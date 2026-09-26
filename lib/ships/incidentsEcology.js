/**
 * Washington State Department of Ecology "Reported spills to water" → incidents (pure; no I/O).
 * docs/SHIP_INCIDENT_SOURCES.md §5, §13.
 *
 * Layer: SPPR/Spills_map_series/MapServer/130 (anonymous ArcGIS query). One layer row per
 * product spilled, so rows are grouped by ERTS number into one event; the raw record is
 * every row of that ERTS exactly as the query returned it.
 *
 * Vessel identity: none structured. A name is taken from the free-text CaseName only when
 * it is marked as a vessel ("F/V …", "Tug …", "USNS …", quoted, …), and only as a
 * NAME-ONLY CANDIDATE: never accepted automatically. Recreational rows get no name at all
 * (their case names can carry state registration numbers, which are personal).
 *
 * Time: Date_incident is epoch ms whose UTC reading is Washington LOCAL wall-clock time
 * (verified: ALEUTIAN ISLE 13:55, KODIAK ENTERPRISE fire 03:06, both local per the
 * narratives). The zone is not stated, so the event is kept at DAY precision (the calendar
 * day named, UTC day convention, as registry dates are); the decoded wall clock is in time_raw.
 *
 * Licence: Ecology credit + link required; commercial and political use prohibited.
 * EarthAtlas is non-commercial conservation use (Josh, 2026-09-25/26).
 */
import { normName } from './normalize.js'
import { typesFromText } from './incidents.js'

export const ECOLOGY_SOURCE = {
  id: 'wa-ecology-spills',
  name: 'Washington State Department of Ecology: reported spills to water',
  publisher: 'Washington State Department of Ecology, Spill Prevention, Preparedness & Response',
  homepage_url: 'https://ecology.wa.gov/spills-cleanup/spills/spill-preparedness-response/responding-to-spill-incidents/spill-incidents',
  license: 'Ecology data: use allowed with credit to the Washington State Department of Ecology and a link; commercial and political use prohibited',
  license_url: 'https://ecology.wa.gov/About-us/Accountability-transparency/Website-information/Copyright-information',
  commercial_use: false,
  attribution_text: 'Washington State Department of Ecology (reported spills to water)',
  attribution_url: 'https://ecology.wa.gov/spills-cleanup/spills/spill-preparedness-response/responding-to-spill-incidents/spill-incidents',
  notes: 'ArcGIS layer https://gis.ecology.wa.gov/serverext/rest/services/SPPR/Spills_map_series/MapServer/130 ("ReportedSpillsToWater - AllScales"): spills of one gallon or more to water since 2015-07-01. No vessel identifiers (name only inside CaseName) → name-only candidate links only. Dates are local wall-clock encoded as UTC epoch → stored at day precision. Quantities in gallons per the layer legend (UNVERIFIED per record). Non-commercial use only.',
}
export const ECOLOGY_ENTITY_KIND = 'ecology_erts'
export const ECOLOGY_LAYER = 'https://gis.ecology.wa.gov/serverext/rest/services/SPPR/Spills_map_series/MapServer/130'

const PREFIX = String.raw`(?:(?:Commercial )?Fishing Vessel|Crabbing Vessel|Research Vessel|F\/V|FV|M\/V|MV|T\/V|TV|S\/V|SV|R\/V|RV|Tug(?:boat)?|USNS|USS|USCGC|USCG Cutter|Barge|Ferry|WSF|Yacht)`
// Recreational boats: no name is taken (their records can carry personal registration numbers).
const RECREATIONAL = /(?:^|[\s,(])(?:P\/C|PC|Pleasure Craft|Recreational Vessel|Recreational Boat)\b/i
const STOP = /^(?:diesel|oil|oily|spill(?:s|ed)?|sinking|sunk(?:en)?|sank|sheen|bilge|hydraulic|wreck|aground|grounding|grounded|fire|vessel|fuel|fueling|gasoline|gas|collision|discharge|leak|leaking|release|lube|unknown|mystery|at|in|on|near|off|to|from|and|&|-|–|\d.*|potential|derelict|abandoned|capsized?|allision|overfill|pumping|reduction|engine|motor|workboat|boat|containing|with|waste|bunkering|equipment|break|breakaway|cooking|soap|water|discharging|adrift|awash|disabled|debris|burning|flooding|taking)$/i
const REGNO = /\b[A-Z]{2}\s?\d{3,4}\s?[A-Z]{1,2}\b/g

/**
 * A vessel name the case name explicitly marks as a vessel, or null. Conservative on purpose:
 * no prefix and no quotes → no name. Strips state registration numbers.
 */
export function vesselNameFromCaseName(text) {
  const s = String(text ?? '').replace(REGNO, ' ').replace(/\s+/g, ' ').trim()
  if (RECREATIONAL.test(s)) return null
  const q = /["“]([^"”]{3,40})["”]/.exec(s)
  if (q) return q[1].trim()
  const m = new RegExp(`(?:^|[\\s,(])${PREFIX}\\.?\\s+(.+)$`, 'i').exec(s)
  if (!m) return null
  const out = []
  for (const tok of m[1].split(/[,;:(]/)[0].split(/\s+/)) {
    const head = tok.split(/[-–]/)[0]
    if (!tok || !head || STOP.test(head.replace(/[.'’]+$/, ''))) break
    out.push(head)
    if (head !== tok) break
    if (out.length >= 5) break
  }
  const name = out.join(' ').trim()
  return normName(name).length >= 3 ? name : null
}

/** Epoch ms whose UTC fields are local wall-clock time → { day: 'YYYY-MM-DD', wall: 'YYYY-MM-DD HH:MM' }. */
function localWallClock(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n)) return null
  const iso = new Date(n).toISOString()
  return { day: iso.slice(0, 10), wall: `${iso.slice(0, 10)} ${iso.slice(11, 16)}` }
}

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const uniq = (a) => [...new Set(a.filter((x) => x != null && String(x).trim() !== '').map((x) => String(x).trim()))]

/** Payload { erts_number, retrieved_at, query_url, rows: [layer attributes…] } → mapped event. */
export function mapEcology(payload) {
  const rows = payload.rows || []
  if (!rows.length) return null
  const r0 = rows[0]
  const key = String(payload.erts_number ?? r0.ERTS_number)
  const wc = localWallClock(r0.Date_incident)
  const from = wc ? `${wc.day}T00:00:00.000Z` : null
  const to = wc ? new Date(Date.parse(from) + 86400000).toISOString() : null
  const cats = uniq(rows.flatMap((r) => String(r.Incident_Category || '').split(',')))
  const toWater = rows.reduce((s, r) => s + (num(r.QuantityToWater) || 0), 0)
  const total = rows.reduce((s, r) => s + (num(r.Quantity_total) || 0), 0)
  const materials = uniq(rows.map((r) => r.Oil_type))
  const lossOfVessel = cats.some((c) => /loss of vessel|sinking|sunk/i.test(c))
  const severity_rank = lossOfVessel || toWater >= 1000 ? 3 : toWater >= 100 || cats.some((c) => /fire|explosion|collision|grounding/i.test(c)) ? 2 : 1
  const lat = num(r0.Latitude), lon = num(r0.Longitude)
  // Plausibility only (no county polygons): inside Washington, and a 'Puget Sound' row must lie in the Sound's
  // longitude band (a Kitsap row at -120.56 is inland, docs §5).
  const inWa = lat != null && lon != null && lat > 45.4 && lat < 49.1 && lon > -125.0 && lon < -116.8 &&
    (!/puget sound/i.test(r0.Medium || '') || (lon > -123.4 && lon < -122.1 && lat > 46.9 && lat < 49.05))
  const recreational = rows.some((r) => /RECREATIONAL/i.test(r.Source || ''))
  const name = recreational ? null : vesselNameFromCaseName(r0.CaseName)
  const place = uniq([r0.Location, r0.City, r0.County ? `${r0.County} County` : null, r0.Medium]).join(', ') || null
  return {
    source: ECOLOGY_SOURCE, entityKind: ECOLOGY_ENTITY_KIND, key, payload,
    datasetVersion: `retrieved:${String(payload.retrieved_at).slice(0, 10)}`,
    event: {
      event_kinds: ['pollution', ...(cats.some((c) => /loss of vessel|fire|explosion|collision|grounding|sinking/i.test(c)) ? ['casualty'] : [])],
      event_types: uniq(['spill', ...typesFromText(...cats)]), event_type_raw: cats.join(' · ') || null, title: null,
      occurred_from: from, occurred_to: to, period_kind: from ? 'validity' : 'unknown',
      time_raw: wc ? `${r0.Date_incident} (epoch ms; reads as local ${wc.wall})` : null, time_quality: from ? 'date_only_local_zone_unstated' : 'missing',
      lat: inWa ? lat : null, lon: inWa ? lon : null, location_text: place,
      position_quality: lat == null ? null : inWa ? 'source_point_unvalidated' : 'rejected_implausible_for_state_or_waterbody',
      severity_raw: null, severity_rank, deaths: null, injuries: null, missing: null,
      material: materials.join(' · ') || null, quantity: total || null, quantity_unit: 'gal', quantity_to_water: toWater || null,
      narrative: null, report_url: ECOLOGY_SOURCE.homepage_url, report_ref: `Ecology ERTS ${key}`, evidence_class: 'state_record',
      detail: { title_display: false, case_name_display: false, source_category: uniq(rows.map((r) => r.Source)), cause: uniq(rows.map((r) => r.Cause)),
        activity: uniq(rows.map((r) => r.Activity)), impact: uniq(rows.map((r) => r.Impact)), regulated: uniq(rows.map((r) => r.Regulated)),
        products: rows.map((r) => ({ product: r.Oil_type ?? null, total: num(r.Quantity_total), to_water: num(r.QuantityToWater), recovered: num(r.Quantity_recovered) })),
        quantity_note: 'gallons per the layer legend ("spills of one gallon or more"); UNVERIFIED per record',
        name_note: recreational ? 'recreational vessel: no name extracted (case names can carry personal registration numbers)' : name ? 'name taken from the free-text case name' : 'no vessel name marked in the case name' },
    },
    refs: name ? [{ ref_key: `name:${normName(name)}`, role_raw: rows.map((r) => r.Source).find(Boolean) ?? null, role: 'involved',
      name_raw: name, vessel_type_raw: r0.Source ?? null, detail: { name_only: true, extracted_from: 'CaseName' } }] : [],
  }
}

/** Group layer rows (attributes) by ERTS number. */
export function groupEcologyRows(rows) {
  const by = new Map()
  for (const r of rows) {
    const k = String(r.ERTS_number ?? `incident:${r.IncidentID}`)
    if (!by.has(k)) by.set(k, [])
    by.get(k).push(r)
  }
  for (const v of by.values()) v.sort((a, b) => a.OBJECTID - b.OBJECTID)
  return by
}
