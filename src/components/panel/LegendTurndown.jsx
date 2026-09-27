import { useId } from 'react'
import Chevron from './Chevron.jsx'
import usePanelToggle from './usePanelToggle.js'
import s from './Panel.module.css'

/**
 * A dataset's legend as its own turndown ("Legend ⌄"), closed by default, open state remembered per viewer.
 * DatasetRow renders one for its `legend` prop; use it directly for a legend outside a dataset row.
 *
 * Props: storageKey (string, optional), label ('Legend'), children (the legend itself).
 * LegendSwatchRow is a ready-made "swatch + label" line for simple legends.
 */
export default function LegendTurndown({ storageKey, label = 'Legend', children }) {
  const uid = useId()
  const [open, toggle] = usePanelToggle(storageKey)
  return (
    <div className={s.legend}>
      <button type="button" className={s.subToggle} onClick={toggle} aria-expanded={open} aria-controls={`${uid}-legend`}>
        <span>{label}</span>
        <span className={s.subChevron}><Chevron up={open} size={14} /></span>
      </button>
      {open && <div className={s.legendBody} id={`${uid}-legend`}>{children}</div>}
    </div>
  )
}

/** One legend line: a swatch (any node) and its label. */
export function LegendSwatchRow({ swatch, children }) {
  return (
    <div className={s.legendRow}>
      <span className={s.legendSwatch} aria-hidden="true">{swatch}</span>
      <span>{children}</span>
    </div>
  )
}
