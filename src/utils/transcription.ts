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

/** 一个可编辑、可跳转播放的段落 */
export interface TranscriptSegment {
  id: string
  speakerId?: string
  start?: number // 秒
  end?: number   // 秒
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

  return {
    text: data.text ?? '',
    languageCode: data.language_code,
    segments: buildSegments(data.words ?? [], data.text ?? '', diarized),
    diarized,
  }
}

// ─── 分段 ─────────────────────────────────────────────────────────────────────

/** 句尾标点（中日英通用），允许后接引号/括号 */
const SENTENCE_END = /[。．.！!？?]["'」』）)\]】》]*$/
/** 没有标点时的硬切长度，避免出现无法编辑的超长段落 */
const MAX_SEGMENT_CHARS = 140
/** 触发断句所需的最小长度，避免碎成一地 */
const MIN_SEGMENT_CHARS = 2

let segmentCounter = 0
function nextSegmentId(): string {
  segmentCounter += 1
  return `seg_${Date.now().toString(36)}_${segmentCounter}`
}

/**
 * 把逐词结果合并成句子级段落。
 * 断句依据：说话人变化（开启分离时）> 句尾标点 > 超长硬切。
 * 每段都带 start/end，供播放高亮与点击跳转使用。
 */
export function buildSegments(
  words: SttWord[],
  fallbackText: string,
  diarized: boolean,
): TranscriptSegment[] {
  if (words.length === 0) {
    return fallbackText.trim()
      ? [{ id: nextSegmentId(), text: fallbackText.trim() }]
      : []
  }

  const segments: TranscriptSegment[] = []
  let current: TranscriptSegment | null = null

  const flush = () => {
    if (current && current.text.trim()) {
      segments.push({ ...current, text: current.text.trim() })
    }
    current = null
  }

  for (const w of words) {
    if (w.type === 'audio_event') continue

    // 空白：并入当前段落，但不单独开新段
    if (w.type === 'spacing') {
      if (current) {
        current.text += w.text
        // 超长时借空白处切开，保证不会切断单词
        if (current.text.length >= MAX_SEGMENT_CHARS) flush()
      }
      continue
    }

    const speakerChanged =
      diarized && current != null && !!w.speaker_id && w.speaker_id !== current.speakerId

    if (!current || speakerChanged) {
      flush()
      current = {
        id: nextSegmentId(),
        speakerId: w.speaker_id,
        start: w.start,
        end: w.end,
        text: w.text,
      }
    } else {
      current.text += w.text
      if (w.end != null) current.end = w.end
    }

    if (
      current.text.trim().length >= MIN_SEGMENT_CHARS &&
      SENTENCE_END.test(current.text.trimEnd())
    ) {
      flush()
    }
  }
  flush()

  return segments
}

/** 找出当前播放时间落在哪个段落，返回下标；找不到返回 -1 */
export function findActiveSegment(segments: TranscriptSegment[], time: number): number {
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    if (s.start == null) continue
    const end = s.end ?? segments[i + 1]?.start ?? Infinity
    if (time >= s.start && time < end) return i
  }
  return -1
}

// ─── 格式化 ───────────────────────────────────────────────────────────────────

/** 秒 → "mm:ss" / "h:mm:ss" */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`
}

/** speaker_1 → 说话人 1 */
export function speakerLabel(speakerId?: string): string {
  if (!speakerId) return ''
  return speakerId.replace(/^speaker[_-]?/i, '说话人 ')
}

/** 读取音频/视频文件时长（秒），失败返回 null */
export function probeDuration(file: Blob): Promise<number | null> {
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
