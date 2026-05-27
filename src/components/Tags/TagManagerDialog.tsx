import { useState, useMemo } from 'react'
import { useAppContext } from '../../store/AppContext'
import { now } from '../../utils/helpers'
import './TagManagerDialog.css'

interface Props {
  onClose: () => void
}

export default function TagManagerDialog({ onClose }: Props) {
  const { state, allTags, tagCount, batchUpdatePapers, setFilter, createTag, deleteTag } = useAppContext()
  const { papers } = state

  // Union of records and tags-on-papers (allTags from context already does this),
  // attached to per-tag paper counts. Zero-count entries are kept so the user
  // sees tags they created from this dialog even before any paper uses them.
  const tagCounts = useMemo<[string, number][]>(
    () => allTags.map(name => [name, tagCount(name)]),
    [allTags, tagCount],
  )

  const [newTagInput, setNewTagInput]   = useState('')
  const [createMsg, setCreateMsg]       = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [editingTag, setEditingTag]     = useState<string | null>(null)
  const [editValue, setEditValue]       = useState('')
  const [mergingTag, setMergingTag]     = useState<string | null>(null)
  const [mergeTarget, setMergeTarget]   = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const allTagNames = tagCounts.map(([name]) => name)

  const handleCreate = async () => {
    const result = await createTag(newTagInput)
    if (result.ok) {
      setCreateMsg({ kind: 'ok', text: `已创建 "${newTagInput.trim()}"` })
      setNewTagInput('')
    } else if (result.reason === 'empty') {
      setCreateMsg({ kind: 'err', text: '标签名不能为空' })
    } else if (result.reason === 'exists') {
      setCreateMsg({ kind: 'err', text: `标签 "${newTagInput.trim()}" 已存在` })
    }
    setTimeout(() => setCreateMsg(null), 3000)
  }

  const handleRename = async (oldName: string) => {
    const newName = editValue.trim()
    if (!newName || newName === oldName) { setEditingTag(null); return }
    // Rewrite the name on every paper that uses it. batchUpdatePapers will
    // ensure a tag record exists for newName via ensureTagRecords.
    const updated = papers
      .filter(p => p.tags.includes(oldName))
      .map(p => ({ ...p, tags: p.tags.map(t => t === oldName ? newName : t), updatedAt: now() }))
    if (updated.length > 0) await batchUpdatePapers(updated)
    else await createTag(newName)  // standalone (zero-paper) tag — just create the record
    // Remove the old tag record (papers no longer reference it)
    await deleteTag(oldName)
    if (state.filters.tag === oldName) setFilter({ tag: null })
    setEditingTag(null)
  }

  const handleMerge = async (from: string) => {
    const into = mergeTarget.trim()
    if (!into || into === from) { setMergingTag(null); return }
    const updated = papers
      .filter(p => p.tags.includes(from))
      .map(p => ({
        ...p,
        tags: [...new Set(p.tags.map(t => t === from ? into : t))],
        updatedAt: now(),
      }))
    if (updated.length > 0) await batchUpdatePapers(updated)
    await deleteTag(from)  // source tag fully absorbed; its record is gone
    if (state.filters.tag === from) setFilter({ tag: null })
    setMergingTag(null)
    setMergeTarget('')
  }

  const handleDelete = async (tagName: string) => {
    const updated = papers
      .filter(p => p.tags.includes(tagName))
      .map(p => ({ ...p, tags: p.tags.filter(t => t !== tagName), updatedAt: now() }))
    if (updated.length > 0) await batchUpdatePapers(updated)
    await deleteTag(tagName)  // remove the record itself, regardless of paper usage
    if (state.filters.tag === tagName) setFilter({ tag: null })
    setDeleteConfirm(null)
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="tag-manager-modal" role="dialog" aria-modal="true">
        <div className="add-dialog-head">
          <h2 className="add-dialog-title">标签管理</h2>
          <button className="dialog-close" onClick={onClose}>✕</button>
        </div>

        <div className="tag-manager-body">
          {/* Create new tag row */}
          <div className="tag-manager-create">
            <input
              className="tag-manager-input"
              type="text"
              placeholder="新建标签名…"
              value={newTagInput}
              onChange={e => setNewTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            />
            <button
              className="tag-action-btn confirm"
              onClick={handleCreate}
              disabled={!newTagInput.trim()}
            >
              + 新建标签
            </button>
          </div>
          {createMsg && (
            <p style={{
              fontSize: 11,
              color: createMsg.kind === 'ok' ? 'var(--cn, #2a6a3a)' : 'var(--accent)',
              padding: '4px 2px 8px',
              margin: 0,
            }}>
              {createMsg.kind === 'ok' ? '✓' : '⚠'} {createMsg.text}
            </p>
          )}

          {tagCounts.length === 0 ? (
            <p className="tag-manager-empty">还没有任何标签。在上方输入框新建，或在添加文献时为文献打标签。</p>
          ) : (
            tagCounts.map(([tagName, count]) => (
              <div key={tagName} className="tag-manager-row">
                {/* Tag name / inline rename input */}
                <div className="tag-manager-name">
                  {editingTag === tagName ? (
                    <input
                      className="tag-manager-input"
                      value={editValue}
                      autoFocus
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRename(tagName)
                        if (e.key === 'Escape') setEditingTag(null)
                      }}
                    />
                  ) : (
                    <span>{tagName}</span>
                  )}
                </div>

                <span className="tag-manager-count">
                  {count === 0 ? '未使用' : `${count} 篇`}
                </span>

                {/* Mode: renaming — save/cancel buttons */}
                {editingTag === tagName && (
                  <div className="tag-manager-actions">
                    <button className="tag-action-btn confirm" onClick={() => handleRename(tagName)}>保存</button>
                    <button className="tag-action-btn" onClick={() => setEditingTag(null)}>取消</button>
                  </div>
                )}

                {/* Mode: merging — target selector */}
                {mergingTag === tagName && (
                  <div className="tag-manager-merge">
                    <select
                      className="tag-manager-select"
                      value={mergeTarget}
                      onChange={e => setMergeTarget(e.target.value)}
                      autoFocus
                    >
                      <option value="">合并到…</option>
                      {allTagNames.filter(t => t !== tagName).map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <button className="tag-action-btn confirm" onClick={() => handleMerge(tagName)}>确认</button>
                    <button className="tag-action-btn" onClick={() => setMergingTag(null)}>取消</button>
                  </div>
                )}

                {/* Mode: confirming delete */}
                {deleteConfirm === tagName && (
                  <div className="tag-manager-delete-confirm">
                    <span>从 {count} 篇文献中删除？</span>
                    <button className="tag-action-btn danger" onClick={() => handleDelete(tagName)}>确认删除</button>
                    <button className="tag-action-btn" onClick={() => setDeleteConfirm(null)}>取消</button>
                  </div>
                )}

                {/* Default: rename / merge / delete buttons */}
                {editingTag !== tagName && mergingTag !== tagName && deleteConfirm !== tagName && (
                  <div className="tag-manager-actions">
                    <button
                      className="tag-action-btn"
                      onClick={() => { setEditingTag(tagName); setEditValue(tagName) }}
                    >重命名</button>
                    {allTagNames.length > 1 && (
                      <button
                        className="tag-action-btn"
                        onClick={() => { setMergingTag(tagName); setMergeTarget('') }}
                      >合并</button>
                    )}
                    <button
                      className="tag-action-btn danger-outline"
                      onClick={() => setDeleteConfirm(tagName)}
                    >删除</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="add-dialog-foot">
          <button className="btn-secondary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </>
  )
}
