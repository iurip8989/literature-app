import type { Paper } from '../../types'
import { formatDateShort, getStatusLabel, getLanguageLabel } from '../../utils/helpers'
import './PaperList.css'

interface Props {
  papers: Paper[]
  onPaperClick: (paper: Paper) => void
}

export default function PaperList({ papers, onPaperClick }: Props) {
  return (
    <div className="paper-list">
      {papers.map(paper => {
        const hasTranslation = paper.files.some(f => f.type === 'translation')
        return (
          <div
            key={paper.id}
            className={`list-row lang-${paper.language}${paper.isPrivate ? ' list-private' : ''}`}
            onClick={() => onPaperClick(paper)}
          >
            {/* Language badge */}
            <span className={`badge ${paper.language} list-badge`}>
              {getLanguageLabel(paper.language)}
            </span>

            {/* Main content */}
            <div className="list-content">
              <div className="list-title-row">
                <span className="list-title">{paper.title}</span>
                {paper.titleCn && (
                  <span className="list-title-cn">{paper.titleCn}</span>
                )}
                {hasTranslation && <span className="trans-mark list-trans">⇌</span>}
                {paper.isPrivate && <span className="list-lock" title="仅本地">🔒</span>}
              </div>
              <div className="list-meta">
                {paper.authors.slice(0, 2).join(', ')}
                {paper.authors.length > 2 && ' 等'}
                {paper.venue && <> · <em>{paper.venue}</em></>}
                {paper.year > 0 && <> · {paper.year}</>}
              </div>
            </div>

            {/* Tags */}
            <div className="list-tags">
              {paper.tags.slice(0, 3).map(t => (
                <span key={t} className="tag">{t}</span>
              ))}
              {paper.tags.length > 3 && (
                <span className="tag" style={{ color: 'var(--ink-faint)' }}>+{paper.tags.length - 3}</span>
              )}
            </div>

            {/* Status */}
            <div className="list-status">
              <span className={`dot ${paper.status}`} />
              <span className="list-status-label">{getStatusLabel(paper.status)}</span>
            </div>

            {/* Date */}
            <span className="list-date">{formatDateShort(paper.addedAt)}</span>
          </div>
        )
      })}
    </div>
  )
}
