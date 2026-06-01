import { Octokit } from '@octokit/rest'
import type { Paper } from '../types'

// UTF-8 safe base64 encoding/decoding
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function fromBase64(b64: string): string {
  const binary = atob(b64.replace(/\n/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

function fromBase64Binary(b64: string): ArrayBuffer {
  const binary = atob(b64.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

export function createOctokit(pat: string): Octokit {
  return new Octokit({ auth: pat })
}

// Verify PAT has access to the given repo
export async function validateConnection(
  pat: string,
  username: string,
  repo: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const octokit = createOctokit(pat)
    await octokit.repos.get({ owner: username, repo })
    return { ok: true }
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 401) return { ok: false, error: 'Token 无效或已过期，请重新生成' }
    if (status === 404) return { ok: false, error: '仓库不存在，或 Token 没有访问该仓库的权限' }
    if (status === 403) return { ok: false, error: '权限不足，请检查 Token 的 Contents 权限是否为 Read and write' }
    return { ok: false, error: (err as Error).message ?? '网络连接失败，请检查网络后重试' }
  }
}

// Initialize repo structure (idempotent — safe to call on an existing repo)
export async function initializeRepo(
  pat: string,
  username: string,
  repo: string,
): Promise<void> {
  const octokit = createOctokit(pat)

  const ensureFile = async (path: string, content: string, message: string) => {
    try {
      await octokit.repos.getContent({ owner: username, repo, path })
      // File already exists, skip
    } catch (err) {
      if ((err as { status?: number }).status === 404) {
        await octokit.repos.createOrUpdateFileContents({
          owner: username,
          repo,
          path,
          message,
          content: toBase64(content),
        })
      } else {
        throw err
      }
    }
  }

  await ensureFile(
    'metadata.json',
    JSON.stringify([], null, 2),
    'init: 初始化文献库元数据',
  )
  await ensureFile('papers/.gitkeep', '', 'init: 创建 papers 目录')
  await ensureFile('translations/.gitkeep', '', 'init: 创建 translations 目录')
  await ensureFile(
    'README.md',
    [
      '# 文献库 · 数据仓库',
      '',
      '这是 **文献库** 应用的数据存储仓库，由应用自动管理。',
      '',
      '## 目录结构',
      '',
      '- `metadata.json` — 所有文献的元数据',
      '- `papers/` — 原文 PDF 文件',
      '- `translations/` — 中文译本文件',
      '',
      '> 请勿手动修改文件内容，否则可能导致数据不一致。',
    ].join('\n'),
    'init: 创建说明文档',
  )
}

// Read metadata.json from repo, returns papers array + current file SHA
// metadata.json shape — v2 is a wrapper object that carries both papers and
// tag records. v1 was a bare `Paper[]` array; `fetchMetadata` accepts both so
// users upgrading from MVP don't lose data.
//
//   v1 (legacy):  Paper[]
//   v2 (current): { version: 2, papers: Paper[], tags: Tag[] }
//
// `pushMetadata` always writes v2. Old clients reading v2 would break, but
// there's only one writer per user (their own app instance).

import type { Tag } from '../types'

interface MetadataFileV2 {
  version: 2
  papers: Paper[]
  tags: Tag[]
}

export async function fetchMetadata(
  pat: string,
  username: string,
  repo: string,
): Promise<{ papers: Paper[]; tags: Tag[]; sha: string }> {
  const octokit = createOctokit(pat)
  const res = await octokit.repos.getContent({ owner: username, repo, path: 'metadata.json' })
  const file = res.data as { content: string; sha: string }
  const parsed = JSON.parse(fromBase64(file.content)) as MetadataFileV2 | Paper[]

  // v1 → v2 migration on read
  if (Array.isArray(parsed)) {
    return { papers: parsed, tags: [], sha: file.sha }
  }
  return {
    papers: parsed.papers ?? [],
    tags: parsed.tags ?? [],
    sha: file.sha,
  }
}

// Write papers + tags back to metadata.json; returns new file SHA
export async function pushMetadata(
  pat: string,
  username: string,
  repo: string,
  papers: Paper[],
  tags: Tag[],
  sha: string,
): Promise<string> {
  const octokit = createOctokit(pat)
  const body: MetadataFileV2 = { version: 2, papers, tags }
  const res = await octokit.repos.createOrUpdateFileContents({
    owner: username,
    repo,
    path: 'metadata.json',
    message: `sync: 更新文献库 (${papers.length} 篇, ${tags.length} 标签)`,
    content: toBase64(JSON.stringify(body, null, 2)),
    sha,
  })
  return (res.data.content as { sha: string }).sha
}

// Upload a binary file (PDF/DOCX) to papers/ or translations/
export async function uploadFile(
  pat: string,
  username: string,
  repo: string,
  path: string,        // e.g. "papers/uuid.pdf"
  arrayBuffer: ArrayBuffer,
  message: string,
): Promise<string> {
  const octokit = createOctokit(pat)
  let binary = ''
  const bytes = new Uint8Array(arrayBuffer)
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const res = await octokit.repos.createOrUpdateFileContents({
    owner: username,
    repo,
    path,
    message,
    content: btoa(binary),
  })
  return (res.data.content as { sha: string }).sha
}

// Download a file from the repo as ArrayBuffer + return its current SHA
export async function fetchFileContent(
  pat: string,
  username: string,
  repo: string,
  path: string,
): Promise<{ content: ArrayBuffer; sha: string }> {
  const octokit = createOctokit(pat)
  const res = await octokit.repos.getContent({ owner: username, repo, path })
  const file = res.data as { content?: string; encoding?: string; sha: string }

  // The Contents API only inlines `content` for files up to 1 MB; for larger
  // files it returns an empty body with `encoding: "none"`. Fall back to the
  // Git Blobs API, which returns base64 content for any blob up to 100 MB.
  if (!file.content || file.encoding === 'none') {
    const blob = await octokit.git.getBlob({ owner: username, repo, file_sha: file.sha })
    return {
      content: fromBase64Binary(blob.data.content),
      sha: file.sha,
    }
  }

  return {
    content: fromBase64Binary(file.content),
    sha: file.sha,
  }
}

// Upload using Git Data API — handles files that would exceed the Contents API 25 MB limit
async function uploadFileLarge(
  pat: string,
  username: string,
  repo: string,
  path: string,
  arrayBuffer: ArrayBuffer,
  message: string,
): Promise<string> {
  const octokit = createOctokit(pat)
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])

  // 1. Create blob
  const blobRes = await octokit.git.createBlob({
    owner: username, repo,
    content: btoa(binary),
    encoding: 'base64',
  })
  const blobSha = blobRes.data.sha

  // 2. Get HEAD commit + its tree
  const refRes = await octokit.git.getRef({ owner: username, repo, ref: 'heads/main' })
  const headSha = refRes.data.object.sha
  const commitRes = await octokit.git.getCommit({ owner: username, repo, commit_sha: headSha })
  const treeSha = commitRes.data.tree.sha

  // 3. New tree that adds / replaces the file
  const treeRes = await octokit.git.createTree({
    owner: username, repo,
    base_tree: treeSha,
    tree: [{ path, mode: '100644', type: 'blob', sha: blobSha }],
  })

  // 4. New commit
  const newCommit = await octokit.git.createCommit({
    owner: username, repo,
    message,
    tree: treeRes.data.sha,
    parents: [headSha],
  })

  // 5. Update branch ref
  await octokit.git.updateRef({
    owner: username, repo,
    ref: 'heads/main',
    sha: newCommit.data.sha,
  })

  return blobSha
}

// Smart upload: Contents API for small files, Git Data API for large files
export async function uploadPaperFile(
  pat: string,
  username: string,
  repo: string,
  path: string,
  arrayBuffer: ArrayBuffer,
  message: string,
): Promise<string> {
  const CONTENTS_LIMIT = 18 * 1024 * 1024  // ~18 MB (base64 overhead stays < 25 MB)
  if (arrayBuffer.byteLength <= CONTENTS_LIMIT) {
    return uploadFile(pat, username, repo, path, arrayBuffer, message)
  }
  return uploadFileLarge(pat, username, repo, path, arrayBuffer, message)
}

// Delete a file from the repo
export async function deleteFile(
  pat: string,
  username: string,
  repo: string,
  path: string,
  sha: string,
  message: string,
): Promise<void> {
  const octokit = createOctokit(pat)
  await octokit.repos.deleteFile({
    owner: username,
    repo,
    path,
    message,
    sha,
  })
}
