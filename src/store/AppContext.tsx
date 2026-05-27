import {
  createContext, useContext, useReducer, useEffect, useRef, useCallback, useMemo,
  type ReactNode,
} from 'react'
import type { Paper, Tag, FilterState, SyncStatus, Settings } from '../types'
import {
  db, deleteAllFileBlobs,
  bulkPutTagRecords, createTagRecord, deleteTagRecord, getAllTagRecords, clearAllTagRecords,
} from './db'
import { fetchMetadata, pushMetadata, deleteFile } from '../utils/github'
import { now } from '../utils/helpers'

// ── State ──────────────────────────────────────────────────────────────────────

interface AppState {
  papers: Paper[]
  tagRecords: Tag[]              // standalone tags (may include zero-paper entries)
  metadataSha: string
  syncStatus: SyncStatus
  filters: FilterState
  initState: 'loading' | 'ready' | 'error'
  initError?: string
}

const defaultFilters: FilterState = {
  language: 'all',
  status: null,
  tag: null,
  year: null,
  addedWithin: null,
  hasTranslation: false,
  searchQuery: '',
}

const initialState: AppState = {
  papers: [],
  tagRecords: [],
  metadataSha: '',
  syncStatus: 'synced',
  filters: defaultFilters,
  initState: 'loading',
}

// ── Actions ────────────────────────────────────────────────────────────────────

type AppAction =
  | { type: 'LOAD_SUCCESS'; papers: Paper[]; tags: Tag[]; sha: string }
  | { type: 'LOAD_ERROR'; error: string }
  | { type: 'ADD_PAPER'; paper: Paper }
  | { type: 'UPDATE_PAPER'; paper: Paper }
  | { type: 'BATCH_UPDATE_PAPERS'; papers: Paper[] }
  | { type: 'DELETE_PAPER'; id: string }
  | { type: 'ADD_TAG_RECORDS'; tags: Tag[] }           // additive — used by auto-create from paper.tags too
  | { type: 'DELETE_TAG_RECORD'; name: string }
  | { type: 'SET_FILTER'; patch: Partial<FilterState> }
  | { type: 'CLEAR_FILTERS' }
  | { type: 'SET_SYNC_STATUS'; status: SyncStatus }
  | { type: 'UPDATE_SHA'; sha: string }

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'LOAD_SUCCESS':
      return {
        ...state,
        papers: action.papers,
        tagRecords: action.tags,
        metadataSha: action.sha,
        initState: 'ready',
      }
    case 'LOAD_ERROR':
      return { ...state, initState: 'error', initError: action.error }
    case 'ADD_PAPER':
      return { ...state, papers: [...state.papers, action.paper] }
    case 'UPDATE_PAPER':
      return { ...state, papers: state.papers.map(p => p.id === action.paper.id ? action.paper : p) }
    case 'BATCH_UPDATE_PAPERS': {
      const map = new Map(action.papers.map(p => [p.id, p]))
      return { ...state, papers: state.papers.map(p => map.get(p.id) ?? p) }
    }
    case 'DELETE_PAPER':
      return { ...state, papers: state.papers.filter(p => p.id !== action.id) }
    case 'ADD_TAG_RECORDS': {
      const existing = new Set(state.tagRecords.map(t => t.name))
      const fresh = action.tags.filter(t => !existing.has(t.name))
      if (fresh.length === 0) return state
      return { ...state, tagRecords: [...state.tagRecords, ...fresh] }
    }
    case 'DELETE_TAG_RECORD':
      return { ...state, tagRecords: state.tagRecords.filter(t => t.name !== action.name) }
    case 'SET_FILTER':
      return { ...state, filters: { ...state.filters, ...action.patch } }
    case 'CLEAR_FILTERS':
      return { ...state, filters: defaultFilters }
    case 'SET_SYNC_STATUS':
      return { ...state, syncStatus: action.status }
    case 'UPDATE_SHA':
      return { ...state, metadataSha: action.sha }
    default:
      return state
  }
}

// ── Context value ──────────────────────────────────────────────────────────────

interface AppContextValue {
  state: AppState
  settings: Partial<Settings>
  updateSettings: (partial: Partial<Settings>) => Promise<void>
  filteredPapers: Paper[]
  allTags: string[]                         // union of tag records and tags used by any paper
  tagCount: (name: string) => number        // # of papers using a given tag
  addPaper: (paper: Paper) => Promise<void>
  updatePaper: (paper: Paper) => Promise<void>
  batchUpdatePapers: (papers: Paper[]) => Promise<void>
  deletePaper: (id: string) => Promise<void>
  createTag: (name: string) => Promise<{ ok: true } | { ok: false; reason: 'empty' | 'exists' }>
  deleteTag: (name: string) => Promise<void>
  setFilter: (patch: Partial<FilterState>) => void
  clearFilters: () => void
  forceSync: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be inside AppProvider')
  return ctx
}

// ── Provider ───────────────────────────────────────────────────────────────────

interface AppProviderProps {
  settings: Partial<Settings>
  updateSettings: (partial: Partial<Settings>) => Promise<void>
  children: ReactNode
}

export function AppProvider({ settings, updateSettings, children }: AppProviderProps) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const pat = settings.githubPat!
  const username = settings.githubUsername!
  const repo = settings.githubRepo!

  // Refs so sync timer always has the latest values
  const papersRef = useRef<Paper[]>([])
  const tagRecordsRef = useRef<Tag[]>([])
  const shaRef = useRef('')
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { papersRef.current = state.papers }, [state.papers])
  useEffect(() => { tagRecordsRef.current = state.tagRecords }, [state.tagRecords])
  useEffect(() => { shaRef.current = state.metadataSha }, [state.metadataSha])

  // ── Initial load ─────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      // Try GitHub first
      try {
        const { papers, tags, sha } = await fetchMetadata(pat, username, repo)
        // Cache in IndexedDB for offline access
        await db.papers.clear()
        await clearAllTagRecords()
        if (papers.length > 0) await db.papers.bulkPut(papers)
        if (tags.length > 0) await bulkPutTagRecords(tags)
        papersRef.current = papers
        tagRecordsRef.current = tags
        shaRef.current = sha
        dispatch({ type: 'LOAD_SUCCESS', papers, tags, sha })
      } catch (err) {
        const status = (err as { status?: number }).status
        if (status === 401 || status === 403) {
          dispatch({ type: 'LOAD_ERROR', error: 'GitHub Token 已过期或权限不足，请重新配置' })
          return
        }
        // Network error — fall back to IndexedDB
        const cachedPapers = await db.papers.toArray()
        const cachedTags = await getAllTagRecords()
        papersRef.current = cachedPapers
        tagRecordsRef.current = cachedTags
        dispatch({ type: 'LOAD_SUCCESS', papers: cachedPapers, tags: cachedTags, sha: '' })
        dispatch({ type: 'SET_SYNC_STATUS', status: 'offline' })
      }
    }
    load()
  }, [pat, username, repo])

  // ── Sync engine ───────────────────────────────────────────────────────────────

  const scheduleSync = useCallback(() => {
    if (!settings.autoSyncEnabled) return
    dispatch({ type: 'SET_SYNC_STATUS', status: 'pending' })
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(async () => {
      if (!shaRef.current) return // no SHA = offline or not yet loaded
      dispatch({ type: 'SET_SYNC_STATUS', status: 'syncing' })
      try {
        const newSha = await pushMetadata(pat, username, repo, papersRef.current, tagRecordsRef.current, shaRef.current)
        shaRef.current = newSha
        dispatch({ type: 'UPDATE_SHA', sha: newSha })
        dispatch({ type: 'SET_SYNC_STATUS', status: 'synced' })
      } catch (err) {
        console.error('Sync failed:', err)
        dispatch({ type: 'SET_SYNC_STATUS', status: 'error' })
      }
    }, 3000)
  }, [pat, username, repo, settings.autoSyncEnabled])

  // Awaitable immediate push. Cancels any pending debounced sync so we don't
  // double-push the same state. Used by add/delete where losing the operation
  // on quick refresh is unacceptable (debounce drops them in <3s reload).
  const flushSync = useCallback(async (): Promise<void> => {
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = null
    if (!shaRef.current) return
    if (!settings.autoSyncEnabled) {
      dispatch({ type: 'SET_SYNC_STATUS', status: 'pending' })
      return
    }
    dispatch({ type: 'SET_SYNC_STATUS', status: 'syncing' })
    try {
      const newSha = await pushMetadata(pat, username, repo, papersRef.current, tagRecordsRef.current, shaRef.current)
      shaRef.current = newSha
      dispatch({ type: 'UPDATE_SHA', sha: newSha })
      dispatch({ type: 'SET_SYNC_STATUS', status: 'synced' })
    } catch (err) {
      console.error('Sync failed:', err)
      dispatch({ type: 'SET_SYNC_STATUS', status: 'error' })
      throw err
    }
  }, [pat, username, repo, settings.autoSyncEnabled])

  // Fire-and-forget wrapper for the TopBar's manual "retry sync" button.
  const forceSync = useCallback(() => {
    flushSync().catch(() => { /* status already dispatched */ })
  }, [flushSync])

  // ── Mutations ─────────────────────────────────────────────────────────────────

  // Auto-promote any names on paper.tags that don't yet have a Tag record into
  // first-class records. Keeps the tags table consistent with what papers
  // actually use, even when a user types a brand-new name into TagInput
  // without going through the manager.
  const ensureTagRecords = useCallback(async (tagNames: string[]): Promise<void> => {
    const known = new Set(tagRecordsRef.current.map(t => t.name))
    const fresh = [...new Set(tagNames)]
      .map(n => n.trim())
      .filter(n => n.length > 0 && !known.has(n))
    if (fresh.length === 0) return
    const created: Tag[] = fresh.map(name => ({ name, createdAt: now() }))
    tagRecordsRef.current = [...tagRecordsRef.current, ...created]
    dispatch({ type: 'ADD_TAG_RECORDS', tags: created })
    await bulkPutTagRecords(created)
  }, [])

  const addPaper = useCallback(async (paper: Paper) => {
    await ensureTagRecords(paper.tags)
    papersRef.current = [...papersRef.current, paper]
    dispatch({ type: 'ADD_PAPER', paper })
    await db.papers.put(paper)
    await flushSync()  // push immediately — otherwise quick refresh loses the add
  }, [flushSync, ensureTagRecords])

  const updatePaper = useCallback(async (paper: Paper) => {
    await ensureTagRecords(paper.tags)
    papersRef.current = papersRef.current.map(p => p.id === paper.id ? paper : p)
    dispatch({ type: 'UPDATE_PAPER', paper })
    await db.papers.put(paper)
    scheduleSync()  // debounced — coalesce high-frequency edits (notes, tags)
  }, [scheduleSync, ensureTagRecords])

  const batchUpdatePapers = useCallback(async (updated: Paper[]) => {
    await ensureTagRecords(updated.flatMap(p => p.tags))
    const map = new Map(updated.map(p => [p.id, p]))
    papersRef.current = papersRef.current.map(p => map.get(p.id) ?? p)
    dispatch({ type: 'BATCH_UPDATE_PAPERS', papers: updated })
    await db.papers.bulkPut(updated)
    scheduleSync()
  }, [scheduleSync, ensureTagRecords])

  const createTag = useCallback(async (
    rawName: string,
  ): Promise<{ ok: true } | { ok: false; reason: 'empty' | 'exists' }> => {
    const name = rawName.trim()
    if (!name) return { ok: false, reason: 'empty' }
    if (tagRecordsRef.current.some(t => t.name === name)) {
      return { ok: false, reason: 'exists' }
    }
    const tag: Tag = { name, createdAt: now() }
    tagRecordsRef.current = [...tagRecordsRef.current, tag]
    dispatch({ type: 'ADD_TAG_RECORDS', tags: [tag] })
    await createTagRecord(tag)
    await flushSync()  // independent tag must survive a quick refresh
    return { ok: true }
  }, [flushSync])

  const deleteTag = useCallback(async (name: string) => {
    // Remove tag record only — does NOT scrub the name off papers; that's
    // the manager dialog's responsibility (and it already calls batchUpdatePapers
    // before this when a tag is on papers).
    tagRecordsRef.current = tagRecordsRef.current.filter(t => t.name !== name)
    dispatch({ type: 'DELETE_TAG_RECORD', name })
    await deleteTagRecord(name)
    await flushSync()
  }, [flushSync])

  const deletePaper = useCallback(async (id: string) => {
    const paper = papersRef.current.find(p => p.id === id)
    if (paper) {
      // Delete associated files from GitHub
      for (const file of paper.files) {
        if (file.githubPath && file.githubSha) {
          try {
            await deleteFile(pat, username, repo, file.githubPath, file.githubSha, `delete: ${file.filename}`)
          } catch { /* ignore — file may already be absent */ }
        }
      }
      await deleteAllFileBlobs(id)
    }
    papersRef.current = papersRef.current.filter(p => p.id !== id)
    dispatch({ type: 'DELETE_PAPER', id })
    await db.papers.delete(id)
    await flushSync()  // push immediately — otherwise quick refresh resurrects the paper
  }, [pat, username, repo, flushSync])

  const setFilter = useCallback((patch: Partial<FilterState>) => {
    dispatch({ type: 'SET_FILTER', patch })
  }, [])

  const clearFilters = useCallback(() => {
    dispatch({ type: 'CLEAR_FILTERS' })
  }, [])

  // ── Derived values ────────────────────────────────────────────────────────────

  // Per-tag paper count (used by TagManagerDialog and sort key for allTags)
  const tagCountsMap = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of state.papers) {
      for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return counts
  }, [state.papers])

  const tagCount = useCallback((name: string) => tagCountsMap.get(name) ?? 0, [tagCountsMap])

  // Union of (tag records) and (names actually used on papers). Sort by usage
  // count desc, then alphabetical; zero-count records come last but are still
  // present so users can pick them in TagInput suggestions.
  const allTags = useMemo(() => {
    const all = new Set<string>(state.tagRecords.map(t => t.name))
    for (const p of state.papers) for (const t of p.tags) all.add(t)
    return [...all].sort((a, b) => {
      const ca = tagCountsMap.get(a) ?? 0
      const cb = tagCountsMap.get(b) ?? 0
      return cb - ca || a.localeCompare(b)
    })
  }, [state.papers, state.tagRecords, tagCountsMap])

  const filteredPapers = useMemo(() => {
    const { language, status, tag, year, addedWithin, hasTranslation, searchQuery } = state.filters
    return state.papers.filter(p => {
      if (language !== 'all' && p.language !== language) return false
      if (status && p.status !== status) return false
      if (tag && !p.tags.includes(tag)) return false
      if (year && p.year !== year) return false
      if (addedWithin) {
        const months = { month: 1, '3months': 3, '6months': 6, year: 12 }[addedWithin]
        if (months && !isWithinMonths(p.addedAt, months)) return false
      }
      if (hasTranslation && !p.files.some(f => f.type === 'translation')) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const haystack = [
          p.title, p.titleCn ?? '', ...p.authors, ...p.tags,
        ].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [state.papers, state.filters])

  const value: AppContextValue = {
    state, settings, updateSettings, filteredPapers, allTags, tagCount,
    addPaper, updatePaper, batchUpdatePapers, deletePaper,
    createTag, deleteTag,
    setFilter, clearFilters, forceSync,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

function isWithinMonths(iso: string, months: number): boolean {
  return Date.now() - new Date(iso).getTime() <= months * 30 * 24 * 60 * 60 * 1000
}
