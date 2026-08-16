import { cloneElement, useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../hooks/useMediaQuery'
import styles from './MapSearch.module.css'

/**
 * MapSearch — the shared search chrome for the map tools.
 *
 * Desktop (>768px): renders its child (a GeoSearch) inside the tool's own
 * absolutely-positioned search box class — pixel for pixel what each tool
 * already had.
 *
 * Mobile (≤768px): the search collapses to a 44px magnifier button in the top
 * right corner, freeing the whole top edge for the map. Tapping it swaps in a
 * full-width search row; picking a result, tapping ×, or pressing Escape
 * collapses it back to the icon.
 *
 * Props:
 *   className — the tool's desktop search box class (from its own CSS module)
 *   children  — a single GeoSearch element. Its onSelect is wrapped so the
 *               row closes itself after the result is handed to the tool.
 */
export default function MapSearch({ className, children }) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const rowRef = useRef(null)

  // Focus the input as soon as the row exists — the opening tap counts as a
  // user gesture, so mobile Safari allows the keyboard to come up.
  useEffect(() => {
    if (!open) return
    rowRef.current?.querySelector('input')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!isMobile) {
    return <div className={className}>{children}</div>
  }

  if (!open) {
    return (
      <button
        type="button"
        className={styles.fab}
        onClick={() => setOpen(true)}
        aria-label="Search location"
        title="Search location"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
    )
  }

  // Close after a result lands, on top of whatever the tool's onSelect does.
  const search = cloneElement(children, {
    onSelect: (r) => { children.props.onSelect?.(r); setOpen(false) },
  })

  return (
    <div className={styles.row} ref={rowRef}>
      <div className={styles.rowSearch}>{search}</div>
      <button
        type="button"
        className={styles.rowClose}
        onClick={() => setOpen(false)}
        aria-label="Close search"
      >
        ×
      </button>
    </div>
  )
}
