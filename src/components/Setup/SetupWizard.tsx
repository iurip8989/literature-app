import { useState } from 'react'
import type { Settings } from '../../types'
import { validateConnection, initializeRepo } from '../../utils/github'
import { setSetting } from '../../store/db'
import './SetupWizard.css'

interface Props {
  onComplete: (settings: Partial<Settings>) => void
}

export default function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState(1)

  return (
    <div className="setup-bg">
      <div className="setup-card">
        <div className="setup-header">
          <span className="setup-brand-mark"><em>文</em>献库</span>
          <div className="setup-progress">
            {[1, 2, 3].map(n => (
              <div
                key={n}
                className={`setup-dot ${n === step ? 'active' : n < step ? 'done' : ''}`}
              />
            ))}
            <span className="setup-progress-label">{step} / 3</span>
          </div>
        </div>

        <div className="setup-body">
          {step === 1 && <StepWelcome onNext={() => setStep(2)} />}
          {step === 2 && <StepGitHub onBack={() => setStep(1)} onNext={() => setStep(3)} />}
          {step === 3 && <StepConnect onBack={() => setStep(2)} onComplete={onComplete} />}
        </div>
      </div>
    </div>
  )
}

// ── Step 1：欢迎 ─────────────────────────────────────────────────────────────

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <>
      <h2 className="setup-step-title">欢迎使用文献库</h2>
      <p className="setup-step-desc">
        在开始之前，需要做一次简单的配置。你的所有文献数据将存储在你自己的
        GitHub 私有仓库中，完全属于你，无月费，自带版本历史。
      </p>

      <ul className="setup-checklist">
        <li>
          <span className="setup-check-icon">✦</span>
          <span>一个 <strong>GitHub 账号</strong>（没有的话可以免费注册）</span>
        </li>
        <li>
          <span className="setup-check-icon">✦</span>
          <span>在 GitHub 创建一个 <strong>私有仓库</strong>（用来存放文献数据）</span>
        </li>
        <li>
          <span className="setup-check-icon">✦</span>
          <span>生成一个 <strong>访问令牌 (PAT)</strong>，让应用有权限读写该仓库</span>
        </li>
        <li>
          <span className="setup-check-icon">✦</span>
          <span>预计耗时 <strong>5–10 分钟</strong>，只需配置一次</span>
        </li>
      </ul>

      <div className="setup-actions end">
        <button className="setup-btn-primary" onClick={onNext}>
          开始配置 →
        </button>
      </div>
    </>
  )
}

// ── Step 2：GitHub 配置说明 ──────────────────────────────────────────────────

function StepGitHub({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <>
      <h2 className="setup-step-title">配置 GitHub 仓库</h2>
      <p className="setup-step-desc">
        按照以下步骤，在 GitHub 上创建数据仓库和访问令牌。完成后点击"下一步"填写信息。
      </p>

      <div className="setup-section">
        <div className="setup-section-title">① 创建数据仓库</div>
        <ol className="setup-ol">
          <li>打开 <a className="setup-link" href="https://github.com/new" target="_blank" rel="noreferrer">github.com/new</a>，新建仓库</li>
          <li>
            <span>
              <strong>Repository name</strong> 填写{' '}
              <code className="setup-code">literature-db</code>
              （或任意你喜欢的名字，下一步需要用到）
            </span>
          </li>
          <li>选择 <strong>Private</strong>（私有，只有你能看到）</li>
          <li><strong>不要</strong>勾选"Add a README file"等初始化选项，保持空仓库</li>
          <li>点击 <strong>Create repository</strong></li>
        </ol>
      </div>

      <div className="setup-section">
        <div className="setup-section-title">② 创建访问令牌 (PAT)</div>
        <ol className="setup-ol">
          <li>
            打开{' '}
            <a
              className="setup-link"
              href="https://github.com/settings/tokens?type=beta"
              target="_blank"
              rel="noreferrer"
            >
              github.com/settings/tokens?type=beta
            </a>
          </li>
          <li>点击 <strong>Generate new token</strong></li>
          <li>
            <strong>Token name</strong> 填写任意，如{' '}
            <code className="setup-code">文献库 App</code>；
            <strong>Expiration</strong> 建议选 <strong>1 year</strong>
          </li>
          <li>
            找到 <strong>Repository access</strong>，选{' '}
            <strong>Only select repositories</strong>，在下拉里选刚创建的仓库
          </li>
          <li>
            展开 <strong>Repository permissions</strong> → 找到{' '}
            <strong>Contents</strong> → 改为 <strong>Read and write</strong>
          </li>
          <li>滑到底部点 <strong>Generate token</strong>，<strong>立即复制保存好</strong></li>
        </ol>
        <div className="setup-tip">
          <span>⚠</span>
          <span>
            <strong>注意：</strong>Token 只在生成后显示一次，关掉页面就再也看不到了。
            如果忘记复制，需要重新生成一个。
          </span>
        </div>
      </div>

      <div className="setup-actions">
        <button className="setup-btn-back" onClick={onBack}>← 上一步</button>
        <button className="setup-btn-primary" onClick={onNext}>我已完成 →</button>
      </div>
    </>
  )
}

// ── Step 3：填写信息 & 验证 ──────────────────────────────────────────────────

type ConnectStatus = 'idle' | 'loading' | 'error' | 'success'

function StepConnect({
  onBack,
  onComplete,
}: {
  onBack: () => void
  onComplete: (settings: Partial<Settings>) => void
}) {
  const [username, setUsername] = useState('')
  const [repo, setRepo] = useState('literature-db')
  const [pat, setPat] = useState('')
  const [showPat, setShowPat] = useState(false)
  const [status, setStatus] = useState<ConnectStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleConnect = async () => {
    if (!username.trim() || !repo.trim() || !pat.trim()) {
      setErrorMsg('请填写所有字段')
      setStatus('error')
      return
    }
    setStatus('loading')
    setErrorMsg('')

    const result = await validateConnection(pat.trim(), username.trim(), repo.trim())
    if (!result.ok) {
      setStatus('error')
      setErrorMsg(result.error ?? '连接失败')
      return
    }

    try {
      await initializeRepo(pat.trim(), username.trim(), repo.trim())
    } catch (err) {
      setStatus('error')
      setErrorMsg('仓库初始化失败：' + (err instanceof Error ? err.message : String(err)))
      return
    }

    const newSettings: Partial<Settings> = {
      githubPat: pat.trim(),
      githubUsername: username.trim(),
      githubRepo: repo.trim(),
      defaultView: 'cards',
      theme: 'editorial',
      autoSyncEnabled: true,
      rememberApiKey: true,
    }
    await setSetting('app_settings', newSettings)

    setStatus('success')
    setTimeout(() => onComplete(newSettings), 1200)
  }

  const isLoading = status === 'loading'
  const isSuccess = status === 'success'

  return (
    <>
      <h2 className="setup-step-title">填写连接信息</h2>
      <p className="setup-step-desc">
        把上一步准备好的 GitHub 用户名、仓库名和访问令牌填入下方，然后点击验证。
      </p>

      <div className="setup-form">
        <div className="setup-field">
          <label>GitHub 用户名</label>
          <input
            className="setup-input"
            type="text"
            placeholder="例如：johndoe"
            value={username}
            onChange={e => setUsername(e.target.value)}
            disabled={isLoading || isSuccess}
            autoComplete="off"
          />
        </div>

        <div className="setup-field">
          <label>数据仓库名</label>
          <input
            className="setup-input"
            type="text"
            placeholder="例如：literature-db"
            value={repo}
            onChange={e => setRepo(e.target.value)}
            disabled={isLoading || isSuccess}
            autoComplete="off"
          />
        </div>

        <div className="setup-field">
          <label>Personal Access Token</label>
          <div className="setup-pat-wrap">
            <input
              className="setup-input"
              type={showPat ? 'text' : 'password'}
              placeholder="github_pat_…"
              value={pat}
              onChange={e => setPat(e.target.value)}
              disabled={isLoading || isSuccess}
              autoComplete="off"
              style={{ paddingRight: '56px' }}
            />
            <button
              className="setup-pat-toggle"
              type="button"
              onClick={() => setShowPat(v => !v)}
            >
              {showPat ? '隐藏' : '显示'}
            </button>
          </div>
        </div>
      </div>

      {status === 'error' && (
        <div className="setup-error">{errorMsg}</div>
      )}

      {isSuccess && (
        <div className="setup-success-msg">
          <span>✓</span>
          <span>连接成功，正在进入文献库…</span>
        </div>
      )}

      <div className="setup-actions">
        <button className="setup-btn-back" onClick={onBack} disabled={isLoading || isSuccess}>
          ← 上一步
        </button>
        <button
          className="setup-btn-primary"
          onClick={handleConnect}
          disabled={isLoading || isSuccess}
        >
          {isLoading ? (
            <><span className="spinner" /> 验证中…</>
          ) : (
            '验证并连接 →'
          )}
        </button>
      </div>
    </>
  )
}
