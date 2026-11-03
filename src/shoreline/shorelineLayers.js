/**
 * /shoreline's map layers, drawn exactly as Salish Sea Explorer draws them (Josh 2026-11-02: "the same colors, shapes,
 * icons, animations"). The five Friends habitat layers come from src/friends/habitatOverlay.js (also /permits); this
 * file adds the rest of SSE's default map, ported from salish-sea-propmapper:
 *   config/layers.ts (styles, minZoom), config/fishUse.ts (priority levels, Color by), config/shoreforms.ts (classes),
 *   config/markerIcons.ts (pins), components/Map/DeckLayers.ts (fish line + casing, parcel/building tiles),
 *   hooks/useLayers.ts (pin placement, zoom thinning, pins yielding to other layers' pins).
 * Every zoom below is SSE's (Google) zoom; GZ converts to Mapbox. Mapbox layer ids start with `sl-`.
 */
import { shorelineBake, loadShorelineBake } from './bake.js'
import { GZ, gzoom, LAYERS_OF, CLICK_LAYERS as HABITAT_CLICK_LAYERS, addFriendsHabitat, addPinImage, pinPoints, pinMeta, selectPins } from '../friends/habitatOverlay.js'

// ─── Priority Shorelines for Fish (fishUse.ts): Beamer & Fresh 2012 model scores in Friends' three levels ───
export const FISH_TIERS = {
  1: { label: 'Moderate priority', color: '#FCD34D', weight: 4 },
  2: { label: 'High priority', color: '#F97316', weight: 5 },
  3: { label: 'Highest priority', color: '#B91C1C', weight: 6 },
}
export const FISH_SPECIES = [
  { mode: 'chinook', code: 'Ck', name: 'Juvenile Chinook Salmon', moderateMax: 0.084656, highMax: 0.214912 },
  { mode: 'chum', code: 'Chum', name: 'Juvenile Chum Salmon', moderateMax: 0.323232, highMax: 0.611842 },
  { mode: 'pink', code: 'Pk', name: 'Juvenile Pink Salmon', moderateMax: 0.300752, highMax: 0.477273 },
  { mode: 'herring', code: 'Herr', name: 'Pacific herring', moderateMax: 0.0888889, highMax: 0.208333 },
  { mode: 'smelt', code: 'Smelt', name: 'Surf smelt', moderateMax: 0.073333, highMax: 0.2 },
  { mode: 'sand-lance', code: 'Lance', name: 'Pacific sand lance', moderateMax: 0.113636, highMax: 0.27778 },
  { mode: 'greenlings', code: 'Hex', name: 'Greenlings and Cods', moderateMax: 0.357955, highMax: 0.614035 },
]
export const FISH_MODE_ALL = 'all'
export const FISH_COLOR_MODES = [...FISH_SPECIES.map((s) => ({ id: s.mode, label: s.name })), { id: FISH_MODE_ALL, label: 'Highest of all seven species' }]
export const DEFAULT_FISH_MODE = 'chinook'
// The bins end exactly on values in the data (6 decimals), hence the tolerance. Nothing is ranked low.
export function fishTier(sp, hrm) {
  const EPS = 5e-6
  return hrm > sp.highMax + EPS ? 3 : hrm > sp.moderateMax + EPS ? 2 : 1
}
/** Adds t_<mode> (the segment's level for each Color by choice) to every fish-use segment. */
function prepareFish(fc) {
  for (const f of fc.features) {
    let top = 1
    for (const sp of FISH_SPECIES) {
      const raw = f.properties[`HRM_${sp.code}`], hrm = Number(raw)
      const t = raw == null || raw === '' || !Number.isFinite(hrm) ? null : fishTier(sp, hrm)
      if (t) { f.properties[`t_${sp.mode}`] = t; top = Math.max(top, t) }
    }
    f.properties[`t_${FISH_MODE_ALL}`] = top
  }
  return fc
}

// ─── Shoreline Geology: Shoreforms (shoreforms.ts): one color per group (Tina Whitman, 2026-09-14) ───
export const SHOREFORM_GROUPS = {
  feeder: { label: 'Feeder bluff (sediment supply)', color: '#9A3412' },
  transport: { label: 'Transport zone', color: '#F59E0B' },
  barrier: { label: 'Barrier / accretion beach', color: '#FACC15' },
  pocket: { label: 'Pocket beach', color: '#3B82F6' },
  embayment: { label: 'Embayment (estuary, lagoon)', color: '#0891B2' },
  rocky: { label: 'Rocky shoreline', color: '#4B5563' },
  artificial: { label: 'Artificial', color: '#111827' },
}
export const SHOREFORM_GROUP_ORDER = ['feeder', 'transport', 'barrier', 'pocket', 'embayment', 'rocky', 'artificial']
// PIAT_shoreforms code → group (labels and descriptions for popups live with the popups)
const SHOREFORM_GROUP_OF = {
  FBE: 'feeder', FB: 'feeder', HFBE: 'feeder', HFB: 'feeder', PFB: 'feeder', TZ: 'transport', BAB: 'barrier',
  'Embayments - Estuary': 'embayment', 'Embayments - Lagoon': 'embayment', 'Pocket Beach': 'pocket', 'Rocky Shoreline': 'rocky', ART: 'artificial',
}
const SHOREFORM_DEFAULT = '#708090'

// ─── Pins (markerIcons.ts) ───
const PINS = {
  fish: { color: '#1E5A8A', box: 27, glyph: 'M3 13.5c3.1-4.6 7.3-6.4 11.1-6.4 3 0 5.6 1.2 7.4 3.5l3-2.9v11.6l-3-2.9c-1.8 2.3-4.4 3.5-7.4 3.5-3.8 0-8-1.8-11.1-6.4z' },
  shoreform: { color: '#475569', glyph: 'M4 5h7.2l1.5 2.7H4zM4 9.1h9.5l1.5 2.7H4zM4 13.2h11.7l1.5 2.7H4z', strokeExtra: 'M3.5 19.5c1.4-1.3 2.8-1.3 4.2 0s2.8 1.3 4.2 0 2.8-1.3 4.2 0 2.8 1.3 4.2 0' },
  armor: { color: '#A0522D', glyph: 'M4 4h7v3.4H4zM12.6 4H20v3.4h-7.4zM4 9h3.4v3.4H4zM9 9h6v3.4H9zM16.6 9H20v3.4h-3.4zM4 14h7v3.4H4zM12.6 14H20v3.4h-7.4zM3 19.2c1.6-1.1 3.2-1.1 4.8 0s3.2 1.1 4.8 0 3.2-1.1 4.8 0 3.2 1.1 4.6 0V22H3z' },
  dock: { color: '#0B8FA8', glyph: 'M4 9h16v2.4H4zM6 11.4h2.2V18H6zM10.9 11.4h2.2V18h-2.2zM15.8 11.4H18V18h-2.2zM4.5 18.5h15v1.5h-15z' },
  buoy: { color: '#1A73E8', glyph: 'M11 4h2v4h-2zM10 3h4v1.6h-4zM8.5 9h7l1.2 7.5H7.3zM6.5 17.5h11a1 1 0 0 1 0 2h-11a1 1 0 0 1 0-2z' },
  // "Map icons by Scott de Jonge" boat-ramp glyph (CC BY 4.0, via Wikimedia Commons; 50×50 box), as SSE uses it
  ramp: { color: '#4682B4', box: 50, glyph: 'M8.5 7.092l9.565 2.639 5.309-3.731 1.847.455-5.259 3.742 28.985 8.053-2.121 7.882-29.093-8.031c-11.271-3.399-9.216-11.009-9.216-11.009M33.957 27.258c-.035-.658-.16-1.285-.375-1.877l13.281 3.697-.426 1.639-12.48-3.459zm-12.066-3.332c.358-.521.782-.991 1.264-1.398l-22.155-6.12v1.763l20.891 5.755zm5.486 5.836c1.191 0 2.158-.969 2.158-2.16 0-1.195-.967-2.162-2.158-2.162-1.195 0-2.161.967-2.161 2.162 0 1.191.966 2.16 2.161 2.16zm21.623 13.238c-1.051 0-2.051-.238-2.943-.648-.928-.42-1.963-.672-3.047-.672-1.08 0-2.121.252-3.035.672-.905.41-1.903.648-2.955.648-1.051 0-2.053-.238-2.955-.648-.92-.42-1.953-.672-3.035-.672-1.086 0-2.119.252-3.045.672-.893.41-1.905.648-2.951.648-1.045 0-2.051-.238-2.949-.648-.926-.42-1.967-.672-3.046-.672-1.08 0-2.12.252-3.035.672-.898.41-1.909.648-2.956.648-1.045 0-2.051-.238-2.955-.648-.916-.42-1.956-.672-3.036-.672-1.079 0-2.119.252-3.04.672-.897.41-1.909.648-2.949.648l-.068-17.605 24.227 6.686c-1.67-.807-2.83-2.5-2.83-4.479 0-2.754 2.227-4.983 4.979-4.983 2.744 0 4.977 2.229 4.977 4.983 0 2.752-2.232 4.98-4.977 4.98l-.49-.047 22.078 6.088.036 4.377z' },
  railway: { color: '#2F6F8F', stroke: true, glyph: 'M4 5.5l14.5 14.5M9 3l14.5 14.5M5.5 9l4.5-4.5M10 13.5l4.5-4.5M14.5 18l4.5-4.5' },
  groin: { color: '#7A6A53', glyph: 'M3 4h18v2.6H3zM10.7 6.6h2.6v9.4h-2.6zM2.6 18.6c1.6-1.2 3.2-1.2 4.8 0s3.2 1.2 4.8 0 3.2-1.2 4.8 0 3.2 1.2 4.8 0v2.6H2.6z' },
  piling: { color: '#5B5F97', glyph: 'M5.5 7h2.6v12H5.5zM10.7 4h2.6v15h-2.6zM15.9 8h2.6v11h-2.6zM3.5 19.3h17v1.7h-17z' },
}
export const PIN_SPECS = PINS

// ─── Shoreline Modifications (legendGroups.ts order): armor lines + six point structure types, all from zoom 16 ───
// scale = SSE markerScale (pin height 26 px × scale)
export const MODIFICATIONS = [
  { id: 'armor', name: 'Shoreline Armor (2019 survey)', file: 'friends-armor.json', pin: 'armor', scale: 0.85, line: '#8B0000' },
  { id: 'docks', name: 'Docks', file: 'friends-docks.geojson', pin: 'dock', scale: 0.85 },
  { id: 'buoys', name: 'Mooring Buoys & Floats', file: 'friends-mooring-buoys.json', pin: 'buoy', scale: 0.65 },
  { id: 'ramps', name: 'Boat Ramps', file: 'friends-boat-ramps.json', pin: 'ramp', scale: 0.85 },
  { id: 'railway', name: 'Marine Railways', file: 'friends-marine-railway.json', pin: 'railway', scale: 0.85 },
  { id: 'groins', name: 'Groins', file: 'friends-groins.json', pin: 'groin', scale: 0.85 },
  { id: 'pilings', name: 'Pilings', file: 'friends-pilings.json', pin: 'piling', scale: 0.75 },
]
export const FORAGE = [
  { id: 'herring', h: 'hhe', name: 'Herring spawning grounds', color: '#8B5CF6' },
  { id: 'fdoc', h: 'hfd', name: 'Smelt & sand lance — documented beaches', color: '#E11D74' },
  { id: 'fpot', h: 'hfp', name: 'Smelt & sand lance — potential habitat', color: '#F9A8D4' },
]
// SSE minZoom per layer (Google zoom); Mapbox = − GZ
export const MIN_ZOOM = { parcels: 13.5, buildings: 15, fish: 12, forage: 12, geology: 13, modifications: 16 }
export const mapboxZoom = (g) => g - GZ

const DATA = '/shoreline-data/'
const TILE_EXTENT = [-123.35, 48.33, -122.65, 48.85]   // San Juan County (DeckLayers TILE_EXTENT)

/** Every file the map draws; resolves to { habitat, fish, geology, armor, docks, … } FeatureCollections. */
export async function loadShorelineData(signal) {
  const get = (url) => fetch(url, { signal }).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json() })
  const files = { habitat: '/permits-data/friends-habitat.geojson', fish: `${DATA}fish-use.geojson`, geology: `${DATA}friends-shoreline-geology.json`,
    ...Object.fromEntries(MODIFICATIONS.map((m) => [m.id, DATA + m.file])) }
  // The parcel tiles' version comes from the bake pointer (bake.js), read alongside the map data
  const [entries] = await Promise.all([Promise.all(Object.entries(files).map(async ([k, url]) => [k, await get(url)])), loadShorelineBake()])
  const out = Object.fromEntries(entries)
  prepareFish(out.fish)
  return out
}

/** Mapbox layer ids behind each on/off id (the panel's rows and chips). */
export function layerIdsOf(id) {
  const f = FORAGE.find((x) => x.id === id)
  if (f) return LAYERS_OF[f.h]
  return {
    kelp: LAYERS_OF.hkb, eelgrass: LAYERS_OF.hee,
    parcels: ['sl-parcels-fill', 'sl-parcels-hover', 'sl-parcels-line'], buildings: ['sl-buildings-fill', 'sl-buildings-hover', 'sl-buildings-line'],
    fish: ['sl-fish-halo', 'sl-fish', 'sl-fish-hit', 'sl-fish-pins'], geology: ['sl-geology', 'sl-geology-hit', 'sl-geology-pins'],
    armor: ['sl-armor', 'sl-armor-hit', 'sl-armor-pins'],
  }[id] || [`sl-${id}`]
}
// ─── Clicks and hovers: map layer → SSE layer id (the popup's key, src/friends/habitatPopups.js) ───
const SSE_ID = { kelp: 'friends-bull-kelp', eelgrass: 'friends-deepwater-eelgrass', herring: 'friends-herring-spawning',
  fdoc: 'friends-documented-forage-spawning', fpot: 'friends-potential-forage-spawning', fish: 'fish-use', geology: 'friends-shoreline-geology',
  armor: 'friends-armor', docks: 'friends-docks', buoys: 'friends-mooring-buoys', ramps: 'friends-boat-ramps', railway: 'friends-marine-railway',
  groins: 'friends-groins', pilings: 'friends-pilings', buildings: 'building-footprints' }
const HABITAT_ROW = { hkb: 'kelp', hee: 'eelgrass', hhe: 'herring', hfd: 'fdoc', hfp: 'fpot' }
/** The panel row id ('kelp', 'armor', …) a Mapbox layer belongs to, or null. */
export function rowOfLayer(layerId) {
  const h = /^fhab-(h[a-z]{2})/.exec(layerId)
  if (h) return HABITAT_ROW[h[1]] || null
  const m = /^sl-([a-z]+)/.exec(layerId)
  return m && SSE_ID[m[1]] ? m[1] : null
}
export const sseLayerId = (row) => SSE_ID[row]
/** Pins and point structures open straight away (SSE: "Pins open directly"); lines and areas may offer the chooser. */
export const isPinLayer = (layerId) => /-pins$/.test(layerId) || MODIFICATIONS.some((m) => !m.line && layerId === `sl-${m.id}`)
/** Every Mapbox layer a click or hover can hit, top first. */
export const CLICK_LAYERS = [
  ...MODIFICATIONS.filter((m) => !m.line).map((m) => `sl-${m.id}`), 'sl-armor-pins', 'sl-fish-pins', 'sl-geology-pins', 'sl-armor-hit', 'sl-geology-hit', 'sl-fish-hit',
  ...HABITAT_CLICK_LAYERS, 'sl-buildings-fill',
]
// Legend order ("On the map"), which the chooser follows
export const LEGEND_ORDER = ['kelp', 'eelgrass', 'parcels', 'buildings', 'fish', 'herring', 'fdoc', 'fpot', 'geology', 'armor', 'docks', 'buoys', 'ramps', 'railway', 'groins', 'pilings']

export const ALL_IDS = ['kelp', 'eelgrass', 'parcels', 'buildings', 'fish', ...FORAGE.map((f) => f.id), 'geology', ...MODIFICATIONS.map((m) => m.id)]

const tilesUrl = () => `${window.location.origin}/api/parcel-tiles?r=shoreline-sjc&v=${shorelineBake.version}&z={z}&x={x}&y={y}`
const fishKey = (mode) => `t_${mode}`
const tierMatch = (mode, of) => ['match', ['coalesce', ['get', fishKey(mode)], 1], 3, of(3), 2, of(2), of(1)]

/**
 * Add the whole /shoreline map to `map` (call on every style.load). Returns { setVisible(offSet), setFishMode(mode),
 * thin(), setSelected(fid) } — thin re-chooses the pins for the current zoom.
 */
export function addShorelineLayers(map, data) {
  // Parcels and buildings (DeckLayers buildMvt): bottom of the stack
  map.addSource('sl-parcels', { type: 'vector', tiles: [tilesUrl()], minzoom: 12, maxzoom: 15, bounds: TILE_EXTENT, promoteId: { parcels: 'fid', buildings: 'bid' },
    attribution: 'San Juan County GIS' })
  const pz = mapboxZoom(MIN_ZOOM.parcels), bz = mapboxZoom(MIN_ZOOM.buildings), close = mapboxZoom(17)
  map.addLayer({ id: 'sl-parcels-fill', type: 'fill', source: 'sl-parcels', 'source-layer': 'parcels', minzoom: pz,
    paint: { 'fill-color': '#ADB5BD', 'fill-opacity': 0.05 } })
  // deck autoHighlight: the hovered parcel brightens (white, 80/255)
  map.addLayer({ id: 'sl-parcels-hover', type: 'fill', source: 'sl-parcels', 'source-layer': 'parcels', minzoom: pz,
    paint: { 'fill-color': '#FFFFFF', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 80 / 255, 0] } })
  // From zoom 17 the ground itself shows the lot lines: hairline
  map.addLayer({ id: 'sl-parcels-line', type: 'line', source: 'sl-parcels', 'source-layer': 'parcels', minzoom: pz,
    paint: { 'line-color': '#F97316', 'line-width': ['step', ['zoom'], 1.2, close, 1] } })
  // Buildings: solid blue with a dark edge; from zoom 17 ("closeUp") a pale fill with a blue outline
  map.addLayer({ id: 'sl-buildings-fill', type: 'fill', source: 'sl-parcels', 'source-layer': 'buildings', minzoom: bz,
    paint: { 'fill-color': '#60A5FA', 'fill-opacity': ['step', ['zoom'], 0.7, close, 0.2] } })
  map.addLayer({ id: 'sl-buildings-hover', type: 'fill', source: 'sl-parcels', 'source-layer': 'buildings', minzoom: bz,
    paint: { 'fill-color': '#FFFFFF', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 80 / 255, 0] } })
  map.addLayer({ id: 'sl-buildings-line', type: 'line', source: 'sl-parcels', 'source-layer': 'buildings', minzoom: bz,
    paint: { 'line-color': ['step', ['zoom'], '#1A252F', close, '#60A5FA'], 'line-width': ['step', ['zoom'], 0.8, close, 1.5] } })
  // The parcel whose property report is open (SSE featureHighlight): orange wash, 4 px edge
  const none = ['==', ['get', 'fid'], -1]
  map.addLayer({ id: 'sl-parcels-sel-fill', type: 'fill', source: 'sl-parcels', 'source-layer': 'parcels', filter: none, paint: { 'fill-color': '#F97316', 'fill-opacity': 0.25 } })
  map.addLayer({ id: 'sl-parcels-sel-line', type: 'line', source: 'sl-parcels', 'source-layer': 'parcels', filter: none, paint: { 'line-color': '#F97316', 'line-width': 4 } })

  // Friends habitat (kelp, eelgrass, herring, forage beaches), as on /permits; its pins thin themselves
  map.addSource('sl-fish', { type: 'geojson', data: data.fish })
  map.addSource('sl-geology', { type: 'geojson', data: data.geology })
  for (const m of MODIFICATIONS) map.addSource(`sl-${m.id}`, { type: 'geojson', data: data[m.id] })
  const round = { 'line-cap': 'round', 'line-join': 'round' }

  // Priority Shorelines for Fish (buildFishUse): width by level, 35% at zoom 10 → full from 14; a white casing fading
  // in from zoom 12 to 3 px at 14. zIndex 4.5: over the spawning-beach bands, under geology and armor.
  const fz = mapboxZoom(MIN_ZOOM.fish)
  const width = (mode, halo) => {
    const w = tierMatch(mode, (t) => FISH_TIERS[t].weight)
    return ['interpolate', ['linear'], ['zoom'], mapboxZoom(10), ['*', w, 0.35], mapboxZoom(12), ['*', w, 0.675], mapboxZoom(14), halo ? ['+', w, 3] : w]
  }
  map.addLayer({ id: 'sl-fish-halo', type: 'line', source: 'sl-fish', minzoom: fz, layout: round,
    paint: { 'line-color': '#FFFFFF', 'line-opacity': 0.9, 'line-width': width(DEFAULT_FISH_MODE, true) } })
  map.addLayer({ id: 'sl-fish', type: 'line', source: 'sl-fish', minzoom: fz, layout: round,
    paint: { 'line-color': tierMatch(DEFAULT_FISH_MODE, (t) => FISH_TIERS[t].color), 'line-width': width(DEFAULT_FISH_MODE, false) } })

  // Shoreforms: 3 px in the class's group color (2 px slate for an unknown class)
  const known = Object.keys(SHOREFORM_GROUP_OF)
  map.addLayer({ id: 'sl-geology', type: 'line', source: 'sl-geology', minzoom: mapboxZoom(MIN_ZOOM.geology), layout: round,
    paint: {
      'line-color': ['match', ['get', 'PIAT_shoreforms'], ...known.flatMap((k) => [k, SHOREFORM_GROUPS[SHOREFORM_GROUP_OF[k]].color]), SHOREFORM_DEFAULT],
      'line-width': ['match', ['get', 'PIAT_shoreforms'], known, 3, 2],
    } })
  const mz = mapboxZoom(MIN_ZOOM.modifications)
  map.addLayer({ id: 'sl-armor', type: 'line', source: 'sl-armor', minzoom: mz, layout: round, paint: { 'line-color': '#8B0000', 'line-width': 3 } })
  // Invisible wide click targets over the thin lines (SSE hitStrokeWeight 14)
  for (const [id, z] of [['fish', fz], ['geology', mapboxZoom(MIN_ZOOM.geology)], ['armor', mz]]) {
    map.addLayer({ id: `sl-${id}-hit`, type: 'line', source: `sl-${id}`, minzoom: z, layout: round, paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 14 } })
  }

  // The habitat layers sit under the fish line (SSE zIndex: herring 1, eelgrass 2, beaches 3–4, fish 4.5)
  const thinHabitat = addFriendsHabitat(map, data.habitat, 'sl-fish-halo')

  // Point structures: the layer's pin at each point, every one shown
  for (const [k, spec] of Object.entries(PINS)) addPinImage(map, `sl-pin-${k}`, spec)
  const pinLayout = (pin, scale) => ({ 'icon-image': `sl-pin-${pin}`, 'icon-size': scale, 'icon-anchor': 'bottom', 'icon-offset': [0, 3],
    'icon-allow-overlap': true, 'icon-ignore-placement': true })
  for (const m of MODIFICATIONS.filter((x) => !x.line)) {
    map.addLayer({ id: `sl-${m.id}`, type: 'symbol', source: `sl-${m.id}`, minzoom: mz, layout: pinLayout(m.pin, m.scale) })
  }

  // Pins on lines (createMidpointMarkers): armor at each segment's middle; fish and shoreform pins a third / two thirds
  // along, repeated every 1.2 km, always thinned on a wider grid, and yielding to every other layer's pins.
  const LINE_PINS = [
    { id: 'armor', layer: 'sl-armor-pins', fc: data.armor, pin: 'armor', scale: 0.85, gate: MIN_ZOOM.modifications },
    { id: 'fish', layer: 'sl-fish-pins', fc: data.fish, pin: 'fish', gate: MIN_ZOOM.fish, yield: true, placement: { along: 0.33, repeatEveryM: 1200 } },
    { id: 'geology', layer: 'sl-geology-pins', fc: data.geology, pin: 'shoreform', gate: MIN_ZOOM.geology, yield: true, placement: { along: 0.67, repeatEveryM: 1200 } },
  ]
  for (const p of LINE_PINS) {
    const pts = pinPoints(p.fc.features, 0, p.placement)
    p.meta = pinMeta(pts)
    map.addSource(p.layer, { type: 'geojson', data: { type: 'FeatureCollection', features: pts } })
    map.addLayer({ id: p.layer, type: 'symbol', source: p.layer, minzoom: mapboxZoom(p.gate), layout: pinLayout(p.pin, p.scale ?? 1) })
  }

  let off = new Set(), mode = DEFAULT_FISH_MODE, lastKey = ''
  const vis = (id, on) => { for (const l of layerIdsOf(id)) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none') }
  // hooks/useLayers: yielding layers choose last, around the pins already chosen (only layers on and past their zoom gate)
  const thin = (force = false) => {
    const z = gzoom(map)
    const habitatChanged = thinHabitat()
    const key = `${Math.round(z * 2) / 2}|${[...off].sort().join(',')}`
    if (!force && !habitatChanged && key === lastKey) return
    lastKey = key
    const avoid = []
    if (!off.has('kelp')) avoid.push(...(thinHabitat.chosen.hkb || []))
    if (!off.has('eelgrass')) avoid.push(...(thinHabitat.chosen.hee || []))
    for (const p of LINE_PINS) {
      const shown = !off.has(p.id) && z >= p.gate
      const wide = 1.6, grid = 0.85 + (wide - 0.85) * Math.min(1, Math.max(0, (z - 12) / 2))   // pinGridScale
      const ids = p.yield ? selectPins(p.meta, z, { alwaysThin: true, gridScale: grid, avoid: [...avoid] }) : selectPins(p.meta, z)
      map.setFilter(p.layer, ids ? ['in', ['get', 'mid'], ['literal', ids]] : null)
      if (shown) { const keep = ids && new Set(ids); avoid.push(...(keep ? p.meta.filter((m) => keep.has(m.mid)) : p.meta).map((m) => m.w)) }
    }
  }
  thin(true)

  return {
    setVisible(offSet) { off = new Set(offSet); for (const id of ALL_IDS) vis(id, !off.has(id)); thin(true) },
    setFishMode(m) {
      mode = m
      map.setPaintProperty('sl-fish', 'line-color', tierMatch(mode, (t) => FISH_TIERS[t].color))
      map.setPaintProperty('sl-fish', 'line-width', width(mode, false))
      map.setPaintProperty('sl-fish-halo', 'line-width', width(mode, true))
    },
    thin,
    /** Outline one parcel (its fid), or none (null). */
    setSelected(fid) {
      const f = ['==', ['get', 'fid'], fid == null ? -1 : Number(fid)]
      for (const id of ['sl-parcels-sel-fill', 'sl-parcels-sel-line']) if (map.getLayer(id)) map.setFilter(id, f)
    },
  }
}

/** deck autoHighlight for parcels and buildings: the one under the pointer brightens. Returns an uninstall function. */
export function installParcelHover(map) {
  const offs = []
  for (const [layer, sourceLayer] of [['sl-parcels-fill', 'parcels'], ['sl-buildings-fill', 'buildings']]) {
    let hovered = null
    const set = (id) => {
      if (hovered === id) return
      if (hovered != null && map.getSource('sl-parcels')) map.setFeatureState({ source: 'sl-parcels', sourceLayer, id: hovered }, { hover: false })
      hovered = id
      if (id != null) map.setFeatureState({ source: 'sl-parcels', sourceLayer, id }, { hover: true })
    }
    const move = (e) => set(e.features?.[0]?.id ?? null)
    const leave = () => set(null)
    map.on('mousemove', layer, move)
    map.on('mouseleave', layer, leave)
    offs.push(() => { map.off('mousemove', layer, move); map.off('mouseleave', layer, leave) })
  }
  return () => offs.forEach((f) => f())
}
