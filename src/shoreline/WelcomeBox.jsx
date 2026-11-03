/**
 * Welcome box (SSE LandingIntro.tsx): a card at the top of the map on arrival; closing it leaves an "About this map"
 * pill that brings it back. The close is remembered for the tab (sessionStorage), and a shared link (one with a view in
 * its URL) starts on the pill. The text was Friends' admin-edited copy in SSE's bucket
 * (docs/shoreline/sse-site-content.json); it lives here now (decision 7), retitled, with the control hints pointing
 * at this map's own controls.
 */
import { useState } from 'react'
import styles from './WelcomeBox.module.css'

const KEY = 'shoreline_intro_dismissed'
const read = () => { try { return sessionStorage.getItem(KEY) === '1' } catch { return false } }
// SSE swapped the scroll-wheel line for a touch one on phones
const touch = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
const write = (v) => { try { v ? sessionStorage.setItem(KEY, '1') : sessionStorage.removeItem(KEY) } catch { /* not kept */ } }

export default function WelcomeBox({ defaultDismissed = false }) {
  const [dismissed, setDismissed] = useState(() => defaultDismissed || read())
  const [mobile] = useState(touch)
  const close = () => { setDismissed(true); write(true) }
  const open = () => { setDismissed(false); write(false) }

  if (dismissed) {
    return (
      <button type="button" className={styles.pill} onClick={open}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" />
        </svg>
        About this map
      </button>
    )
  }
  return (
    <div className={styles.card} role="dialog" aria-label="Welcome to the Salish Sea Explorer: Shoreline Ecosystems">
      <button type="button" className={styles.x} onClick={close} aria-label="Close introduction">×</button>
      <div className={styles.body}>
        <h3>Welcome to the Salish Sea Explorer: Shoreline Ecosystems</h3>
        <p>Explore shoreline habitats and property information across San Juan County.</p>
        <ul>
          <li><strong>Search an address</strong> above to open a property report.</li>
          {mobile
            ? <li><strong>Pinch</strong> to zoom in on a shoreline, and drag to move around.</li>
            : <li><strong>Zoom in</strong> with the <strong>+</strong> / <strong>−</strong> buttons or your scroll wheel to explore an area.</li>}
          <li>Use the <strong>On the map</strong> panel (left) to turn datasets on and off.</li>
        </ul>
        <p>Brought to you by <a href="https://sanjuans.org" target="_blank" rel="noopener noreferrer">Friends of the San Juans</a>.</p>
      </div>
      <button type="button" className={styles.done} onClick={close}>Close</button>
    </div>
  )
}
