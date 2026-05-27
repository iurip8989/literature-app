import * as pdfjsLib from 'pdfjs-dist'
import type { Language } from '../types'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

export interface ExtractedInfo {
  title: string
  authors: string[]
  year: number | null
  abstract: string
  language: Language
  pageCount: number
  doi: string | null
  arxivId: string | null
}

// ── Language detection ────────────────────────────────────────────────────────
// Japanese is detected by the presence of hiragana/katakana, which are unique
// to Japanese. Chinese uses CJK characters without those scripts. Otherwise English.

function detectLanguage(text: string): Language {
  const hiragana = (text.match(/[ぁ-ゖゝ-ゟ]/g) ?? []).length
  const katakana = (text.match(/[゠-ヿㇰ-ㇿ]/g) ?? []).length
  const cjk     = (text.match(/[一-鿿㐀-䶿豈-﫿]/g) ?? []).length
  const latin   = (text.match(/[a-zA-Z]/g) ?? []).length
  const total   = hiragana + katakana + cjk + latin

  if (total === 0) return 'en'
  if (hiragana + katakana >= 3) return 'jp'
  if (cjk / total > 0.25 && latin / total < 0.5) return 'zh'
  return 'en'
}

// ── Text item helpers ─────────────────────────────────────────────────────────

interface TItem { str: string; height: number; width: number; x: number; y: number }

// Group flat text items into visual lines (same Y ± 2 units). Each line keeps
// its items sorted by x so downstream code can reason about character spacing.
function toLines(items: TItem[]): Array<{ y: number; text: string; maxH: number; items: TItem[] }> {
  const lines: Array<{ y: number; parts: TItem[] }> = []
  for (const item of items) {
    const line = lines.find(l => Math.abs(l.y - item.y) < 3)
    if (line) line.parts.push(item)
    else lines.push({ y: item.y, parts: [item] })
  }
  // Sort each line by x (left-to-right reading order), then join with space and
  // collapse runs. This keeps author lines readable when PDF.js delivers items
  // in non-reading order.
  return lines.map(l => {
    const sorted = l.parts.slice().sort((a, b) => a.x - b.x)
    return {
      y: l.y,
      text: sorted.map(p => p.str).join(' ').replace(/\s+/g, ' ').trim(),
      maxH: Math.max(...sorted.map(p => p.height)),
      items: sorted,
    }
  }).filter(l => l.text.length > 0)
}

// ── Quality filters ───────────────────────────────────────────────────────────

// Returns true if the title looks like an editorial artefact, not a real title
function isJunkTitle(t: string): boolean {
  if (!t || t.length < 4) return true
  if (/^(untitled|document|microsoft\s*word|新規|無題|temp|draft)/i.test(t)) return true
  // Special symbols that appear in editorial headers but not real titles
  if (/[★☆▼▲◆■□①-⑩⑪-⑳\/\/進行中]/.test(t)) return true
  // All numbers / pure punctuation
  if (/^[\d０-９\s\-—.·。、,，！!()（）【】]+$/.test(t)) return true
  // arXiv paper IDs used as filenames, e.g. "2605.22794v1"
  if (/^\d{4}\.\d{4,6}(v\d+)?$/.test(t)) return true
  // Adobe InDesign source filenames leaked into PDF.Title metadata
  if (/\.indd(\s|$|\.)/i.test(t)) return true
  // Japanese typesetting workflow suffixes (入稿/校正/最終/FIX) in filenames
  if (/_(入稿|校正|最終|FIX|fix|final|印刷|提出|再校|初校|念校|責了)(\s|$|\.|_)/i.test(t)) return true
  return false
}

// ── Title extraction from first page ─────────────────────────────────────────
// Multi-line titles (common in arXiv / journal PDFs) are merged when consecutive
// lines share the same font size (within 80 %) and have a small vertical gap
// (< 2.5 × line height). The merge stops when font size drops sharply (authors
// are typically ≥ 25 % smaller than the title).

function extractTitleFromPage(items: TItem[], pageHeight: number): string {
  // Exclude header/footer zones (top/bottom 8 % of page height)
  const content = items.filter(i => i.y > pageHeight * 0.08 && i.y < pageHeight * 0.92)
  // Keep ALL lines for gap arithmetic; junk filter applied only to selection
  const allLines = toLines(content).sort((a, b) => b.y - a.y) // top-of-page first

  if (allLines.length === 0) return ''

  const nonJunk = allLines.filter(l => l.text.length >= 4 && !isJunkTitle(l.text))
  if (nonJunk.length === 0) return ''

  const maxH = Math.max(...nonJunk.map(l => l.maxH))

  // Find the first non-junk line with large font — this is the title start
  const startIdx = allLines.findIndex(
    l => l.text.length >= 4 && !isJunkTitle(l.text) && l.maxH >= maxH * 0.8,
  )
  if (startIdx < 0) return nonJunk[0].text

  const titleH = allLines[startIdx].maxH
  const parts  = [allLines[startIdx].text]

  // Collect continuation lines (cap at 4 extra lines to prevent runaway)
  for (let i = startIdx + 1; i < allLines.length && parts.length <= 4; i++) {
    const prev = allLines[i - 1]
    const curr = allLines[i]
    const yGap = prev.y - curr.y // positive: curr is below prev in reading order

    // Author / body lines are ≥ 20 % smaller — stop here
    if (curr.maxH < titleH * 0.8) break

    // Large gap signals a new section (e.g. blank line between title and authors)
    if (yGap > titleH * 2.5) break

    // Skip junk lines (e.g. running headers) without ending the title
    if (curr.text.length < 4 || isJunkTitle(curr.text)) continue

    parts.push(curr.text)
  }

  return parts.join(' ')
}

// ── Author extraction from first page ────────────────────────────────────────
//
// Strategy (tried in order per candidate line):
//   1. ITEM-AWARE split — uses each PDF.js item's x position, width and
//      height. Splits on superscript items (affiliation markers like ¹²³),
//      separator items (",", ";", "&", "、", "・"), and large visual gaps.
//      Works for the common case: "Cai¹  Zhang¹  Jia²" with multiple authors
//      separated by space + superscripts on a single line.
//   2. JAPANESE full-name regex — when items are flat (no height/gap signal),
//      e.g. "中田　知生　木村　義文".
//   3. CJK token split — Japanese using "・" / "、" delimiters.
//   4. WESTERN comma split — explicit "A, B, C" lists.
// Falls back to empty if nothing yields a plausible list.

const PERSON_PARTICLES = new Set(['van', 'der', 'de', 'la', 'le', 'di', 'da', 'del', 'al', 'von', 'bin', 'ibn'])

function looksLikePersonName(s: string): boolean {
  if (s.length < 2 || s.length > 50) return false
  // Reject decorative / structural symbols common in Japanese journal headers
  // (e.g. "◆論", "★研究ノート", "【特集】")
  if (/[★☆▼▲◆◇■□※●○◎〇〔〕〘〙〚〛〖〗【】「」『』]/.test(s)) return false
  const words = s.split(/\s+/).filter(w => w.length > 0)
  if (words.length < 1 || words.length > 5) return false

  // CJK-specific rules — stricter than "any CJK is a name". Subtitles like
  // "—長野県のある集落調査から—" contain CJK but are NOT person names.
  if (/[一-鿿]/.test(s)) {
    // Subtitle / parenthetical / colon markers → not a name
    if (/[—–―:：()（）\[\]［］]/.test(s)) return false
    // Hiragana (の/と/に/から/は…) is essentially absent from CJK names but
    // pervasive in Japanese subtitles and abstracts.
    if (/[぀-ゟ]/.test(s)) return false
    // CJK names are short: 姓 + 名 typically ≤ 6 chars, ≤ 10 even with spaces.
    if (s.replace(/\s+/g, '').length > 10) return false
    return true
  }

  // Each Latin word must start uppercase, OR be a known lowercase particle,
  // OR be an initial like "M." / "R.".
  return words.every(w =>
    /^[A-Z]/.test(w) ||
    /^[A-Z]\.?$/.test(w) ||
    PERSON_PARTICLES.has(w.toLowerCase()),
  )
}

// Strip trailing affiliation markers (Unicode supers, *, †, ‡, §, and stray
// digits) from a chunk that's already been assembled.
function stripAffiliation(s: string): string {
  return s.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰\*†‡§\d]+$/u, '').trim()
}

const SEP_ITEM_RX = /^[,;&、，；・／]+$/
const TRAIL_PUNCT_RX = /[,;、，；]+$/

function splitAuthorLineByItems(items: TItem[]): string[] {
  const cleaned = items.filter(i => i.str.trim().length > 0)
  if (cleaned.length === 0) return []

  // Median item height = baseline font size for this line. Anything noticeably
  // smaller is treated as a superscript (affiliation marker).
  const heights = cleaned.map(i => i.height).filter(h => h > 0).sort((a, b) => a - b)
  const medianH = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 0

  const chunks: string[][] = []
  let chunk: string[] = []
  const flush = () => { if (chunk.length > 0) { chunks.push(chunk); chunk = [] } }

  for (let i = 0; i < cleaned.length; i++) {
    const cur = cleaned[i]
    const str = cur.str.trim()

    // Pure separator item ("," or "、" alone)
    if (SEP_ITEM_RX.test(str)) { flush(); continue }

    // Superscript / affiliation marker (smaller font than line baseline)
    if (medianH > 0 && cur.height > 0 && cur.height < medianH * 0.75) {
      flush()
      continue
    }

    // Embedded trailing punctuation ("Cai,") → push the part before, then split
    if (TRAIL_PUNCT_RX.test(str)) {
      chunk.push(str.replace(TRAIL_PUNCT_RX, ''))
      flush()
      continue
    }

    chunk.push(cur.str)

    // Large x gap after this item → author boundary. Threshold ~0.8× baseline
    // font height: a normal word space is ~0.3×, an author boundary is ≥ 0.8×.
    const next = cleaned[i + 1]
    if (next && medianH > 0) {
      const gap = next.x - (cur.x + (cur.width || 0))
      if (gap > medianH * 0.8) flush()
    }
  }
  flush()

  return chunks
    .map(parts => parts.join(' ').replace(/\s+/g, ' ').trim())
    .map(stripAffiliation)
    .filter(s => s.length >= 2 && s.length < 60)
    .filter(s => /[A-Za-z一-鿿]/.test(s))
    .filter(looksLikePersonName)
}

function extractAuthorsFromPage(items: TItem[], titleText: string, pageHeight: number): string[] {
  const content = items.filter(i => i.y > pageHeight * 0.05 && i.y < pageHeight * 0.95)
  const lines = toLines(content).sort((a, b) => b.y - a.y) // top-of-page first

  const titleIdx = lines.findIndex(l =>
    titleText.length > 0 && l.text.includes(titleText.slice(0, Math.min(8, titleText.length))),
  )

  // Two candidate windows: after title, and page-end fallback
  const afterStart = titleIdx >= 0 ? titleIdx + 1 : 0
  const afterTitle = lines.slice(afterStart, afterStart + 7)
  const pageEnd    = lines.slice(-5)
  const windows    = [afterTitle, pageEnd]

  for (const window of windows) {
    for (const line of window) {
      const text = line.text
      if (text.length < 2 || text.length > 200) continue
      // Skip lines that are part of a multi-line title (spillover protection)
      if (titleText.length > 0 && titleText.includes(text)) continue

      // 1. Item-aware split (best for most academic layouts)
      const rich = splitAuthorLineByItems(line.items)
      if (rich.length >= 1 && rich.length <= 15) return rich

      // 2. Japanese full-name regex (CJK + 全角/半角 space + CJK)
      const jpFullNames = [...text.matchAll(/[一-鿿㐀-䶿]{1,4}[　 ][一-鿿㐀-䶿]{1,4}/g)]
        .map(m => m[0].trim())
      if (jpFullNames.length >= 1 && jpFullNames.length <= 8) return jpFullNames

      // 3. Japanese tokens split on ・, 、, ；
      const jpTokens = text.split(/[・、；;／]+/).map(s => s.trim()).filter(s => {
        if (s.length < 2 || s.length > 12) return false
        const cjkKana = (s.match(/[　-鿿]/g) ?? []).length
        return cjkKana / s.length >= 0.5
      })
      if (jpTokens.length >= 1 && jpTokens.length <= 8) return jpTokens

      // 4. Western comma-separated list
      if (/,/.test(text)) {
        const names = text.split(/[,;&]+/).map(s => stripAffiliation(s.trim()))
          .filter(s => s.length >= 2 && s.length < 60)
          .filter(looksLikePersonName)
        if (names.length >= 1 && names.length <= 10) return names
      }
    }
  }

  return [] // leave blank rather than guessing
}

// ── Year extraction ───────────────────────────────────────────────────────────
//
// Strategy (region-weighted, four passes — first hit wins):
//
//   Pass 1: Explicit pub-year markers in PRIORITY region (top 25 % + bottom
//           25 % of page 1). Publication info lives in headers/footers;
//           references cluster in the middle band, so this isolates the
//           authoritative signal. Markers: © / Copyright / 年 / Vol. (YYYY) /
//           発行・公開・刊行・受付・受理・採択 / Published in YYYY / etc.
//
//   Pass 2: Same explicit markers, but on the FULL first-page text.
//
//   Pass 3: Frequency on raw 4-digit years in PRIORITY region. Tie-break
//           prefers the EARLIER year (references are usually ≤ publication
//           year, so the publication year tends to be the smallest of any
//           cluster tied for most frequent).
//
//   Pass 4: Frequency on full text (last resort).
//
// Note: PDF metadata CreationDate is intentionally NOT consulted here — many
// Japanese journals re-typeset old papers and CreationDate ends up being the
// re-typeset date. The caller falls back to CreationDate only if all four
// passes yield nothing.

const YEAR_EXPLICIT_PATTERNS: RegExp[] = [
  // High-confidence: explicit copyright / publication markers
  /(?:©|copyright|\(c\))\s*((?:19|20)\d{2})/i,
  /\b((?:19|20)\d{2})\s*年/,                                  // JP/ZH "2020年"
  /(?:published|publication\s*date|to\s*appear\s*in|in\s*press|first\s*published)\s+(?:in\s+|online\s+)?[^\n]{0,30}?\b((?:19|20)\d{2})\b/i,
  /(?:発行|公開|刊行|印刷|出版|発表)\s*[:：日]?\s*((?:19|20)\d{2})/,
  /\b(?:Vol|Volume|Issue|No)\.?\s*\d+[^\n]{0,60}?\b((?:19|20)\d{2})\b/i,  // "Vol. 32, 2020" or "Vol. X (2020)"
  /\b(19|20)(\d{2})\b\s*\)\s*$/m,                             // line ending with "YYYY)"
  // Lower-confidence: submission timestamps. May differ from publication year
  // by 1-2 years; checked last so the patterns above win when present.
  /(?:受付|受理|採択|投稿)\s*[:：日]?\s*((?:19|20)\d{2})/,
  /(?:received|accepted|revised)\s*[:\s][^\n]{0,30}?\b((?:19|20)\d{2})\b/i,
]

function frequencyYear(text: string, isValid: (y: number) => boolean): number | null {
  const matches = text.match(/\b(?:19|20)\d{2}\b/g)
  if (!matches) return null
  const years = matches.map(Number).filter(isValid)
  if (years.length === 0) return null
  const freq = new Map<number, number>()
  for (const y of years) freq.set(y, (freq.get(y) ?? 0) + 1)
  // Highest frequency first; tie → earlier year (references skew newer than
  // the publication year, so the earlier of two tied years is usually it)
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  return sorted[0][0]
}

function tryExplicit(text: string, isValid: (y: number) => boolean): number | null {
  for (const rx of YEAR_EXPLICIT_PATTERNS) {
    const m = text.match(rx)
    if (!m) continue
    const yStr = m[2] ? `${m[1]}${m[2]}` : m[1]
    const y = parseInt(yStr)
    if (isValid(y)) return y
  }
  return null
}

function extractYear(items: TItem[], pageHeight: number, fullText: string): number | null {
  const current = new Date().getFullYear()
  const isValid = (y: number) => y >= 1990 && y <= current + 1

  // Build priority text: top 25 % (header) + bottom 25 % (footer / copyright)
  // PDF y-axis: 0 = bottom of page, so "header" lives at large y values.
  const priorityItems = items.filter(i => i.y > pageHeight * 0.75 || i.y < pageHeight * 0.25)
  const priorityText = priorityItems
    .slice()
    .sort((a, b) => (b.y - a.y) || (a.x - b.x))
    .map(i => i.str).join(' ').replace(/\s+/g, ' ')

  return tryExplicit(priorityText, isValid)
      ?? tryExplicit(fullText, isValid)
      ?? frequencyYear(priorityText, isValid)
      ?? frequencyYear(fullText, isValid)
}

// ── Filename → title fallback ─────────────────────────────────────────────────

function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')  // strip extension
    .replace(/[_\-]+/g, ' ') // normalize separators
    .trim()
}

// ── DOI / arXiv ID extraction ─────────────────────────────────────────────────

function cleanDoi(doi: string): string {
  return doi.replace(/[.,;'")\]>]+$/, '').trim()
}

function findDoi(haystacks: string[], info: Record<string, unknown>): string | null {
  // PDF.js metadata contains non-string values (booleans like IsLinearized);
  // skip those rather than calling .match on them.
  for (const val of Object.values(info)) {
    if (typeof val !== 'string') continue
    const m = val.match(/\b(10\.\d{4,}\/[^\s,;'")\]>]+)/)
    if (m) return cleanDoi(m[1])
  }
  for (const t of haystacks) {
    const m = t.match(/\b(10\.\d{4,}\/[^\s,;'")\]>]+)/)
    if (m) return cleanDoi(m[1])
  }
  return null
}

function findArxivId(haystacks: string[], info: Record<string, unknown>): string | null {
  for (const val of Object.values(info)) {
    if (typeof val !== 'string') continue
    const m = val.match(/arxiv[:\s/]*(\d{4}\.\d{4,6})(?:v\d+)?/i)
    if (m) return m[1]
  }
  // Labeled patterns: "arXiv:NNNN.NNNNN" or "arxiv.org/abs/NNNN.NNNNN"
  const labeled = [
    /arxiv[:\s]*(\d{4}\.\d{4,6})(?:v\d+)?/i,
    /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,6})(?:v\d+)?/i,
  ]
  for (const t of haystacks) {
    for (const pat of labeled) {
      const m = t.match(pat)
      if (m) return m[1]
    }
  }
  // Fallback: standalone arXiv-shaped ID without "arXiv" prefix.
  // Constrained to plausible YYMM (year 19xx-29xx, month 01-12) to avoid
  // false-positive matches like "1234.56789".
  const standalone = /\b((?:19|20|21|22|23|24|25|26|27|28|29)(?:0[1-9]|1[0-2])\.\d{4,6})(?:v\d+)?\b/
  for (const t of haystacks) {
    const m = t.match(standalone)
    if (m) return m[1]
  }
  return null
}

// ── Main export ───────────────────────────────────────────────────────────────
//
// Extraction strategy (each field falls through until something is found):
//
//  LANGUAGE  page-1 text → hiragana/katakana ≥ 3 → "jp"
//                        → CJK dominant (> 25 %, Latin < 50 %) → "zh"
//                        → otherwise "en"
//
//  TITLE     1. PDF metadata Title (if non-empty and passes junk filter)
//            2. Filename (strip extension; often more reliable than in-PDF text)
//            3. Largest-font line on page 1 (excluding header/footer zones)
//            4. Raw filename as last resort
//
//  AUTHORS   1. PDF metadata Author
//            2. Page-1 text: lines after title (patterns A/B/C in order)
//            3. Page-1 text: last 5 lines fallback (Japanese journals)
//            4. Empty — user fills in manually
//
//  YEAR      1. Explicit pub-year markers in page-1 text (© / 年 / Vol. (yyyy))
//            2. Most-frequent year in page-1 text (tie → earlier year)
//            3. PDF CreationDate metadata (only as last resort — re-typeset
//               PDFs make this unreliable for Japanese journals)
//            4. Empty (null)
//
export async function extractPdfInfo(file: File): Promise<ExtractedInfo> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const meta = await pdf.getMetadata().catch(() => ({ info: {} }))
  const info = (meta.info ?? {}) as Record<string, string>

  // ── First-page text items with font heights ───────────────────────────────
  let pageItems: TItem[] = []
  let pageHeight = 842
  let firstPageText = ''
  let rotatedText = ''  // concatenation of rotated items only (arXiv margin stamp)

  try {
    const page = await pdf.getPage(1)
    pageHeight = page.getViewport({ scale: 1 }).height
    const tc = await page.getTextContent()
    type RawItem = { str?: string; transform?: number[]; height?: number; width?: number }
    const rawItems = (tc.items as RawItem[]).filter(i => (i.str ?? '').trim().length > 0)

    pageItems = rawItems.map(i => {
      const t = i.transform ?? [0, 0, 0, 0, 0, 0]
      return {
        str:    i.str!,
        height: i.height ?? Math.abs(t[3] || 12),
        width:  i.width ?? 0,
        x:      t[4] ?? 0,
        y:      t[5] ?? 0,
      }
    })
    firstPageText = pageItems.map(i => i.str).join(' ')

    // Rotated text: items whose transform has non-zero off-diagonal terms.
    // arXiv stamps are typically rotated 90° in the left margin; PDF.js extracts
    // each character as its own item, but they all share the rotation.
    const rotatedItems = rawItems.filter(i => {
      const t = i.transform ?? [1, 0, 0, 1, 0, 0]
      return Math.abs(t[1] ?? 0) > 0.01 || Math.abs(t[2] ?? 0) > 0.01
    })
    rotatedText = rotatedItems.map(i => i.str ?? '').join('')
  } catch { /* ignore — proceed with whatever we got */ }

  // Condensed text (no spaces) for catching IDs split across adjacent items.
  const condensedText = pageItems.map(i => i.str).join('')

  // ── DOI / arXiv detection: do this BEFORE title/author extraction so a
  //    throw in those heuristics can't drop the IDs we already found ─────────
  const haystacks = [firstPageText, condensedText, rotatedText].filter(s => s.length > 0)
  const doi     = findDoi(haystacks, info)
  const arxivId = findArxivId(haystacks, info)

  // ── Language (based on first-page text) ──────────────────────────────────
  const language = detectLanguage(firstPageText)

  // ── Title: priority order ─────────────────────────────────────────────────
  //    Wrapped in try/catch so a throw in extractTitleFromPage can't drop the
  //    DOI/arXiv IDs we already found above.
  let title = ''
  try {
    const metaTitle = (info.Title ?? '').trim()
    if (metaTitle.length >= 4 && !isJunkTitle(metaTitle)) {
      title = metaTitle
    }
    if (!title) {
      const fnTitle = titleFromFilename(file.name)
      if (fnTitle.length >= 4 && !isJunkTitle(fnTitle)) title = fnTitle
    }
    if (!title) {
      title = extractTitleFromPage(pageItems, pageHeight)
    }
  } catch { /* fall through to filename */ }
  if (!title) title = titleFromFilename(file.name)

  // ── Authors ───────────────────────────────────────────────────────────────
  let authors: string[] = []
  try {
    const metaAuthor = (info.Author ?? '').trim()
    if (metaAuthor) {
      authors = metaAuthor.split(/[;,]+/).map(s => s.trim()).filter(Boolean)
    }
    if (authors.length === 0) {
      authors = extractAuthorsFromPage(pageItems, title, pageHeight)
    }
  } catch { /* leave authors empty — user can fill in manually */ }

  // ── Year ──────────────────────────────────────────────────────────────────
  // Text-first: cues in the paper body are more authoritative than the PDF
  // file's CreationDate (which reflects re-typesetting, not publication).
  let year: number | null = extractYear(pageItems, pageHeight, firstPageText)
  if (!year && typeof info.CreationDate === 'string' && info.CreationDate.length >= 6) {
    const y = parseInt(info.CreationDate.substring(2, 6))
    if (y >= 1990 && y <= new Date().getFullYear() + 1) year = y
  }

  // ── Abstract ─────────────────────────────────────────────────────────────
  const abstractMatch = firstPageText.match(/(?:Abstract|要旨|概要|摘要)[:\s：]+(.{60,600})/i)
  const abstract = abstractMatch ? abstractMatch[1].trim() : ''

  return { title, authors, year, abstract, language, pageCount: pdf.numPages, doi, arxivId }
}

// Re-export for callers that need the pdfjs instance (PdfViewer)
export { pdfjsLib }

// ── Full-text extraction (for AI summary input) ──────────────────────────────
//
// Extract concatenated text from the whole PDF for use as Claude API input.
//
// Token budget strategy:
//   - Target ~12K tokens of input (well under any model's window, low cost)
//   - English: ~4 chars/token → budget ≈ 40000 chars
//   - CJK (zh/jp): ~1.5 chars/token → budget ≈ 18000 chars
//   - Mixed text: detect by CJK ratio and pick the appropriate budget
//
// Truncation: when the full text exceeds budget, we keep the HEAD + TAIL with
// a marker in the middle. Rationale: abstract & introduction usually live at
// the front, conclusions at the back; section headings and citations are
// noisier middle content that loses less when dropped.

export interface FullTextResult {
  text: string
  pageCount: number
  truncated: boolean
  originalLength: number
}

const HEAD_RATIO = 0.7   // 70% of budget from the start of the document
const TAIL_RATIO = 0.3   // 30% from the end (conclusions / discussion)

function pickBudget(text: string): number {
  // Sample the first 2K chars to estimate language; full-text CJK ratio is
  // similar to the head's, and this avoids scanning megabytes upfront.
  const sample = text.slice(0, 2000)
  const cjk = (sample.match(/[一-鿿぀-ヿ]/g) ?? []).length
  const cjkRatio = sample.length > 0 ? cjk / sample.length : 0
  return cjkRatio > 0.2 ? 18000 : 40000
}

function truncateHeadTail(text: string, budget: number): string {
  if (text.length <= budget) return text
  const headLen = Math.floor(budget * HEAD_RATIO)
  const tailLen = Math.floor(budget * TAIL_RATIO)
  const head = text.slice(0, headLen)
  const tail = text.slice(text.length - tailLen)
  return `${head}\n\n[... 中间部分省略以适应上下文长度 ...]\n\n${tail}`
}

export async function extractFullPdfText(file: File): Promise<FullTextResult> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i)
      const tc = await page.getTextContent()
      const pageText = (tc.items as Array<{ str?: string }>)
        .map(it => it.str ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (pageText.length > 0) pages.push(pageText)
    } catch { /* skip unreadable page, continue */ }
  }

  const fullText = pages.join('\n\n')
  const budget = pickBudget(fullText)
  const truncated = fullText.length > budget
  const text = truncated ? truncateHeadTail(fullText, budget) : fullText

  return {
    text,
    pageCount: pdf.numPages,
    truncated,
    originalLength: fullText.length,
  }
}
