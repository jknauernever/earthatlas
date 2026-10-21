// Shared bits for /species-of-concern: status colors, agency-layer colors, wording.
import { KM_PER_MILE } from '../lib/speciesOfConcern.js'
import { NOT_CONFIRMED, BLURRED_ONLY } from '../../lib/speciesOfConcern/statusOrder.js'

// Most protective first: red → orange → amber → yellow → green → cyan → blue → violet → slate.
export const GROUP_COLORS = {
  Endangered: '#ef4444', Threatened: '#f97316', 'Proposed Endangered': '#f59e0b', 'Proposed Threatened': '#f59e0b',
  Sensitive: '#eab308', Candidate: '#84cc16', 'Experimental Population, Non-Essential': '#22d3ee', 'Under Review': '#22d3ee',
  'Possibly extirpated': '#94a3b8', 'Species of Concern': '#38bdf8', 'Species of Greatest Conservation Need': '#a78bfa',
  'Priority species': '#cbd5e1', [BLURRED_ONLY]: '#94a3b8', [NOT_CONFIRMED]: '#64748b',
}
export const colorOf = (g) => GROUP_COLORS[g] || '#cbd5e1'

// The legend: one line per color actually used for dots (statuses sharing a color share a line).
export const DOT_LEGEND = [
  ['Endangered', ['Endangered']],
  ['Threatened', ['Threatened']],
  ['Proposed for federal listing', ['Proposed Endangered', 'Proposed Threatened']],
  ['Sensitive (WA)', ['Sensitive']],
  ['Candidate (WA or federal)', ['Candidate']],
  ['Federal species of concern', ['Species of Concern']],
  ['WA Greatest Conservation Need', ['Species of Greatest Conservation Need']],
  ['WA priority species only', ['Priority species']],
  ['Listed population not confirmed', [NOT_CONFIRMED]],
]

// Agency map layers.
// Chosen to stand out from satellite imagery: no greens (forest, fields) or blues (water).
export const REG_COLORS = { 'critical-habitat': '#f472b6', 'phs-species': '#facc15', 'phs-habitat': '#fb923c' }

export const LIST_SHORT = { 'wa-state': 'WA', 'us-federal': 'Federal', 'wa-plants': 'WA rare plant', 'wa-sgcn': 'WA SGCN', 'wa-phs': 'WA priority' }
export function shortStatus(s) {
  if (s.list === 'wa-sgcn') return 'WA Greatest Conservation Need'
  if (s.list === 'wa-phs') return 'WA priority species'
  if (s.list === 'us-federal' && s.status === 'Species of Concern') return 'Federal species of concern'
  return `${LIST_SHORT[s.list] || s.list_label} ${s.status.toLowerCase()}${s.confirmed_population ? ` (${s.confirmed_population})` : ''}`
}

export const SOURCE_NAMES = { inaturalist: 'iNaturalist', gbif: 'GBIF', ebird: 'eBird', maplify: 'Whale Alert', happywhale: 'Happywhale', salishsea: 'SalishSea.io', obis: 'OBIS', orcasound: 'Orcasound' }
export const fmtDate = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'date unknown')
export const fmtKm = (km, unit) => (km == null ? null : unit === 'mi' ? `${(km / KM_PER_MILE).toFixed(1)} mi` : `${km.toFixed(1)} km`)
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// The EarthAtlas species page (src/species/SpeciesDetailPage.jsx: /species/<iNaturalist id>-<slug>).
const slug = (name) => name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || ''
export const speciesPage = (inatId, sci) => (inatId ? `/species/${inatId}${sci ? `-${slug(sci)}` : ''}` : null)
