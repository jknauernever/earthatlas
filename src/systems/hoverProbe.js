/**
 * Shared hover probe for /inmotion.
 *
 * One mousemove listener in SystemsApp asks this what is under the cursor,
 * and one tooltip renders the answer. Per-overlay tooltips were the
 * alternative and would have meant N implementations of edge-flipping,
 * styling and throttling that drifted apart.
 *
 * Scope is deliberate: **discrete features only** — points, lines and shapes
 * you can be "on". Continuous fields (wind, currents, and every scalar wash
 * like sea temperature or pressure) are excluded, because a value exists at
 * every pixel, so a tooltip would follow the cursor everywhere saying
 * something nobody asked. Those layers stay click-to-inspect.
 *
 * Adding a layer here needs two things: an instance that can answer
 * "what's at this pixel" (`hoverAt`, `nearest` or `hitTest` — most overlays
 * already have one for click handling), and a formatter turning that hit into
 * two or three short lines.
 */

import { LAYERS } from './layerDefs.js'
import { sectorStyle } from './traceData.js'

const defOf = (id) => LAYERS.find((d) => d.id === id)

/** Compact lines from a layer's existing popup formatter — no new copy. */
function fromPopupEvent(def, ev) {
  if (!def?.popupEvent) return null
  let card
  try { card = def.popupEvent(ev) } catch { return null }
  if (!card) return null
  return [card.head, card.big, card.alt].filter(Boolean).slice(0, 3)
}

// Probed in the order they're drawn, topmost first, so the thing you can see
// is the thing you get.
const PROBES = [
  {
    inst: 'storms',
    on: 'storms',
    // Storms answers for itself: it knows whether you're on the eye, a
    // forecast dot, a wind shell, a past fix or inside the cone.
    probe: (i, x, y) => i.hoverAt?.(x, y),
  },
  {
    inst: 'fireevents',
    on: 'hotspots',
    probe: (i, x, y) => {
      const ev = i.hitTest?.(x, y, 16)
      if (!ev) return null
      const def = defOf('hotspots')
      const lines = fromPopupEvent(def, ev)
      return lines && { lines, color: def.hue }
    },
  },
  {
    inst: 'hotspots',
    on: 'hotspots',
    probe: (i, x, y) => {
      const ev = i.nearest?.(x, y, 14)
      if (!ev) return null
      const def = defOf('hotspots')
      const lines = fromPopupEvent(def, ev)
      return lines && { lines, color: def.hue }
    },
  },
  {
    inst: 'quakes',
    on: 'quakes',
    probe: (i, x, y) => {
      const ev = i.nearest?.(x, y, 14)
      if (!ev) return null
      const def = defOf('quakes')
      const lines = fromPopupEvent(def, ev)
      return lines && { lines, color: def.hue }
    },
  },
  {
    // Climate TRACE facilities, tinted by sector. Hovering also warms the
    // source's detail shard, so the click popup can show ownership detail.
    inst: 'emissions',
    on: 'emissions',
    probe: (i, x, y) => {
      const ev = i.nearest?.(x, y, 12)
      if (!ev) return null
      const lines = fromPopupEvent(defOf('emissions'), ev)
      return lines && { lines, color: sectorStyle(ev.sec).color }
    },
  },
]

// Observed-emission markers: same shape for every gas overlay, so one
// formatter covers methane, CO2 and the MARS layer.
const PLUME_INSTANCES = [
  { inst: 'methaneplumes', on: 'methane', hue: '#5fe0a0' },
  { inst: 'methanemars', on: 'methane', hue: '#67e8f9' },
  { inst: 'co2plumes', on: 'co2', hue: '#5fe0a0' },
]

function plumeLines(pl) {
  const kgh = Number.isFinite(pl.kgh) && pl.kgh > 0 ? pl.kgh : null
  const rate = kgh
    ? (kgh >= 1000 ? `${(kgh / 1000).toFixed(1)} tonnes/hour` : `${Math.round(kgh)} kg/hour`)
    : `${pl.det || 1} plume${(pl.det || 1) === 1 ? '' : 's'} detected`
  return [
    pl.source_name || 'Observed emission source',
    rate,
    pl.t_ms ? `last seen ${new Date(pl.t_ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}` : null,
  ].filter(Boolean)
}

for (const g of PLUME_INSTANCES) {
  PROBES.push({
    inst: g.inst,
    on: g.on,
    probe: (i, x, y) => {
      const pl = i.hitTest?.(x, y)
      return pl ? { lines: plumeLines(pl), color: g.hue } : null
    },
  })
}

PROBES.push({
  inst: 'smokeplumes',
  on: 'smoke',
  probe: (i, x, y) => {
    const pl = i.hitTest?.(x, y)
    if (!pl) return null
    const d = pl.properties?.density
    return {
      lines: [
        'Smoke overhead',
        d ? `${d[0].toUpperCase()}${d.slice(1)} smoke` : 'Analyst-traced plume',
        'seen in satellite imagery',
      ],
      color: '#d9a441',
    }
  },
})

/**
 * @returns {{lines: string[], color: string}|null}
 */
export function probeHover(x, y, instances, layerOn) {
  for (const p of PROBES) {
    if (!layerOn?.[p.on]) continue
    const inst = instances?.[p.inst]
    if (!inst) continue
    let hit = null
    try { hit = p.probe(inst, x, y) } catch { hit = null }
    if (hit?.lines?.length) return hit
  }
  return null
}
