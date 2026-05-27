import { useEffect, useRef, useState } from 'react'
import { pdfjsLib } from '../../utils/pdfExtract'
import { TextLayer } from 'pdfjs-dist'

interface Props {
  blob: Blob
}

const ZOOM_STEP = 0.15
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3.0

export default function PdfViewer({ blob }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const zoomWrapRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState('')
  const [renderError, setRenderError] = useState('')
  const [zoom, setZoom] = useState(1.0)

  // Apply zoom via CSS zoom property (adjusts both visual size and layout box)
  useEffect(() => {
    if (zoomWrapRef.current) {
      (zoomWrapRef.current.style as unknown as Record<string, string>).zoom = String(zoom)
    }
  }, [zoom])

  useEffect(() => {
    let cancelled = false
    setProgress('')
    setRenderError('')

    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''

    blob.arrayBuffer().then(buf =>
      pdfjsLib.getDocument({ data: buf }).promise
    ).then(async pdf => {
      if (cancelled) return
      for (let i = 1; i <= pdf.numPages; i++) {
        if (cancelled) break
        setProgress(`渲染中… ${i}/${pdf.numPages} 页`)

        const page = await pdf.getPage(i)
        const dpr = window.devicePixelRatio || 1
        const renderScale = Math.max(1.5, Math.min(3.0, 1.5 * dpr))

        // naturalViewport: 1× scale — used for CSS layout and TextLayer positions
        const naturalViewport = page.getViewport({ scale: 1 })
        // renderViewport: high-res — used only for canvas pixel buffer
        const renderViewport = page.getViewport({ scale: renderScale })

        const pageWrapper = document.createElement('div')
        pageWrapper.className = 'pdf-page-wrapper'
        pageWrapper.style.width = naturalViewport.width + 'px'
        pageWrapper.style.height = naturalViewport.height + 'px'
        // --total-scale-factor = 1 because TextLayer uses naturalViewport (1× coords)
        pageWrapper.style.setProperty('--total-scale-factor', '1')
        ;(containerRef.current ?? container).appendChild(pageWrapper)

        const canvas = document.createElement('canvas')
        canvas.width = renderViewport.width    // high-res pixel buffer
        canvas.height = renderViewport.height
        canvas.style.width = naturalViewport.width + 'px'   // CSS display = natural size
        canvas.style.height = naturalViewport.height + 'px'
        canvas.className = 'pdf-page-canvas'
        pageWrapper.appendChild(canvas)

        const ctx = canvas.getContext('2d')!
        await page.render({ canvas, canvasContext: ctx, viewport: renderViewport }).promise
        if (cancelled) break

        const textLayerDiv = document.createElement('div')
        textLayerDiv.className = 'textLayer'
        pageWrapper.appendChild(textLayerDiv)

        const textContent = await page.getTextContent()
        if (!cancelled) {
          const textLayer = new TextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: naturalViewport,   // positions in natural (1×) coordinates
          })
          await textLayer.render()
        }
      }
      if (!cancelled) setProgress('')
    }).catch(err => {
      if (!cancelled) setRenderError(err.message || 'PDF 渲染失败')
    })

    return () => { cancelled = true }
  }, [blob])

  if (renderError) return <p className="viewer-error">PDF 渲染失败：{renderError}</p>

  return (
    <div className="pdf-viewer-wrap">
      <div className="pdf-zoom-bar">
        <button
          className="pdf-zoom-btn"
          onClick={() => setZoom(z => Math.max(ZOOM_MIN, parseFloat((z - ZOOM_STEP).toFixed(2))))}
          title="缩小"
        >−</button>
        <span className="pdf-zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          className="pdf-zoom-btn"
          onClick={() => setZoom(z => Math.min(ZOOM_MAX, parseFloat((z + ZOOM_STEP).toFixed(2))))}
          title="放大"
        >+</button>
        <button
          className="pdf-zoom-btn pdf-zoom-fit"
          onClick={() => setZoom(1.0)}
          title="重置缩放"
        >适配</button>
      </div>
      {progress && <p className="pdf-progress">{progress}</p>}
      <div ref={zoomWrapRef}>
        <div ref={containerRef} className="pdf-viewer" />
      </div>
    </div>
  )
}
