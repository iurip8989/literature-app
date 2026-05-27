import { useState, useEffect, useCallback } from 'react'
import type { Settings } from '../types'
import { getSetting, setSetting } from '../store/db'

const SETTINGS_KEY = 'app_settings'

type PartialSettings = Partial<Settings>

interface UseSettingsReturn {
  settings: PartialSettings | null
  loading: boolean
  updateSettings: (partial: PartialSettings) => Promise<void>
  clearSettings: () => Promise<void>
}

export function useSettings(): UseSettingsReturn {
  const [settings, setSettings] = useState<PartialSettings | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSetting<PartialSettings>(SETTINGS_KEY).then(s => {
      setSettings(s ?? {})
      setLoading(false)
    })
  }, [])

  const updateSettings = useCallback(async (partial: PartialSettings) => {
    const merged = { ...settings, ...partial }
    await setSetting(SETTINGS_KEY, merged)
    setSettings(merged)
  }, [settings])

  const clearSettings = useCallback(async () => {
    await setSetting(SETTINGS_KEY, {})
    setSettings({})
  }, [])

  return { settings, loading, updateSettings, clearSettings }
}
