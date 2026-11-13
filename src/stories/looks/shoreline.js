/**
 * How story maps draw /shoreline's layers (docs/design/stories-split/DESIGN.md, "Map look to reproduce"). Same data
 * files and layer ids as the explorer and its report (src/shoreline, scripts/shoreline/report-counts.py); only the
 * look differs. Used by every shoreline story; a story file never restyles a layer.
 *
 * Each layer: the data file, an optional map-key entry, and its drawn parts, back to front. A part's role decides how
 * the chapter's emphasis shows it (src/stories/StoryMap.jsx):
 *   glow     wide blurred halo: shown for 'glow' and 'dim', hidden for 'on'
 *   core     the line itself
 *   sparkle  moving highlight along the line: like glow
 *   faint    a quiet gray backdrop line: shown only for 'faint', in place of the other parts
 * `opacity` is the part's own strength at full emphasis; `animate` is 'pulse' (glow brightens and fades, 3.4 s),
 * 'flow' (dashes run along the line, 1.8 s) or 'sparkle' (sparse dashes drift along it, 7 s).
 *
 * Widths are the mockup's at the county view (zoom 10) and its Fisherman Bay detail (zoom 12).
 */
import { FISH_SPECIES, fishTier } from '../../shoreline/shorelineLayers.js'

const DATA = '/shoreline-data/'
const w = (z10, z12) => ['interpolate', ['linear'], ['zoom'], 10, z10, 12, z12]
const round = { 'line-cap': 'round', 'line-join': 'round' }

// t_<mode>: each fish-use segment's priority level per species (as the explorer computes it in shorelineLayers.js)
function prepareFish(fc) {
  for (const f of fc.features) {
    for (const sp of FISH_SPECIES) {
      const raw = f.properties[`HRM_${sp.code}`], v = Number(raw)
      if (raw != null && raw !== '' && Number.isFinite(v)) f.properties[`t_${sp.mode}`] = fishTier(sp, v)
    }
  }
  return fc
}

export default {
  // key order is the map key's order
  layers: {
    geology: {
      file: `${DATA}friends-shoreline-geology.json`,
      parts: [
        { role: 'faint', opacity: 0.5, layout: round, paint: { 'line-color': '#A9B6BF', 'line-width': w(1, 1.3) } },
        { role: 'glow', opacity: 0.35, layout: round, paint: { 'line-color': '#7FD0F0', 'line-width': w(5, 6), 'line-blur': w(2.5, 3) } },
        { role: 'core', opacity: 0.9, layout: round, paint: { 'line-color': '#CFEFFF', 'line-width': w(1.3, 1.7) } },
        { role: 'sparkle', opacity: 0.9, animate: 'sparkle', layout: round, paint: { 'line-color': '#FFFFFF', 'line-width': w(1.5, 1.8) } },
      ],
    },
    fdoc: {
      file: `${DATA}friends-documented-forage-spawning.json`,
      key: { label: 'Spawning beach', color: '#FFEFC2', glow: '#FFC74D' },
      parts: [
        { role: 'glow', opacity: 1, animate: 'pulse', layout: round, paint: { 'line-color': '#FFC74D', 'line-width': w(13, 22), 'line-blur': w(7, 10) } },
        { role: 'core', opacity: 1, layout: round, paint: { 'line-color': '#FFEFC2', 'line-width': w(3, 5) } },
      ],
    },
    fish: {
      file: `${DATA}fish-use.geojson`,
      prepare: prepareFish,
      key: { label: 'Juvenile Chinook', color: '#7CF5E6' },
      parts: [
        { role: 'glow', opacity: 0.6, layout: round, paint: { 'line-color': '#7CF5E6', 'line-width': w(7, 5), 'line-blur': w(4, 3) } },
        { role: 'core', opacity: 1, animate: 'flow', layout: round, paint: { 'line-color': '#D8FFFA', 'line-width': w(2.4, 3.2) } },
      ],
    },
    armor: {
      file: `${DATA}friends-armor.json`,
      key: { label: 'Armoring', color: '#FF6A5C' },
      parts: [
        { role: 'glow', opacity: 0.55, layout: round, paint: { 'line-color': '#FF4A3D', 'line-width': w(9, 11), 'line-blur': w(6, 7) } },
        { role: 'core', opacity: 1, layout: round, paint: { 'line-color': '#FF6A5C', 'line-width': w(3, 3.6) } },
      ],
    },
  },
}
