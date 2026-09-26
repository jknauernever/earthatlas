/**
 * Shared helpers for official government vessel registries (USCG PSIX, FCC ULS,
 * Transport Canada). Pure; no I/O. Semantics + sources: docs/VESSEL_REGISTRIES.md.
 */

export const REGISTRY_SOURCE_IDS = new Set(['uscg-psix', 'fcc-uls-ship', 'tc-vessel-registry'])

const has = (v) => v !== null && v !== undefined && String(v).trim() !== ''
export { has }

const dayIso = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d))
  if (Number.isNaN(t.getTime()) || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return t.toISOString()
}
const nextDay = (iso) => new Date(new Date(iso).getTime() + 86400000).toISOString()

/**
 * A calendar date with no time and no zone (registries publish legal dates, not
 * instants). Returned as the UTC day it names: { from: day 00:00Z, until: next
 * day 00:00Z, text }. This is day precision, the same convention as Wikidata
 * day-precision dates; it is not a guessed time zone for a timestamp.
 * Accepts 'YYYY-MM-DD', 'MM/DD/YYYY' (FCC ULS) and 'Month D,YYYY' (PSIX).
 */
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
export function parseDate(raw) {
  if (!has(raw)) return null
  const s = String(raw).trim()
  let y, m, d, x
  if ((x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) [y, m, d] = [+x[1], +x[2], +x[3]]
  else if ((x = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s))) [m, d, y] = [+x[1], +x[2], +x[3]]
  else if ((x = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(s))) {
    m = MONTHS.indexOf(x[1].toLowerCase()) + 1
    d = +x[2]; y = +x[3]
    if (!m) return null
  } else return null
  const from = dayIso(y, m, d)
  if (!from) return null
  return { from, until: nextDay(from), text: from.slice(0, 10) }
}

/** Plain decimal text: '152527.0' → '152527', '17.380' → '17.38'. */
export function plainNumber(raw) {
  if (!has(raw)) return null
  const n = Number(String(raw).trim())
  if (!Number.isFinite(n)) return null
  return String(Math.round(n * 1000) / 1000)
}

export const FT_TO_M = 0.3048
export const ftToM = (ft) => String(Math.round(Number(ft) * FT_TO_M * 100) / 100)

/**
 * Flag names as registries write them → ISO 3166-1 alpha-3. Only names we have
 * actually seen or that are common in our area; anything else keeps a
 * source-prefixed value_norm and the raw name, never a guessed code.
 */
const ISO3 = {
  'UNITED STATES': 'USA', 'CANADA': 'CAN', 'NETHERLANDS': 'NLD', 'BAHAMAS': 'BHS', 'BERMUDA': 'BMU',
  'MARSHALL ISLANDS': 'MHL', 'LIBERIA': 'LBR', 'PANAMA': 'PAN', 'MALTA': 'MLT', 'SINGAPORE': 'SGP',
  'HONG KONG': 'HKG', 'CHINA': 'CHN', 'JAPAN': 'JPN', 'KOREA, SOUTH': 'KOR', 'SOUTH KOREA': 'KOR',
  'NORWAY': 'NOR', 'DENMARK': 'DNK', 'UNITED KINGDOM': 'GBR', 'GREECE': 'GRC', 'CYPRUS': 'CYP',
  'ITALY': 'ITA', 'GERMANY': 'DEU', 'FRANCE': 'FRA', 'ANTIGUA AND BARBUDA': 'ATG', 'PORTUGAL': 'PRT',
  'BELGIUM': 'BEL', 'SWEDEN': 'SWE', 'FINLAND': 'FIN', 'RUSSIA': 'RUS', 'INDIA': 'IND', 'TAIWAN': 'TWN',
  'MEXICO': 'MEX', 'CAYMAN ISLANDS': 'CYM', 'ISLE OF MAN': 'IMN', 'GIBRALTAR': 'GIB', 'MADEIRA': 'PRT',
  'SAINT VINCENT AND THE GRENADINES': 'VCT', 'VANUATU': 'VUT', 'TUVALU': 'TUV', 'COOK ISLANDS': 'COK',
}
export function flagIso3(name) {
  const k = String(name ?? '').trim().toUpperCase()
  return ISO3[k] ?? null
}

// ── Privacy (docs/VESSEL_REGISTRIES.md §Privacy; needs Josh's approval to change) ──

/** FCC ULS EN applicant type codes (FCC ULS "Code Definitions", Attachment C). */
export const FCC_APPLICANT_TYPES = {
  B: 'Amateur Club', C: 'Corporation', G: 'Governmental Entity', I: 'Individual', J: 'Joint Venture',
  L: 'Limited Liability Corporation', M: 'Military Recreation', O: 'Consortium', P: 'Partnership',
  R: 'RACES', T: 'Trust', U: 'Unincorporated Association',
}
/** Types that are organisations by definition. Partnerships, trusts, clubs etc. often carry people's names. */
export const ORG_TYPES = new Set(['C', 'G', 'J', 'L', 'O', 'U'])

/**
 * Privacy decision for a registry-listed party (owner / licensee).
 *   storeName  may the name be stored in a claim at all? Only for organisations.
 *   display    may the UI show it? Organisation AND the vessel is licensed as a
 *              commercial/compulsory ship. An organisation holding a recreational
 *              licence (e.g. a one-boat LLC) is stored but not shown.
 *   reason     why not, when display is false.
 * Individuals and unknown party types: the name is never stored. Josh must approve
 * before any individual's name is ever shown (and so before it is ever stored).
 */
export function partyPrivacy({ applicantType, recreational }) {
  const t = String(applicantType ?? '').trim().toUpperCase()
  if (t === 'I') return { storeName: false, display: false, reason: 'private_individual', kind: 'individual' }
  if (!ORG_TYPES.has(t)) return { storeName: false, display: false, reason: 'party_type_may_be_individual', kind: t ? `type_${t}` : 'unknown' }
  if (recreational) return { storeName: true, display: false, reason: 'organisation_on_recreational_licence', kind: 'organisation' }
  return { storeName: true, display: true, reason: null, kind: 'organisation' }
}

/** The name placeholder stored instead of a withheld party name. */
export const WITHHELD = { value_raw: 'Name withheld (privacy rule)', value_norm: 'WITHHELD' }
