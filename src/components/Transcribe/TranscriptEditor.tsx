import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TranscriptRecord } from '../../types'
import { findActiveSegment, formatTimestamp, speakerLabel } from '../../utils/transcription'
import {
  baseName,
  buildDocxBlob,
  buildPlainText,
  downloadBlob,
  type ExportOptions,
} from '../../utils/transcriptExport'

interface Props {
  record: TranscriptRecord
  onChange: (record: TranscriptRecord) => void
  onBack: () => void
  onDelete: () => void
  onAttachAudio: (file: File) => void
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]

export default function TranscriptEditor({
  record,
  onChange,
  onBack,
  onDelete,
  onAttachAudio,
}: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const reattachRef = useRef<HTMLInputElement>(null)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(record.durationSec ?? 0)
  const [speed, setSpeed] = useState(1)
  const [follow, setFollow] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [exportOpts, setExportOpts] = useState<ExportOptions>({
    includeTimestamps: true,
    includeSpeakers: record.diarized,
  })
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)

  // 音频对象 URL —— 记录切换时重建，卸载时回收
  const audioUrl = useMemo(
    () => (record.audioBlob ? URL.createObjectURL(record.audioBlob) : null),
    [record.audioBlob],
  )
  useEffect(() => {
    return () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }
  }, [audioUrl])

  const activeIndex = findActiveSegment(record.segments, currentTime)
  const activeId = activeIndex >= 0 ? record.segments[activeIndex].id : null

  // 跟随播放：滚动到当前段落（编辑中不打扰）
  useEffect(() => {
    if (!follow || !activeId || editingId) return
    const el = listRef.current?.querySelector(`[data-seg="${activeId}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeId, follow, editingId])

  // 进入编辑时聚焦并把光标放到末尾
  useEffect(() => {
    if (!editingId) return
    const ta = textareaRef.current
    if (!ta) return
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [editingId])

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds))
    setCurrentTime(audio.currentTime)
  }, [])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }, [])

  const commitEdit = useCallback(() => {
    if (!editingId) return
    const next = record.segments.map(s =>
      s.id === editingId ? { ...s, text: draft } : s,
    )
    setEditingId(null)
    // 内容没变就不写库，避免无谓的自动保存
    if (next.some((s, i) => s.text !== record.segments[i].text)) {
      onChange({ ...record, segments: next })
    }
  }, [editingId, draft, record, onChange])

  const startEdit = (id: string, text: string) => {
    if (editingId && editingId !== id) commitEdit()
    setEditingId(id)
    setDraft(text)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildPlainText(record, exportOpts))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* 剪贴板不可用 */ }
  }

  const handleDownloadTxt = () => {
    const blob = new Blob([buildPlainText(record, exportOpts)], {
      type: 'text/plain;charset=utf-8',
    })
    downloadBlob(blob, `${baseName(record.filename)}_转写.txt`)
  }

  const handleDownloadDocx = async () => {
    setExporting(true)
    try {
      const blob = await buildDocxBlob(record, exportOpts)
      downloadBlob(blob, `${baseName(record.filename)}_转写.docx`)
    } finally {
      setExporting(false)
    }
  }

  const charCount = record.segments.reduce((n, s) => n + s.text.length, 0)

  return (
    <div className="tr-editor">
      {/* ── 顶部：返回 + 标题 ─────────────────────────────────────────── */}
      <div className="tr-editor-head">
        <button className="tr-back" onClick={onBack} title="返回列表">‹ 返回</button>
        {editingTitle ? (
          <input
            className="tr-title-input"
            value={record.title}
            autoFocus
            onChange={e => onChange({ ...record, title: e.target.value })}
            onBlur={() => setEditingTitle(false)}
            onKeyDown={e => { if (e.key === 'Enter') setEditingTitle(false) }}
          />
        ) : (
          <button
            className="tr-title"
            onClick={() => setEditingTitle(true)}
            title="点击重命名"
          >
            {record.title}
          </button>
        )}
        <button className="tr-delete" onClick={onDelete} title="删除这条转写记录">删除</button>
      </div>

      {/* ── 播放器 ───────────────────────────────────────────────────── */}
      {audioUrl ? (
        <div className="tr-player">
          <audio
            ref={audioRef}
            src={audioUrl}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={e => {
              if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration)
              e.currentTarget.playbackRate = speed
            }}
          />
          <button className="tr-play" onClick={togglePlay}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="tr-skip" onClick={() => seekTo(currentTime - 5)} title="后退 5 秒">−5s</button>
          <button className="tr-skip" onClick={() => seekTo(currentTime + 5)} title="前进 5 秒">+5s</button>
          <input
            className="tr-seek"
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={e => seekTo(Number(e.target.value))}
          />
          <span className="tr-time">
            {formatTimestamp(currentTime)} / {formatTimestamp(duration)}
          </span>
          <select
            className="tr-speed"
            value={speed}
            onChange={e => {
              const v = Number(e.target.value)
              setSpeed(v)
              if (audioRef.current) audioRef.current.playbackRate = v
            }}
            title="播放速度"
          >
            {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
          </select>
          <label className="tr-follow" title="播放时自动滚动到当前句">
            <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />
            跟随
          </label>
        </div>
      ) : (
        <div className="tr-noaudio">
          音频没有保存下来（可能是文件太大超出浏览器存储限制）。文字仍可编辑；
          <button className="tr-link" onClick={() => reattachRef.current?.click()}>
            重新选择同一个音频文件
          </button>
          即可恢复边听边改。
          <input
            ref={reattachRef}
            type="file"
            accept="audio/*,video/*"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) onAttachAudio(f)
            }}
          />
        </div>
      )}

      {/* ── 段落列表 ─────────────────────────────────────────────────── */}
      <div className="tr-segments" ref={listRef}>
        {record.segments.length === 0 && (
          <p className="tr-empty">这条记录没有内容。</p>
        )}
        {record.segments.map(seg => {
          const isActive = seg.id === activeId
          const isEditing = seg.id === editingId
          return (
            <div
              key={seg.id}
              data-seg={seg.id}
              className={`tr-seg${isActive ? ' active' : ''}${isEditing ? ' editing' : ''}`}
            >
              <div className="tr-seg-meta">
                {seg.start != null && (
                  <button
                    className="tr-seg-time"
                    onClick={() => seekTo(seg.start!)}
                    disabled={!audioUrl}
                    title={audioUrl ? '跳到这句' : '没有音频'}
                  >
                    {formatTimestamp(seg.start)}
                  </button>
                )}
                {seg.speakerId && (
                  <span className="tr-seg-speaker">{speakerLabel(seg.speakerId)}</span>
                )}
              </div>

              {isEditing ? (
                <textarea
                  ref={textareaRef}
                  className="tr-seg-input"
                  value={draft}
                  onChange={e => {
                    setDraft(e.target.value)
                    e.target.style.height = 'auto'
                    e.target.style.height = `${e.target.scrollHeight}px`
                  }}
                  onBlur={commitEdit}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { e.preventDefault(); commitEdit() }
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault(); commitEdit()
                    }
                  }}
                />
              ) : (
                <div
                  className="tr-seg-text"
                  onClick={() => startEdit(seg.id, seg.text)}
                  title="点击编辑"
                >
                  {seg.text}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── 导出栏 ───────────────────────────────────────────────────── */}
      <div className="tr-export">
        <div className="tr-export-opts">
          <label>
            <input
              type="checkbox"
              checked={exportOpts.includeTimestamps}
              onChange={e => setExportOpts(o => ({ ...o, includeTimestamps: e.target.checked }))}
            />
            含时间戳
          </label>
          <label>
            <input
              type="checkbox"
              checked={exportOpts.includeSpeakers}
              onChange={e => setExportOpts(o => ({ ...o, includeSpeakers: e.target.checked }))}
            />
            含说话人
          </label>
          <span className="tr-count">{record.segments.length} 段 · {charCount} 字</span>
        </div>
        <div className="tr-export-btns">
          <button className="btn-secondary tr-mini" onClick={handleCopy}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
          <button className="btn-secondary tr-mini" onClick={handleDownloadTxt}>.txt</button>
          <button className="btn-primary tr-mini" onClick={handleDownloadDocx} disabled={exporting}>
            {exporting ? '生成中…' : 'Word (.docx)'}
          </button>
        </div>
      </div>
    </div>
  )
}
