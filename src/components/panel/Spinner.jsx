import s from './Panel.module.css'

/**
 * Small animated spinner for anything that is loading (Josh, 2026-09-27: "a nice animated spinner" in place
 * of bare "Loading…"). Inherits the text colour; `size` in px. With reduced motion it pulses instead of spinning.
 * Use <Loading>text</Loading> for the usual spinner + words line.
 */
export default function Spinner({ size = 14, className = '' }) {
  return <span className={`${s.spinner} ${className}`} style={{ width: size, height: size }} role="presentation" aria-hidden="true" />
}

/** Spinner + words, announced politely to screen readers. */
export function Loading({ children, className = '', style, size = 14 }) {
  return (
    <div className={`${s.loadingLine} ${className}`} style={style} role="status" aria-live="polite">
      <Spinner size={size} />
      <span>{children}</span>
    </div>
  )
}
