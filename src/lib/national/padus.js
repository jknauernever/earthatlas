// National dataset `padus` (docs/NATIONAL_DATA.md): USGS PAD-US 4.1, every protected area in the U.S., as map tiles
// (api/national-tiles?d=padus) with plain-language labels. For any subsite: add `padusSource` and the layers from
// `padusLayers`, read a clicked feature with `padusArea`, and credit it with PADUS_SOURCE.
import { nationalDataset, nationalTilesUrl } from './catalog.js'

export const PADUS_SOURCE = {
  name: 'Protected Areas Database of the United States (PAD-US) 4.1',
  publisher: 'U.S. Geological Survey, Gap Analysis Project',
  href: 'https://www.usgs.gov/programs/gap-analysis-project/science/protected-areas',
  doi: 'https://doi.org/10.5066/P96WBCHS',
}
export const PADUS_COLOR = '#39e75f'

// GAP status: how strongly an area is managed for nature, in plain words.
export const GAP = {
  1: { label: 'Protected for nature, left wild' },
  2: { label: 'Protected for nature' },
  3: { label: 'Protected, other uses allowed (such as logging or hunting)' },
  4: { label: 'Public land not set aside for nature (most city parks)' },
}
export const MANAGER = { FED: 'Federal', STAT: 'State', LOC: 'Local', DIST: 'Regional district', NGO: 'Nonprofit', TRIB: 'Tribal',
  PVT: 'Private', JNT: 'Jointly managed', UNK: 'Manager unknown', TERR: 'Territorial', DESG: 'Designation' }
// Agencies PAD-US names by code (Mang_Name), for the ones that show up as bare codes.
export const AGENCY = { BLM: 'Bureau of Land Management', USFS: 'U.S. Forest Service', NPS: 'National Park Service', FWS: 'U.S. Fish and Wildlife Service',
  USBR: 'Bureau of Reclamation', DOD: 'Department of Defense', USACE: 'U.S. Army Corps of Engineers', NOAA: 'NOAA', BOEM: 'Bureau of Ocean Energy Management', TVA: 'Tennessee Valley Authority',
  NRCS: 'Natural Resources Conservation Service', BIA: 'Bureau of Indian Affairs', DOE: 'Department of Energy', ARS: 'Agricultural Research Service',
  SFW: 'State fish and wildlife agency', SPR: 'State parks agency', SDNR: 'State natural resources department', SLB: 'State land board',
  SDOL: 'State lands department', SDC: 'State conservation agency' }
export const ACCESS = { OA: 'Open to the public', RA: 'Open to the public with limits', XA: 'Closed to the public', UK: 'Public access not known' }
// PAD-US designation types (Des_Tp), as USGS names them.
export const DESIGNATION = {"NP": "National Park", "NM": "National Monument", "NCA": "Conservation Area", "NF": "National Forest", "NG": "National Grassland", "PUB": "National Public Lands", "NT": "National Scenic or Historic Trail", "NWR": "National Wildlife Refuge", "WA": "Wilderness Area", "WSR": "Wild and Scenic River", "WSA": "Wilderness Study Area", "MPA": "Marine Protected Area", "NRA": "National Recreation Area", "NSBV": "National Scenic, Botanical or Volcanic Area", "NLS": "National Lakeshore or Seashore", "IRA": "Inventoried Roadless Area", "ACEC": "Area of Critical Environmental Concern", "RNA": "Research Natural Area", "REC": "Recreation Management Area", "RMA": "Resource Management Area", "WPA": "Watershed Protection Area", "REA": "Research or Educational Area", "HCA": "Historic or Cultural Area", "MIT": "Mitigation Land or Bank", "MIL": "Military Land", "ACC": "Access Area", "SDA": "Special Designation Area", "PROC": "Approved or Proclamation Boundary", "FOTH": "Federal Other or Unknown", "ND": "Not Designated", "TRIBL": "Native American Land Area", "SP": "State Park", "SW": "State Wilderness", "SCA": "State Conservation Area", "SREC": "State Recreation Area", "SHCA": "State Historic or Cultural Area", "SRMA": "State Resource Management Area", "SOTH": "State Other or Unknown", "LP": "Local Park", "LCA": "Local Conservation Area", "LREC": "Local Recreation Area", "LHCA": "Local Historic or Cultural Area", "LRMA": "Local Resource Management Area", "LOTH": "Local Other or Unknown", "PCON": "Private Conservation", "PPRK": "Private Park", "PREC": "Private Recreation or Education", "PHCA": "Private Historic or Cultural", "PAGR": "Private Agricultural", "PRAN": "Private Ranch", "PFOR": "Private Forest Stewardship", "POTH": "Private Other or Unknown", "CONE": "Conservation Easement", "RECE": "Recreation or Education Easement", "HCAE": "Historic or Cultural Easement", "AGRE": "Agricultural Easement", "RANE": "Ranch Easement", "FORE": "Forest Stewardship Easement", "OTHE": "Other Easement", "UNKE": "Unknown Easement", "UNK": "Unknown", "OCS": "Outer Continental Shelf Area", "FACY": "Facility"}

/** The current PAD-US version and a Mapbox vector source for it, or null when it isn't published (or built locally). */
export async function padusSource() {
  const d = await nationalDataset('padus')
  return d ? { version: d.version, source: { type: 'vector', tiles: [nationalTilesUrl('padus', d.version)], minzoom: 0, maxzoom: 13, attribution: 'USGS PAD-US 4.1' } } : null
}

// Not drawn: Outer Continental Shelf areas (offshore leasing zones, not protected land).
export const PADUS_FILTER = ['!=', ['get', 'Des_Tp'], 'OCS']

// PAD-US stacks designations (wilderness study areas, roadless areas, scenic rivers…) on top of the land they sit on,
// so filling both doubles the green. Designations are drawn as outlines only; ownership, easements and marine areas fill.
export const PADUS_FILL_OPACITY = ['case', ['==', ['get', 'FeatClass'], 'Designation'], 0, 0.22]
// Outlines only up close: none below z8 (fills alone read cleanly at state scale), designations' from z10.
export const PADUS_LINE_OPACITY = ['step', ['zoom'], 0, 8, ['case', ['==', ['get', 'FeatClass'], 'Designation'], 0, 0.95], 10, 0.95]

/** Fill + outline layers for the `padus` source layer (one clear green; protection level is told in words, not color). */
export function padusLayers(sourceId, prefix = 'padus') {
  return [
    { id: `${prefix}-fill`, type: 'fill', source: sourceId, 'source-layer': 'padus', filter: PADUS_FILTER, paint: { 'fill-color': PADUS_COLOR, 'fill-opacity': PADUS_FILL_OPACITY } },
    { id: `${prefix}-line`, type: 'line', source: sourceId, 'source-layer': 'padus', filter: PADUS_FILTER,
      paint: { 'line-color': PADUS_COLOR, 'line-opacity': PADUS_LINE_OPACITY, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 9, 1, 12, 2] } },
  ]
}

/** A clicked `padus` tile feature in the plain-language shape cards use (same keys as the /spills bake's areas). */
export function padusArea(props) {
  const p = props || {}
  return {
    id: p.id, n: (p.Unit_Nm || '').trim(), agency: AGENCY[p.Mang_Name] || '', fc: p.FeatClass || '', mt: p.Mang_Type || 'UNK',
    mn: p.Mang_Name || '', lm: (p.Loc_Mang || '').trim(), d: DESIGNATION[p.Des_Tp] || p.Des_Tp || '', ld: (p.Loc_Ds || '').trim(),
    gap: p.GAP_Sts, acc: p.Pub_Access || 'UK', ac: Number(p.GIS_Acres) || 0, st: p.State_Nm || '',
  }
}

// Names PAD-US uses when a record has none (measured on PAD-US 4.1: "Unknown", "Unknown or Unnamed", "Data not
// available", "Na", "Easement #0"…), and record codes from old contributor files ("Pcon3", "Loth230", "04-63-0222").
const PLACEHOLDER = /^(unknown\b.*|unnamed\b.*|data not available|n\/?a|none|null|tbd|no name|easement #?\d+)$/i
const CODE = /^[\w#-]*\d[\w#-]*$/
// Program acronyms PAD-US gives as the whole name.
const PROGRAM = { PDR: 'Purchase of development rights easement', TDR: 'Transfer of development rights easement',
  WRP: 'Wetlands Reserve Program easement', FRPP: 'Farm and Ranch Lands Protection Program easement' }
const OFFICE = /\b(field|district|regional|area|forestry)?\s*office$/i
const SMALL = new Set(['of', 'and', 'the', 'for', 'at', 'in', 'on'])
const tidy = (v) => (v === v.toUpperCase() ? v.toLowerCase().replace(/\b[a-z]+/g, (w, k) => (k && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1))) : v)
const holderOf = (v) => (v && !/^unknown$/i.test(v) && !CODE.test(v) && !/^[A-Z]{2,6}$/.test(v) ? tidy(v) : '')

/** The area's kind without PAD-US's "Unknown" prefix: "Unknown Easement" → "Easement", "Unknown" → "". */
export const padusKind = (a) => (/^unknown$/i.test(a.d || '') ? '' : (a.d || '').replace(/^unknown\s+/i, ''))

/**
 * What to call an area (a padusArea, or a /spills bake area). PAD-US's own name, except:
 *  - a managing office as the name ("Lakeview Office") → "<agency> land", with the office kept as who manages it
 *  - no name or a record code → "<holder> <kind>" from the local manager ("San Juan Preservation Trust easement"),
 *    or "Unnamed <kind>" when there is no holder either
 *  - a program acronym ("Pdr") → the program's name
 * Returns { name, office }.
 */
export function padusLabel(a) {
  const unit = (a.n || '').trim()
  if (OFFICE.test(unit)) return { name: `${AGENCY[a.mn] || MANAGER[a.mt] || 'Public'} land`, office: unit }
  if (PROGRAM[unit.toUpperCase()]) return { name: PROGRAM[unit.toUpperCase()], office: '' }
  if (unit && !PLACEHOLDER.test(unit) && !CODE.test(unit)) return { name: unit, office: '' }
  let kind = padusKind(a).toLowerCase()
  kind = !kind || /other or unknown$/.test(kind) ? 'land' : /(easement|park|area|refuge|preserve|reserve|forest|land|space|monument|trail|sanctuary)$/.test(kind) ? kind : `${kind} land`
  const holder = holderOf(a.lm) || AGENCY[a.mn] || ''
  return { name: holder ? `${holder} ${kind}` : `Unnamed ${kind}`, office: '' }
}
