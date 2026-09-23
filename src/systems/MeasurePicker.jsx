/**
 * "What are the discs measuring?" — the top-center pill for the Emission
 * sources layer, and its popover.
 *
 * Organized around what people ask, not how the files are split:
 *   Warming the planet  → all greenhouse gases (CO₂e, optional 20-year view),
 *                          CO₂, methane, nitrous oxide
 *   Air people breathe  → PM2.5, SO₂, NOx, CO (with the rough-estimate caveat)
 *   Show                → which kinds of site (the legend's sectors)
 * The map shows ONE measure at a time; "everything a site emits" lives in the
 * facility card. Wording and figures: docs/CLIMATETRACE_FACTS.md.
 */

import { useEffect, useRef, useState } from 'react'
import styles from './MeasurePicker.module.css'
import { MEASURE_INFO, AIR_CAVEAT, SECTOR_STYLE, measureInfo } from './traceData.js'

const CLIMATE = ['co2e_100yr', 'co2', 'ch4', 'n2o']
const AIR = ['pm2_5', 'so2', 'nox', 'co']
const GWP_POST = 'https://climatetrace.org/news/feeling-the-heat-global-warming-potentials-and-20-vs-100'

export default function MeasurePicker({ measure, onMeasure, sectors, onSectors, available, sectorCounts }) {
  const [open, setOpen] = useState(false)
  const [why20, setWhy20] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const has = (g) => available.includes(g)
  const isCo2e = measure === 'co2e_100yr' || measure === 'co2e_20yr'
  const info = measureInfo(measure)
  const group = info.group
  const pick = (g) => onMeasure(g === 'co2e_100yr' && measure === 'co2e_20yr' ? 'co2e_20yr' : g)

  const option = (g) => {
    const m = MEASURE_INFO[g]
    const selected = g === 'co2e_100yr' ? isCo2e : measure === g
    return (
      <label key={g} className={`${styles.opt} ${selected ? styles.optOn : ''} ${has(g) ? '' : styles.optNa}`}>
        <input type="radio" name="trace-measure" checked={selected} onChange={() => has(g) && pick(g)} disabled={!has(g)} />
        <span>
          <span className={styles.optLabel}>{m.label}</span>
          <span className={styles.optHint}>{has(g) ? m.hint : 'not in this release yet'}</span>
        </span>
      </label>
    )
  }

  const allSectors = Object.keys(SECTOR_STYLE)
  // From "Everything", a chip means "only this kind"; after that, chips add
  // or remove kinds. Emptying the set (or selecting all) returns to Everything.
  const toggleSector = (k) => {
    if (!sectors) return onSectors(new Set([k]))
    const next = new Set(sectors)
    if (next.has(k)) next.delete(k); else next.add(k)
    onSectors(next.size === allSectors.length || next.size === 0 ? null : next)
  }
  const filtered = sectors && sectors.size < allSectors.length

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        type="button"
        className={`${styles.pill} ${group === 'air' ? styles.pillAir : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Choose what the emission discs measure"
      >
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.pillLead}>Emission sources:</span>
        <span className={styles.pillValue}>{info.label}{measure === 'co2e_20yr' ? ' · 20-year view' : ''}{filtered ? ` · ${sectors.size} kind${sectors.size === 1 ? '' : 's'} of site` : ''}</span>
        <span className={styles.chev} aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className={styles.pop} role="dialog" aria-label="What the emission discs measure">
          <div className={styles.head}>Warming the planet</div>
          {option('co2e_100yr')}
          {isCo2e && has('co2e_20yr') && (
            <div className={styles.sub}>
              <label className={styles.check}>
                <input type="checkbox" checked={measure === 'co2e_20yr'} onChange={(e) => onMeasure(e.target.checked ? 'co2e_20yr' : 'co2e_100yr')} />
                Count near-term warming (20-year view)
              </label>
              <button type="button" className={styles.info} onClick={() => setWhy20((w) => !w)} aria-expanded={why20} aria-label="What is the 20-year view?">ⓘ</button>
              {why20 && (
                <div className={styles.explain}>
                  Gases keep warming the planet for different lengths of time. “CO₂e” turns every gas into the amount
                  of CO₂ that would cause the same warming. Counted over 100 years (the IPCC standard, and this map’s
                  default), a tonne of methane counts as about 30 tonnes of CO₂. Counted over 20 years it’s about 80,
                  because most of methane’s warming happens in its first decades. The 20-year view shows which sites
                  matter most for the warming we’ll feel soonest.{' '}
                  <a href={GWP_POST} target="_blank" rel="noopener noreferrer">Climate TRACE explains ↗</a>
                </div>
              )}
            </div>
          )}

          {CLIMATE.slice(1).map(option)}
          <div className={styles.head}>Air people breathe</div>
          {AIR.map(option)}
          <div className={styles.caveat}>{AIR_CAVEAT}</div>

          <div className={styles.head}>Show</div>
          <div className={styles.chips}>
            <button type="button" className={`${styles.chip} ${!filtered ? styles.chipOn : ''}`} onClick={() => onSectors(null)}>Everything</button>
            {allSectors.map((k) => {
              const on = !sectors || sectors.has(k)
              const n = sectorCounts?.[k]
              return (
                <button
                  key={k}
                  type="button"
                  className={`${styles.chip} ${filtered && on ? styles.chipOn : ''} ${n === 0 || n == null ? styles.chipNa : ''}`}
                  onClick={() => toggleSector(k)}
                  title={n ? `${n.toLocaleString()} sites with this measure` : 'No sites of this kind have this measure'}
                >
                  <span className={styles.swatch} style={{ background: SECTOR_STYLE[k].color }} aria-hidden="true" />
                  {SECTOR_STYLE[k].label}
                </button>
              )
            })}
          </div>
          {sectorCounts && allSectors.some((k) => !sectorCounts[k]) && (
            <div className={styles.note}>Faded kinds of site have no estimate for this measure, so they don’t appear on the map.</div>
          )}
        </div>
      )}
    </div>
  )
}
