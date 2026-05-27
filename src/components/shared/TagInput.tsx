import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import './TagInput.css'

interface Props {
  tags: string[]
  allTags: string[]        // suggestions from the library
  onChange: (tags: string[]) => void
  disabled?: boolean
}

export default function TagInput({ tags, allTags, onChange, disabled }: Props) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const suggestions = input.trim()
    ? allTags.filter(t => t.toLowerCase().includes(input.toLowerCase()) && !tags.includes(t))
    : []
  const canCreate = input.trim() && !tags.includes(input.trim()) && !allTags.includes(input.trim())

  const addTag = (tag: string) => {
    const t = tag.trim()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setInput('')
    setOpen(false)
    inputRef.current?.focus()
  }

  const removeTag = (tag: string) => {
    onChange(tags.filter(t => t !== tag))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault()
      addTag(input.trim())
    }
    if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
    if (e.key === 'Escape') setOpen(false)
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="tag-input-root" ref={wrapRef}>
      <div className="tag-input-field" onClick={() => inputRef.current?.focus()}>
        {tags.map(tag => (
          <span key={tag} className="tag-chip">
            {tag}
            {!disabled && (
              <button
                className="tag-chip-remove"
                onClick={e => { e.stopPropagation(); removeTag(tag) }}
                type="button"
                aria-label={`移除 ${tag}`}
              >×</button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            ref={inputRef}
            className="tag-input-text"
            value={input}
            onChange={e => { setInput(e.target.value); setOpen(true) }}
            onKeyDown={handleKeyDown}
            onFocus={() => setOpen(true)}
            placeholder={tags.length === 0 ? '输入标签，按 Enter 添加…' : ''}
          />
        )}
      </div>

      {open && (suggestions.length > 0 || canCreate) && (
        <div className="tag-suggestions">
          {suggestions.map(s => (
            <div key={s} className="tag-suggestion" onMouseDown={() => addTag(s)}>
              <span>{s}</span>
              <span className="tag-suggestion-meta">已有</span>
            </div>
          ))}
          {canCreate && (
            <div className="tag-suggestion tag-suggestion-new" onMouseDown={() => addTag(input.trim())}>
              <span>+ 新建标签 &ldquo;{input.trim()}&rdquo;</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
