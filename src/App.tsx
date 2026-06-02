import { useState } from 'react'
import { useSettings } from './hooks/useSettings'
import { AppProvider, useAppContext } from './store/AppContext'
import SetupWizard from './components/Setup/SetupWizard'
import TopBar from './components/Layout/TopBar'
import Sidebar from './components/Layout/Sidebar'
import PaperCard from './components/Papers/PaperCard'
import PaperList from './components/Papers/PaperList'
import AddPaperDialog from './components/AddPaper/AddPaperDialog'
import PaperDetail from './components/PaperDetail/PaperDetail'
import TagManagerDialog from './components/Tags/TagManagerDialog'
import AiSettingsDialog from './components/Settings/AiSettingsDialog'
import type { Paper, Settings } from './types'
import type { SortField } from './utils/sorting'
import './components/Layout/MainLayout.css'

export default function App() {
  const { settings, loading, updateSettings, clearSettings } = useSettings()

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', background: 'var(--bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-faint)', letterSpacing: '0.1em' }}>
          LOADING…
        </span>
      </div>
    )
  }

  const isConnected = !!(
    settings?.githubPat && settings?.githubUsername && settings?.githubRepo
  )

  if (!isConnected) {
    return <SetupWizard onComplete={updateSettings} />
  }

  return (
    <AppProvider settings={settings as Partial<Settings>} updateSettings={updateSettings}>
      <MainLayout onDisconnect={clearSettings} />
    </AppProvider>
  )
}

// ── Main layout ───────────────────────────────────────────────────────────────

type ViewType = 'cards' | 'list'

const ADDED_WITHIN_LABELS: Record<string, string> = {
  month: '本月', '3months': '最近 3 个月', '6months': '最近半年', year: '最近一年',
}

const SORT_FIELD_LABELS: Record<SortField, string> = {
  addedAt: '添加时间', year: '年份', title: '标题',
}

function MainLayout({ onDisconnect }: { onDisconnect: () => Promise<void> }) {
  const { state, filteredPapers, sort, setSort, setFilter, clearFilters } = useAppContext()
  const [view, setView] = useState<ViewType>('cards')
  const [showAdd, setShowAdd] = useState(false)
  const [showTagManager, setShowTagManager] = useState(false)
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null)

  if (state.initState === 'loading') {
    return (
      <div className="app">
        <div className="init-screen">
          <div style={{ width: 28, height: 28, border: '2px solid var(--rule)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          <span className="init-label">正在从 GitHub 同步…</span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (state.initState === 'error') {
    return (
      <div className="app">
        <div className="init-screen">
          <span style={{ fontSize: 28, opacity: 0.5 }}>⚠</span>
          <span className="init-label">加载失败</span>
          <p className="init-error-msg">{state.initError}</p>
          <button
            style={{ padding: '8px 18px', background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 3, fontFamily: 'var(--sans)', fontSize: 12, cursor: 'pointer', marginTop: 8 }}
            onClick={onDisconnect}
          >
            重新配置
          </button>
        </div>
      </div>
    )
  }

  const { filters } = state

  // Count active filters for display
  const activeChips: { label: string; clear: () => void }[] = []
  if (filters.language !== 'all')
    activeChips.push({ label: `语言: ${{ en: '英文', jp: '日文', zh: '中文', other: '其他' }[filters.language] ?? filters.language}`, clear: () => setFilter({ language: 'all' }) })
  if (filters.status)
    activeChips.push({ label: `状态: ${{ unread: '未读', reading: '在读', done: '已读', deep: '精读' }[filters.status]}`, clear: () => setFilter({ status: null }) })
  if (filters.tag)
    activeChips.push({ label: `标签: ${filters.tag}`, clear: () => setFilter({ tag: null }) })
  if (filters.year)
    activeChips.push({ label: `年份: ${filters.year}`, clear: () => setFilter({ year: null }) })
  if (filters.addedWithin)
    activeChips.push({ label: ADDED_WITHIN_LABELS[filters.addedWithin] ?? filters.addedWithin, clear: () => setFilter({ addedWithin: null }) })
  if (filters.hasTranslation)
    activeChips.push({ label: '有中文译本', clear: () => setFilter({ hasTranslation: false }) })
  if (filters.searchQuery)
    activeChips.push({ label: `搜索: ${filters.searchQuery}`, clear: () => setFilter({ searchQuery: '' }) })

  return (
    <div className="app">
      <TopBar onAddClick={() => setShowAdd(true)} />

      <div className={`body${selectedPaper ? ' detail-open' : ''}`}>
        <Sidebar onOpenTagManager={() => setShowTagManager(true)} />

        <main className="main">
          {/* Main header */}
          <div className="main-head">
            <div>
              <h1 className="main-title">
                <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>文</em>献库
              </h1>
              <p className="main-count">
                {filteredPapers.length} 篇{filteredPapers.length !== state.papers.length ? `（共 ${state.papers.length} 篇）` : ''}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="sort-control" title="排序方式">
                <span className="sort-label">排序</span>
                <div className="view-toggle">
                  {(['addedAt', 'year', 'title'] as SortField[]).map(field => (
                    <button
                      key={field}
                      className={`view-btn ${sort.field === field ? 'active' : ''}`}
                      onClick={() => setSort({ field, direction: sort.direction })}
                    >
                      {SORT_FIELD_LABELS[field]}
                    </button>
                  ))}
                </div>
                <button
                  className="sort-dir-btn"
                  onClick={() => setSort({ field: sort.field, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
                  title={sort.direction === 'asc' ? '升序（点击切换为降序）' : '降序（点击切换为升序）'}
                >
                  {sort.direction === 'asc' ? '▲' : '▼'}
                </button>
              </div>
              <div className="view-toggle">
                <button className={`view-btn ${view === 'cards' ? 'active' : ''}`} onClick={() => setView('cards')}>卡片</button>
                <button className={`view-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>列表</button>
                <button className="view-btn" disabled title="阶段 6 实现">关系图</button>
              </div>
              <button
                style={{ background: 'none', border: 'none', fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--ink-faint)', cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => setShowAiSettings(true)}
                title="配置 Claude API Key 和模型"
              >
                AI 设置
              </button>
              <button
                style={{ background: 'none', border: 'none', fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--ink-faint)', cursor: 'pointer', textDecoration: 'underline' }}
                onClick={onDisconnect}
                title="清除配置，返回设置向导"
              >
                断开连接
              </button>
            </div>
          </div>

          {/* Active filter chips */}
          {activeChips.length > 0 && (
            <div className="active-filters">
              {activeChips.map(({ label, clear }) => (
                <span key={label} className="active-chip">
                  {label}
                  <button className="active-chip-x" onClick={clear}>×</button>
                </span>
              ))}
              {activeChips.length > 1 && (
                <button className="clear-all-btn" onClick={clearFilters}>清除全部</button>
              )}
            </div>
          )}

          {/* Content */}
          {filteredPapers.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">◎</div>
              <div className="empty-state-title">
                {state.papers.length === 0 ? '文献库还是空的' : '没有符合条件的文献'}
              </div>
              <p className="empty-state-desc">
                {state.papers.length === 0
                  ? '点击右上角"+ 添加文献"开始构建你的文献库。'
                  : '试试清除部分筛选条件，或修改搜索关键词。'}
              </p>
            </div>
          ) : view === 'cards' ? (
            <div className="cards">
              {filteredPapers.map(paper => (
                <PaperCard key={paper.id} paper={paper} onClick={() => setSelectedPaper(paper)} />
              ))}
            </div>
          ) : (
            <PaperList papers={filteredPapers} onPaperClick={setSelectedPaper} />
          )}
        </main>
      </div>

      {/* Dialogs */}
      {showAdd && <AddPaperDialog onClose={() => setShowAdd(false)} />}
      {showTagManager && <TagManagerDialog onClose={() => setShowTagManager(false)} />}
      {showAiSettings && <AiSettingsDialog onClose={() => setShowAiSettings(false)} />}
      {selectedPaper && (
        <PaperDetail paper={selectedPaper} onClose={() => setSelectedPaper(null)} />
      )}
    </div>
  )
}
