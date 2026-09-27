import { useId } from 'react'
import Chevron from './Chevron.jsx'
import usePanelToggle from './usePanelToggle.js'
import s from './Panel.module.css'

/**
 * One dataset in an EarthAtlas left panel (the one panel standard, Josh 2026-09-27):
 *
 *   [icon] Name  short descriptor          (i) (⌄)
 *          ├ controls turndown   (⌄ on the row; filters, time pickers…; only while the dataset is on)
 *          ├ legend              (always shown while on; Josh 2026-09-27)
 *          └ explanatory text    ((i) on the row; the long "what is this" text + its inline source links)
 *
 * Clicking the icon/name turns the dataset on or off. The controls and (i) turndowns start closed and remember their state
 * per viewer (localStorage, see usePanelToggle); on/off itself is owned by the site (it lives in the URL).
 *
 * Props
 *   storageKey  string    unique per site + dataset, e.g. "ships.tracks" (turndown memory; omit to not persist)
 *   name        string    dataset name (the toggle's label)
 *   sub         node      short one-line descriptor after the name (truncates)
 *   icon        node      the dataset's icon (≈16 px, drawn with currentColor)
 *   hue         '#rrggbb' the dataset's colour: the icon chip lights up in it when on
 *   on          bool      is the dataset showing
 *   onToggle    fn        called when the name/icon is clicked (or Enter/Space on it)
 *   controls    node      the dataset's controls (omit if none)
 *   legend      node      the legend (omit if none)
 *   info        node      the explanatory text, with its inline source links (omit if none)
 *   status      node      a short always-visible line under the row while on (loading / error / live stamp); optional
 *   disabled    bool      the toggle can't be used (e.g. data still loading)
 */
export default function DatasetRow({ storageKey, name, sub, icon, hue, on, onToggle, controls, legend, info, status, disabled = false }) {
  const uid = useId()
  const k = (part) => (storageKey ? `${storageKey}.${part}` : null)
  const [controlsOpen, toggleControls] = usePanelToggle(k('controls'))
  const [infoOpen, toggleInfo] = usePanelToggle(k('info'))
  const hasControls = controls != null && controls !== false
  const hasInfo = info != null && info !== false
  const hasLegend = legend != null && legend !== false
  return (
    <div className={`${s.dataset} ${on ? s.datasetOn : ''}`}>
      <div className={s.row}>
        <button type="button" className={s.toggle} aria-pressed={!!on} onClick={onToggle} disabled={disabled}
          title={`${on ? 'Hide' : 'Show'} ${name}`}>
          <span className={`${s.icon} ${on ? s.iconOn : ''}`} style={on && hue ? hueVars(hue) : undefined} aria-hidden="true">{icon}</span>
          <span className={s.text}>
            <span className={s.name}>{name}</span>
            {sub && <span className={s.sub}>{sub}</span>}
          </span>
          <span className={`${s.switch} ${on ? s.switchOn : ''}`} style={on && hue ? hueVars(hue) : undefined} aria-hidden="true" />
        </button>
        {hasInfo ? (
          <button type="button" className={`${s.iconBtn} ${infoOpen ? s.iconBtnActive : ''}`} onClick={toggleInfo}
            aria-expanded={infoOpen} aria-controls={`${uid}-info`} aria-label={`About ${name}`} title={`About ${name}`}>
            <InfoGlyph />
          </button>
        ) : <span className={s.iconBtnSpacer} aria-hidden="true" />}
        {hasControls && on ? (
          <button type="button" className={`${s.iconBtn} ${controlsOpen ? s.iconBtnActive : ''}`} onClick={toggleControls}
            aria-expanded={controlsOpen} aria-controls={`${uid}-controls`} aria-label={`${name} options`}
            title={controlsOpen ? `Hide ${name} options` : `${name} options`}>
            <Chevron up={controlsOpen} size={16} />
          </button>
        ) : hasControls ? <span className={s.iconBtnSpacer} aria-hidden="true" /> : null}
      </div>
      {on && status}
      {on && hasControls && controlsOpen && <div className={s.controls} id={`${uid}-controls`}>{controls}</div>}
      {on && hasLegend && <div className={s.legend}><div className={s.legendBody}>{legend}</div></div>}
      {hasInfo && infoOpen && <div className={s.info} id={`${uid}-info`}>{info}</div>}
    </div>
  )
}

/** On-state colours from a hue: border .6, background .13, icon = hue (the /inmotion dock rule). */
export function hueVars(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return { '--hue': hex, '--hue-border': `rgba(${r},${g},${b},0.6)`, '--hue-bg': `rgba(${r},${g},${b},0.13)` }
}

/** Drawn "i" in a circle (sized with the chevron and the × close buttons, not a text glyph). */
function InfoGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', margin: 'auto' }}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v6" />
      <circle cx="12" cy="7.6" r="0.6" fill="currentColor" />
    </svg>
  )
}
