import { useCallback, useState } from 'react'

/**
 * Open/closed state of one panel turndown, remembered per viewer in localStorage.
 * Only turndowns use this: whether a dataset is ON stays in the URL (shareable), as each site already does.
 * Storage can be missing or throw (private window, blocked site data), so every access is guarded and the
 * panel falls back to the default.
 */
const PREFIX = 'ea.panel.'

function read(key, fallback) {
  if (!key) return fallback
  try {
    const v = window.localStorage.getItem(PREFIX + key)
    return v === '1' ? true : v === '0' ? false : fallback
  } catch { return fallback }
}

export default function usePanelToggle(key, initial = false) {
  const [open, setOpenState] = useState(() => read(key, initial))
  const setOpen = useCallback((next) => {
    setOpenState((cur) => {
      const v = typeof next === 'function' ? next(cur) : next
      if (key) { try { window.localStorage.setItem(PREFIX + key, v ? '1' : '0') } catch { /* per-viewer nicety only */ } }
      return v
    })
  }, [key])
  const toggle = useCallback(() => setOpen((o) => !o), [setOpen])
  return [open, toggle, setOpen]
}
