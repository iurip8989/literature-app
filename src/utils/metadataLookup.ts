// ─────────────────────────────────────────────────────────────────────────────
// TODO V2: 自动从外部 API 补全元数据
// ─────────────────────────────────────────────────────────────────────────────
// 此模块在 MVP 阶段【不被调用】。AddPaperDialog 只依赖本地 PDF 提取。
//
// 原因：所有候选 API 在浏览器端都有不同的阻断问题——
//   - CrossRef (DOI):           支持 CORS，可用，但社会学 PDF 不一定带 DOI
//   - arXiv (export.arxiv.org): 不返回 Access-Control-Allow-Origin header
//   - Semantic Scholar:         限流（~100 req/5min），429 时不带 CORS header
//   - OpenAlex:                 需评估，未验证
//
// V2 计划：
//   ① 自建一个简单的 Cloudflare Worker 代理（统一 CORS、可加缓存）；或
//   ② 让用户在 AddPaperDialog 里手动粘贴 DOI 触发查询（仅 CrossRef，确定可用）
//
// MVP 阶段：完全依赖本地 PDF 识别（标题、作者、年份、语言）+ 用户手动修改。
// ─────────────────────────────────────────────────────────────────────────────

export interface MetadataResult {
  title?: string
  authors?: string[]
  year?: number
  venue?: string    // journal / conference name
  doi?: string
  arxivId?: string
  abstract?: string
}

// ── CrossRef (DOI lookup) ─────────────────────────────────────────────────────

export async function lookupCrossRef(doi: string): Promise<MetadataResult> {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`CrossRef ${res.status}`)

  const { message: m } = (await res.json()) as {
    message: {
      title?: string[]
      author?: Array<{ family: string; given?: string }>
      published?: { 'date-parts': number[][] }
      'container-title'?: string[]
      DOI?: string
      abstract?: string
    }
  }

  const authors = (m.author ?? [])
    .map(a => [a.given, a.family].filter(Boolean).join(' '))
    .filter(Boolean)

  const yearParts = m.published?.['date-parts']?.[0]
  const year = yearParts?.[0]

  return {
    title:   m.title?.[0],
    authors: authors.length > 0 ? authors : undefined,
    year,
    venue:   m['container-title']?.[0],
    doi:     m.DOI,
    abstract: m.abstract?.replace(/<[^>]+>/g, '').trim(),  // strip JATS tags
  }
}

// ── arXiv (via Semantic Scholar) ─────────────────────────────────────────────
// We can't hit export.arxiv.org directly from the browser — that endpoint
// doesn't return Access-Control-Allow-Origin headers. Semantic Scholar's
// Graph API indexes arXiv papers and *does* support CORS.

export async function lookupArxiv(arxivId: string): Promise<MetadataResult> {
  const fields = 'title,authors,year,venue,abstract,externalIds'
  const url = `https://api.semanticscholar.org/graph/v1/paper/ARXIV:${encodeURIComponent(arxivId)}?fields=${fields}`
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`Semantic Scholar ${res.status}`)

  const data = (await res.json()) as {
    title?: string
    authors?: Array<{ name?: string }>
    year?: number
    venue?: string
    abstract?: string
    externalIds?: { DOI?: string; ArXiv?: string }
  }

  const authors = (data.authors ?? [])
    .map(a => a.name?.trim() ?? '')
    .filter(Boolean)

  return {
    title:   data.title,
    authors: authors.length > 0 ? authors : undefined,
    year:    data.year,
    venue:   data.venue || 'arXiv preprint',
    arxivId,
    doi:     data.externalIds?.DOI,
    abstract: data.abstract,
  }
}

// ── Auto-lookup: try DOI → arXiv → null ──────────────────────────────────────

export async function autoLookup(
  doi: string | null | undefined,
  arxivId: string | null | undefined,
): Promise<MetadataResult | null> {
  if (doi) {
    try { return await lookupCrossRef(doi) } catch { /* fall through */ }
  }
  if (arxivId) {
    try { return await lookupArxiv(arxivId) } catch { /* fall through */ }
  }
  return null
}
