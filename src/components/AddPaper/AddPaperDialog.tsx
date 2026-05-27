import { useState, useRef, useCallback } from 'react'
import { useAppContext } from '../../store/AppContext'
import TagInput from '../shared/TagInput'
import type { Language, Paper, PaperFile } from '../../types'
import { generateId, now, parseAuthors } from '../../utils/helpers'
import { getFileFormat, githubFilePath, formatFileSize } from '../../utils/fileUtils'
import { extractPdfInfo } from '../../utils/pdfExtract'
import { uploadPaperFile } from '../../utils/github'
import { saveFileBlob } from '../../store/db'
import './AddPaperDialog.css'

interface Props {
  onClose: () => void
}

interface FormState {
  title: string
  titleCn: string
  authorsRaw: string
  year: string
  venue: string
  language: Language
  tags: string[]
  isPrivate: boolean
}

const defaultForm: FormState = {
  title: '',
  titleCn: '',
  authorsRaw: '',
  year: String(new Date().getFullYear()),
  venue: '',
  language: 'en',
  tags: [],
  isPrivate: false,
}

export default function AddPaperDialog({ onClose }: Props) {
  const { addPaper, allTags, settings } = useAppContext()
  const [form, setForm] = useState<FormState>(defaultForm)
  const [droppedFile, setDroppedFile] = useState<File | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [detectedDoi, setDetectedDoi]         = useState<string | null>(null)
  const [detectedArxivId, setDetectedArxivId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const set = (patch: Partial<FormState>) => setForm(f => ({ ...f, ...patch }))

  const handleFile = useCallback(async (file: File) => {
    const format = getFileFormat(file.name)
    if (!format) { setError('仅支持 PDF、DOCX、TXT、MD 格式'); return }
    setDroppedFile(file)
    setError('')

    if (format !== 'pdf') {
      set({ title: file.name.replace(/\.[^.]+$/, '') })
      return
    }

    setExtracting(true)
    try {
      const info = await extractPdfInfo(file)
      setDetectedDoi(info.doi)
      setDetectedArxivId(info.arxivId)
      set({
        title:      info.title || file.name.replace(/\.pdf$/i, ''),
        authorsRaw: info.authors.join(', '),
        year:       info.year ? String(info.year) : String(new Date().getFullYear()),
        language:   info.language,
      })
    } catch {
      set({ title: file.name.replace(/\.pdf$/i, '') })
    } finally {
      setExtracting(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleSubmit = async () => {
    if (!form.title.trim()) { setError('标题不能为空'); return }
    setSaving(true)
    setError('')

    const paperId = generateId()
    const files: PaperFile[] = []

    if (droppedFile) {
      const format = getFileFormat(droppedFile.name)!
      const fileId = generateId()
      const ext = droppedFile.name.split('.').pop()!
      const arrayBuffer = await droppedFile.arrayBuffer()
      const blob = new Blob([arrayBuffer], { type: droppedFile.type })

      await saveFileBlob(paperId, fileId, blob)

      let githubPath: string | undefined
      let githubSha: string | undefined

      const { githubPat: pat, githubUsername: username, githubRepo: repo } = settings
      if (!form.isPrivate && pat && username && repo) {
        try {
          const path = githubFilePath('original', paperId, fileId, ext)
          const sha = await uploadPaperFile(pat, username, repo, path, arrayBuffer, `upload: ${droppedFile.name}`)
          githubPath = path
          githubSha = sha
        } catch (err) {
          setError(`GitHub 上传失败：${(err as Error).message}，文件已保存到本地`)
        }
      }

      files.push({
        id: fileId,
        type: 'original',
        filename: droppedFile.name,
        githubPath,
        githubSha,
        format,
        size: droppedFile.size,
        addedAt: now(),
      })
    }

    const paper: Paper = {
      id: paperId,
      title:    form.title.trim(),
      titleCn:  form.titleCn.trim() || undefined,
      authors:  parseAuthors(form.authorsRaw),
      year:     parseInt(form.year) || new Date().getFullYear(),
      venue:    form.venue.trim() || undefined,
      language: form.language,
      tags:     form.tags,
      status:   'unread',
      notes:    '',
      files,
      cites:    [],
      citedBy:  [],
      manualRelations: [],
      isPrivate: form.isPrivate,
      doi:      detectedDoi   ?? undefined,
      arxivId:  detectedArxivId ?? undefined,
      addedAt:  now(),
      updatedAt: now(),
    }

    await addPaper(paper)
    onClose()
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="add-dialog" role="dialog" aria-modal="true">
        <div className="add-dialog-head">
          <h2 className="add-dialog-title">添加文献</h2>
          <button className="dialog-close" onClick={onClose}>✕</button>
        </div>

        <div className="add-dialog-body">
          {/* ── Drop zone ─────────────────────────────────────────────────── */}
          <div
            className={`drop-zone ${isDragOver ? 'drag-over' : ''} ${droppedFile ? 'has-file' : ''}`}
            onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
            />
            {droppedFile ? (
              <div className="drop-zone-file">
                <span className="drop-zone-icon">{droppedFile.name.endsWith('.pdf') ? '📄' : '📝'}</span>
                <span className="drop-zone-filename">{droppedFile.name}</span>
                <span className="drop-zone-size">{formatFileSize(droppedFile.size)}</span>
                <button className="drop-zone-clear" onClick={e => { e.stopPropagation(); setDroppedFile(null) }}>✕</button>
              </div>
            ) : (
              <div className="drop-zone-hint">
                <span className="drop-zone-icon-big">＋</span>
                <span>拖入 PDF / DOCX 文件，或点击选择</span>
                <span className="drop-zone-sub">自动识别标题、作者、年份</span>
              </div>
            )}
          </div>

          {/* ── Extraction status ─────────────────────────────────────────── */}
          {extracting && (
            <p className="extract-status extracting">⏳ 正在识别文件信息…</p>
          )}

          {/* ── Form fields ───────────────────────────────────────────────── */}
          <div className="field-row">
            <div className="field field-grow">
              <label>标题 <span className="required">*</span></label>
              <input className="field-input" type="text" placeholder="论文原标题"
                value={form.title} onChange={e => set({ title: e.target.value })} autoFocus />
            </div>
          </div>

          <div className="field-row">
            <div className="field field-grow">
              <label>中文译名 <span className="optional">可选</span></label>
              <input className="field-input" type="text" placeholder="如有中文标题或译名，填在这里"
                value={form.titleCn} onChange={e => set({ titleCn: e.target.value })} />
            </div>
          </div>

          <div className="field-row">
            <div className="field field-grow">
              <label>作者</label>
              <input className="field-input" type="text" placeholder="多位作者用逗号分隔"
                value={form.authorsRaw} onChange={e => set({ authorsRaw: e.target.value })} />
            </div>
          </div>

          <div className="field-row">
            <div className="field field-year">
              <label>年份</label>
              <input className="field-input" type="number" min="1900" max="2099"
                value={form.year} onChange={e => set({ year: e.target.value })} />
            </div>
            <div className="field field-lang">
              <label>语言</label>
              <select className="field-input" value={form.language}
                onChange={e => set({ language: e.target.value as Language })}>
                <option value="en">英文</option>
                <option value="jp">日文</option>
                <option value="zh">中文</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div className="field field-grow">
              <label>期刊 / 会议 <span className="optional">可选</span></label>
              <input className="field-input" type="text" placeholder="发表期刊或会议名称"
                value={form.venue} onChange={e => set({ venue: e.target.value })} />
            </div>
          </div>

          <div className="field">
            <label>主题标签</label>
            <TagInput tags={form.tags} allTags={allTags} onChange={tags => set({ tags })} />
          </div>

          <label className="private-toggle-row">
            <input type="checkbox" checked={form.isPrivate}
              onChange={e => set({ isPrivate: e.target.checked })} />
            <span>
              <strong>🔒 仅本地，不上传到 GitHub</strong>
              <span className="private-toggle-desc">适用于采访录音、未公开资料等需要保密的内容</span>
            </span>
          </label>

          {error && <p className="add-dialog-error">{error}</p>}
        </div>

        <div className="add-dialog-foot">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>取消</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving || extracting}>
            {saving ? '添加中…' : '确认添加'}
          </button>
        </div>
      </div>
    </>
  )
}
