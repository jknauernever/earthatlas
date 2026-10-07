/**
 * Terminal pins (/ships, Josh 2026-09-28, UI "C"): one drawn SVG glyph per family of terminal kind, used both as the map
 * icon (a round badge, rasterised once per style) and in the legend / card header, so they always match.
 * Glyphs are 24×24 stroke drawings (same style as the dock icons); badges are sized like the adjacent map controls.
 */
export const TERMINAL_RING = '#fb923c'          // the Ports & terminals row's hue (PORT_HUE)
export const TERMINAL_MUTED_RING = '#9ca3af'    // closed / idle / under construction

const G = {
  refinery: '<path d="M3 21h18"/><path d="M5 21v-9l4 2.5V12l4 2.5V12l4 2.5V21"/><path d="M17 12V4h2v8"/>',
  tank: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/><path d="M5 11.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/><path d="M3 21h12"/><path d="M7 7h4"/><path d="M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V9l-3-3"/>',
  gas: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 1.5 1 2.5 2.5 3 4 .5-2 0-5 0-7z"/>',
  coal: '<path d="M3 19l6-9 3 4 3-5 6 10z"/><circle cx="9.5" cy="16" r="1.2"/><circle cx="14.5" cy="15.5" r="1.2"/>',
  grain: '<path d="M12 21V7"/><path d="M12 7c-2-1-3-2.5-3-4.5 2 .8 3 2.5 3 4.5zM12 7c2-1 3-2.5 3-4.5-2 .8-3 2.5-3 4.5z"/><path d="M12 12.5c-2-1-3.5-2.5-3.5-4.5 2 .5 3.5 2.5 3.5 4.5zM12 12.5c2-1 3.5-2.5 3.5-4.5-2 .5-3.5 2.5-3.5 4.5z"/><path d="M12 17.5c-2-1-3.5-2.5-3.5-4.5 2 .5 3.5 2.5 3.5 4.5zM12 17.5c2-1 3.5-2.5 3.5-4.5-2 .5-3.5 2.5-3.5 4.5z"/>',
  bulk: '<path d="M3 19l6-9 3 4 3-5 6 10z"/>',
  chemical: '<path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7.5 15h9"/>',
  forest: '<path d="M12 3l6 8h-3l4 6H5l4-6H6z"/><path d="M12 17v4"/>',
  cruise: '<path d="M3 16l2 4h14l2-4z"/><path d="M6 16v-4h12v4"/><path d="M9 12V8h6v4"/><path d="M12 8V5"/>',
  cargo: '<rect x="3" y="12" width="8" height="7"/><rect x="13" y="12" width="8" height="7"/><rect x="8" y="5" width="8" height="7"/>',
}

/** Families shown in the legend, in order: [id, glyph, label]. */
export const TERMINAL_FAMILIES = [
  ['refinery', G.refinery, 'Refinery dock'],
  ['tank', G.tank, 'Crude or fuel-products terminal'],
  ['fuel', G.fuel, 'Bunkering or fuel dock'],
  ['gas', G.gas, 'LNG or LPG terminal'],
  ['chemical', G.chemical, 'Chemical terminal'],
  ['coal', G.coal, 'Coal terminal'],
  ['grain', G.grain, 'Grain terminal'],
  ['bulk', G.bulk, 'Cement, aggregate or other bulk'],
  ['forest', G.forest, 'Forest products'],
  ['cruise', G.cruise, 'Cruise terminal'],
  ['cargo', G.cargo, 'Container, ro-ro or general cargo'],
]
export const GLYPH = Object.fromEntries(TERMINAL_FAMILIES.map(([id, svg]) => [id, svg]))

/** Terminal kind (lib/ships/terminals.js KINDS) → [family, words]. */
export const TERMINAL_KIND = {
  refinery_dock: ['refinery', 'Refinery dock'],
  crude_terminal: ['tank', 'Crude oil terminal'],
  product_terminal: ['tank', 'Fuel-products terminal'],
  bunkering_terminal: ['fuel', 'Bunkering terminal'],
  fuel_dock: ['fuel', 'Fuel dock'],
  military_fuel_pier: ['fuel', 'Military fuel pier'],
  lng_terminal: ['gas', 'LNG terminal'],
  lpg_terminal: ['gas', 'LPG terminal'],
  chemical_terminal: ['chemical', 'Chemical terminal'],
  coal_terminal: ['coal', 'Coal terminal'],
  grain_terminal: ['grain', 'Grain terminal'],
  dry_bulk_terminal: ['bulk', 'Dry bulk terminal'],
  cement_terminal: ['bulk', 'Cement terminal'],
  scrap_metal_terminal: ['bulk', 'Scrap metal terminal'],
  other_bulk_terminal: ['bulk', 'Bulk terminal'],
  forest_products_terminal: ['forest', 'Forest products terminal'],
  cruise_terminal: ['cruise', 'Cruise terminal'],
  container_terminal: ['cargo', 'Container terminal'],
  roro_terminal: ['cargo', 'Ro-ro / vehicle terminal'],
  general_cargo_terminal: ['cargo', 'General cargo terminal'],
}
export const kindWords = (k) => TERMINAL_KIND[k]?.[1] || String(k || '').replace(/_/g, ' ')
export const kindFamily = (k) => TERMINAL_KIND[k]?.[0] || 'bulk'
export const NOT_OPERATING = ['closed', 'idle', 'construction']
export const STATUS_WORDS = { operating: 'Operating', idle: 'Idle', closed: 'Closed', construction: 'Under construction', unknown: 'Status not confirmed' }

export const iconId = (family, muted) => `terminal-${family}${muted ? '-muted' : ''}`

/** A badge (dark disc, coloured ring, white glyph) as an image Mapbox can add. Rasterised at 2× for sharp pins. */
function badgeImage(glyph, ring, { px = 26, ratio = 2 } = {}) {
  const s = px * ratio
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${px} ${px}">`
    + `<circle cx="${px / 2}" cy="${px / 2}" r="${px / 2 - 1.2}" fill="#0a0e17" stroke="${ring}" stroke-width="2"/>`
    + `<g transform="translate(${(px - 16) / 2} ${(px - 16) / 2}) scale(${16 / 24})" fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`
  return new Promise((resolve, reject) => {
    const img = new Image(s, s)
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = s; c.height = s
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, s, s)
      resolve({ data: ctx.getImageData(0, 0, s, s), ratio })
    }
    img.onerror = reject
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

/** Add every family's badge (normal + muted) to the map's current style (after each style.load). */
export async function addTerminalImages(map) {
  const jobs = []
  for (const [id, glyph] of TERMINAL_FAMILIES) {
    for (const muted of [false, true]) {
      const name = iconId(id, muted)
      if (map.hasImage(name)) continue
      jobs.push(badgeImage(glyph, muted ? TERMINAL_MUTED_RING : TERMINAL_RING).then(({ data, ratio }) => {
        if (!map.hasImage(name)) map.addImage(name, data, { pixelRatio: ratio })
      }))
    }
  }
  await Promise.all(jobs)
}

/** Mapbox expression: the icon for a feature (properties t = kind, s = status). */
export function iconExpression() {
  const fam = ['match', ['get', 't'], ...Object.entries(TERMINAL_KIND).flatMap(([k, [f]]) => [k, f]), 'bulk']
  return ['concat', 'terminal-', fam, ['case', ['in', ['get', 's'], ['literal', NOT_OPERATING]], '-muted', '']]
}
