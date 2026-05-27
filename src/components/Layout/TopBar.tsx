import { useAppContext } from '../../store/AppContext'
import type { SyncStatus } from '../../types'

interface Props {
  onAddClick: () => void
}

const syncLabels: Record<SyncStatus, string> = {
  synced: '已同步',
  pending: '待同步',
  syncing: '同步中',
  offline: '离线',
  error: '同步失败',
}

export default function TopBar({ onAddClick }: Props) {
  const { state, setFilter, forceSync } = useAppContext()
  const { syncStatus, filters } = state

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark"><em>文</em>献库</span>
        <span className="brand-sub">Reading Archive</span>
      </div>

      <div className="search-wrap">
        <span className="search-icon">⌕</span>
        <input
          type="text"
          placeholder="搜索标题、作者、标签…"
          value={filters.searchQuery}
          onChange={e => setFilter({ searchQuery: e.target.value })}
        />
      </div>

      <div className="topbar-right">
        <button
          className="sync-pill"
          title={syncStatus === 'error' ? '点击重试' : syncStatus === 'pending' ? '点击立即同步' : undefined}
          onClick={syncStatus === 'error' || syncStatus === 'pending' ? forceSync : undefined}
        >
          <span className={`sync-dot ${syncStatus}`} />
          {syncLabels[syncStatus]}
        </button>

        <button className="add-btn" onClick={onAddClick}>
          <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
          添加文献
        </button>
      </div>
    </header>
  )
}
