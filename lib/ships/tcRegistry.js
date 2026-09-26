/**
 * Transport Canada, Canadian Register of Vessels (large vessels) → EarthAtlas
 * claims (pure; no I/O). Datasets, fields and caveats: docs/VESSEL_REGISTRIES.md §Transport Canada.
 *
 * Discovery uses the open.canada.ca bulk export (large-vessel-registry_dataset_en.xlsx,
 * Open Government Licence – Canada). For vessels we attach or consider, the
 * Vessel Registration Query System API record (status, former name, certificate
 * expiry, builder) is fetched too. The raw record = { official_number, dataset,
 * row (the export row, as parsed), api (the API response exactly as received, or null) }.
 * One source entity per official number. Neither source lists owners, call signs or MMSIs.
 */
import { normName, normImo, parseUtc } from './normalize.js'
import { parseDate, plainNumber, has } from './registry.js'

export const TC_SOURCE = {
  id: 'tc-vessel-registry',
  name: 'Transport Canada — Canadian Register of Vessels (large vessels)',
  publisher: 'Transport Canada, Marine Safety and Security (Vessel Registration)',
  homepage_url: 'https://open.canada.ca/data/en/dataset/bf00b7f4-e370-46b7-94e4-0bdedc98531b',
  license: 'Open Government Licence – Canada 2.0',
  license_url: 'https://open.canada.ca/en/open-government-licence-canada',
  commercial_use: true,
  attribution_text: 'Contains information licensed under the Open Government Licence – Canada (Transport Canada, Canadian Register of Vessels).',
  attribution_url: 'https://open.canada.ca/data/en/dataset/bf00b7f4-e370-46b7-94e4-0bdedc98531b',
  notes: 'Bulk XLSX export (open.canada.ca, "continual" updates) + Vessel Registration Query System API (data.tc.gc.ca v1.3). No owners, call signs or MMSIs are published. The Small Commercial Vessel Registry dataset has no vessel names or IMO numbers and is not imported (nothing to match on).',
}
export const TC_ENTITY_KIND = 'tc_large_vessel'
const EVIDENCE = 'registry'

const blank = (v) => !has(v) || /^(N\/A|UNKNOWN|-|NONE)$/i.test(String(v).trim())

/** Export's "Official Number" ('152527.0') → '152527'. */
export const officialNumber = (raw) => String(raw ?? '').trim().replace(/\.0+$/, '')

/**
 * "Year of Build" in the export is YYYYMM (month 00 = month not recorded) or YYYY.
 * Anything else ('0', '5-digit') is not interpreted. Returns { year, month } or null.
 */
export function tcYear(raw) {
  const s = String(raw ?? '').trim().replace(/\.0+$/, '')
  let m
  if ((m = /^(\d{4})(\d{2})$/.exec(s))) {
    const y = +m[1], mo = +m[2]
    if (y < 1700 || y > 2100 || mo > 12) return null
    return { year: String(y), month: mo || null }
  }
  if (/^\d{4}$/.test(s) && +s >= 1700 && +s <= 2100) return { year: s, month: null }
  return null
}

/** The API's ResultSet → { field name: literal }. */
export function apiFields(api) {
  const rs = api?.ResultSet?.[0]
  if (!Array.isArray(rs)) return null
  return Object.fromEntries(rs.map((f) => [f.Name, f.Value?.Literal ?? null]))
}

/** One payload → { assertions, warnings, summary }. */
export function mapTc(p) {
  const out = []
  const warnings = []
  const on = officialNumber(p.official_number ?? p.row?.['Official Number'])
  const ref = `tc:${on}`
  const row = p.row ?? {}
  const api = apiFields(p.api)
  const dsAt = p.dataset?.last_modified ? parseUtc(p.dataset.last_modified) : null
  const snap = dsAt ? { from: dsAt, to: dsAt, kind: 'observed' } : { from: null, to: null, kind: 'unknown' }
  const apiAt = p.api_retrieved_at ? parseUtc(p.api_retrieved_at) : null
  const apiSnap = apiAt ? { from: apiAt, to: apiAt, kind: 'observed' } : snap
  const push = (a, period = snap, basis = 'export') => {
    if (!has(a.value_raw) || !has(a.value_norm)) return
    out.push({ attribute: a.attribute, value_raw: String(a.value_raw).trim(), value_norm: String(a.value_norm).trim(),
      period_from: period.from, period_to: period.to, period_kind: period.kind, evidence_class: EVIDENCE, sub_record_ref: ref,
      detail: { official_number: on, from: basis === 'api' ? 'Vessel Registration Query System API' : 'open.canada.ca bulk export',
        ...(a.detail || {}) } })
  }

  push({ attribute: 'official_number', value_raw: on, value_norm: on, detail: { scheme: 'ca_official_number' } })
  const name = row['Vessel Name'] || api?.['Vessel Name']
  if (!blank(name)) push({ attribute: 'name', value_raw: name, value_norm: normName(name) })
  if (api && !blank(api['Former Vessel Name'])) {
    push({ attribute: 'name', value_raw: api['Former Vessel Name'], value_norm: normName(api['Former Vessel Name']),
      detail: { former: true, note: 'former name per the registry; the registry gives no dates for it' } }, { from: null, to: null, kind: 'unknown' }, 'api')
  }
  const imoRaw = row['IMO Vessel Number'] || (blank(api?.['IMO Number']) ? '' : api['IMO Number'])
  if (!blank(imoRaw)) {
    const i = normImo(imoRaw)
    if (!i.valid) warnings.push(`IMO "${imoRaw}" fails its checksum; stored flagged`)
    push({ attribute: 'imo', value_raw: imoRaw, value_norm: i.value, detail: { checksum_ok: i.valid } })
  }
  if (!blank(row['Hull Number'])) push({ attribute: 'hull_id', value_raw: row['Hull Number'], value_norm: normName(row['Hull Number']), detail: { kind: 'hull number (HIN or builder number)' } })
  const y = tcYear(row['Year of Build'])
  if (y) push({ attribute: 'year_built', value_raw: row['Year of Build'], value_norm: y.year, detail: { month: y.month, format: 'YYYYMM (00 = month not recorded)' } })
  else if (has(row['Year of Build'])) warnings.push(`year of build "${row['Year of Build']}" not interpreted; kept only in the raw record`)
  const rb = tcYear(row['Year of Latest Rebuild'])
  if (rb) push({ attribute: 'event', value_raw: `Rebuilt ${rb.year}`, value_norm: `TC_REBUILT_${rb.year}`, detail: { kind: 'rebuild', year: rb.year } })
  if (!blank(row['Port of Registry'])) push({ attribute: 'port_of_registry', value_raw: row['Port of Registry'], value_norm: normName(row['Port of Registry']) })

  const desc = row['Vessel Descriptor']
  const apiType = api?.['Vessel Type'] ?? null
  if (!blank(desc)) push({ attribute: 'vessel_type', value_raw: desc, value_norm: `TC_${normName(desc)}`, detail: { vessel_type_api: apiType } })
  else if (apiType && !blank(apiType.split('/')[0])) {
    const main = apiType.split('/')[0].trim()
    push({ attribute: 'vessel_type', value_raw: apiType, value_norm: `TC_${normName(main)}` }, apiSnap, 'api')
  }
  const gt = plainNumber(row['Gross Tonnage']), nt = plainNumber(row['Net Tonnage'])
  if (gt && +gt > 0) push({ attribute: 'tonnage_gt', value_raw: row['Gross Tonnage'], value_norm: gt })
  if (nt && +nt > 0) push({ attribute: 'net_tonnage', value_raw: row['Net Tonnage'], value_norm: nt })
  if (!blank(row['Construction Material'])) {
    push({ attribute: 'hull_material', value_raw: row['Construction Material'], value_norm: normName(row['Construction Material']),
      detail: { construction_type: blank(row['Construction Type']) ? null : row['Construction Type'] } })
  }
  for (const [col, attribute] of [['Length', 'length_m'], ['Breadth', 'width_m'], ['Depth', 'depth_m']]) {
    const v = plainNumber(row[col])
    if (v && +v > 0) push({ attribute, value_raw: `${row[col]} m`, value_norm: v, detail: { unit: 'm' } })
  }
  const prop = {
    engine_type: row['Engine Type'], engines: plainNumber(row['Number of Engines']), propulsion_type: row['Propulsion Type'],
    propulsion_method: row['Propulsion Method'], power: plainNumber(row['Engine Propulsion Power']), power_unit: row['Unit/Brake Power'],
    speed_knots: plainNumber(row['Speed (Knots)']),
  }
  const parts = [!blank(prop.engine_type) && prop.engine_type + (prop.engines && +prop.engines > 0 ? ` ×${prop.engines}` : ''),
    !blank(prop.propulsion_type) && prop.propulsion_type, !blank(prop.propulsion_method) && prop.propulsion_method,
    prop.power && +prop.power > 0 && !blank(prop.power_unit) && `${prop.power} ${prop.power_unit}`].filter(Boolean)
  if (parts.length) push({ attribute: 'propulsion', value_raw: parts.join(' · '), value_norm: normName(parts.join('|')), detail: prop })

  const reg = parseDate(row['Certificate Issuing date or Registration date'])
  const exp = api ? parseDate(api['Certificate Expires']) : null
  if (reg || exp) {
    push({ attribute: 'certificate', value_raw: 'Canadian certificate of registry', value_norm: `TC_REGISTRY_${reg?.text ?? 'NA'}`,
      detail: { issued_or_registered: reg?.text ?? null, expires: exp?.text ?? null, registry_date_api: api?.['Registry Date'] || null,
        period_basis: 'certificate issuing / registration date → certificate expiry (API), day precision' } },
    { from: reg?.from ?? null, to: exp?.until ?? null, kind: 'validity' })
  }
  if (api) {
    if (!blank(api.Status)) {
      push({ attribute: 'registration_status', value_raw: `${api.Status} (Canadian Register of Vessels)`, value_norm: `TC_${normName(api.Status)}` }, apiSnap, 'api')
      if (/^REGISTERED$/i.test(api.Status)) {
        push({ attribute: 'flag', value_raw: 'Canada (Canadian Register of Vessels)', value_norm: 'CAN',
          detail: { basis: 'registered on the Canadian Register of Vessels (status REGISTERED)' } }, apiSnap, 'api')
      }
    }
    if (!blank(api['Builder Name'])) {
      push({ attribute: 'builder', value_raw: api['Builder Name'], value_norm: normName(api['Builder Name']),
        detail: { city: blank(api['Builder City']) ? null : api['Builder City'], province_state: blank(api['Builder State / Province']) ? null : api['Builder State / Province'],
          country: blank(api['Builder Country']) ? null : api['Builder Country'] } }, apiSnap, 'api')
    }
  }
  return { assertions: out, warnings, summary: { officialNumber: on, name, imo: imoRaw || null } }
}
