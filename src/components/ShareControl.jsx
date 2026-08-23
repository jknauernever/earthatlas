/**
 * ShareControl — the shared share button for every EarthAtlas map tool.
 *
 * The standard box-with-arrow-up icon. Clicking it shares the current URL —
 * which, per the URL-state convention, reproduces exactly what's on screen —
 * via the native share sheet where available, else copies it with a toast.
 *
 * Before/while sharing it makes sure the view's social card exists
 * (ensureViewCard): the snapshot a crawler will be served as og:image when
 * anyone pastes this URL into Facebook/LinkedIn/X/Slack. The share sheet is
 * opened synchronously in the click gesture (Safari requires it); the card
 * upload rides in parallel and is usually already done by the debounced
 * auto-upload anyway.
 *
 * Props:
 *   capture   — async () => Blob (JPEG of the current view)
 *   className — positioning wrapper class from the host tool
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ensureViewCard } from '../lib/shareCard'
import styles from './ShareControl.module.css'

export default function ShareControl({ capture, className }) {
  const [state, setState] = useState('idle') // idle | working | copied
  const timerRef = useRef(0)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const share = useCallback(() => {
    const url = window.location.href
    // Fire-and-forget: the card is usually already uploaded by the debounced
    // auto-capture; this guarantees it for views shared immediately.
    ensureViewCard(capture)
    // Native share sheet on touch devices (what users expect there); on
    // desktop — where navigator.share also exists but feels foreign —
    // copy the link with a toast, like every content site does.
    const touch = window.matchMedia('(pointer: coarse)').matches
    if (touch && navigator.share) {
      navigator.share({ url, title: document.title }).catch(() => { /* user dismissed */ })
      return
    }
    setState('working')
    navigator.clipboard.writeText(url).then(
      () => setState('copied'),
      () => setState('idle'),
    )
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setState('idle'), 2600)
  }, [capture])

  return (
    <div className={className}>
      <button
        type="button"
        className={state === 'copied' ? styles.btnDone : styles.btn}
        onClick={share}
        aria-label="Share this view"
        title="Share this view"
      >
        {state === 'copied' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12" /><path d="m8 7 4-4 4 4" />
            <path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
          </svg>
        )}
      </button>
      {state === 'copied' && (
        <div className={styles.toast} role="status">
          Link copied — the social preview shows this view
        </div>
      )}
    </div>
  )
}
