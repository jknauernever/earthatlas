/**
 * Drawn chevron for fold / open toggles, sized to sit with the × close button (Josh, 2026-09-26:
 * no tiny ▴▾ text glyphs). Shared by every EarthAtlas panel, card and turndown.
 */
export default function Chevron({ up = false, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', margin: 'auto' }}>
      <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
    </svg>
  )
}
