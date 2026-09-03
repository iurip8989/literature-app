// ─── 转写结果导出（纯文本 / Word） ──────────────────────────────────────────
// docx 库在浏览器里直接生成 .docx，无需后端。

// docx 只在用户点「导出 Word」时才动态加载（约 100 KB gzip），
// 避免拖慢文献库的首屏加载。
import type { Paragraph as ParagraphType, TextRun as TextRunType } from 'docx'
import type { TranscriptRecord, TranscriptSegmentRecord } from '../types'
import { formatTimestamp, speakerLabel } from './transcription'

export interface ExportOptions {
  includeTimestamps: boolean
  includeSpeakers: boolean
}

/** 段落前缀，例如 "[1:23] 说话人 1：" */
function segmentPrefix(seg: TranscriptSegmentRecord, opts: ExportOptions): string {
  const parts: string[] = []
  if (opts.includeTimestamps && seg.start != null) parts.push(`[${formatTimestamp(seg.start)}]`)
  if (opts.includeSpeakers && seg.speakerId) parts.push(`${speakerLabel(seg.speakerId)}：`)
  if (parts.length === 0) return ''
  // 「说话人 X：」自带全角冒号，后面不再补空格
  return parts.join(' ').replace(/：\s*$/, '：')
}

/** 导出为纯文本 */
export function buildPlainText(record: TranscriptRecord, opts: ExportOptions): string {
  return record.segments
    .map(seg => `${segmentPrefix(seg, opts)}${seg.text}`)
    .join('\n\n')
}

/** 导出为 Word 文档（返回 Blob） */
export async function buildDocxBlob(
  record: TranscriptRecord,
  opts: ExportOptions,
): Promise<Blob> {
  const { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } =
    await import('docx')

  const meta: string[] = [`音频文件：${record.filename}`]
  if (record.durationSec != null) meta.push(`时长：${formatTimestamp(record.durationSec)}`)
  if (record.languageCode) meta.push(`语言：${record.languageCode}`)
  meta.push(`转写日期：${new Date(record.createdAt).toLocaleDateString('zh-CN')}`)

  const children: ParagraphType[] = [
    new Paragraph({
      text: record.title,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: meta.join('　·　'), size: 18, color: '808080' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  ]

  for (const seg of record.segments) {
    const prefix = segmentPrefix(seg, opts)
    const runs: TextRunType[] = []
    if (prefix) {
      // 前缀用灰色小字，正文保持默认，打印出来一眼能分清
      runs.push(new TextRun({ text: prefix, size: 18, color: '888888' }))
      if (!prefix.endsWith('：')) runs.push(new TextRun({ text: ' ' }))
    }
    runs.push(new TextRun({ text: seg.text, size: 21 }))
    children.push(
      new Paragraph({
        children: runs,
        spacing: { after: 160, line: 360 }, // 1.5 倍行距
      }),
    )
  }

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBlob(doc)
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 稍后回收，避免部分浏览器下载还没开始就断了链接
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 去掉扩展名，用作导出文件名的主干 */
export function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '') || 'transcript'
}
