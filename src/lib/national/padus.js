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
export const ACCESS = { OA: 'Open to the public', RA: 'Open to the public with limits', XA: 'Closed to the public', UK: 'Public access not known' }
// PAD-US designation types (Des_Tp), as USGS names them.
export const DESIGNATION = {"NP": "National Park", "NM": "National Monument", "NCA": "Conservation Area", "NF": "National Forest", "NG": "National Grassland", "PUB": "National Public Lands", "NT": "National Scenic or Historic Trail", "NWR": "National Wildlife Refuge", "WA": "Wilderness Area", "WSR": "Wild and Scenic River", "WSA": "Wilderness Study Area", "MPA": "Marine Protected Area", "NRA": "National Recreation Area", "NSBV": "National Scenic, Botanical or Volcanic Area", "NLS": "National Lakeshore or Seashore", "IRA": "Inventoried Roadless Area", "ACEC": "Area of Critical Environmental Concern", "RNA": "Research Natural Area", "REC": "Recreation Management Area", "RMA": "Resource Management Area", "WPA": "Watershed Protection Area", "REA": "Research or Educational Area", "HCA": "Historic or Cultural Area", "MIT": "Mitigation Land or Bank", "MIL": "Military Land", "ACC": "Access Area", "SDA": "Special Designation Area", "PROC": "Approved or Proclamation Boundary", "FOTH": "Federal Other or Unknown", "ND": "Not Designated", "TRIBL": "Native American Land Area", "SP": "State Park", "SW": "State Wilderness", "SCA": "State Conservation Area", "SREC": "State Recreation Area", "SHCA": "State Historic or Cultural Area", "SRMA": "State Resource Management Area", "SOTH": "State Other or Unknown", "LP": "Local Park", "LCA": "Local Conservation Area", "LREC": "Local Recreation Area", "LHCA": "Local Historic or Cultural Area", "LRMA": "Local Resource Management Area", "LOTH": "Local Other or Unknown", "PCON": "Private Conservation", "PPRK": "Private Park", "PREC": "Private Recreation or Education", "PHCA": "Private Historic or Cultural", "PAGR": "Private Agricultural", "PRAN": "Private Ranch", "PFOR": "Private Forest Stewardship", "POTH": "Private Other or Unknown", "CONE": "Conservation Easement", "RECE": "Recreation or Education Easement", "HCAE": "Historic or Cultural Easement", "AGRE": "Agricultural Easement", "RANE": "Ranch Easement", "FORE": "Forest Stewardship Easement", "OTHE": "Other Easement", "UNKE": "Unknown Easement", "UNK": "Unknown", "OCS": "Outer Continental Shelf Area", "FACY": "Facility"}

/** The current PAD-US version and a Mapbox vector source for it, or null when it isn't published (or built locally). */
export async function padusSource() {
  const d = await nationalDataset('padus')
  return d ? { version: d.version, source: { type: 'vector', tiles: [nationalTilesUrl('padus', d.version)], minzoom: 0, maxzoom: 13, attribution: 'USGS PAD-US 4.1' } } : null
}

// Not drawn: Outer Continental Shelf areas (offshore leasing zones, not protected land), and, in tiles 4.1-20261101,
// the shapes that cross the 180° line (Aleutians, Pacific monuments), which that build stretched into bands around the
// world. A rebuild that splits them at the line (scripts/national/padus/build.sh, -wrapdateline) lets them come back.
const DATELINE_IDS = [6938,7869,4154,6937,6939,7870,4153,4418,4419,310290,3447,3449,3453,3477,3451,3475,3473,3729,3977,3684,3498,3739,3956,3980,3564,3563,3561,3555,3491,3483,3482,3489,3487,4072,3494,3952,7570,4463,310667,310575,8525,4340,8520,7565]
export const PADUS_FILTER = ['all', ['!=', ['get', 'Des_Tp'], 'OCS'], ['!', ['in', ['to-number', ['get', 'id']], ['literal', DATELINE_IDS]]]]

/** Fill + outline layers for the `padus` source layer (one clear green; protection level is told in words, not color). */
export function padusLayers(sourceId, prefix = 'padus') {
  return [
    { id: `${prefix}-fill`, type: 'fill', source: sourceId, 'source-layer': 'padus', filter: PADUS_FILTER, paint: { 'fill-color': PADUS_COLOR, 'fill-opacity': 0.22 } },
    { id: `${prefix}-line`, type: 'line', source: sourceId, 'source-layer': 'padus', filter: PADUS_FILTER,
      paint: { 'line-color': PADUS_COLOR, 'line-opacity': 0.95, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 9, 1, 12, 2] } },
  ]
}

/** A clicked `padus` tile feature in the plain-language shape cards use (same keys as the /spills bake's areas). */
export function padusArea(props) {
  const p = props || {}
  return {
    id: p.id, n: (p.Unit_Nm || '').trim() || 'Unnamed protected area', mt: p.Mang_Type || 'UNK', mn: p.Mang_Name || '', lm: (p.Loc_Mang || '').trim(),
    d: DESIGNATION[p.Des_Tp] || p.Des_Tp || '', ld: (p.Loc_Ds || '').trim(), gap: p.GAP_Sts, acc: p.Pub_Access || 'UK',
    ac: Number(p.GIS_Acres) || 0, st: p.State_Nm || '',
  }
}
