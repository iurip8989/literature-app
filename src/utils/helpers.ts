export function generateId(): string {
  return crypto.randomUUID()
}

export function now(): string {
  return new Date().toISOString()
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isWithinMonths(iso: string, months: number): boolean {
  const ms = months * 30 * 24 * 60 * 60 * 1000
  return Date.now() - new Date(iso).getTime() <= ms
}

export function parseAuthors(raw: string): string[] {
  return raw.split(/[,，;；]+/).map(s => s.trim()).filter(Boolean)
}

export function getLanguageLabel(lang: string): string {
  const map: Record<string, string> = { en: 'EN', jp: 'JP', zh: 'ZH', other: '—' }
  return map[lang] ?? '—'
}

export function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    unread: '未读', reading: '在读', done: '已读', deep: '精读',
  }
  return map[status] ?? status
}
