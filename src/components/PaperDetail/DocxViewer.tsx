import { useEffect, useState } from 'react'
import mammoth from 'mammoth'

interface Props {
  blob: Blob
}

export default function DocxViewer({ blob }: Props) {
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    blob.arrayBuffer()
      .then(buf => mammoth.convertToHtml({ arrayBuffer: buf }))
      .then(result => {
        if (!cancelled) setHtml(result.value)
      })
      .catch(err => {
        if (!cancelled) setError(err.message || '无法解析 DOCX 文件')
      })
    return () => { cancelled = true }
  }, [blob])

  if (error) return <p className="viewer-error">{error}</p>

  return (
    <div
      className="docx-viewer"
      dangerouslySetInnerHTML={{ __html: html || '<p style="color:var(--ink-faint)">解析中…</p>' }}
    />
  )
}
