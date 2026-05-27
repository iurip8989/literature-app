import { useState, useEffect, useRef } from 'react'
import { useAppContext } from '../../store/AppContext'
import TagInput from '../shared/TagInput'
import FileTab from './FileTab'
import PdfViewer from './PdfViewer'
import DocxViewer from './DocxViewer'
import AiSettingsDialog from '../Settings/AiSettingsDialog'
import type { Paper, PaperFile, FileType, ReadingStatus, Settings } from '../../types'
import { now, formatDateShort, getLanguageLabel, generateId } from '../../utils/helpers'
import { deleteFile, uploadPaperFile, fetchFileContent } from '../../utils/github'
import { getFileBlob, saveFileBlob, deleteFileBlob } from '../../store/db'
import { githubFilePath, getFileFormat } from '../../utils/fileUtils'
import { extractFullPdfText } from '../../utils/pdfExtract'
import { generateSummary, DEFAULT_SUMMARY_MODEL, AiError } from '../../utils/aiClient'
import { useFileContent } from '../../hooks/useFileContent'
import './PaperDetail.css'

interface Props {
  paper: Paper
  onClose: () => void
}

type WideTab = 'translation' | 'relations' | null
type NarrowTab = 'pdf' | 'translation' | 'notes' | 'relations'

const STATUS_OPTIONS: { value: ReadingStatus; label: string }[] = [
  { value: 'unread',  label: '未读' },
  { value: 'reading', label: '在读' },
  { value: 'done',    label: '已读' },
  { value: 'deep',    label: '精读' },
]

const WIDE_BREAKPOINT = 1024

export default function PaperDetail({ paper: initialPaper, onClose }: Props) {
  const { updatePaper, deletePaper, allTags, settings, updateSettings } = useAppContext()
  const { githubPat: pat = '', githubUsername: username = '', githubRepo: repo = '' } = settings
  const [paper, setPaper] = useState(initialPaper)
  const [narrowTab, setNarrowTab] = useState<NarrowTab>('notes')
  const [wideTab, setWideTab] = useState<WideTab>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'pending' | 'syncing'>('saved')

  // Active file selection (shared between InfoPanel and PdfMidPanel)
  const [activeFileId, setActiveFileId] = useState<string | null>(null)

  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  useEffect(() => {
    const handler = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  const isWide = windowWidth >= WIDE_BREAKPOINT

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const paperRef = useRef(paper)
  const updatePaperRef = useRef(updatePaper)
  const dirtyRef = useRef(false)

  useEffect(() => { updatePaperRef.current = updatePaper }, [updatePaper])

  const save = (updated: Paper) => {
    setPaper(updated)
    paperRef.current = updated
    dirtyRef.current = true
    setSaveStatus('pending')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      dirtyRef.current = false
      setSaveStatus('saved')
      updatePaperRef.current({ ...updated, updatedAt: now() })
    }, 1000)
  }

  const handlePrivacyToggle = async (newIsPrivate: boolean) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('syncing')
    let files = [...paperRef.current.files]
    if (newIsPrivate) {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        if (f.githubPath && f.githubSha && pat && username && repo) {
          try { await deleteFile(pat, username, repo, f.githubPath, f.githubSha, `private: ${f.filename}`) }
          catch { /* continue */ }
          files[i] = { ...f, githubPath: undefined, githubSha: undefined }
        }
      }
    } else {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        if (!f.githubPath && pat && username && repo) {
          const blob = await getFileBlob(paperRef.current.id, f.id)
          if (blob) {
            const ext = f.filename.split('.').pop() ?? 'bin'
            const path = githubFilePath(
              f.type === 'translation' ? 'translation' : 'original',
              paperRef.current.id, f.id, ext,
            )
            try {
              const buf = await blob.arrayBuffer()
              const sha = await uploadPaperFile(pat, username, repo, path, buf, `upload: ${f.filename}`)
              files[i] = { ...f, githubPath: path, githubSha: sha }
            } catch { /* leave without githubPath */ }
          }
        }
      }
    }
    const updated: Paper = { ...paperRef.current, isPrivate: newIsPrivate, files, updatedAt: now() }
    setPaper(updated)
    paperRef.current = updated
    dirtyRef.current = false
    await updatePaperRef.current(updated)
    setSaveStatus('saved')
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (dirtyRef.current) updatePaperRef.current({ ...paperRef.current, updatedAt: now() })
    }
  }, [])

  const hasTranslation = paper.files.some(f => f.type === 'translation')

  const handleDelete = async () => {
    await deletePaper(paper.id)
    onClose()
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div
        className={`detail-modal${isWide ? ' detail-modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        onWheel={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="detail-head">
          <button className="dialog-close" onClick={onClose}>✕</button>
          <div className="detail-badges">
            <span className={`badge ${paper.language}`}>{getLanguageLabel(paper.language)}</span>
            {hasTranslation && <span className="trans-mark">⇌ 含中译</span>}
            {paper.isPrivate && <span className="private-mark">🔒 仅本地</span>}
          </div>
          <h2 className="detail-title">{paper.title}</h2>
          {paper.titleCn && <p className="detail-title-cn">{paper.titleCn}</p>}
          <div className="detail-meta">
            {paper.authors.length > 0 && (
              <span>{paper.authors.slice(0, 4).join(', ')}{paper.authors.length > 4 ? ' 等' : ''}</span>
            )}
            {paper.venue && <span>{paper.venue}</span>}
            {paper.year > 0 && <span>{paper.year}</span>}
          </div>
        </div>

        {/* Tabs */}
        <div className="detail-tabs">
          {isWide ? (
            <>
              <button className={`tab ${wideTab === null ? 'active' : ''}`} onClick={() => setWideTab(null)}>
                PDF + 笔记
              </button>
              <button
                className={`tab ${wideTab === 'translation' ? 'active' : ''}`}
                onClick={() => setWideTab('translation')}
              >
                中文译本{hasTranslation ? ' ⇌' : ''}
              </button>
              <button
                className={`tab ${wideTab === 'relations' ? 'active' : ''}`}
                onClick={() => setWideTab('relations')}
              >
                关系
              </button>
            </>
          ) : (
            <>
              <button className={`tab ${narrowTab === 'pdf' ? 'active' : ''}`} onClick={() => setNarrowTab('pdf')}>原文 PDF</button>
              <button
                className={`tab ${narrowTab === 'translation' ? 'active' : ''}`}
                onClick={() => setNarrowTab('translation')}
              >
                中文译本{hasTranslation ? ' ⇌' : ''}
              </button>
              <button className={`tab ${narrowTab === 'notes' ? 'active' : ''}`} onClick={() => setNarrowTab('notes')}>笔记 & AI</button>
              <button className={`tab ${narrowTab === 'relations' ? 'active' : ''}`} onClick={() => setNarrowTab('relations')}>关系</button>
            </>
          )}
        </div>

        {/* Body */}
        <div className={`detail-body${isWide && wideTab === null ? ' detail-body--split' : ''}`}>
          {isWide ? (
            wideTab === null ? (
              // ── 3-column split: [Info+AI] | [PDF] | [Notes] ──────────────
              <div className="split-body">
                <div className="split-left">
                  <InfoPanel
                    paper={paper}
                    allTags={allTags}
                    settings={settings}
                    activeFileId={activeFileId}
                    onChange={save}
                    onPrivacyChange={handlePrivacyToggle}
                    onActiveFileChange={setActiveFileId}
                  />
                </div>
                <div className="split-col-divider" />
                <div className="split-mid">
                  <PdfMidPanel
                    paper={paper}
                    fileId={activeFileId}
                    settings={settings}
                  />
                </div>
                <div className="split-col-divider" />
                <div className="split-right">
                  <NotesPanel paper={paper} onChange={save} saveStatus={saveStatus} />
                </div>
              </div>
            ) : wideTab === 'translation' ? (
              <FileTab paper={paper} fileType="translation" onUpdate={save} />
            ) : (
              <div className="placeholder-tab">
                <div className="placeholder-icon">⬡</div>
                <div className="placeholder-title">关系图</div>
                <div className="placeholder-desc">阶段 6 将实现文献引用与主题关联的射状图。</div>
              </div>
            )
          ) : (
            // ── Narrow mode ────────────────────────────────────────────────
            <>
              {narrowTab === 'pdf' && <FileTab paper={paper} fileType="original" onUpdate={save} />}
              {narrowTab === 'translation' && <FileTab paper={paper} fileType="translation" onUpdate={save} />}
              {narrowTab === 'notes' && (
                <NotesTab
                  paper={paper}
                  allTags={allTags}
                  settings={settings}
                  onChange={save}
                  onPrivacyChange={handlePrivacyToggle}
                />
              )}
              {narrowTab === 'relations' && (
                <div className="placeholder-tab">
                  <div className="placeholder-icon">⬡</div>
                  <div className="placeholder-title">关系图</div>
                  <div className="placeholder-desc">阶段 6 将实现文献引用与主题关联的射状图。</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="detail-foot">
          <div className="detail-meta-small">
            <span>加入：{formatDateShort(paper.addedAt)}</span>
            <span>修改：{formatDateShort(paper.updatedAt)}</span>
            <span style={{ color: saveStatus === 'pending' ? 'var(--gold)' : saveStatus === 'syncing' ? 'var(--accent)' : 'var(--cn)' }}>
              {saveStatus === 'pending' ? '· 待保存' : saveStatus === 'syncing' ? '· 同步中…' : '· 已保存'}
            </span>
          </div>
          {confirmDelete ? (
            <div className="delete-confirm">
              <span>确认删除这篇文献？</span>
              <button className="btn-danger" onClick={handleDelete}>确认删除</button>
              <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>取消</button>
            </div>
          ) : (
            <button className="btn-delete" onClick={() => setConfirmDelete(true)}>删除文献</button>
          )}
        </div>
      </div>
    </>
  )
}

// ── Left panel: Info + AI ─────────────────────────────────────────────────────

function InfoPanel({
  paper,
  allTags,
  settings,
  activeFileId,
  onChange,
  onPrivacyChange,
  onActiveFileChange,
}: {
  paper: Paper
  allTags: string[]
  settings: Partial<Settings>
  activeFileId: string | null
  onChange: (p: Paper) => void
  onPrivacyChange: (v: boolean) => void
  onActiveFileChange: (id: string | null) => void
}) {
  const { githubPat: pat = '', githubUsername: username = '', githubRepo: repo = '' } = settings
  const [editingField, setEditingField] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const originalFiles = paper.files.filter(f => f.type !== 'translation')
  const resolvedActiveId = activeFileId ?? originalFiles[0]?.id ?? null

  const handleUpload = async (rawFile: File) => {
    const format = getFileFormat(rawFile.name)
    if (!format) { setUploadError('仅支持 PDF、DOCX、TXT、MD 格式'); return }
    setUploading(true); setUploadError('')
    const fileId = generateId()
    const ext = rawFile.name.split('.').pop()!
    const arrayBuffer = await rawFile.arrayBuffer()
    const blob = new Blob([arrayBuffer], { type: rawFile.type })
    await saveFileBlob(paper.id, fileId, blob)
    let githubPath: string | undefined, githubSha: string | undefined
    if (!paper.isPrivate && pat && username && repo) {
      try {
        const path = githubFilePath('original' as FileType, paper.id, fileId, ext)
        const sha = await uploadPaperFile(pat, username, repo, path, arrayBuffer, `upload: ${rawFile.name}`)
        githubPath = path; githubSha = sha
      } catch (err) {
        setUploadError(`GitHub 上传失败：${(err as Error).message}`)
      }
    }
    const paperFile: PaperFile = {
      id: fileId, type: 'original', filename: rawFile.name,
      githubPath, githubSha, format, size: rawFile.size, addedAt: now(),
    }
    onChange({ ...paper, files: [...paper.files, paperFile] })
    onActiveFileChange(fileId)
    setUploading(false)
  }

  const handleDelete = async (pf: PaperFile) => {
    setDeletingId(pf.id)
    if (pf.githubPath && pf.githubSha && pat && username && repo) {
      try { await deleteFile(pat, username, repo, pf.githubPath, pf.githubSha, `delete: ${pf.filename}`) }
      catch { /* ignore */ }
    }
    await deleteFileBlob(paper.id, pf.id)
    onChange({ ...paper, files: paper.files.filter(f => f.id !== pf.id) })
    if (resolvedActiveId === pf.id) onActiveFileChange(null)
    setDeletingId(null)
  }

  const editProps = (field: string) => ({
    editing: editingField === field,
    onDoubleClick: () => setEditingField(field),
    onBlur: () => setEditingField(null),
  })

  return (
    <div className="info-panel">
      {/* Basic info */}
      <div className="info-section">
        <div className="section-label">基本信息</div>
        <InfoField label="标题" value={paper.title} {...editProps('title')}
          onChange={v => onChange({ ...paper, title: v })} />
        <InfoField label="中文译名" value={paper.titleCn ?? ''} placeholder="暂无" {...editProps('titleCn')}
          onChange={v => onChange({ ...paper, titleCn: v || undefined })} />
        <InfoField label="作者" value={paper.authors.join(', ')} placeholder="暂无" {...editProps('authors')}
          onChange={v => onChange({ ...paper, authors: v.split(/[,，]+/).map(s => s.trim()).filter(Boolean) })} />
        <div className="info-field-row">
          <InfoField label="年份" value={paper.year > 0 ? String(paper.year) : ''} placeholder="—" {...editProps('year')}
            onChange={v => onChange({ ...paper, year: parseInt(v) || paper.year })} short />
          <InfoField label="期刊/会议" value={paper.venue ?? ''} placeholder="暂无" {...editProps('venue')}
            onChange={v => onChange({ ...paper, venue: v || undefined })} />
        </div>
        <div className="info-field-row" style={{ marginTop: 4 }}>
          <span className="info-field-label" style={{ alignSelf: 'center' }}>语言</span>
          <select
            className="edit-input info-select"
            value={paper.language}
            onChange={e => onChange({ ...paper, language: e.target.value as Paper['language'] })}
          >
            <option value="en">英文</option>
            <option value="jp">日文</option>
            <option value="zh">中文</option>
            <option value="other">其他</option>
          </select>
        </div>
      </div>

      {/* Status */}
      <div className="info-section">
        <div className="section-label">阅读状态</div>
        <div className="status-pills">
          {STATUS_OPTIONS.map(({ value, label }) => (
            <button key={value}
              className={`status-pill ${paper.status === value ? 'active' : ''}`}
              onClick={() => onChange({ ...paper, status: value })}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* Tags */}
      <div className="info-section">
        <div className="section-label">主题标签</div>
        <TagInput tags={paper.tags} allTags={allTags} onChange={tags => onChange({ ...paper, tags })} />
      </div>

      {/* Private toggle */}
      <div className="info-section">
        <label className="private-toggle">
          <input type="checkbox" checked={paper.isPrivate} onChange={e => onPrivacyChange(e.target.checked)} />
          <span className="toggle-label">
            <span className="toggle-title">🔒 仅本地</span>
            <span className="toggle-desc">不同步 PDF 到 GitHub</span>
          </span>
        </label>
      </div>

      {/* Original files */}
      <div className="info-section">
        <div className="section-label">原文文件</div>
        <div className="info-file-list">
          {originalFiles.length === 0 ? (
            <p className="file-empty-hint">暂无原文文件</p>
          ) : (
            originalFiles.map(f => (
              <div
                key={f.id}
                className={`file-item ${resolvedActiveId === f.id ? 'active' : ''}`}
                onClick={() => onActiveFileChange(f.id)}
              >
                <span className="file-icon">{f.format === 'pdf' ? '📄' : '📝'}</span>
                <span className="file-name" title={f.filename}>{f.filename}</span>
                {!f.githubPath && <span className="file-local-badge" title="仅本地">🔒</span>}
                <button className="file-del-btn"
                  onClick={e => { e.stopPropagation(); handleDelete(f) }}
                  disabled={deletingId === f.id}
                >{deletingId === f.id ? '…' : '✕'}</button>
              </div>
            ))
          )}
        </div>
        <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.md" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }}
        />
        <button
          className="btn-secondary file-upload-btn"
          style={{ marginTop: 8 }}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >{uploading ? '上传中…' : '＋ 上传原文'}</button>
        {paper.isPrivate && <p className="file-private-note">🔒 仅本地，不上传 GitHub</p>}
        {uploadError && <p className="file-upload-error">{uploadError}</p>}
      </div>

      {/* AI */}
      <SummarySection paper={paper} settings={settings} onChange={onChange} />
    </div>
  )
}

// ── Compact editable field ────────────────────────────────────────────────────

function InfoField({
  label, value, placeholder = '—', editing, short = false,
  onDoubleClick, onBlur, onChange,
}: {
  label: string
  value: string
  placeholder?: string
  editing: boolean
  short?: boolean
  onDoubleClick: () => void
  onBlur: () => void
  onChange: (v: string) => void
}) {
  return (
    <div className={`info-field${short ? ' info-field--short' : ''}`}>
      <span className="info-field-label">{label}</span>
      {editing ? (
        <input
          className="edit-input info-edit-input"
          autoFocus
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={e => e.key === 'Enter' && onBlur()}
        />
      ) : (
        <span
          className={`info-field-value${!value ? ' info-field-empty' : ''}`}
          onDoubleClick={onDoubleClick}
          title="双击编辑"
        >
          {value || placeholder}
        </span>
      )}
    </div>
  )
}

// ── Middle panel: PDF viewer ─────────────────────────────────────────────────

function PdfMidPanel({
  paper,
  fileId,
  settings,
}: {
  paper: Paper
  fileId: string | null
  settings: Partial<Settings>
}) {
  const { githubPat: pat = '', githubUsername: username = '', githubRepo: repo = '' } = settings
  const originalFiles = paper.files.filter(f => f.type !== 'translation')
  const activeFile = originalFiles.find(f => f.id === fileId) ?? originalFiles[0] ?? null

  const { blob, loading, error } = useFileContent(
    paper.id,
    activeFile?.id ?? '',
    activeFile?.githubPath,
    pat, username, repo,
  )

  if (!activeFile) {
    return (
      <div className="file-viewer-empty">
        <span>在左侧上传原文文件后，可在这里阅读</span>
      </div>
    )
  }
  if (loading) return <div className="file-loading" style={{ padding: '20px 16px' }}>加载文件中…</div>
  if (error) return <p className="viewer-error" style={{ margin: 16 }}>{error}</p>
  if (!blob) return null

  return (
    <div className="pdf-mid-inner">
      {activeFile.format === 'pdf' && <PdfViewer blob={blob} />}
      {activeFile.format === 'docx' && <DocxViewer blob={blob} />}
      {activeFile.format !== 'pdf' && activeFile.format !== 'docx' && (
        <p className="viewer-error" style={{ margin: 16 }}>不支持预览此格式（{activeFile.format}）</p>
      )}
    </div>
  )
}

// ── Right panel: Notes only ──────────────────────────────────────────────────

function NotesPanel({
  paper,
  onChange,
  saveStatus,
}: {
  paper: Paper
  onChange: (p: Paper) => void
  saveStatus: 'saved' | 'pending' | 'syncing'
}) {
  return (
    <div className="notes-panel">
      <div className="notes-panel-head">
        <span className="section-label" style={{ margin: 0 }}>个人笔记</span>
        <span className="notes-save-status" style={{
          color: saveStatus === 'pending' ? 'var(--gold)'
            : saveStatus === 'syncing' ? 'var(--accent)'
            : 'var(--cn)',
        }}>
          {saveStatus === 'pending' ? '待保存' : saveStatus === 'syncing' ? '同步中…' : '已保存'}
        </span>
      </div>
      <textarea
        className="notes-textarea notes-textarea--fill"
        placeholder="在这里记录阅读笔记、摘录、想法…（支持 Markdown）"
        value={paper.notes}
        onChange={e => onChange({ ...paper, notes: e.target.value })}
      />
    </div>
  )
}

// ── Narrow mode: Notes & AI tab (unchanged) ──────────────────────────────────

function NotesTab({
  paper,
  allTags,
  settings,
  onChange,
  onPrivacyChange,
}: {
  paper: Paper
  allTags: string[]
  settings: Partial<Settings>
  onChange: (p: Paper) => void
  onPrivacyChange: (newValue: boolean) => void
}) {
  return (
    <div className="notes-tab">
      <div className="notes-section">
        <div className="section-label">基本信息</div>
        <div className="edit-grid">
          <div className="edit-field">
            <label>标题</label>
            <input className="edit-input" value={paper.title}
              onChange={e => onChange({ ...paper, title: e.target.value })} />
          </div>
          <div className="edit-field">
            <label>中文译名</label>
            <input className="edit-input" placeholder="如有中文标题，填在这里"
              value={paper.titleCn ?? ''}
              onChange={e => onChange({ ...paper, titleCn: e.target.value || undefined })} />
          </div>
          <div className="edit-field">
            <label>作者（逗号分隔）</label>
            <input className="edit-input" value={paper.authors.join(', ')}
              onChange={e => onChange({ ...paper, authors: e.target.value.split(/[,，]+/).map(s => s.trim()).filter(Boolean) })} />
          </div>
          <div className="edit-field-row">
            <div className="edit-field edit-field-short">
              <label>年份</label>
              <input className="edit-input" type="number" value={paper.year}
                onChange={e => onChange({ ...paper, year: parseInt(e.target.value) || paper.year })} />
            </div>
            <div className="edit-field edit-field-short">
              <label>语言</label>
              <select className="edit-input" value={paper.language}
                onChange={e => onChange({ ...paper, language: e.target.value as Paper['language'] })}>
                <option value="en">英文</option>
                <option value="jp">日文</option>
                <option value="zh">中文</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div className="edit-field" style={{ flex: 1 }}>
              <label>期刊 / 会议</label>
              <input className="edit-input" placeholder="发表期刊或会议"
                value={paper.venue ?? ''}
                onChange={e => onChange({ ...paper, venue: e.target.value || undefined })} />
            </div>
          </div>
        </div>
      </div>
      <div className="notes-section">
        <div className="section-label">阅读状态</div>
        <div className="status-pills">
          {STATUS_OPTIONS.map(({ value, label }) => (
            <button key={value}
              className={`status-pill ${paper.status === value ? 'active' : ''}`}
              onClick={() => onChange({ ...paper, status: value })}
            >{label}</button>
          ))}
        </div>
      </div>
      <div className="notes-section">
        <div className="section-label">主题标签</div>
        <TagInput tags={paper.tags} allTags={allTags} onChange={tags => onChange({ ...paper, tags })} />
      </div>
      <div className="notes-section">
        <label className="private-toggle">
          <input type="checkbox" checked={paper.isPrivate} onChange={e => onPrivacyChange(e.target.checked)} />
          <span className="toggle-label">
            <span className="toggle-title">🔒 仅本地，不同步到 GitHub</span>
            <span className="toggle-desc">勾选后，该文献的 PDF 文件不会上传到 GitHub 仓库；元数据仍然同步。</span>
          </span>
        </label>
      </div>
      <div className="notes-section">
        <div className="section-label">个人笔记</div>
        <textarea className="notes-textarea" rows={8}
          placeholder="在这里记录阅读笔记、摘录、想法…（支持 Markdown）"
          value={paper.notes}
          onChange={e => onChange({ ...paper, notes: e.target.value })} />
      </div>
      <SummarySection paper={paper} settings={settings} onChange={onChange} />
    </div>
  )
}

// ── AI summary section ────────────────────────────────────────────────────────

function SummarySection({
  paper,
  settings,
  onChange,
}: {
  paper: Paper
  settings: Partial<Settings>
  onChange: (p: Paper) => void
}) {
  const { githubPat: pat = '', githubUsername: username = '', githubRepo: repo = '' } = settings
  const apiKey = settings.claudeApiKey ?? ''
  const model = settings.aiSummaryModel || DEFAULT_SUMMARY_MODEL

  const [generating, setGenerating] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showFullSummary, setShowFullSummary] = useState(false)
  const abortRef = useRef<(() => void) | null>(null)

  const pdfFile = paper.files.find(f => f.type === 'original' && f.format === 'pdf')

  const loadBlob = async (): Promise<Blob> => {
    if (!pdfFile) throw new Error('该文献没有 PDF 原文，无法生成摘要')
    const cached = await getFileBlob(paper.id, pdfFile.id)
    if (cached) return cached
    if (!pdfFile.githubPath || !pat || !username || !repo) {
      throw new Error('PDF 不在本地缓存且 GitHub 配置缺失')
    }
    const { content } = await fetchFileContent(pat, username, repo, pdfFile.githubPath)
    const blob = new Blob([content])
    await saveFileBlob(paper.id, pdfFile.id, blob)
    return blob
  }

  const handleGenerate = async () => {
    if (!apiKey) { setShowSettings(true); return }
    setError(null); setStreamText(''); setGenerating(true)
    try {
      const blob = await loadBlob()
      const file = new File([blob], pdfFile!.filename, { type: 'application/pdf' })
      const { text: paperText } = await extractFullPdfText(file)
      let acc = ''
      const summary = await generateSummary({
        apiKey, paperText, model,
        onAbortable: (abort) => { abortRef.current = abort },
        onDelta: (delta) => { acc += delta; setStreamText(acc) },
      })
      onChange({ ...paper, aiSummary: summary, aiSummaryGeneratedAt: now() })
      setStreamText('')
    } catch (err) {
      const msg = err instanceof AiError ? err.message : err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setGenerating(false); abortRef.current = null
    }
  }

  const handleSaveToNotes = () => {
    if (!paper.aiSummary) return
    const header = `\n\n## AI 摘要（${model}）\n\n`
    onChange({ ...paper, notes: (paper.notes || '').trimEnd() + header + paper.aiSummary })
  }

  const hasSummary = !!paper.aiSummary
  const displayText = streamText || (hasSummary ? paper.aiSummary! : '')

  return (
    <div className="ai-zone">
      <div className="ai-zone-title">AI 辅助</div>
      {!apiKey && !generating && (
        <p className="ai-note" style={{ marginTop: 0 }}>
          尚未配置 Claude API Key。
          <button onClick={() => setShowSettings(true)} style={{
            background: 'none', border: 'none', padding: 0, marginLeft: 6,
            color: 'var(--accent)', textDecoration: 'underline',
            fontFamily: 'var(--sans)', fontSize: 'inherit', cursor: 'pointer',
          }}>前往设置</button>
        </p>
      )}
      <div className="ai-buttons">
        {!generating ? (
          <button className="ai-btn" onClick={handleGenerate} disabled={!pdfFile}>
            {hasSummary ? '✦ 重新生成摘要' : '✦ 生成中文摘要'}
          </button>
        ) : (
          <button className="ai-btn" onClick={() => abortRef.current?.()}>⏹ 取消生成</button>
        )}
        {hasSummary && !generating && (
          <button className="ai-btn" onClick={handleSaveToNotes} title="将摘要追加到笔记区">⤓ 保存到笔记</button>
        )}
        <button className="ai-btn" disabled title="阶段 5.5 实现">✦ 推荐主题标签</button>
      </div>
      {!pdfFile && <p className="ai-note">这篇文献没有 PDF 原文，无法生成摘要。请先上传。</p>}
      {error && <p className="ai-note" style={{ color: 'var(--accent)' }}>⚠ {error}</p>}
      {displayText && (
        <div style={{
          marginTop: 10, padding: '12px 14px',
          background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 3,
          fontSize: 13, lineHeight: 1.7, color: 'var(--ink)', whiteSpace: 'pre-wrap',
          maxHeight: showFullSummary ? 'none' : 200, overflow: 'hidden', position: 'relative',
        }}>
          {displayText}
          {generating && (
            <span style={{
              display: 'inline-block', width: 7, height: 14, marginLeft: 2,
              background: 'var(--accent)', verticalAlign: 'middle',
              animation: 'cursor-blink 1s steps(2) infinite',
            }} />
          )}
        </div>
      )}
      {hasSummary && !generating && paper.aiSummary && paper.aiSummary.length > 200 && (
        <button onClick={() => setShowFullSummary(v => !v)} style={{
          background: 'none', border: 'none', padding: 0, marginTop: 6,
          color: 'var(--ink-faint)', fontFamily: 'var(--sans)', fontSize: 11,
          textDecoration: 'underline', cursor: 'pointer',
        }}>{showFullSummary ? '收起' : '展开全文'}</button>
      )}
      {hasSummary && paper.aiSummaryGeneratedAt && !generating && (
        <p className="ai-note" style={{ marginTop: 8, fontSize: 10 }}>
          生成于 {formatDateShort(paper.aiSummaryGeneratedAt)} · 模型 {model}
        </p>
      )}
      {showSettings && <AiSettingsDialog onClose={() => setShowSettings(false)} />}
      <style>{`@keyframes cursor-blink { to { opacity: 0 } }`}</style>
    </div>
  )
}
