/**
 * /whalewatch time bar: hour by hour through the last 12 months, or LIVE (each boat's latest position on record).
 * Same look and controls as /inmotion's TransportBar (its stylesheet), driven by plain props instead of a replay tape.
 */
import { useEffect } from 'react'
import styles from '../systems/TransportBar.module.css'

const H = 3600
// The boats' own clock (Salish Sea: Pacific time), then UTC.
const fmtPacific = (s) => new Date(s * 1000).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZone: 'America/Vancouver', timeZoneName: 'short' })
const fmtUTC = (s) => { const d = new Date(s * 1000); return `${String(d.getUTCHours()).padStart(2, '0')}:00 UTC` }
const fmtDay = (s) => new Date(s * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Vancouver' })
export const SPEEDS = [[1, '1 h'], [6, '6 h'], [24, '1 d']]   // hours per step while playing

export default function WhaleTimeBar({ start, end, t, onT, playing, onPlaying, speed, onSpeed, shifted, newestFix, liveStatus }) {
  const live = t == null
  const at = live ? end : t
  const clamp = (x) => Math.max(start, Math.min(end, x))
  const step = (h) => { onPlaying(false); const n = clamp((live ? end : t) + h * H); onT(n >= end ? null : n) }
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return
      if (e.key === ' ') { e.preventDefault(); onPlaying(!playing) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -24 : -1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? 24 : 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const pct = end > start ? ((at - start) / (end - start)) * 100 : 100
  return (
    <div className={`${styles.bar} ${shifted ? styles.shifted : ''}`} role="region" aria-label="Time controls">
      <div className={styles.when}>
        <span className={styles.badge + (live ? ` ${styles.badgeLive}` : '')}>{live ? 'LIVE' : 'REPLAY'}</span>
        {live
          ? <span className={styles.utc}>Latest position of each boat</span>
          : <><span className={styles.utc}>{fmtPacific(at)}</span><span className={styles.local}>({fmtUTC(at)})</span></>}
        <span className={styles.status}>{live && liveStatus ? liveStatus : live && newestFix ? `newest on record ${fmtDay(newestFix)}` : ''}</span>
      </div>
      <div className={styles.row}>
        <button type="button" className={styles.btn} onClick={() => { onPlaying(false); onT(start) }} title="Back to the start (12 months ago)" aria-label="Back to start">⏮</button>
        <button type="button" className={styles.btn} onClick={() => step(-1)} title="Back one hour (←; shift: one day)" aria-label="Back one hour">◀︎</button>
        <button type="button" className={`${styles.btn} ${styles.play}`} title={playing ? 'Pause (space)' : 'Play (space)'} aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => { if (!playing && live) onT(clamp(end - 24 * H)); onPlaying(!playing) }}>{playing ? '❚❚' : '▶'}</button>
        <button type="button" className={styles.btn} onClick={() => step(1)} title="Forward one hour (→; shift: one day)" aria-label="Forward one hour">▶︎</button>
        <button type="button" className={`${styles.btn} ${live ? styles.btnLiveOn : ''}`} onClick={() => { onPlaying(false); onT(null) }}
          title="Each boat’s latest position on record" aria-label="Jump to live">Live ⏭</button>
        <input className={styles.scrub} type="range" min={start} max={end} step={H} value={at}
          onChange={(e) => { onPlaying(false); const v = Number(e.target.value); onT(v >= end ? null : v) }}
          aria-label="Scrub through time, hour by hour" style={{ '--pct': `${pct}%` }} />
        <div className={styles.window} role="group" aria-label="Playback speed">
          {SPEEDS.map(([h, label]) => (
            <button key={h} type="button" className={`${styles.win} ${speed === h ? styles.winOn : ''}`} onClick={() => onSpeed(h)} title={`Play ${label} per step`}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
