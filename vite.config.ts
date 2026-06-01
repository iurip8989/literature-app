import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// Copy pdfjs-dist runtime assets into public/pdfjs so Vite serves them in dev
// and bundles them into dist on build (both under the configured `base`).
// Required for CJK font CMaps, standard fonts, JBig2/JPEG2000 (wasm) decoding
// of scanned PDFs, and ICC colour profiles — without them scanned / Japanese
// PDFs fail to render. public/pdfjs is gitignored; it is regenerated here on
// every dev start and build so it always matches the installed pdfjs version.
function copyPdfjsAssets(): Plugin {
  const dirs = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
  return {
    name: 'copy-pdfjs-assets',
    buildStart() {
      for (const d of dirs) {
        const dst = resolve(here, 'public/pdfjs', d)
        mkdirSync(dirname(dst), { recursive: true })
        cpSync(resolve(here, 'node_modules/pdfjs-dist', d), dst, { recursive: true })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), copyPdfjsAssets()],
  base: '/literature-app/',
})
