import { useState } from 'react'
import { useAppContext } from '../../store/AppContext'
import { DEFAULT_SUMMARY_MODEL } from '../../utils/aiClient'
import '../AddPaper/AddPaperDialog.css'

interface Props {
  onClose: () => void
}

const MODEL_OPTIONS: { id: string; label: string; hint: string }[] = [
  { id: 'claude-sonnet-4-6',  label: 'Sonnet 4.6', hint: '推荐 · 平衡质量与成本' },
  { id: 'claude-opus-4-7',    label: 'Opus 4.7',   hint: '最高质量 · 3 倍价格' },
  { id: 'claude-haiku-4-5',   label: 'Haiku 4.5',  hint: '最便宜 · 适合简单任务' },
]

export default function AiSettingsDialog({ onClose }: Props) {
  // Read settings + updateSettings from the SHARED context (not from a fresh
  // useSettings() instance — that would create its own React state and writes
  // would never reach the rest of the app until reload). See bug fix note.
  const { settings, updateSettings } = useAppContext()
  const [apiKey, setApiKey] = useState(settings.claudeApiKey ?? '')
  const [model, setModel] = useState(settings.aiSummaryModel ?? DEFAULT_SUMMARY_MODEL)
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await updateSettings({
      claudeApiKey: apiKey.trim() || undefined,
      aiSummaryModel: model,
    })
    setSaving(false)
    onClose()
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="add-dialog" role="dialog" aria-modal="true">
        <div className="add-dialog-head">
          <h2 className="add-dialog-title">AI 设置</h2>
          <button className="dialog-close" onClick={onClose}>✕</button>
        </div>

        <div className="add-dialog-body">
          <div className="field-row">
            <div className="field field-grow">
              <label>Claude API Key</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="field-input"
                  type={showKey ? 'text' : 'password'}
                  placeholder="sk-ant-…"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  style={{ paddingRight: 56 }}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  style={{
                    position: 'absolute', right: 6, top: 6,
                    fontFamily: 'var(--mono)', fontSize: 10,
                    background: 'transparent', border: '1px solid var(--rule)',
                    borderRadius: 3, padding: '3px 8px',
                    color: 'var(--ink-faint)', cursor: 'pointer',
                  }}
                >
                  {showKey ? '隐藏' : '显示'}
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 6, lineHeight: 1.5 }}>
                在 <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer"
                  style={{ color: 'var(--accent)' }}>console.anthropic.com</a> 获取你的 API Key。
                保存在本地 IndexedDB，不会上传到 GitHub。
              </p>
            </div>
          </div>

          <div className="field-row">
            <div className="field field-grow">
              <label>摘要生成模型</label>
              <select
                className="field-input"
                value={model}
                onChange={e => setModel(e.target.value)}
              >
                {MODEL_OPTIONS.map(opt => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label} — {opt.hint}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="add-dialog-foot">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>取消</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </>
  )
}
