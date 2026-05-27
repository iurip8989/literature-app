import { useState, useRef } from 'react'
import { useAppContext } from '../../store/AppContext'
import { useFileContent } from '../../hooks/useFileContent'
import PdfViewer from './PdfViewer'
import DocxViewer from './DocxViewer'
import type { Paper, PaperFile, FileType } from '../../types'
import { generateId, now } from '../../utils/helpers'
import { getFileFormat, githubFilePath, formatFileSize } from '../../utils/fileUtils'
import { uploadPaperFile, deleteFile } from '../../utils/github'
import { saveFileBlob, deleteFileBlob } from '../../store/db'
import './FileTab.css'

interface Props {
  paper: Paper
  fileType: 'original' | 'translation'
  onUpdate: (paper: Paper) => void
}

function FileViewer({
  paper,
  file,
  pat,
  username,
  repo,
}: {
  paper: Paper
  file: PaperFile
  pat: string
  username: string
  repo: string
}) {
  const { blob, loading, error } = useFileContent(
    paper.id, file.id, file.githubPath, pat, username, repo,
  )

  if (loading) return <div className="file-loading">加载文件中…</div>
  if (error) return <p className="viewer-error">{error}</p>
  if (!blob) return null

  if (file.format === 'pdf') return <PdfViewer blob={blob} />
  if (file.format === 'docx') return <DocxViewer blob={blob} />
  return <p className="viewer-error">不支持预览此格式（{file.format}）</p>
}

export default function FileTab({ paper, fileType, onUpdate }: Props) {
  const { settings } = useAppContext()
  const { githubPat: pat = '', githubUsername: username = '', githubRepo: repo = '' } = settings

  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const files = paper.files.filter(f =>
    fileType === 'translation' ? f.type === 'translation' : f.type !== 'translation',
  )

  const activeFile = files.find(f => f.id === activeFileId) ?? files[0] ?? null

  const handleUpload = async (rawFile: File) => {
    const format = getFileFormat(rawFile.name)
    if (!format) {
      setUploadError('仅支持 PDF、DOCX、TXT、MD 格式')
      return
    }
    setUploading(true)
    setUploadError('')

    const fileId = generateId()
    const ext = rawFile.name.split('.').pop()!
    const arrayBuffer = await rawFile.arrayBuffer()
    const blob = new Blob([arrayBuffer], { type: rawFile.type })

    await saveFileBlob(paper.id, fileId, blob)

    let githubPath: string | undefined
    let githubSha: string | undefined

    if (!paper.isPrivate && pat && username && repo) {
      try {
        const type: FileType = fileType === 'translation' ? 'translation' : 'original'
        const path = githubFilePath(type, paper.id, fileId, ext)
        const sha = await uploadPaperFile(pat, username, repo, path, arrayBuffer, `upload: ${rawFile.name}`)
        githubPath = path
        githubSha = sha
      } catch (err) {
        setUploadError(`GitHub 上传失败：${(err as Error).message}，文件已保存到本地`)
      }
    }

    const paperFile: PaperFile = {
      id: fileId,
      type: fileType === 'translation' ? 'translation' : 'original',
      filename: rawFile.name,
      githubPath,
      githubSha,
      format,
      size: rawFile.size,
      addedAt: now(),
    }

    onUpdate({ ...paper, files: [...paper.files, paperFile], updatedAt: now() })
    setActiveFileId(fileId)
    setUploading(false)
  }

  const handleDelete = async (pf: PaperFile) => {
    setDeletingId(pf.id)
    if (pf.githubPath && pf.githubSha && pat && username && repo) {
      try {
        await deleteFile(pat, username, repo, pf.githubPath, pf.githubSha, `delete: ${pf.filename}`)
      } catch { /* ignore */ }
    }
    await deleteFileBlob(paper.id, pf.id)
    onUpdate({ ...paper, files: paper.files.filter(f => f.id !== pf.id), updatedAt: now() })
    if (activeFileId === pf.id) setActiveFileId(null)
    setDeletingId(null)
  }

  const typeLabel = fileType === 'translation' ? '译本' : '原文'

  return (
    <div className="file-tab">
      {/* File list + upload row */}
      <div className="file-sidebar">
        <div className="file-list">
          {files.length === 0 ? (
            <p className="file-empty-hint">还没有{typeLabel}文件</p>
          ) : (
            files.map(f => (
              <div
                key={f.id}
                className={`file-item ${activeFile?.id === f.id ? 'active' : ''}`}
                onClick={() => setActiveFileId(f.id)}
              >
                <span className="file-icon">{f.format === 'pdf' ? '📄' : '📝'}</span>
                <span className="file-name" title={f.filename}>{f.filename}</span>
                {f.size != null && <span className="file-size">{formatFileSize(f.size)}</span>}
                {!f.githubPath && <span className="file-local-badge" title="仅本地">🔒</span>}
                <button
                  className="file-del-btn"
                  title="删除文件"
                  onClick={e => { e.stopPropagation(); handleDelete(f) }}
                  disabled={deletingId === f.id}
                >
                  {deletingId === f.id ? '…' : '✕'}
                </button>
              </div>
            ))
          )}
        </div>

        <div className="file-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) handleUpload(f)
              e.target.value = ''
            }}
          />
          <button
            className="btn-secondary file-upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? '上传中…' : `＋ 上传${typeLabel}`}
          </button>
          {paper.isPrivate && (
            <span className="file-private-note">🔒 仅本地，不上传 GitHub</span>
          )}
        </div>

        {uploadError && <p className="file-upload-error">{uploadError}</p>}
      </div>

      {/* Viewer panel */}
      <div className="file-viewer-panel">
        {activeFile ? (
          <FileViewer paper={paper} file={activeFile} pat={pat} username={username} repo={repo} />
        ) : (
          <div className="file-viewer-empty">
            <span>选择左侧文件预览</span>
          </div>
        )}
      </div>
    </div>
  )
}
