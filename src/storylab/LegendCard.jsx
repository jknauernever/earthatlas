/**
 * The one legend card: active layer's title, measure, color bar, low/high
 * ends (US units), one-line source, an (i) for the two-sentence description,
 * and "How we get this data" for the full detail.
 */

import { useEffect, useState } from 'react'
import { COPY, defFor, legendBar, sourceLine } from './layers.js'
import s from './StoryLab.module.css'

export default function LegendCard({ id, status, embedded, onTitleClick }) {
  const [info, setInfo] = useState(false)
  const [detail, setDetail] = useState(false)
  useEffect(() => { setInfo(false) }, [id])
  if (!id) {
    return (
      <section className={embedded ? s.legendEmbedded : s.legend} aria-label="Legend">
        <span className={s.legendTitle}>No layer on</span>
        <span className={s.legendMuted}>Turn on a layer to see what the colors mean.</span>
      </section>
    )
  }
  const c = COPY[id] || {}
  const def = defFor(id)
  const meta = status.layerMeta?.[id]
  const st = status.layerStatus?.[id]
  return (
    <section className={embedded ? s.legendEmbedded : s.legend} aria-label="Legend">
      {(info || embedded) && <p className={s.legendAbout}>{c.about}{' '}<button type="button" className={s.linkBtn} onClick={() => setDetail(true)}>How we get this data</button></p>}
      <div className={s.legendHead}>
        <button type="button" className={s.legendTitleBtn} onClick={onTitleClick} tabIndex={onTitleClick ? 0 : -1}>
          <span className={s.legendTitle}>{c.title || def?.name}</span>
        </button>
        {!embedded && (
          <button type="button" className={s.infoBtn} onClick={() => setInfo(!info)} aria-label="About this layer" aria-expanded={info}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" strokeLinecap="round" /></svg>
          </button>
        )}
      </div>
      <span className={s.legendMeasure}>{c.measure}</span>
      <div className={s.legendBar} style={{ background: legendBar(id) }} />
      {(c.lo || c.hi) && <div className={s.legendEnds}><span>{c.lo}</span><span>{c.hi}</span></div>}
      <span className={s.legendSource}>
        {st === 'loading' ? 'Loading live data…'
          : st === 'error' ? 'Live data unavailable right now'
            : <>Source: <a href={def?.sourceUrl} target="_blank" rel="noopener noreferrer">{sourceLine(id, meta)}</a></>}
      </span>
      {detail && <HowWeGetThis id={id} meta={meta} onClose={() => setDetail(false)} />}
    </section>
  )
}

function HowWeGetThis({ id, meta, onClose }) {
  const def = defFor(id)
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className={s.modalBack} onClick={onClose}>
      <div className={s.modal} role="dialog" aria-label="How we get this data" onClick={(e) => e.stopPropagation()}>
        <button type="button" className={s.modalClose} onClick={onClose} aria-label="Close">×</button>
        <span className={s.eyebrow}>How we get this data</span>
        <h2 className={s.modalTitle}>{COPY[id]?.title || def?.name}</h2>
        {def?.explain && <p>{def.explain}</p>}
        {def?.legendNote && <p>{def.legendNote}</p>}
        <p>
          Data:{' '}<a href={def?.sourceUrl} target="_blank" rel="noopener noreferrer">{def?.sourceName}</a>
          {def?.sourceAlso?.map((x) => <span key={x.url}>{' & '}<a href={x.url} target="_blank" rel="noopener noreferrer">{x.name}</a></span>)}
          {meta && def?.stamp && <> · {def.stamp(meta)}</>}.
        </p>
        <p className={s.legendMuted}>The same data drives the full In Motion map at <a href="/inmotion">earthatlas.org/inmotion</a>.</p>
      </div>
    </div>
  )
}
