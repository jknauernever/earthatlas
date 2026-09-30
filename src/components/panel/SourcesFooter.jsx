import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import s from './Panel.module.css'

/**
 * Bottom of every EarthAtlas left panel: "ⓘ How this is sourced" (opens the site's sources rollup) and the
 * "EarthAtlas is built by KnauerNever.com" credit. Generalised from the /shiptraffic, /happywhale and /quakes
 * footers + their MethodologyModal. The rollup is IN ADDITION to each value's own inline source, never instead.
 *
 * Props (all content comes from the site):
 *   intro     node      optional opening paragraph ("what you're looking at")
 *   sections  array     [{ heading, sources: [Source] }]
 *     Source = { name, href, publisher?, licence, licenceHref?, method, citation? }
 *       name/href     the dataset and its home page
 *       licence       licence text as recorded (e.g. "CC BY-NC 4.0"); licenceHref links it
 *       method        one line: what EarthAtlas does with it
 *       citation      a citation the provider requires, shown verbatim
 *   notes     array     optional [{ heading, body }] for caveats / method notes after the sources
 *   title     string    'How this is sourced'
 *   changelog node      optional { href, label } — a quiet "What's new" link at the foot of the sources dialog (e.g. /ships/changelog)
 */
export default function SourcesFooter({ title = 'How this is sourced', intro, sections, notes, changelog }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  return (
    <div className={s.footer}>
      <button type="button" ref={btnRef} className={s.sourcesBtn} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <InfoCircle /> {title}
      </button>
      <div className={s.builtBy}>
        EarthAtlas is built by{' '}
        <a href="https://knauernever.com" target="_blank" rel="noopener noreferrer" className={s.builtByLink}>KnauerNever.com</a>
      </div>
      {open && (
        <SourcesModal title={title} intro={intro} sections={sections} notes={notes} changelog={changelog}
          onClose={() => { setOpen(false); btnRef.current?.focus() }} />
      )}
    </div>
  )
}

/**
 * The sources rollup dialog. Rendered into document.body: map panels use backdrop-filter, which would
 * otherwise trap a position:fixed overlay inside the panel.
 */
export function SourcesModal({ title = 'How this is sourced', intro, sections = [], notes = [], changelog, onClose }) {
  const titleId = useId()
  const closeRef = useRef(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modal} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <button type="button" ref={closeRef} className={s.modalClose} onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <h2 className={s.modalTitle} id={titleId}>{title}</h2>
        {intro && <div className={s.modalIntro}>{intro}</div>}
        {sections.map((sec) => (
          <section key={sec.heading} className={s.modalSection}>
            <h3>{sec.heading}</h3>
            <ul className={s.sourceList}>
              {sec.sources.map((src) => (
                <li key={src.name} className={s.sourceItem}>
                  <div className={s.sourceName}>
                    {src.href ? <a href={src.href} target="_blank" rel="noopener noreferrer">{src.name}</a> : src.name}
                    {src.publisher && <span className={s.sourcePublisher}> · {src.publisher}</span>}
                  </div>
                  <div className={s.sourceMeta}>
                    <span className={s.sourceLicence}>
                      {src.licenceHref ? <a href={src.licenceHref} target="_blank" rel="noopener noreferrer">{src.licence}</a> : src.licence}
                    </span>
                  </div>
                  {src.method && <div className={s.sourceMethod}>{src.method}</div>}
                  {src.citation && <div className={s.sourceCitation}>Citation: “{src.citation}”</div>}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {notes.map((n) => (
          <section key={n.heading} className={s.modalSection}>
            <h3>{n.heading}</h3>
            <div className={s.modalText}>{n.body}</div>
          </section>
        ))}
        <div className={s.modalFoot}>
          {changelog?.href && <><a href={changelog.href}>{changelog.label || 'What’s new (changelog)'}</a>{' · '}</>}
          EarthAtlas is built by{' '}
          <a href="https://knauernever.com" target="_blank" rel="noopener noreferrer">KnauerNever.com</a>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function InfoCircle() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="12" cy="12" r="9.5" /><path d="M12 11v6" /><circle cx="12" cy="7.6" r="0.6" fill="currentColor" />
    </svg>
  )
}
