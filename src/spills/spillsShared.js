// /spills shared constants: data files, ESI colours, location-precision classes, source links.

// Bump with scripts/bake-spills/analyze.py VERSION on every re-bake (browsers keep the files).
export const DATA_URL = '/spills-data/lm-spills-v1.json'
export const ESI_URL = '/spills-data/esi-shoreline-v1.geojson'
export const SCOPE_URL = '/spills-data/lm-scope-v1.geojson'

export const NRC_HOME = 'https://nrc.uscg.mil/'
export const nrcFile = (year) => `https://nrc.uscg.mil/FOIAFiles/CY${String(year).slice(2)}.xlsx`
export const ESI_HOME = 'https://response.restoration.noaa.gov/esi_download'
export const ESI_GDB = 'https://response.restoration.noaa.gov/sites/default/files/esimaps/gisdata/Lake_Michigan_ESI_2025_GDB.zip'
export const ESI_GUIDE = 'https://response.restoration.noaa.gov/sites/default/files/ESI_Guidelines.pdf'
export const CENSUS_GEOCODER = 'https://geocoding.geo.census.gov/geocoder/'
export const CENSUS_GAZ = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html'
export const WBD = 'https://www.usgs.gov/national-hydrography/watershed-boundary-dataset'

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
  if (p.loc === 'coords' || p.loc === 'text') return { label: 'NRC report', href: nrcFile(p.y), title: `NRC FOIA file CY${String(p.y).slice(2)}.xlsx, report ${p.seq}` }
  if (p.loc === 'address') return { label: 'Census Geocoder', href: CENSUS_GEOCODER, title: 'U.S. Census Bureau Geocoder, benchmark Public_AR_Current' }
  if (p.loc === 'place') return { label: 'NOAA ESI', href: ESI_HOME, title: 'Named site in the NOAA Lake Michigan ESI 2025 (socio-economic and navigation points)' }
  return { label: 'Census places', href: CENSUS_GAZ, title: 'U.S. Census Bureau 2024 Gazetteer, places (internal point)' }
}

export const STATUS_WORD = { E: 'Endangered', T: 'Threatened' }
export const STATE_NAMES = { IL: 'Illinois', IN: 'Indiana', MI: 'Michigan', WI: 'Wisconsin' }
export const isListed = (sp) => !!sp.fed || Object.keys(sp.st).length > 0

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
  const rank = (sp) => (sp.fed === 'E' ? 0 : sp.fed ? 1 : Object.values(sp.st).includes('E') ? 2 : 3)
  const listed = all.filter(isListed).sort((a, b) => rank(a) - rank(b) || a.n.localeCompare(b.n))
  const seen = new Set()
  const names = listed.filter((sp) => (seen.has(sp.n) ? false : seen.add(sp.n)))
  return { listed: names, other: all.filter((sp) => !isListed(sp)).length, total: all.length }
}
export function statusShort(sp, home) {
  if (sp.fed) return `Federal ${STATUS_WORD[sp.fed] || sp.fed}`
  // the report's own state first, then an Endangered listing in another state
  const [st, code] = (home && sp.st[home] ? [home, sp.st[home]] : Object.entries(sp.st).sort((a, b) => (a[1] === 'E' ? -1 : 1))[0]) || []
  return st ? `${STATE_NAMES[st] || st} ${STATUS_WORD[code] || code}` : ''
}
export const spName = (sp) => (sp.masked ? `“${sp.n}” (species not named)` : sp.n)
