import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useIsMobile } from '../hooks/useMediaQuery'
import styles from './MapSheet.module.css'

/**
 * MapSheet — one control panel, two layouts.
 *
 * Desktop (>768px): renders `children` inside the tool's own panel class, so
 * /fire, /forestmonitor, /carbon and /quakes keep the floating left panel they
 * already have — pixel for pixel.
 *
 * Mobile (≤768px): the same children move into a bottom sheet that starts
 * collapsed to a 60px handle. Previously these panels were 300–320px wide and
 * ~full height with no close control, which covered the entire map on a phone.
 * Now the map is always visible, and the panel is one tap (or drag) away.
 *
 * Props:
 *   title    — sheet header text (also the desktop aria-label)
 *   summary  — one-line state readout shown next to the title while collapsed
 *              (e.g. "3 of 11 layers on"); keep it short, it truncates
 *   className— the tool's desktop panel class (from its own CSS module)
 *   children — panel contents, unchanged between layouts
 *   collapseSignal / expandSignal — bump these counters to drive the sheet from
 *              the app: collapse when an action hands the map back to the user
 *              (carbon's "Draw area"), expand when a result arrives worth
 *              reading. Both are no-ops on desktop.
 */

// Height reserved above a fully-open sheet — enough to clear the wordmark row
// and the search bar, so the top chrome stays usable at every snap point.
const SNAP_TOP_GAP = 108
const TAP_SLOP = 8        // px of movement still counted as a tap, not a drag
const TAP_MS = 500

export default function MapSheet({ title, summary, className, children, id, collapseSignal = 0, expandSignal = 0 }) {
  const isMobile = useIsMobile()
  const [snap, setSnap] = useState('peek')
  const [dragHeight, setDragHeight] = useState(null)

  const sheetRef = useRef(null)
  const peekPxRef = useRef(60)
  const dragRef = useRef(null)

  // Remember what "peek" actually measures to (60px + the home-indicator inset,
  // which only CSS knows) so drag snapping lands exactly on the collapsed state.
  useLayoutEffect(() => {
    if (!isMobile || snap !== 'peek' || !sheetRef.current) return
    const h = sheetRef.current.getBoundingClientRect().height
    if (h > 0) peekPxRef.current = h
  }, [isMobile, snap])

  const snapHeights = useCallback(() => {
    const vh = window.innerHeight
    return {
      peek: peekPxRef.current,
      half: vh * 0.5,
      full: Math.max(vh - SNAP_TOP_GAP, vh * 0.5),
    }
  }, [])

  const toggle = useCallback(() => {
    setSnap((s) => (s === 'peek' ? 'half' : 'peek'))
  }, [])

  const onPointerDown = useCallback((e) => {
    // Let the chevron behave like a plain button.
    if (e.target.closest('[data-sheet-toggle]')) return
    if (!sheetRef.current || e.button > 0) return
    dragRef.current = {
      id: e.pointerId,
      startY: e.clientY,
      startH: sheetRef.current.getBoundingClientRect().height,
      startedAt: Date.now(),
      moved: 0,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    const dy = d.startY - e.clientY
    d.moved = Math.max(d.moved, Math.abs(dy))
    const { peek, full } = snapHeights()
    setDragHeight(Math.min(Math.max(d.startH + dy, peek), full))
  }, [snapHeights])

  const onPointerUp = useCallback((e) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    dragRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }

    const isTap = d.moved < TAP_SLOP && Date.now() - d.startedAt < TAP_MS
    setDragHeight(null)
    if (isTap) { toggle(); return }

    const h = Math.min(Math.max(d.startH + (d.startY - e.clientY), 0), Infinity)
    const heights = snapHeights()
    const nearest = Object.keys(heights).reduce((best, key) =>
      Math.abs(heights[key] - h) < Math.abs(heights[best] - h) ? key : best, 'peek')
    setSnap(nearest)
  }, [snapHeights, toggle])

  // App-driven snapping. Compare against the last value rather than "have I run
  // before?" — StrictMode invokes mount effects twice, and a run-once guard
  // would read the second invocation as a real signal.
  const prevCollapse = useRef(collapseSignal)
  useEffect(() => {
    if (prevCollapse.current === collapseSignal) return
    prevCollapse.current = collapseSignal
    setSnap('peek')
  }, [collapseSignal])

  const prevExpand = useRef(expandSignal)
  useEffect(() => {
    if (prevExpand.current === expandSignal) return
    prevExpand.current = expandSignal
    setSnap((s) => (s === 'peek' ? 'half' : s))
  }, [expandSignal])

  // Collapse on Escape — the panel is the only thing over the map, so Escape
  // reading as "get out of my way" is unambiguous.
  useEffect(() => {
    if (!isMobile || snap === 'peek') return
    const onKey = (e) => { if (e.key === 'Escape') setSnap('peek') }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isMobile, snap])

  if (!isMobile) {
    return (
      <aside className={className} aria-label={title} id={id}>
        {children}
      </aside>
    )
  }

  const open = snap !== 'peek'
  const sheetClass = [
    styles.sheet,
    styles[snap],
    dragHeight != null ? styles.dragging : '',
  ].filter(Boolean).join(' ')

  return (
    <aside
      ref={sheetRef}
      className={sheetClass}
      style={dragHeight != null ? { height: `${dragHeight}px` } : undefined}
      aria-label={title}
      id={id}
    >
      <div
        className={styles.grab}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className={styles.grabBar} aria-hidden="true" />
        <div className={styles.headRow}>
          <span className={styles.title}>{title}</span>
          {summary && <span className={styles.summary}>{summary}</span>}
          <button
            type="button"
            data-sheet-toggle
            className={styles.toggle}
            onClick={toggle}
            aria-expanded={open}
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          >
            <svg
              className={`${styles.toggleIcon} ${open ? styles.toggleIconOpen : ''}`}
              width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        </div>
      </div>

      <div className={`${styles.body} ${open ? '' : styles.bodyHidden}`}>
        {children}
      </div>
    </aside>
  )
}
