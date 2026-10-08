import s from './Panel.module.css'
import Spinner, { useLoadingMessage } from './Spinner.jsx'

/**
 * A page-sized loader (Josh 2026-10-08: "a fun/cute spinner" for the scrubber report): a little ship bobbing on rolling waves,
 * puffs of exhaust drifting from its funnel, and a changing line from the shared library (loadingMessages.js) under it.
 * Light pages by default; `tone="dark"` on a dark panel. With reduced motion everything holds still.
 */
export default function ShipLoader({ kind = 'report', every = 3200, children, tone = 'light', className = '' }) {
  const msg = useLoadingMessage(kind, children ? 0 : every)
  return (
    <div className={`${s.shipLoader} ${tone === 'dark' ? s.shipLoaderDark : ''} ${className}`} role="status" aria-live="polite">
      <svg viewBox="0 0 160 96" className={s.shipLoaderArt} aria-hidden="true">
        <defs>
          <clipPath id="ea-ship-sea"><rect x="0" y="0" width="160" height="96" rx="14" /></clipPath>
        </defs>
        <g clipPath="url(#ea-ship-sea)">
          {/* exhaust: three puffs leave the funnel in turn, grow, drift downwind and fade */}
          <g className={s.slSmoke}>
            <circle cx="92" cy="30" r="4" /><circle cx="92" cy="30" r="4" /><circle cx="92" cy="30" r="4" />
          </g>
          {/* the ship rocks and bobs as one piece */}
          <g className={s.slShip}>
            <rect x="86" y="28" width="11" height="15" rx="2" className={s.slFunnel} />
            <rect x="86" y="32" width="11" height="3.5" className={s.slStripe} />
            <path d="M58 44 h48 a4 4 0 0 1 4 4 v6 H54 v-6 a4 4 0 0 1 4 -4z" className={s.slCabin} />
            <circle cx="66" cy="50" r="1.8" className={s.slPort} /><circle cx="74" cy="50" r="1.8" className={s.slPort} />
            <circle cx="82" cy="50" r="1.8" className={s.slPort} /><circle cx="90" cy="50" r="1.8" className={s.slPort} />
            <circle cx="98" cy="50" r="1.8" className={s.slPort} />
            <path d="M34 54 H128 l-10 16 H46 z" className={s.slHull} />
            <path d="M38 60 H124" className={s.slWaterline} />
          </g>
          {/* two layers of waves rolling at different speeds (each path is two copies wide, so the loop is seamless) */}
          <path className={`${s.slWave} ${s.slWaveBack}`}
            d="M0 70 q10 -5 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 V96 H0 z" />
          <path className={`${s.slWave} ${s.slWaveFront}`}
            d="M0 75 q13 -6 26.67 0 t26.67 0 t26.67 0 t26.67 0 t26.67 0 t26.67 0 t26.67 0 t26.67 0 t26.67 0 t26.67 0 t26.67 0 t26.67 0 V96 H0 z" />
        </g>
      </svg>
      <span className={s.shipLoaderText}><Spinner size={14} /><span>{children ?? msg}</span></span>
    </div>
  )
}
