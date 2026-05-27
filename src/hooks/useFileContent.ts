import { useState, useEffect } from 'react'
import { getFileBlob, saveFileBlob } from '../store/db'
import { fetchFileContent } from '../utils/github'

export function useFileContent(
  paperId: string,
  fileId: string,
  githubPath: string | undefined,
  pat: string,
  username: string,
  repo: string,
) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!paperId || !fileId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const cached = await getFileBlob(paperId, fileId)
        if (cached) {
          if (!cancelled) { setBlob(cached); setLoading(false) }
          return
        }
        if (!githubPath || !pat || !username || !repo) {
          if (!cancelled) {
            setError('文件不在本地缓存中。若已上传到 GitHub，请检查网络后重试。')
            setLoading(false)
          }
          return
        }
        const { content } = await fetchFileContent(pat, username, repo, githubPath)
        const fetched = new Blob([content])
        await saveFileBlob(paperId, fileId, fetched)
        if (!cancelled) { setBlob(fetched); setLoading(false) }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || '加载文件失败')
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [paperId, fileId, githubPath, pat, username, repo])

  return { blob, loading, error }
}
