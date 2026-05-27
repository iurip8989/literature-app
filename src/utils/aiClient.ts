// Claude API client (browser-side).
//
// ⚠️ Browser usage requires `dangerouslyAllowBrowser: true` because the API key
// lives in the user's own browser. Anthropic's own docs call this acceptable
// for "Internal Tools" where users are trusted — this app is a personal tool
// using the user's own key, so it qualifies.
//
// We construct a fresh client per call rather than memoising one — the key
// may change in Settings, and the SDK constructor is cheap.

import Anthropic from '@anthropic-ai/sdk'

export const DEFAULT_SUMMARY_MODEL = 'claude-sonnet-4-6'

// ── System prompt for Chinese academic summary ────────────────────────────────
// Lifted from 需求文档 §5.1; the curly-brace placeholder is replaced by the
// actual paper text in the user turn (not by string interpolation in the
// system prompt — keeping the system prompt stable matters for prompt caching).

const SUMMARY_SYSTEM = `你是学术文献摘要助手。请阅读用户提供的论文文本，并用 200-300 字中文输出：
1. 核心贡献（1 句）
2. 主要方法 / 论点（2-3 句）
3. 关键结论或实验结果（2-3 句）

要求：
- 学术风格，不要套话
- 不要把"本文"、"作者"作为开头
- 如果论文是中文/日文写就，直接用论文原意翻译/转述
- 输出纯文本，不要 Markdown 加粗或列表标记`

// Friendly error type so the UI can render without unwrapping SDK details.
export type AiErrorCode = 'no-key' | 'auth' | 'rate-limit' | 'overloaded' | 'network' | 'unknown'

export class AiError extends Error {
  code: AiErrorCode
  constructor(code: AiErrorCode, message: string) {
    super(message)
    this.name = 'AiError'
    this.code = code
  }
}

function classify(err: unknown): AiError {
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError('auth', 'API Key 无效或已过期，请在设置里更新')
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError('rate-limit', '触发了 Anthropic 限流，请稍后重试')
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new AiError('overloaded', 'Anthropic 服务器临时不可用，请稍后重试')
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError('network', '无法连接到 Anthropic 服务器，请检查网络')
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError('unknown', `Anthropic API 错误 ${err.status}: ${err.message}`)
  }
  if (err instanceof Error) return new AiError('unknown', err.message)
  return new AiError('unknown', String(err))
}

interface GenerateSummaryOptions {
  apiKey: string
  paperText: string
  model?: string
  /** Called for each text delta as the response streams. */
  onDelta?: (delta: string) => void
  /** Called once with the abort controller so the caller can cancel mid-stream. */
  onAbortable?: (abort: () => void) => void
}

/**
 * Generate a Chinese summary for a paper text. Streams deltas via `onDelta`
 * and resolves with the full text.
 *
 * Prompt caching note: a top-level `cache_control` would let "regenerate" hit
 * the cache. Skipped here because each paper's text is unique — first
 * generation never hits, and regenerations are rare enough that the cache
 * write premium isn't recovered in practice.
 */
export async function generateSummary({
  apiKey,
  paperText,
  model = DEFAULT_SUMMARY_MODEL,
  onDelta,
  onAbortable,
}: GenerateSummaryOptions): Promise<string> {
  if (!apiKey) {
    throw new AiError('no-key', '尚未设置 Claude API Key')
  }

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: 1024, // 200-300 中文字 well under this
      system: SUMMARY_SYSTEM,
      messages: [{ role: 'user', content: `论文文本：\n\n${paperText}` }],
    })

    if (onAbortable) onAbortable(() => stream.controller.abort())
    if (onDelta) stream.on('text', onDelta)

    const final = await stream.finalMessage()
    const textBlock = final.content.find(b => b.type === 'text')
    return textBlock && textBlock.type === 'text' ? textBlock.text : ''
  } catch (err) {
    throw classify(err)
  }
}
