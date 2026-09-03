// ─── 音频转写（ElevenLabs Scribe v2） ────────────────────────────────────────
// 纯前端直调 ElevenLabs Speech-to-Text API（CORS 开放），Key 存本地 IndexedDB。
// 文档：https://elevenlabs.io/docs/api-reference/speech-to-text/convert

const STT_ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text'

export const STT_MODEL = 'scribe_v2'

/** 转写语言选项（auto = 让模型自动识别，日/英/中混合也可） */
export type TranscribeLanguage = 'auto' | 'ja' | 'en' | 'zh'

export const LANGUAGE_OPTIONS: { id: TranscribeLanguage; label: string }[] = [
  { id: 'auto', label: '自动识别' },
  { id: 'ja', label: '日文' },
  { id: 'zh', label: '中文' },
  { id: 'en', label: '英文' },
]

interface SttWord {
  text: string
  start?: number
  end?: number
  speaker_id?: string
  type?: 'word' | 'spacing' | 'audio_event'
}

interface SttResponse {
  language_code?: string
  language_probability?: number
  text: string
  words?: SttWord[]
}

/** 按说话人分组后的段落 */
export interface TranscriptSegment {
  speakerId?: string
  start?: number // 秒
  text: string
}

export interface TranscribeResult {
  text: string
  languageCode?: string
  segments: TranscriptSegment[]
  diarized: boolean
}

export interface TranscribeOptions {
  language?: TranscribeLanguage
  diarize?: boolean
}

export async function transcribeAudio(
  apiKey: string,
  file: File,
  opts: TranscribeOptions = {},
): Promise<TranscribeResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('model_id', STT_MODEL)
  if (opts.language && opts.language !== 'auto') {
    form.append('language_code', opts.language)
  }
  if (opts.diarize) {
    form.append('diarize', 'true')
  }
  form.append('timestamps_granularity', 'word')

  let res: Response
  try {
    res = await fetch(STT_ENDPOINT, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    })
  } catch {
    throw new Error('网络请求失败，请检查网络连接后重试。')
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail =
        typeof body?.detail === 'string'
          ? body.detail
          : body?.detail?.message ?? JSON.stringify(body?.detail ?? body)
    } catch {
      /* ignore */
    }
    if (res.status === 401) {
      throw new Error('API Key 无效或已过期，请在设置中检查 ElevenLabs API Key。')
    }
    if (res.status === 402 || res.status === 429) {
      throw new Error(`额度不足或请求过于频繁（HTTP ${res.status}）。${detail}`)
    }
    throw new Error(`转写失败（HTTP ${res.status}）。${detail}`)
  }

  const data = (await res.json()) as SttResponse
  const diarized = !!opts.diarize
  const segments = buildSegments(data.words ?? [], diarized)

  return {
    text: data.text ?? '',
    languageCode: data.language_code,
    segments,
    diarized,
  }
}

/** 把逐词结果按说话人合并为段落（未开启说话人分离时返回空数组，直接用 text 即可） */
function buildSegments(words: SttWord[], diarized: boolean): TranscriptSegment[] {
  if (!diarized || words.length === 0) return []

  const segments: TranscriptSegment[] = []
  let current: TranscriptSegment | null = null

  for (const w of words) {
    if (w.type === 'audio_event') continue
    // spacing 归属当前段落
    if (w.type === 'spacing') {
      if (current) current.text += w.text
      continue
    }
    if (!current || (w.speaker_id && w.speaker_id !== current.speakerId)) {
      if (current) segments.push(current)
      current = { speakerId: w.speaker_id, start: w.start, text: w.text }
    } else {
      current.text += w.text
    }
  }
  if (current) segments.push(current)

  return segments.map(s => ({ ...s, text: s.text.trim() })).filter(s => s.text)
}

/** 秒 → "mm:ss" / "h:mm:ss" */
export function formatTimestamp(seconds: number): string {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`
}

/** 把结果格式化为可复制/下载的纯文本 */
export function formatTranscript(result: TranscribeResult): string {
  if (result.diarized && result.segments.length > 0) {
    return result.segments
      .map(s => {
        const time = s.start != null ? `[${formatTimestamp(s.start)}] ` : ''
        const speaker = s.speakerId ? `${s.speakerId.replace('speaker_', '说话人 ')}：` : ''
        return `${time}${speaker}${s.text}`
      })
      .join('\n\n')
  }
  return result.text
}

/** 读取音频/视频文件时长（秒），失败返回 null */
export function probeDuration(file: File): Promise<number | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const el = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio')
    el.preload = 'metadata'
    const done = (v: number | null) => {
      URL.revokeObjectURL(url)
      resolve(v)
    }
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null)
    el.onerror = () => done(null)
    el.src = url
  })
}
