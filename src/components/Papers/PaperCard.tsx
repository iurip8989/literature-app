import type { Paper } from '../../types'
import { formatDateShort, getStatusLabel, getLanguageLabel } from '../../utils/helpers'
import './PaperCard.css'

interface Props {
  paper: Paper
  onClick: () => void
}

const STATUS_DOTS: Record<string, string> = {
  unread: 'unread', reading: 'reading', done: 'done', deep: 'deep',
}

export default function PaperCard({ paper, onClick }: Props) {
  const hasTranslation = paper.files.some(f => f.type === 'translation')

  return (
    <article
      className={`card lang-${paper.language}${paper.isPrivate ? ' private-paper' : ''}`}
      onClick={onClick}
    >
      {/* Top row: language badge + translation + private */}
      <div className="card-top">
        <span className={`badge ${paper.language}`}>
          {getLanguageLabel(paper.language)}
        </span>
        {hasTranslation && (
          <span className="trans-mark">⇌ 含中译</span>
        )}
        {paper.isPrivate && (
          <span className="private-mark" title="仅本地，不同步到 GitHub">🔒 本地</span>
        )}
      </div>

      {/* Title */}
      <h3 className="card-title">{paper.title}</h3>

      {/* Chinese title */}
      {paper.titleCn && (
        <p className="card-title-cn">{paper.titleCn}</p>
      )}

      {/* Meta */}
      <p className="card-meta">
        {paper.authors.slice(0, 3).join(', ')}
        {paper.authors.length > 3 && ' 等'}
        {paper.venue && <> · <em>{paper.venue}</em></>}
        {paper.year > 0 && <>, {paper.year}</>}
      </p>

      {/* Tags */}
      {paper.tags.length > 0 && (
        <div className="card-tags">
          {paper.tags.slice(0, 4).map(tag => (
            <span key={tag} className="tag">{tag}</span>
          ))}
          {paper.tags.length > 4 && (
            <span className="tag" style={{ color: 'var(--ink-faint)' }}>+{paper.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="card-foot">
        <span className="status">
          <span className={`dot ${STATUS_DOTS[paper.status]}`} />
          {getStatusLabel(paper.status)}
        </span>
        <span className="card-date">{formatDateShort(paper.addedAt)}</span>
      </div>
    </article>
  )
}
