import { useMemo } from 'react'
import { useAppContext } from '../../store/AppContext'
import type { Language, ReadingStatus, FilterState } from '../../types'

interface Props {
  onOpenTagManager: () => void
}

export default function Sidebar({ onOpenTagManager }: Props) {
  const { state, setFilter, allTags } = useAppContext()
  const { filters, papers } = state

  // Count helpers
  const langCounts = useMemo(() => {
    const c = { en: 0, jp: 0, zh: 0, other: 0 }
    for (const p of papers) { if (p.language in c) c[p.language as keyof typeof c]++ }
    return c
  }, [papers])

  const statusCounts = useMemo(() => {
    const c = { unread: 0, reading: 0, done: 0, deep: 0 }
    for (const p of papers) { if (p.status in c) c[p.status as keyof typeof c]++ }
    return c
  }, [papers])

  const tagCounts = useMemo(() => {
    const c = new Map<string, number>()
    for (const p of papers) for (const t of p.tags) c.set(t, (c.get(t) ?? 0) + 1)
    return c
  }, [papers])

  const years = useMemo(() => {
    const y = new Map<number, number>()
    for (const p of papers) y.set(p.year, (y.get(p.year) ?? 0) + 1)
    return [...y.entries()].sort((a, b) => b[0] - a[0])
  }, [papers])

  const toggle = (key: keyof typeof filters, val: unknown, activeVal: unknown) => {
    setFilter({ [key]: filters[key] === val ? activeVal : val } as never)
  }

  return (
    <aside className="sidebar">
      {/* Language */}
      <div className="filter-group">
        <div className="filter-title">语言</div>
        <button
          className={`filter-item ${filters.language === 'all' ? 'active' : ''}`}
          onClick={() => setFilter({ language: 'all' })}
        >
          <span>全部</span>
          <span className="count">{papers.length}</span>
        </button>
        {([['en', '英文'], ['jp', '日文']] as [Language, string][]).map(([lang, label]) => (
          <button
            key={lang}
            className={`filter-item ${filters.language === lang ? 'active' : ''}`}
            onClick={() => toggle('language', lang, 'all')}
          >
            <span className="label-with-dot">
              <span className={`dot ${lang}`} />
              {label}
            </span>
            <span className="count">{langCounts[lang]}</span>
          </button>
        ))}
      </div>

      {/* Reading status */}
      <div className="filter-group">
        <div className="filter-title">阅读状态</div>
        {([
          ['unread', '未读'],
          ['reading', '在读'],
          ['done', '已读'],
          ['deep', '精读'],
        ] as [ReadingStatus, string][]).map(([s, label]) => (
          <button
            key={s}
            className={`filter-item ${filters.status === s ? 'active' : ''}`}
            onClick={() => toggle('status', s, null)}
          >
            <span className="label-with-dot">
              <span className={`dot ${s}`} />
              {label}
            </span>
            <span className="count">{statusCounts[s]}</span>
          </button>
        ))}
      </div>

      {/* Added within */}
      <div className="filter-group">
        <div className="filter-title">添加时间</div>
        {([
          ['month',    '本月'],
          ['3months',  '最近 3 个月'],
          ['6months',  '最近半年'],
          ['year',     '最近一年'],
        ] as [FilterState['addedWithin'], string][]).map(([val, label]) => (
          <button
            key={val!}
            className={`filter-item ${filters.addedWithin === val ? 'active' : ''}`}
            onClick={() => toggle('addedWithin', val, null)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tags */}
      {allTags.length > 0 && (
        <div className="filter-group">
          <div className="filter-title">
            主题
            <button className="filter-action" onClick={onOpenTagManager}>管理</button>
          </div>
          {allTags.slice(0, 20).map(tag => (
            <button
              key={tag}
              className={`filter-item ${filters.tag === tag ? 'active' : ''}`}
              onClick={() => toggle('tag', tag, null)}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
              <span className="count">{tagCounts.get(tag) ?? 0}</span>
            </button>
          ))}
        </div>
      )}

      {/* Year */}
      {years.length > 0 && (
        <div className="filter-group">
          <div className="filter-title">年份</div>
          <div className="year-chips">
            {years.map(([y, count]) => (
              <button
                key={y}
                className={`year-chip ${filters.year === y ? 'active' : ''}`}
                onClick={() => toggle('year', y, null)}
                title={`${count} 篇`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Has translation */}
      <div className="filter-group">
        <div className="filter-title">译本</div>
        <button
          className={`filter-item ${filters.hasTranslation ? 'active' : ''}`}
          onClick={() => setFilter({ hasTranslation: !filters.hasTranslation })}
        >
          <span>有中文译本</span>
        </button>
      </div>
    </aside>
  )
}
