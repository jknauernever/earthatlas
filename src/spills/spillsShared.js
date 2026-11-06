import { nationalDataset } from '../lib/national/catalog.js'
// /spills shared constants: data files, ESI colours, location-precision classes, source links.

// Bump with scripts/bake-spills/analyze.py VERSION on every re-bake (browsers keep the files).
export const DATA_URL = '/spills-data/lm-spills-v2.json'
export const ESI_URL = '/spills-data/esi-shoreline-v2.geojson'
export const PROTECTED_URL = '/spills-data/protected-v2.geojson'
// U.S. pipeline accidents (scripts/bake-spills/phmsa.py): the map layer, and each year's full records for the card.
export const PIPE_URL = '/spills-data/pipeline-v1.json'
let pipeDetailBase = '/spills-data/pipeline-v1/'
export const pipeDetailUrl = (year) => `${pipeDetailBase}${year}.json`
// Gas pipeline incidents (PHMSA gas forms), the same way.
export const GAS_URL = '/spills-data/gas-v1.json'
let gasDetailBase = '/spills-data/gas-v1/'
export const gasDetailUrl = (year) => `${gasDetailBase}${year}.json`
export const GAS_COLOR = '#c084fc'
export const GAS_SYSTEM = { transmission: 'Gas transmission or gathering line', distribution: 'Gas distribution line (to homes and businesses)', lng: 'Liquefied natural gas (LNG) facility' }
// PHMSA gives gas volumes in thousand standard cubic feet (MCF): "3.4 million cubic feet"
export function mcfText(mcf) {
  if (mcf == null) return 'not given'
  if (mcf === 0) return 'none reported'
  const cf = mcf * 1000
  if (cf >= 1e9) return `${(cf / 1e9).toFixed(1)} billion cubic feet`
  if (cf >= 1e6) return `${(cf / 1e6).toFixed(1)} million cubic feet`
  return `${Math.round(cf).toLocaleString('en-US')} cubic feet`
}

// In production the data comes from the latest weekly bake (scripts/bake-spills/weekly.sh → upload.mjs), named by
// spills/manifest.json on Vercel Blob, so new reports go live without a deploy. The files bundled with the site are
// the fallback, and what localhost uses (so a local re-bake shows at once).
const SPILLS_MANIFEST = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/spills/manifest.json'
export async function loadSpillsFiles() {
  const files = await loadSpillsOwnFiles()
  // Pipeline and gas accidents are the national dataset `phmsa` (docs/NATIONAL_DATA.md), found through its catalog
  // (local builds on localhost); the /spills manifest's own copies are the fallback.
  const phmsa = await nationalDataset('phmsa')
  if (phmsa?.files?.['pipeline.json']) {
    files.pipe = phmsa.files['pipeline.json']
    if (phmsa.files['gas.json']) files.gas = phmsa.files['gas.json']
    pipeDetailBase = `${phmsa.base}pipeline/`
    gasDetailBase = `${phmsa.base}gas/`
  }
  return files
}

async function loadSpillsOwnFiles() {
  const local = { lm: DATA_URL, esi: ESI_URL, protected: PROTECTED_URL, pipe: PIPE_URL, gas: GAS_URL,
    regions: '/spills-data/regions-v2.json', stateDir: '/spills-data/state-v2/', statePaDir: '/spills-data/state-pa-v2/' }
  if (!import.meta.env.PROD) return local
  try {
    const m = await fetch(SPILLS_MANIFEST, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json() })
    if (!m.files?.lm) throw new Error('manifest incomplete')
    if (m.pipeDetail) pipeDetailBase = m.pipeDetail
    if (m.gasDetail) gasDetailBase = m.gasDetail
    return { ...m.files, stateDir: m.stateDir, statePaDir: m.statePaDir }
  } catch {
    return local
  }
}
export const PHMSA_HOME = 'https://www.phmsa.dot.gov/data-and-statistics/pipeline/distribution-transmission-gathering-lng-and-liquid-accident-and-incident-data'
export const PIPE_COLOR = '#ff8a1f'
export const COMMODITY_PLAIN = {
  crude: 'Crude oil', refined: 'Gasoline, diesel or other fuel', hvl: 'Propane, butane or other gas liquids',
  co2: 'Carbon dioxide', bio: 'Ethanol or other biofuel', other: 'Other',
}
const GAL_PER_BBL = 42
// "33,000 barrels (1.4 million gallons)"
export function bblText(bbl) {
  if (bbl == null) return 'not given'
  const gal = bbl * GAL_PER_BBL
  const g = gal >= 1e6 ? `${(gal / 1e6).toFixed(1)} million gallons` : `${Math.round(gal).toLocaleString('en-US')} gallons`
  return `${(Math.round(bbl * 10) / 10).toLocaleString('en-US')} barrel${bbl === 1 ? '' : 's'} (${g})`
}

export const NRC_HOME = 'https://nrc.uscg.mil/'
export const ESI_HOME = 'https://response.restoration.noaa.gov/esi_download'
export const ESI_GDB = 'https://response.restoration.noaa.gov/sites/default/files/esimaps/gisdata/Lake_Michigan_ESI_2025_GDB.zip'
export const ESI_GUIDE = 'https://response.restoration.noaa.gov/sites/default/files/ESI_Guidelines.pdf'
export const CENSUS_GEOCODER = 'https://geocoding.geo.census.gov/geocoder/'
export const CENSUS_GAZ = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html'
export const WBD = 'https://www.usgs.gov/national-hydrography/watershed-boundary-dataset'
export const PADUS_HOME = 'https://www.usgs.gov/programs/gap-analysis-project/science/protected-areas'
export const PADUS_DATA = 'https://www.sciencebase.gov/catalog/item/6759abcfd34edfeb8710a004'

// Protected areas (USGS PAD-US 4.1): one clear green on the map; the GAP status (how strongly each is protected for
// nature) is told in words in the hover readout and the card.
export const PA_COLOR = '#39e75f'
export const GAP = {
  1: { label: 'Protected for nature, left wild' },
  2: { label: 'Protected for nature' },
  3: { label: 'Protected, other uses allowed (such as logging or hunting)' },
  4: { label: 'Public land not set aside for nature (most city parks)' },
}
export const gapOf = (a) => GAP[a.gap] || GAP[4]
export const MANAGER = { FED: 'Federal', STAT: 'State', LOC: 'Local', DIST: 'Regional district', NGO: 'Nonprofit', TRIB: 'Tribal',
  PVT: 'Private', JNT: 'Jointly managed', UNK: 'Manager unknown', TERR: 'Territorial', DESG: 'Designation' }
export const ACCESS = { OA: 'Open to the public', RA: 'Open to the public with limits', XA: 'Closed to the public', UK: 'Public access not known' }

// NOAA's own ESI shoreline colours, read from the atlas's ArcGIS project (Lake_Michigan_ESI_2025.aprx, layer ESIL,
// CMYK converted to RGB). Keyed by class code; a line with several classes is coloured by its most sensitive one.
export const ESI_COLORS = {
  '1A': '#620dde', '1B': '#620dde', '2A': '#9e8fff', '2B': '#9e8fff', '3A': '#0059d9', '3B': '#0059d9', '4': '#2ebaff',
  '5': '#00e6a8', '6A': '#008c78', '6B': '#38a800', '6D': '#38a800', '7': '#bfbf00', '8A': '#ffff00', '8B': '#ffd430',
  '8C': '#ffd430', '8D': '#ffd430', '8E': '#ffd430', '8F': '#ffd430', '9A': '#fc9403', '9B': '#fc9403', '9C': '#fc9403',
  '10A': '#ff0000', '10B': '#ff80ff', '10C': '#cc1a33', '10D': '#730000', '10F': '#730000',
}
export const esiColor = (code) => ESI_COLORS[code] || '#9ca3af'
export const esiNumber = (code) => parseInt(code, 10)

// Where each report's map location came from (analyze.py `loc`), best first, grouped into three map styles.
export const PRECISION = [
  { id: 'coords', group: 'exact', label: 'Coordinates in the report', short: 'report coordinates' },
  { id: 'text', group: 'exact', label: 'Coordinates written in the report text', short: 'coordinates in report text' },
  { id: 'address', group: 'near', label: 'Street address in the report', short: 'street address' },
  { id: 'place', group: 'near', label: 'Named marina, harbor or site in the report', short: 'named site' },
  { id: 'offset', group: 'near', label: 'Distance and direction from a city', short: 'distance from a city' },
  { id: 'city', group: 'city', label: 'Nearest city only', short: 'nearest city only' },
]
export const PRECISION_BY_ID = Object.fromEntries(PRECISION.map((p) => [p.id, p]))
export const PRECISION_GROUPS = [
  { id: 'exact', label: 'Reported coordinates', ids: ['coords', 'text'] },
  { id: 'near', label: 'Street address, named site or distance from a city', ids: ['address', 'place', 'offset'] },
  { id: 'city', label: 'Nearest city only', ids: ['city'] },
]

// The map location's own source, for the inline link beside it.
export function locationSource(p) {
  if (p.hu || p.hs) return { label: p.hs || 'source', href: p.hu || 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html', title: p.how }   // a named place (states.py)
  if (p.loc === 'coords' || p.loc === 'text') return { label: 'NRC report', href: NRC_HOME, title: `Coordinates given in National Response Center report ${p.seq}` }
  if (p.loc === 'address') return { label: 'Census Geocoder', href: CENSUS_GEOCODER, title: 'U.S. Census Bureau Geocoder, benchmark Public_AR_Current' }
  if (p.loc === 'place') return { label: 'NOAA ESI', href: ESI_HOME, title: 'Named site in the NOAA Lake Michigan ESI 2025 (socio-economic and navigation points)' }
  return { label: 'Census places', href: CENSUS_GAZ, title: 'U.S. Census Bureau 2024 Gazetteer, places (internal point)' }
}

export const STATUS_WORD = { E: 'Endangered', T: 'Threatened' }
export const STATE_NAMES = { IL: 'Illinois', IN: 'Indiana', MI: 'Michigan', WI: 'Wisconsin' }
export const isListed = (sp) => !!sp.fed || !!sp.sara || Object.keys(sp.st || {}).length > 0

export const fmtInt = (n) => (n == null ? '—' : n.toLocaleString('en-US'))
export function fmtDate(d) {
  if (!d) return ''
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return d
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const titleCase = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase())

// Plain-language shoreline classes (6th-grade reading level): what the shore is, and what oil does there. Written from
// NOAA's ESI Guidelines class descriptions; the card and legend show NOAA's own term beside it.
export const ESI_PLAIN = {
  '1A': ['Bare rock in open water', 'Big waves hit this rock and wash oil off quickly.'],
  '1B': ['Seawall in open water', 'Concrete walls and piers facing open water. Waves wash oil off quickly.'],
  '2A': ['Flat rock ledges', 'Flat rock at the water’s edge. Waves clean most oil off in days to weeks.'],
  '2B': ['Flat rock ledges', 'Flat rock at the water’s edge. Waves clean most oil off in days to weeks.'],
  '3A': ['Fine sand beach', 'Hard-packed sand. Oil stays near the top, so it is easier to clean.'],
  '3B': ['Crumbling sand or dirt cliff', 'Steep banks that waves are wearing away. Oil can coat the bank.'],
  '4': ['Sand beach', 'Loose sand. Oil can sink into the sand and get buried.'],
  '5': ['Sand-and-pebble beach', 'Sand mixed with pebbles. Oil sinks in deeper and is harder to clean.'],
  '6A': ['Pebble or stone beach', 'Oil sinks deep between the stones and can stay there for years.'],
  '6B': ['Rock pile (riprap)', 'Big rocks piled up to protect the shore. Oil gets trapped between the rocks.'],
  '6D': ['Rock pile (riprap)', 'Big rocks piled up to protect the shore. Oil gets trapped between the rocks.'],
  '7': ['Open mud or sand flat', 'Flat, wet ground at the water’s edge. Animals that live in the mud are harmed.'],
  '8A': ['Rock or clay bank in calm water', 'Calm water means few waves to wash oil away, so it stays.'],
  '8B': ['Wall or dock in a calm harbor', 'Oil sticks to walls and docks in calm water and stays.'],
  '8C': ['Rock pile in calm water', 'Oil gets stuck between rocks where waves can’t reach it.'],
  '8D': ['Rocky rubble in calm water', 'Oil gets stuck between rocks where waves can’t reach it.'],
  '8E': ['Peat shore', 'Soft, spongy plant soil. It soaks up oil.'],
  '8F': ['Steep plant-covered bank', 'Plants and soil on a steep bank in calm water soak up oil.'],
  '9A': ['Mud or sand flat in calm water', 'Oil soaks into the mud and is very hard to remove.'],
  '9B': ['Low grassy or brushy bank', 'Oil soaks into plants and soil along calm rivers and bays.'],
  '9C': ['Low grassy or brushy bank', 'Oil soaks into plants and soil along calm rivers and bays.'],
  '10A': ['Marsh', 'Wet, grassy land full of wildlife. Oil can kill plants and animals and last for years.'],
  '10B': ['Marsh', 'Wet, grassy land full of wildlife. Oil can kill plants and animals and last for years.'],
  '10C': ['Swamp', 'Wet woods. Oil is very hard to clean out and harms wildlife for years.'],
  '10D': ['Bushy wetland', 'Wetland with bushes and small trees. Oil harms wildlife and lasts for years.'],
  '10F': ['Wetland', 'Wet land full of plants and animals. Oil harms wildlife and lasts for years.'],
}
// How easily oil harms a shoreline, in words, by its class number (1–10).
export function esiLevel(code) {
  const n = esiNumber(code)
  if (n >= 9) return 'Most easily harmed'
  if (n >= 7) return 'Easily harmed'
  if (n >= 4) return 'Somewhat easily harmed'
  return 'Least easily harmed'
}
export const esiShort = (code) => ESI_PLAIN[code]?.[0] || `Shoreline class ${code}`
export const esiSentence = (code) => ESI_PLAIN[code]?.[1] || ''

// What could be harmed near a report (or a set of reports): listed species first (federal, then state), then the count
// of other mapped resources. `ids` are indexes into data.species.
export function nearbyHighlights(ids, species) {
  const all = [...new Set(ids)].map((i) => species[i])
  const rank = (sp) => (sp.fed === 'E' || sp.sara === 'E' ? 0 : sp.fed || sp.sara ? 1 : Object.values(sp.st || {}).includes('E') ? 2 : 3)
  const listed = all.filter(isListed).sort((a, b) => rank(a) - rank(b) || a.n.localeCompare(b.n))
  const seen = new Set()
  const names = listed.filter((sp) => (seen.has(sp.n) ? false : seen.add(sp.n)))
  return { listed: names, other: all.filter((sp) => !isListed(sp)).length, total: all.length }
}
// Listing status in plain words: "Listed as endangered in IL", "Listed as threatened in the U.S.".
const listedIn = (code, places) => `${(STATUS_WORD[code] || code).toLowerCase()} in ${places.join(' and ')}`
export function statusShort(sp, home) {
  if (sp.fed) return `Listed as ${listedIn(sp.fed, ['the U.S.'])}`
  if (sp.sara) return `Listed as ${listedIn(sp.sara, ['Canada'])}`
  // the report's own state first, then an Endangered listing in another state
  const [st, code] = (home && sp.st[home] ? [home, sp.st[home]] : Object.entries(sp.st).sort((a, b) => (a[1] === 'E' ? -1 : 1))[0]) || []
  return st ? `Listed as ${listedIn(code, [st])}` : ''
}
// Every listing, grouped by status: "Listed as endangered in the U.S. and IL; threatened in WI".
export function statusFull(sp) {
  const by = {}
  if (sp.fed) (by[sp.fed] ||= []).push('the U.S.')
  if (sp.sara) (by[sp.sara] ||= []).push('Canada')
  for (const [st, code] of Object.entries(sp.st || {}).sort()) (by[code] ||= []).push(st)
  const parts = Object.keys(by).sort((a, b) => (a === 'E' ? -1 : b === 'E' ? 1 : 0)).map((c) => listedIn(c, by[c]))
  return parts.length ? `Listed as ${parts.join('; ')}` : ''
}
// The species' EarthAtlas page (src/species/SpeciesDetailPage.jsx: /species/<iNaturalist id>-<slug>), always on
// earthatlas.org. `tx`/`txn` are the iNaturalist id and name matched to the ESI scientific name in the bake (inat.py).
const slug = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
export const speciesHref = (sp) => (sp.tx ? `https://earthatlas.org/species/${sp.tx}-${slug(sp.txn)}` : null)

// ─── Regions: Lake Michigan (the full bake, with NOAA ESI) or one state (scripts/bake-spills/national.py) ──────────
// A state's file is given the Lake Michigan file's shape, so the map, cards and report read either. States have no
// ESI shoreline or ESI species yet; every region has critical habitat (`ch` on points, `ch_species`).
export const REGION_LM = { id: 'lm', name: 'Lake Michigan' }
export const FWS_CH = 'https://ecos.fws.gov/ecp/report/table/critical-habitat.html'
export const NMFS_CH = 'https://www.fisheries.noaa.gov/resource/map/national-esa-critical-habitat-mapper'
const jsonCache = new Map()
const getJson = (u) => {
  if (!jsonCache.has(u)) jsonCache.set(u, fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json() }))
  return jsonCache.get(u)
}
export const loadRegionList = (files) => (files.regions ? getJson(files.regions).catch(() => null) : Promise.resolve(null))
export async function loadRegion(files, region) {
  if (!region || region === 'lm' || !files.stateDir) {
    const [d, reg] = await Promise.all([getJson(files.lm), loadRegionList(files)])
    return { ...d, region: 'lm', name: REGION_LM.name, ch_species: d.ch_species || reg?.ch_species || [] }
  }
  const [d, reg] = await Promise.all([getJson(`${files.stateDir}${region}.json`), loadRegionList(files)])
  const ys = d.points.map((p) => p.y)
  return {
    region, name: d.name, summary: { years: [Math.min(...ys), Math.max(...ys)] },
    species: [], areas: d.areas || [], hotspots: [], esi_names: {}, pipes: {}, points: d.points, ch_species: reg?.ch_species || [],
  }
}

// Critical habitat near a report: [{ sp, m }] with the species record (n, sci, fed, src, url) and meters away.
export const critNear = (p, chSpecies) => (p.ch || []).map(([i, m]) => ({ sp: chSpecies[i], m })).filter((x) => x.sp)
// Canadian critical habitat (Fisheries and Oceans Canada, Species at Risk Act) carries `sara` instead of `fed`.
export const DFO_SRC = 'Fisheries and Oceans Canada'
export const chStatus = (sp) => (sp.sara ? `Listed as ${STATUS_WORD[sp.sara].toLowerCase()} in Canada`
  : sp.fed ? `Listed as ${STATUS_WORD[sp.fed].toLowerCase()} in the U.S.` : sp.src === DFO_SRC ? 'Listed in Canada' : 'Listed in the U.S.')
export const chSrcShort = (sp) => (sp.src === 'NOAA Fisheries' ? 'NOAA' : sp.src === DFO_SRC ? 'DFO Canada' : 'FWS')
