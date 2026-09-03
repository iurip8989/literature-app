import { useEffect, useRef, useState } from 'react'
import { useAppContext } from '../../store/AppContext'
import {
  LANGUAGE_OPTIONS,
  formatTimestamp,
  formatTranscript,
  probeDuration,
  transcribeAudio,
  type TranscribeLanguage,
  type TranscribeResult,
} from '../../utils/transcription'
import '../AddPaper/AddPaperDialog.css'
import './TranscribeDialog.css'

interface Props {
  onClose: () => void
  onOpenSettings: () => void
}

type Phase = 'idle' | 'working' | 'done' | 'error'

const ACCEPT =
  '.mp3,.wav,.m4a,.mp4,.aac,.flac,.ogg,.webm,.aiff,.amr,audio/*,video/mp4,video/webm'

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function TranscribeDialog({ onClose, onOpenSettings }: Props) {
  const { settings } = useAppContext()
  const apiKey = settings.elevenLabsApiKey?.trim()

  const [file, setFile] = useState<File | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [language, setLanguage] = useState<TranscribeLanguage>('auto')
  const [diarize, setDiarize] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<TranscribeResult | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [copied, setCopied] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 转写计时器（elapsed 在 handleTranscribe 里归零）
  useEffect(() => {
    if (phase !== 'working') return
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  const pickFile = (f: File | null) => {
    setFile(f)
    setResult(null)
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
    setResult(null)
    try {
      const r = await transcribeAudio(apiKey, file, { language, diarize })
      setResult(r)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  const plainText = result ? formatTranscript(result) : ''

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plainText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const handleDownload = () => {
    if (!file) return
    const base = file.name.replace(/\.[^.]+$/, '')
    const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${base}_转写.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const working = phase === 'working'

  return (
    <>
      <div className="overlay" onClick={working ? undefined : onClose} />
      <div className="add-dialog transcribe-dialog" role="dialog" aria-modal="true">
        <div className="add-dialog-head">
          <h2 className="add-dialog-title">音频转写</h2>
          <button className="dialog-close" onClick={onClose} disabled={working}>✕</button>
        </div>

        <div className="add-dialog-body">
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

          {/* 状态 / 结果 */}
          {working && (
            <div className="transcribe-status">
              <span className="transcribe-spinner" />
              正在转写…已用 {formatTimestamp(elapsed)}
              {duration != null && duration > 600 && '（长音频可能需要几分钟，请勿关闭窗口）'}
            </div>
          )}

          {phase === 'error' && <div className="transcribe-error">{error}</div>}

          {phase === 'done' && result && (
            <div className="transcribe-result">
              <div className="transcribe-result-head">
                <span>
                  转写完成
                  {result.languageCode && ` · 识别语言：${result.languageCode}`}
                  {` · ${plainText.length} 字符`}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary transcribe-mini-btn" onClick={handleCopy}>
                    {copied ? '已复制 ✓' : '复制'}
                  </button>
                  <button className="btn-secondary transcribe-mini-btn" onClick={handleDownload}>
                    下载 .txt
                  </button>
                </div>
              </div>
              <div className="transcribe-text">
                {result.diarized && result.segments.length > 0 ? (
                  result.segments.map((s, i) => (
                    <p key={i}>
                      <span className="transcribe-seg-meta">
                        {s.start != null && `[${formatTimestamp(s.start)}] `}
                        {s.speakerId && `${s.speakerId.replace('speaker_', '说话人 ')}：`}
                      </span>
                      {s.text}
                    </p>
                  ))
                ) : (
                  <p style={{ whiteSpace: 'pre-wrap' }}>{result.text}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="add-dialog-foot">
          <button className="btn-secondary" onClick={onClose} disabled={working}>关闭</button>
          <button
            className="btn-primary"
            onClick={handleTranscribe}
            disabled={!file || !apiKey || working}
          >
            {working ? '转写中…' : phase === 'done' ? '重新转写' : '开始转写'}
          </button>
        </div>
      </div>
    </>
  )
}
