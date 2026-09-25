/**
 * "Which underground map?" — the top-center pill for the Underground fungi
 * layer. Same pill + popover as the Emission sources MeasurePicker (it
 * borrows that stylesheet), in magenta, like the fungal-network map.
 *
 *   Networks  → fungal network density (Science 2026)
 *   Richness  → AM fungi / EcM fungi (Nature 2025)
 *   Rarity    → AM fungi / EcM fungi, with an "as sampled today" checkbox
 *               that swaps the even-sampling scenario for the empirical one
 *   Hotspots  → the paper's Figs. 4/5: top-5% richness / rarity / both
 * The map shows ONE measure at a time. Wording and figures: fungiData.js.
 */

import { useEffect, useRef, useState } from 'react'
import styles from './MeasurePicker.module.css'
import { FUNGI_MEASURES } from './fungiData.js'

const ACCENT = '#e0409a'

export default function FungiPicker({ measure, onMeasure, loading, stacked, threads, onThreads }) {
  const [open, setOpen] = useState(false)
  const [whyEmp, setWhyEmp] = useState(false)
  const [whyThreads, setWhyThreads] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const cur = FUNGI_MEASURES[measure]
  const base = cur.empOf || measure // the radio a rarity view belongs to

  const option = (id) => {
    const m = FUNGI_MEASURES[id]
    const selected = base === id
    return (
      <label key={id} className={`${styles.opt} ${selected ? styles.optOn : ''}`}>
        <input type="radio" name="fungi-measure" checked={selected} onChange={() => onMeasure(id)} style={{ accentColor: ACCENT }} />
        <span>
          <span className={styles.optLabel}>{m.label}</span>
          <span className={styles.optHint}>{m.hint}</span>
        </span>
      </label>
    )
  }

  const empToggle = (id) => {
    const m = FUNGI_MEASURES[id]
    if (base !== id) return null
    return (
      <div className={styles.sub}>
        <label className={styles.check}>
          <input type="checkbox" checked={measure === m.emp} onChange={(e) => onMeasure(e.target.checked ? m.emp : id)} style={{ accentColor: ACCENT }} />
          Show rarity as sampled today
        </label>
        <button type="button" className={styles.info} onClick={() => setWhyEmp((w) => !w)} aria-expanded={whyEmp} aria-label="What does “as sampled today” mean?">ⓘ</button>
        {whyEmp && (
          <div className={styles.explain}>
            Some parts of the world have had far more soil sequenced than others, and a fungus only
            looks rare if it has been looked for widely. SPUN’s main rarity map simulates every place
            being sampled equally hard. This view keeps today’s real, uneven sampling instead. Where
            the two disagree (tundra and tropical forest, for ectomycorrhizal fungi), more sampling
            is likely to turn up new rarity hotspots.{' '}
            <a href={FUNGI_MEASURES[id].url} target="_blank" rel="noopener noreferrer">The paper explains ↗</a>
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={wrapRef} className={styles.wrap} style={stacked ? { top: 98 } : undefined}>
      <button
        type="button"
        className={styles.pill}
        style={{ borderColor: 'rgba(224,64,154,0.6)' }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Choose which underground map to show"
      >
        <span className={styles.dot} style={{ background: ACCENT }} aria-hidden="true" />
        <span className={styles.pillLead}>Underground fungi:</span>
        <span className={styles.pillValue}>{cur.label}{loading ? ' …' : ''}</span>
        <span className={styles.chev} aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className={styles.pop} role="dialog" aria-label="Which underground fungi map to show">
          <div className={styles.head}>Fungal networks</div>
          {option('hyphae')}
          {base === 'hyphae' && (
            <div className={styles.sub}>
              <label className={styles.check}>
                <input type="checkbox" checked={threads} onChange={(e) => onThreads(e.target.checked)} style={{ accentColor: ACCENT }} />
                Living threads (illustration)
              </label>
              <button type="button" className={styles.info} onClick={() => setWhyThreads((w) => !w)} aria-expanded={whyThreads} aria-label="What are the living threads?">ⓘ</button>
              {whyThreads && (
                <div className={styles.explain}>
                  The golden threads and the pulses running along them are an illustration of a living
                  network moving energy, nutrients and signals. SPUN measures how dense the networks are,
                  not the paths of individual threads, so the paths are drawn, not measured. What does follow
                  the data is where they grow: threads only start and spread in proportion to the measured
                  density, so the densest networks teem with them and sparse ground stays quiet.
                </div>
              )}
            </div>
          )}
          <div className={styles.head}>How many kinds live here</div>
          {option('am-rich')}
          {option('ecm-rich')}
          <div className={styles.head}>How rare they are</div>
          {option('am-rare')}
          {empToggle('am-rare')}
          {option('ecm-rare')}
          {empToggle('ecm-rare')}
          <div className={styles.head}>Hotspots · top 5% worldwide</div>
          {option('am-hot')}
          {option('ecm-hot')}
          <div className={styles.note}>
            All of these are model predictions from SPUN (Society for the Protection of Underground
            Networks), about 1 km across. Click the map for a value with its uncertainty and source.
          </div>
        </div>
      )}
    </div>
  )
}
