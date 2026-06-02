import type { Paper } from '../types'

// ── Sort preferences ──────────────────────────────────────────────────────────
//
// Sorting is a purely local *view* preference: it only reorders the displayed
// list, never mutates paper data and never triggers a GitHub sync. The chosen
// field + direction are persisted to localStorage (NOT IndexedDB, NOT the
// synced settings), so each device/browser keeps its own ordering.

export type SortField = 'addedAt' | 'year' | 'title'
export type SortDirection = 'asc' | 'desc'

export interface SortState {
  field: SortField
  direction: SortDirection
}

// First run / empty localStorage: by added time, newest first.
export const DEFAULT_SORT: SortState = { field: 'addedAt', direction: 'desc' }

export const SORT_STORAGE_KEY = 'literature-app.sort'

const VALID_FIELDS: SortField[] = ['addedAt', 'year', 'title']
const VALID_DIRECTIONS: SortDirection[] = ['asc', 'desc']

export function loadSortPref(): SortState {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY)
    if (!raw) return DEFAULT_SORT
    const parsed = JSON.parse(raw) as Partial<SortState>
    if (
      parsed &&
      VALID_FIELDS.includes(parsed.field as SortField) &&
      VALID_DIRECTIONS.includes(parsed.direction as SortDirection)
    ) {
      return { field: parsed.field as SortField, direction: parsed.direction as SortDirection }
    }
  } catch { /* corrupt value — fall back to default */ }
  return DEFAULT_SORT
}

export function saveSortPref(sort: SortState): void {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort))
  } catch { /* storage unavailable (private mode / quota) — non-fatal */ }
}

// A paper's year is "missing" when it's absent, zero, or non-finite. Missing
// years always sort to the bottom regardless of direction (see sortPapers).
function isMissingYear(year: number | undefined | null): boolean {
  return year == null || !Number.isFinite(year) || year <= 0
}

// Returns a new, sorted array — does not mutate the input.
export function sortPapers(papers: Paper[], sort: SortState): Paper[] {
  const dir = sort.direction === 'asc' ? 1 : -1
  const sorted = papers.slice()

  sorted.sort((a, b) => {
    switch (sort.field) {
      case 'title':
        // Locale-aware compare. Mixed zh/jp/en titles won't be perfect, which
        // is acceptable — "roughly sensible" is the goal.
        return a.title.localeCompare(b.title) * dir

      case 'year': {
        const am = isMissingYear(a.year)
        const bm = isMissingYear(b.year)
        // Missing years pinned last in BOTH directions (not multiplied by dir).
        if (am && bm) return 0
        if (am) return 1
        if (bm) return -1
        return (a.year - b.year) * dir
      }

      case 'addedAt':
      default:
        // ISO 8601 timestamps compare chronologically as plain strings.
        return a.addedAt.localeCompare(b.addedAt) * dir
    }
  })

  return sorted
}
