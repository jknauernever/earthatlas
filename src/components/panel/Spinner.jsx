import { useEffect, useState } from 'react'
import { pickLoadingMessage } from './loadingMessages.js'
import s from './Panel.module.css'

/**
 * Small animated spinner for anything that is loading (Josh, 2026-09-27: "a nice animated spinner" in place
 * of bare "Loading…"). Inherits the text colour; `size` in px. With reduced motion it pulses instead of spinning.
 */
export default function Spinner({ size = 14, className = '' }) {
  return <span className={`${s.spinner} ${className}`} style={{ width: size, height: size }} role="presentation" aria-hidden="true" />
}

/**
 * Spinner + a friendly line from the shared library (loadingMessages.js), announced politely to screen readers.
 * `kind` picks the set ('quick' | 'slow' | 'search' | 'more'); the line changes every `every` ms while it waits.
 * Pass children only for a message that must be specific (it then stays fixed).
 */
export function Loading({ kind = 'quick', every = 4500, children, className = '', style, size = 14 }) {
  const msg = useLoadingMessage(kind, children ? 0 : every)
  return (
    <div className={`${s.loadingLine} ${className}`} style={style} role="status" aria-live="polite">
      <Spinner size={size} />
      <span>{children ?? msg}</span>
    </div>
  )
}

/** A loading message of this kind that changes every `every` ms (0 = never), for places that aren't a <Loading>. */
export function useLoadingMessage(kind = 'quick', every = 4500) {
  const [msg, setMsg] = useState(() => pickLoadingMessage(kind))
  useEffect(() => {
    setMsg(pickLoadingMessage(kind))
    if (!every) return
    const t = setInterval(() => setMsg((m) => pickLoadingMessage(kind, m)), every)
    return () => clearInterval(t)
  }, [kind, every])
  return msg
}

/** Spinner + a changing message inline (inside a button or a line of text). */
export function LoadingInline({ kind = 'more', every = 4500, size = 12 }) {
  const msg = useLoadingMessage(kind, every)
  return <><Spinner size={size} /> {msg}</>
}
