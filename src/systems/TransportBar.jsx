import { useEffect, useState } from 'react'
import styles from './TransportBar.module.css'

const fmtUTC = (ms) => {
  const d = new Date(ms)
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const fmtLocal = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
const fmtRunShort = (ms) => {
  const d = new Date(ms)
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} ${String(d.getUTCHours()).padStart(2, '0')}z`
}

/**
 * Video-style transport for a ReplayController: rewind / step / play-pause /
 * step / jump-to-now, a scrubber across the replay window, and a large,
 * unambiguous readout of the date & time on screen (UTC + viewer's local)
 * with the frame's provenance underneath.
 */
export default function TransportBar({ controller, sourceName, sourceUrl, shifted, range, onRange, mini }) {
  const [, force] = useState(0)
  useEffect(() => controller.subscribe(() => force((n) => n + 1)), [controller])
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return
      if (e.key === ' ') { e.preventDefault(); controller.toggle() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); controller.stepFrames(e.shiftKey ? -8 : -1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); controller.stepFrames(e.shiftKey ? 8 : 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controller])

  const c = controller
  const meta = c.tape.metaAt(c.t)
  const span = c.end_ms - c.windowStart
  const pct = span > 0 ? ((c.t - c.windowStart) / span) * 100 : 100
  const live = c.atLive
  const daily = c.daily
  // The readout names the FRAME on screen (nearest), not the interpolated
  // clock — a minute-by-minute clock churned 60×/s and was unreadable. Daily
  // and weekly fields are dated, not timed (every frame is the 12:00Z field).
  const shownMs = meta.valid_ms
  const fk = meta.frame_kind
  const kind = meta.event
    ? (meta.live ? 'all quakes of the past 24 h' : c.playing ? 'quakes as they happen' : 'all quakes of this day')
    : meta.live
    ? (daily ? 'latest daily field' : 'forecast valid now')
    : fk ? (meta.lead_h > 0 ? `${fk} (+${meta.lead_h} h)` : fk)
      : meta.lead_h === 0 ? 'analysis' : `short-range analysis (+${meta.lead_h} h)`
  // "model run" only where a run exists (forecast leads, live, CAMS/GFS analyses).
  const stepH = Math.round(c.stepMs / 3.6e6)
  const showRun = !meta.event && (meta.live || meta.lead_h > 0 || !fk || fk === 'analysis')
  const runLabel = (showRun ? ` · run ${fmtRunShort(meta.run_ms)}` : '') + (meta.smoothed ? ' · smoothed toward next analysis' : '')
  // While playing, per-frame detail (lead hours, run time) alternates frame
  // to frame — GFS tapes interleave a run's analysis with its +3 h step — and
  // reads as flicker. Playback shows a steady description of the tape; the
  // exact frame provenance appears the moment you pause or scrub.
  const stepWord = c.weekly ? 'weekly' : daily ? 'daily' : stepH === 1 ? 'hourly' : `every ${stepH} h`
  const steady = meta.event ? `${fk} · one day at a time` : `${fk ? fk.replace(/, weekly$/, '') : 'model analyses'}, ${stepWord}`
  const windowOptions = c.windowOptions
  const status = c.buffering ? 'loading…' : c.holding && c.playing ? 'restarting ↻' : ''

  if (mini) {
    // Compact pill (phones, while a popup is open): date + play/pause only.
    return (
      <div className={`${styles.bar} ${styles.mini}`} role="region" aria-label="Replay controls">
        <span className={styles.badge + (live ? ` ${styles.badgeLive}` : '')}>{live ? 'NOW' : 'REPLAY'}</span>
        <span className={styles.miniDate}>{daily || meta.dayLabel ? fmtDate(shownMs) : fmtUTC(shownMs)}</span>
        <button type="button" className={`${styles.btn} ${styles.play}`} onClick={() => c.toggle()} aria-label={c.playing ? 'Pause' : 'Play'}>{c.playing ? '❚❚' : '▶'}</button>
      </div>
    )
  }

  return (
    <div className={`${styles.bar} ${shifted ? styles.shifted : ''}`} role="region" aria-label="Replay controls">
      <div className={styles.readout}>
        <div className={styles.when}>
          <span className={styles.badge + (live ? ` ${styles.badgeLive}` : '')}>{live ? 'NOW' : 'REPLAY'}</span>
          <span className={styles.utc}>{daily || meta.dayLabel ? fmtDate(shownMs) : fmtUTC(shownMs)}</span>
          {!daily && !meta.dayLabel && <span className={styles.local}>({fmtLocal(shownMs)})</span>}
          {onRange && (
            <div className={styles.span} role="group" aria-label="Replay span">
              <span className={styles.spanLabel}>Show</span>
              {[['short', `Last ${Math.min(31, Math.max(1, Math.round((c.end_ms - c.start_ms) / 8.64e7)))} days`], ['year', 'Last year']].map(([k, label]) => (
                <button key={k} type="button" className={`${styles.win} ${range === k ? styles.winOn : ''}`} onClick={() => onRange(k)}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <div className={styles.prov}>
          {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{sourceName}</a> : sourceName}
          {' · '}{c.playing && !live ? steady : `${kind}${runLabel}`}
          <span className={styles.status}>{status}</span>
        </div>
      </div>
      <div className={styles.controls}>
        <button type="button" className={styles.btn} onClick={() => c.toStart()} title="Back to start of window" aria-label="Back to start">⏮</button>
        <button type="button" className={styles.btn} onClick={() => c.stepDays(c.weekly ? -7 : -1)} title={c.weekly ? 'Back one week' : 'Back one day'} aria-label="Back one step">{c.weekly ? '−1 w' : '−1 d'}</button>
        {!daily && !meta.dayLabel && <button type="button" className={styles.btn} onClick={() => c.stepFrames(-1)} title={`Back ${stepH} hours (←)`} aria-label="Back one frame">◀︎</button>}
        <button type="button" className={`${styles.btn} ${styles.play}`} onClick={() => c.toggle()} title={c.playing ? 'Pause (space)' : 'Play (space)'} aria-label={c.playing ? 'Pause' : 'Play'}>
          {c.playing ? '❚❚' : '▶'}
        </button>
        {!daily && !meta.dayLabel && <button type="button" className={styles.btn} onClick={() => c.stepFrames(1)} title={`Forward ${stepH} hours (→)`} aria-label="Forward one frame">▶︎</button>}
        <button type="button" className={styles.btn} onClick={() => c.stepDays(c.weekly ? 7 : 1)} title={c.weekly ? 'Forward one week' : 'Forward one day'} aria-label="Forward one step">{c.weekly ? '+1 w' : '+1 d'}</button>
        <button type="button" className={`${styles.btn} ${live ? styles.btnLiveOn : ''}`} onClick={() => c.toLive()} title="Jump to now" aria-label="Jump to now">Now ⏭</button>
        <input
          className={styles.scrub}
          type="range"
          min={c.windowStart}
          max={c.end_ms}
          step={60000}
          value={Math.round(c.t)}
          onChange={(e) => { c.pause(); c.seek(Number(e.target.value)) }}
          aria-label="Scrub through time"
          style={{ '--pct': `${pct}%` }}
        />
        {!onRange && windowOptions.length > 1 && (
          <div className={styles.window} role="group" aria-label="Replay window">
            {windowOptions.map((d) => (
              <button key={d} type="button" className={`${styles.win} ${c.windowDays === d ? styles.winOn : ''}`} onClick={() => c.setWindowDays(d)}>{d} d</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
