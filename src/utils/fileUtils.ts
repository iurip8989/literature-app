import type { FileFormat, FileType, Language } from '../types'

export function getFileFormat(filename: string): FileFormat | null {
  const ext = filename.toLowerCase().split('.').pop()
  const map: Record<string, FileFormat> = { pdf: 'pdf', docx: 'docx', txt: 'txt', md: 'md' }
  return map[ext ?? ''] ?? null
}

export function detectLanguageFromText(text: string): Language {
  const hiragana = (text.match(/[ぁ-ゖゝ-ゟ]/g) ?? []).length
  const katakana = (text.match(/[゠-ヿㇰ-ㇿ]/g) ?? []).length
  const cjk     = (text.match(/[一-鿿㐀-䶿豈-﫿]/g) ?? []).length
  const latin   = (text.match(/[a-zA-Z]/g) ?? []).length
  const total   = hiragana + katakana + cjk + latin
  if (total === 0) return 'en'
  if (hiragana + katakana >= 3) return 'jp'
  if (cjk / total > 0.25 && latin / total < 0.5) return 'zh'
  return 'en'
}

export function extractYearFromText(text: string): number | null {
  const current = new Date().getFullYear()
  const matches = text.match(/\b(19|20)\d{2}\b/g)
  if (!matches) return null
  const years = matches.map(Number).filter(y => y >= 1900 && y <= current + 1)
  return years.length > 0 ? years[0] : null
}

export function isTranslationFilename(filename: string): boolean {
  return /(_cn|_zh|_中文|_translated|_translation|_翻译)/i.test(filename)
}

// e.g. "papers/paperId-fileId.pdf"
export function githubFilePath(
  type: FileType,
  paperId: string,
  fileId: string,
  ext: string,
): string {
  const dir = type === 'translation' ? 'translations' : 'papers'
  return `${dir}/${paperId}-${fileId}.${ext}`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// GitHub Contents API limit ~18MB (base64 overhead pushes past 25MB limit)
export const CONTENTS_API_MAX_BYTES = 18 * 1024 * 1024
export const GITHUB_MAX_BYTES = 100 * 1024 * 1024
