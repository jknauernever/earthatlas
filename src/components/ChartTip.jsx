/**
 * Shared mouseover info for charts (Josh 2026-11-09: every data visualization on earthatlas.org gets mouseover info).
 *
 *   <ChartTipProvider> … </ChartTipProvider>          once, around the page
 *   const tip = useChartTip()
 *   <span {...tip({ head: 'Orcas', rows: [{ color, label: 'Shoreline', value: '78.5 mi', on: true }], foot: '19% of the county' })} />
 *
 * Follows the pointer, flips below near the top edge, stays inside the window, hides on scroll. Touch: tap shows it.
 * Looks like the report frame's chart tip (ScrubberReport .tip): dark card, swatch rows, tabular numbers.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import s from './ChartTip.module.css'

const Ctx = createContext(null)

export function ChartTipProvider({ children }) {
  const [tip, setTip] = useState(null)
  const api = useMemo(() => ({
    show: (e, content) => setTip({ x: e.clientX, y: e.clientY, content }),
    hide: () => setTip(null),
  }), [])
  useEffect(() => {
    if (!tip) return
    const off = () => setTip(null)
    window.addEventListener('scroll', off, { passive: true, capture: true })
    return () => window.removeEventListener('scroll', off, { capture: true })
  }, [tip])
  return (
    <Ctx.Provider value={api}>
      {children}
      {tip && <Tip {...tip} />}
    </Ctx.Provider>
  )
}

function Tip({ x, y, content: { head, rows = [], foot } }) {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1000
  const left = Math.min(Math.max(x, 130), w - 130)
  const below = y < 140
  return (
    <div className={s.tip} role="tooltip" style={{ left, top: below ? y + 18 : y - 14, transform: below ? 'translateX(-50%)' : 'translate(-50%, -100%)' }}>
      {head && <div className={s.head}>{head}</div>}
      {rows.map((r, i) => (
        <div key={i} className={`${s.row} ${r.on ? s.on : ''}`}>
          {r.color && <i style={{ background: r.color }} />}
          <span>{r.label}</span><b>{r.value}</b>
        </div>
      ))}
      {foot && <div className={s.foot}>{foot}</div>}
    </div>
  )
}

/** Returns tip(content) → pointer props for any element (no-op outside a provider). */
export function useChartTip() {
  const api = useContext(Ctx)
  return (content) => (api ? {
    onPointerEnter: (e) => api.show(e, content),
    onPointerMove: (e) => api.show(e, content),
    onPointerLeave: api.hide,
    onPointerDown: (e) => api.show(e, content),
  } : {})
}
