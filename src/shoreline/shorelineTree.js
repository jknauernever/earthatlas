/**
 * /shoreline's left panel as a tree (src/lib/siteContent.js): the code defaults an admin can override — order, names,
 * text, colors, icons, the zoom each layer shows from, removing and restoring, and popup images per dataset.
 * layerConfig() turns the resolved tree into what addShorelineLayers draws with.
 *
 * Node ids are stable keys in the database (content.nav_node): never rename one. `leaf` is the on/off id the URL and
 * the map use (ALL_IDS); `dataset` is the popup layer (src/friends/habitatPopups.js) its images belong to.
 * Zooms are Mapbox zooms (what the panel's "shows from zoom" says).
 */
import { FRIENDS_PAGE } from '../permits/habitat.js'
import { HABITAT_PINS, SSE_STYLE, GZ } from '../friends/habitatOverlay.js'
import { PIN_SPECS, FISH_TIERS, SHOREFORM_GROUPS, SHOREFORM_GROUP_ORDER, MODIFICATIONS, FORAGE, MIN_ZOOM, mapboxZoom } from './shorelineLayers.js'
import { GUIDE_URL } from './shorelineSources.js'

export const SITE = 'shoreline'

// The pin glyphs an admin can choose from (white glyph on a colored disc)
export const GLYPHS = {
  kelp: { label: 'Kelp', spec: HABITAT_PINS.kelp },
  eelgrass: { label: 'Eelgrass', spec: HABITAT_PINS.eelgrass },
  fish: { label: 'Fish', spec: PIN_SPECS.fish },
  shoreform: { label: 'Shoreform layers', spec: PIN_SPECS.shoreform },
  armor: { label: 'Armor (bricks)', spec: PIN_SPECS.armor },
  dock: { label: 'Dock', spec: PIN_SPECS.dock },
  buoy: { label: 'Buoy', spec: PIN_SPECS.buoy },
  ramp: { label: 'Boat ramp', spec: PIN_SPECS.ramp },
  railway: { label: 'Railway', spec: PIN_SPECS.railway },
  groin: { label: 'Groin', spec: PIN_SPECS.groin },
  piling: { label: 'Pilings', spec: PIN_SPECS.piling },
}
/** A pin spec for a node's style ({ glyph, pinColor }). */
export const pinSpecOf = (style) => ({ ...(GLYPHS[style.glyph] || GLYPHS.dock).spec, color: style.pinColor })

const FRIENDS = [FRIENDS_PAGE, 'Friends of the San Juans']
const GUIDE = [GUIDE_URL, 'Living with the Shoreline']
const mz = (g) => mapboxZoom(g)
const habZoom = (h) => Math.max(0, SSE_STYLE[h].minZoom - GZ)

// Which modification uses which pin glyph by default
const MOD_INFO = {
  armor: 'Hard shoreline armor (bulkheads, riprap, seawalls) mapped in the 2019 countywide armor survey.',
  docks: 'Docks and piers from Friends of the San Juans’ Inventory of Shoreline Modifications.',
  buoys: 'Mooring buoys and floats from Friends of the San Juans’ Inventory of Shoreline Modifications.',
  ramps: 'Boat ramps from Friends of the San Juans’ Inventory of Shoreline Modifications.',
  railway: 'Marine railways from Friends of the San Juans’ Inventory of Shoreline Modifications.',
  groins: 'Groins from Friends of the San Juans’ Inventory of Shoreline Modifications.',
  pilings: 'Pilings from Friends of the San Juans’ Inventory of Shoreline Modifications.',
}
const SSE_OF_MOD = { armor: 'friends-armor', docks: 'friends-docks', buoys: 'friends-mooring-buoys', ramps: 'friends-boat-ramps', railway: 'friends-marine-railway', groins: 'friends-groins', pilings: 'friends-pilings' }
const SSE_OF_FORAGE = { herring: 'friends-herring-spawning', fdoc: 'friends-documented-forage-spawning', fpot: 'friends-potential-forage-spawning' }

export const SHORELINE_TREE = [
  { id: 'kelp', leaf: 'kelp', dataset: 'friends-bull-kelp', name: 'Bull Kelp', minZoom: habZoom('hkb'), source: FRIENDS,
    style: { color: '#B89A3A', pinColor: HABITAT_PINS.kelp.color, glyph: 'kelp' },
    info: 'Canopy (floating) kelp mapping by the Washington Department of Natural Resources and Friends of the San Juans. Zoomed in, beds are drawn with the nautical-chart kelp symbol.' },
  { id: 'eelgrass', leaf: 'eelgrass', dataset: 'friends-deepwater-eelgrass', name: 'Deepwater/Edge Eelgrass', minZoom: habZoom('hee'), source: FRIENDS,
    style: { color: '#20B2AA', line: SSE_STYLE.hee.stroke, pinColor: HABITAT_PINS.eelgrass.color, glyph: 'eelgrass' },
    info: 'Friends of the San Juans, Washington DNR and Friday Harbor Labs (countywide eelgrass study).' },
  { id: 'parcels', leaf: 'parcels', name: 'Properties', minZoom: mz(MIN_ZOOM.parcels),
    source: ['https://gis.sanjuancountywa.gov/arcgis/rest/services/OpenData/Parcels/MapServer/1', 'San Juan County GIS'],
    style: { color: '#F97316', line: '#F97316' },
    info: 'Property boundaries from the San Juan County Assessor’s parcel layer.' },
  { id: 'buildings', leaf: 'buildings', dataset: 'building-footprints', name: 'Building Footprints', minZoom: mz(MIN_ZOOM.buildings),
    source: ['https://gis.sanjuancountywa.gov/arcgis/rest/services/Polaris/Buildings/MapServer/3', 'San Juan County GIS'],
    style: { color: '#60A5FA', fill: '#60A5FA' },
    info: 'Building outlines across San Juan County.' },
  { id: 'fish', leaf: 'fish', dataset: 'fish-use', name: 'Priority Shorelines for Fish', minZoom: mz(MIN_ZOOM.fish),
    source: ['https://gis.sanjuancountywa.gov/arcgis/rest/services/Habitat/SRSC_ShorelineFishPresence/MapServer', 'San Juan County map service'],
    style: { color: '#F97316', pinColor: PIN_SPECS.fish.color, glyph: 'fish' },
    info: 'How likely juvenile salmon, forage fish, and greenlings and cods are to be present and abundant along each stretch of shoreline, from 1,350 beach seine sets at 80 sites across the San Juan Islands (high-resolution model). Friends of the San Juans groups the model scores into moderate, high and highest priority, as in the countywide salmon recovery prioritization. Salmon levels are for rearing juveniles. Nothing is ranked low: fish can and do use every shoreline. Beamer & Fresh 2012, Skagit River System Cooperative.',
    children: [1, 2, 3].map((t) => ({ id: `fish/tier-${t}`, kind: 'class', tier: t, name: FISH_TIERS[t].label, style: { line: FISH_TIERS[t].color } })) },
  { id: 'forage', name: 'Forage Fish Spawning', minZoom: mz(MIN_ZOOM.forage), source: FRIENDS,
    style: { color: '#E11D74' },
    info: 'Where forage fish spawn in San Juan County: Pacific herring on eelgrass and algae in sheltered bays (WDFW), and surf smelt and Pacific sand lance on upper-beach sand and gravel (Friends of the San Juans and WDFW surveys). Documented beaches have been surveyed with eggs found; potential habitat is beach substrate suitable for spawning that fronts the shore.',
    children: FORAGE.map((f) => ({
      id: `forage/${f.id}`, kind: 'item', leaf: f.id, h: f.h, dataset: SSE_OF_FORAGE[f.id], name: f.name,
      style: f.id === 'herring' ? { fill: SSE_STYLE.hhe.fill, line: SSE_STYLE.hhe.stroke } : { line: f.color },
    })) },
  { id: 'geology', leaf: 'geology', dataset: 'friends-shoreline-geology', name: 'Shoreline Geology: Shoreforms', minZoom: mz(MIN_ZOOM.geology), source: GUIDE,
    style: { color: '#9A3412', pinColor: PIN_SPECS.shoreform.color, glyph: 'shoreform' },
    info: 'Geomorphic shoreforms: the primary geologic features of the marine shoreline. Coastal processes affect each shore form differently, so each carries different management concerns and priorities. Friends of the San Juans geomorphic shoreform mapping.',
    children: SHOREFORM_GROUP_ORDER.map((g) => ({ id: `geology/${g}`, kind: 'class', group: g, name: SHOREFORM_GROUPS[g].label, style: { line: SHOREFORM_GROUPS[g].color } })) },
  { id: 'mods', name: 'Shoreline Modifications', minZoom: mz(MIN_ZOOM.modifications), source: GUIDE,
    style: { color: '#8B0000' },
    info: 'Hard armor and in- and over-water structures along the shore, from Friends of the San Juans’ Inventory of Shoreline Modifications (2010) and the 2019 countywide armor survey.',
    children: MODIFICATIONS.map((m) => ({
      id: `mods/${m.id}`, kind: 'item', leaf: m.id, dataset: SSE_OF_MOD[m.id], name: m.name, info: MOD_INFO[m.id],
      style: { ...(m.line ? { line: m.line } : {}), pinColor: PIN_SPECS[m.pin].color, glyph: m.pin },
    })) },
]

export const STYLE_LABELS = { color: 'Panel color', line: 'Line color', fill: 'Fill color', pinColor: 'Pin color', glyph: 'Pin icon' }

/**
 * What the map draws with, from the resolved tree (resolveTree). zoom: Mapbox zoom per leaf; removed leaves come back
 * in `removed` so the page keeps them off.
 */
export function layerConfig(tree) {
  const n = (id) => tree.byId[id]
  const zoomOf = (id) => n(id).minZoom
  const st = (id) => n(id).style
  const zoom = {}
  for (const id of ['kelp', 'eelgrass', 'parcels', 'buildings', 'fish', 'geology']) zoom[id] = zoomOf(id)
  for (const f of FORAGE) zoom[f.id] = zoomOf(`forage/${f.id}`)
  for (const m of MODIFICATIONS) zoom[m.id] = zoomOf(`mods/${m.id}`)
  const visibleLeaves = new Set()
  const walk = (list) => { for (const x of list) { if (x.leaf && x.kind !== 'class' && !(x.children || []).some((c) => c.kind === 'item')) visibleLeaves.add(x.leaf); if (x.children) walk(x.children) } }
  walk(tree.roots)
  const allLeaves = ['kelp', 'eelgrass', 'parcels', 'buildings', 'fish', ...FORAGE.map((f) => f.id), 'geology', ...MODIFICATIONS.map((m) => m.id)]
  return {
    zoom,
    removed: allLeaves.filter((l) => !visibleLeaves.has(l)),
    // Legend order (the chooser's), from the panel order
    order: tree.roots.flatMap((r) => (r.children?.some((c) => c.kind === 'item') ? r.children.map((c) => c.leaf) : [r.leaf])).filter(Boolean),
    parcels: st('parcels').line,
    buildings: st('buildings').fill,
    eelgrassLine: st('eelgrass').line,
    habitatPins: { kelp: pinSpecOf(st('kelp')), eelgrass: pinSpecOf(st('eelgrass')) },
    habitatStyles: {
      hee: { stroke: st('eelgrass').line },
      hhe: { fill: st('forage/herring').fill, stroke: st('forage/herring').line },
      hfd: { stroke: st('forage/fdoc').line },
      hfp: { stroke: st('forage/fpot').line },
    },
    fishTiers: Object.fromEntries([1, 2, 3].map((t) => [t, st(`fish/tier-${t}`).line])),
    shoreform: Object.fromEntries(SHOREFORM_GROUP_ORDER.map((g) => [g, st(`geology/${g}`).line])),
    armorLine: st('mods/armor').line,
    pins: {
      fish: pinSpecOf(st('fish')), shoreform: pinSpecOf(st('geology')),
      ...Object.fromEntries(MODIFICATIONS.map((m) => [m.pin, pinSpecOf(st(`mods/${m.id}`))])),
    },
  }
}
