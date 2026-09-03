import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppContext } from '../../store/AppContext'
import {
  deleteTranscript,
  listTranscripts,
  saveTranscript,
} from '../../store/db'
import type { TranscriptRecord } from '../../types'
import {
  LANGUAGE_OPTIONS,
  formatTimestamp,
  probeDuration,
  transcribeAudio,
  type TranscribeLanguage,
} from '../../utils/transcription'
import TranscriptEditor from './TranscriptEditor'
import '../AddPaper/AddPaperDialog.css'
import './TranscribeDialog.css'

interface Props {
  onClose: () => void
  onOpenSettings: () => void
}

type Phase = 'idle' | 'working' | 'error'

const ACCEPT =
  '.mp3,.wav,.m4a,.mp4,.aac,.flac,.ogg,.webm,.aiff,.amr,audio/*,video/mp4,video/webm'

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function newId(): string {
  return `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export default function TranscribeDialog({ onClose, onOpenSettings }: Props) {
  const { settings } = useAppContext()
  const apiKey = settings.elevenLabsApiKey?.trim()

  const [records, setRecords] = useState<TranscriptRecord[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [language, setLanguage] = useState<TranscribeLanguage>('auto')
  const [diarize, setDiarize] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [saveNote, setSaveNote] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<number | null>(null)

  const active = records.find(r => r.id === activeId) ?? null

  // 载入历史记录
  useEffect(() => {
    listTranscripts().then(setRecords).catch(() => setRecords([]))
  }, [])

  // 转写计时器（elapsed 在 handleTranscribe 里归零）
  useEffect(() => {
    if (phase !== 'working') return
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  // 卸载时把还没落盘的改动写掉
  useEffect(() => {
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current) }
  }, [])

  const persist = useCallback(async (record: TranscriptRecord) => {
    const mode = await saveTranscript(record)
    if (mode === 'no-audio') {
      setSaveNote('音频太大，浏览器只保存了文字部分。')
      setRecords(rs => rs.map(r => (r.id === record.id ? { ...record, audioBlob: undefined } : r)))
    }
  }, [])

  /** 编辑器里的改动：立刻更新界面，800ms 后落盘 */
  const handleRecordChange = useCallback((next: TranscriptRecord) => {
    const stamped = { ...next, updatedAt: new Date().toISOString() }
    setRecords(rs => rs.map(r => (r.id === stamped.id ? stamped : r)))
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => { void persist(stamped) }, 800)
  }, [persist])

  const pickFile = (f: File | null) => {
    setFile(f)
    setError('')
    setPhase('idle')
    setDuration(null)
    if (f) probeDuration(f).then(setDuration)
  }

  const handleTranscribe = async () => {
    if (!file || !apiKey) return
    setElapsed(0)
    setPhase('working')
    setError('')
    setSaveNote('')
    try {
      const result = await transcribeAudio(apiKey, file, { language, diarize })
      const now = new Date().toISOString()
      const record: TranscriptRecord = {
        id: newId(),
        title: file.name.replace(/\.[^.]+$/, ''),
        filename: file.name,
        languageCode: result.languageCode,
        diarized: result.diarized,
        segments: result.segments,
        audioBlob: file,
        audioType: file.type,
        durationSec: duration ?? undefined,
        createdAt: now,
        updatedAt: now,
      }
      await persist(record)
      setRecords(rs => [record, ...rs])
      setActiveId(record.id)
      setPhase('idle')
      setFile(null)
      setDuration(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  const handleDelete = async () => {
    if (!active) return
    if (!window.confirm(`删除「${active.title}」？这条转写记录和它的音频都会从本地移除，无法恢复。`)) return
    await deleteTranscript(active.id)
    setRecords(rs => rs.filter(r => r.id !== active.id))
    setActiveId(null)
  }

  /** 音频没存下来时，重新挂上本地文件 */
  const handleAttachAudio = useCallback((f: File) => {
    if (!active) return
    handleRecordChange({ ...active, audioBlob: f, audioType: f.type })
  }, [active, handleRecordChange])

  const working = phase === 'working'

  return (
    <>
      <div className="overlay" onClick={working ? undefined : onClose} />
      <div className="add-dialog transcribe-dialog" role="dialog" aria-modal="true">
        <div className="add-dialog-head">
          <h2 className="add-dialog-title">音频转写</h2>
          <button className="dialog-close" onClick={onClose} disabled={working}>✕</button>
        </div>

        <div className="add-dialog-body transcribe-body">
          {saveNote && <div className="transcribe-warn">{saveNote}</div>}

          {active ? (
            <TranscriptEditor
              record={active}
              onChange={handleRecordChange}
              onBack={() => setActiveId(null)}
              onDelete={handleDelete}
              onAttachAudio={handleAttachAudio}
            />
          ) : (
            <>
              {!apiKey && (
                <div className="transcribe-warn">
                  尚未配置 ElevenLabs API Key。转写功能需要在
                  <button className="transcribe-link" onClick={onOpenSettings}>AI 设置</button>
                  中填入 Key（
                  <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">
                    elevenlabs.io
                  </a>
                   获取，免费计划每月含约 2.5 小时转写额度）。
                </div>
              )}

              {/* 文件选择区 */}
              <div
                className={`transcribe-drop${dragOver ? ' drag-over' : ''}${file ? ' has-file' : ''}`}
                onClick={() => !working && inputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault()
                  setDragOver(false)
                  if (working) return
                  const f = e.dataTransfer.files?.[0]
                  if (f) pickFile(f)
                }}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPT}
                  style={{ display: 'none' }}
                  onChange={e => pickFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <div className="transcribe-file-info">
                    <span className="transcribe-file-name">{file.name}</span>
                    <span className="transcribe-file-meta">
                      {formatSize(file.size)}
                      {duration != null && ` · ${formatTimestamp(duration)}`}
                    </span>
                  </div>
                ) : (
                  <div className="transcribe-drop-hint">
                    <span style={{ fontSize: 22, opacity: 0.4 }}>♫</span>
                    <span>点击选择或拖入音频/视频文件</span>
                    <span className="transcribe-drop-sub">支持 mp3 / wav / m4a / mp4 / flac 等 · 日文、中文、英文</span>
                  </div>
                )}
              </div>

              {/* 选项 */}
              <div className="field-row" style={{ marginTop: 14 }}>
                <div className="field">
                  <label>语言</label>
                  <select
                    className="field-input"
                    value={language}
                    onChange={e => setLanguage(e.target.value as TranscribeLanguage)}
                    disabled={working}
                  >
                    {LANGUAGE_OPTIONS.map(o => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ justifyContent: 'flex-end' }}>
                  <label style={{ visibility: 'hidden' }}>·</label>
                  <label className="transcribe-check">
                    <input
                      type="checkbox"
                      checked={diarize}
                      onChange={e => setDiarize(e.target.checked)}
                      disabled={working}
                    />
                    区分说话人（访谈/会议录音）
                  </label>
                </div>
              </div>

              <div className="transcribe-actions">
                <button
                  className="btn-primary"
                  onClick={handleTranscribe}
                  disabled={!file || !apiKey || working}
                >
                  {working ? '转写中…' : '开始转写'}
                </button>
                {working && (
                  <span className="transcribe-status">
                    <span className="transcribe-spinner" />
                    已用 {formatTimestamp(elapsed)}
                    {duration != null && duration > 600 && '（长音频可能需要几分钟，请勿关闭窗口）'}
                  </span>
                )}
              </div>

              {phase === 'error' && <div className="transcribe-error">{error}</div>}

              {/* 历史记录 */}
              {records.length > 0 && (
                <div className="tr-history">
                  <div className="tr-history-head">历史记录（保存在本机浏览器，不上传）</div>
                  {records.map(r => (
                    <button key={r.id} className="tr-history-item" onClick={() => setActiveId(r.id)}>
                      <span className="tr-history-title">{r.title}</span>
                      <span className="tr-history-meta">
                        {new Date(r.updatedAt).toLocaleString('zh-CN', {
                          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                        {' · '}{r.segments.length} 段
                        {r.durationSec != null && ` · ${formatTimestamp(r.durationSec)}`}
                        {!r.audioBlob && ' · 无音频'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {!active && (
          <div className="add-dialog-foot">
            <button className="btn-secondary" onClick={onClose} disabled={working}>关闭</button>
          </div>
        )}
      </div>
    </>
  )
}
