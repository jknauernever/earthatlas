/**
 * USCG Port State Information Exchange (PSIX) → EarthAtlas claims (pure; no I/O).
 * Service, fields and caveats: docs/VESSEL_REGISTRIES.md §PSIX.
 *
 * PSIX is the public (FOIA-releasable) weekly snapshot of the Coast Guard's MISLE
 * database, served by the CGMIX XML web service (SOAP, no key). One source entity
 * per PSIX VesselId. The raw record is every XML result string for that vessel
 * exactly as the service returned it (summary, particulars, dimensions, tonnage,
 * documents, cases) plus the retrieval time. PSIX does not publish owners or
 * operators through the web service, and has no MMSI.
 *
 * Identity values are a snapshot: 'observed' at the retrieval instant (PSIX gives
 * no dates for them). Documents carry issue → expiry as validity; activities are
 * observed at their start time.
 */
import { normName, normCallsign, normImo, parseUtc } from './normalize.js'
import { parseDate, plainNumber, has, flagIso3, ftToM } from './registry.js'
import { unescapeXml } from './xlsx.js'

export const PSIX_SOURCE = {
  id: 'uscg-psix',
  name: 'USCG Port State Information Exchange (PSIX)',
  publisher: 'U.S. Coast Guard (MISLE data via the Coast Guard Maritime Information Exchange, CGMIX)',
  homepage_url: 'https://cgmix.uscg.mil/psix/',
  license: 'U.S. Government work (public domain, 17 U.S.C. § 105); FOIA-releasable MISLE data',
  license_url: 'https://cgmix.uscg.mil/XML/Default.aspx',
  commercial_use: true,
  attribution_text: 'U.S. Coast Guard PSIX',
  attribution_url: 'https://cgmix.uscg.mil/psix/',
  notes: 'CGMIX PSIXData XML web service (https://cgmix.uscg.mil/xml/PSIXData.asmx): weekly snapshot of FOIA data in MISLE. No MMSI, no owner. Values observed at retrieval. CGMIX pages carry the standard U.S. Government information-system banner; no published rate limit (we use one request at a time with a pause).',
}
export const PSIX_ENTITY_KIND = 'psix_vessel'
const EVIDENCE = 'registry'

export const PSIX_OPS = ['summary', 'particulars', 'dimensions', 'tonnage', 'documents', 'cases']

/** Rows of a CGMIX "NewDataSet" XML string: [{ _tag, Field: 'text', … }]. */
export function parseDataset(xml) {
  const s = String(xml ?? '')
  const inner = /<NewDataSet>([\s\S]*)<\/NewDataSet>/.exec(s)?.[1]
  if (!inner) return []
  const rows = []
  for (const m of inner.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) {
    const row = { _tag: m[1] }
    for (const f of m[2].matchAll(/<(\w+)>([^<]*)<\/\1>/g)) row[f[1]] = unescapeXml(f[2]).trim()
    rows.push(row)
  }
  return rows
}

const blank = (v) => !has(v) || /^N\/?A$/i.test(String(v).trim())

/** A PSIX date-time: zoned ISO ('2026-03-02T03:05:20.307-05:00') or a bare date ('March 31,2027'). */
function when(zoned, text) {
  if (has(zoned)) { try { return { at: parseUtc(zoned), text: zoned } } catch { /* fall through */ } }
  const d = parseDate(text)
  return d ? { at: d.from, until: d.until, text: d.text, dayOnly: true } : null
}

/** Payload { vessel_id, retrieved_at, responses: {op: xml} } → { assertions, warnings, summary }. */
export function mapPsix(payload) {
  const out = []
  const warnings = []
  const id = String(payload.vessel_id)
  const ref = `psix:${id}`
  const at = parseUtc(payload.retrieved_at)
  const snap = { from: at, to: at, kind: 'observed' }
  const R = Object.fromEntries(PSIX_OPS.map((op) => [op, parseDataset(payload.responses?.[op])]))
  const sum = R.summary.find((r) => String(r.VesselId) === id) ?? R.summary[0] ?? {}
  const part = R.particulars[0] ?? {}
  const base = { snapshot_basis: 'PSIX weekly MISLE snapshot; value as of retrieval', psix_vessel_id: id }
  const push = (a, period = snap, sub = ref) => {
    if (!has(a.value_raw) || !has(a.value_norm)) return
    out.push({ attribute: a.attribute, value_raw: String(a.value_raw).trim(), value_norm: String(a.value_norm).trim(),
      period_from: period.from, period_to: period.to, period_kind: period.kind, evidence_class: EVIDENCE,
      sub_record_ref: sub, detail: { ...(period === snap ? base : { psix_vessel_id: id }), ...(a.detail || {}) } })
  }

  const name = part.VesselName || sum.VesselName
  push({ attribute: 'name', value_raw: name, value_norm: normName(name) })
  const cs = part.VesselCallSign || sum.VesselCallSign
  if (!blank(cs)) push({ attribute: 'callsign', value_raw: cs, value_norm: normCallsign(cs) })

  const ident = part.Identification || sum.Identification
  const idType = part.IdentificationTypeLookupName || null
  if (!blank(ident)) {
    if (/IMO/i.test(idType ?? '')) {
      const i = normImo(ident)
      push({ attribute: 'imo', value_raw: ident, value_norm: i.value, detail: { checksum_ok: i.valid, identification_type: idType } })
    } else {
      const scheme = /Official Number \(U\.?S\.?\)/i.test(idType ?? '') ? 'us_official_number'
        : idType ? `psix:${normName(idType)}` : 'psix_identification_type_not_stated'
      push({ attribute: 'official_number', value_raw: ident,
        value_norm: scheme === 'us_official_number' ? String(ident).replace(/\D/g, '').replace(/^0+/, '') : normName(ident),
        detail: { scheme, identification_type: idType } })
    }
  }
  if (!blank(sum.HIN)) push({ attribute: 'hull_id', value_raw: sum.HIN, value_norm: normName(sum.HIN), detail: { kind: 'HIN' } })
  if (!blank(sum.ManufacturerHullNumber)) {
    push({ attribute: 'hull_id', value_raw: sum.ManufacturerHullNumber, value_norm: `MFR_${normName(sum.ManufacturerHullNumber)}`,
      detail: { kind: 'manufacturer hull number' } })
  }
  const yb = part.ConstructionCompletedYear || sum.ConstructionCompletedYear
  if (/^\d{4}$/.test(String(yb ?? '').trim())) push({ attribute: 'year_built', value_raw: yb, value_norm: String(yb).trim() })
  else if (has(yb)) warnings.push(`year built "${yb}" not a year; kept only in the raw record`)

  const country = part.CountryLookupName || sum.CountryLookupName
  if (!blank(country)) {
    const iso = flagIso3(country)
    if (!iso) warnings.push(`flag "${country}" not in the ISO3 map; stored with a PSIX_ value`)
    push({ attribute: 'flag', value_raw: country, value_norm: iso ?? `PSIX_${normName(country)}`, detail: { iso3_known: !!iso } })
  }
  const svc = part.ServiceType || sum.ServiceType
  if (!blank(svc)) {
    const sub = blank(part.ServiceSubType) ? null : part.ServiceSubType
    push({ attribute: 'vessel_type', value_raw: sub ? `${svc} · ${sub}` : svc, value_norm: `PSIX_${normName(svc)}`,
      detail: { service_type: svc, service_subtype: sub, cargo_authorization: part.CargoAuthorizationDescription || null } })
  }
  const st = part.StatusLookupName || sum.StatusLookupName
  if (!blank(st)) {
    const oos = part.OutOfServiceDate || sum.OutOfServiceDate || null
    push({ attribute: 'registration_status', value_raw: `${st} (USCG MISLE vessel status)`, value_norm: `PSIX_${normName(st)}`,
      detail: { out_of_service_date: oos } })
  }

  for (const d of R.dimensions) {
    const t = d.DimensionTypeLookupName || 'dimension'
    const sub = `${ref}:dim:${d.DimensionTypeLookupId ?? normName(t)}`
    const det = { dimension_type: t, unit: 'ft', converted: 'ft × 0.3048' }
    if (/draft/i.test(t)) {
      // PSIX returns a draft in the LengthInFeet column.
      if (Number(d.LengthInFeet) > 0) push({ attribute: 'draft_m', value_raw: `${d.LengthInFeet} ft`, value_norm: ftToM(d.LengthInFeet), detail: det }, snap, sub)
      continue
    }
    if (/perpendicular/i.test(t)) { warnings.push(`dimension "${t}" (not overall length) kept only in the raw record`); continue }
    if (Number(d.LengthInFeet) > 0) push({ attribute: 'length_m', value_raw: `${d.LengthInFeet} ft`, value_norm: ftToM(d.LengthInFeet), detail: det }, snap, sub)
    if (Number(d.BreadthInFeet) > 0) push({ attribute: 'width_m', value_raw: `${d.BreadthInFeet} ft`, value_norm: ftToM(d.BreadthInFeet), detail: det }, snap, sub)
    if (Number(d.DepthInFeet) > 0) push({ attribute: 'depth_m', value_raw: `${d.DepthInFeet} ft`, value_norm: ftToM(d.DepthInFeet), detail: det }, snap, sub)
  }
  for (const t of R.tonnage) {
    const type = t.TonnageTypeLookupName || ''
    const unit = t.UnitOfMeasureLookupName || ''
    const n = plainNumber(t.MeasureOfWeight)
    if (!n || Number(n) <= 0) continue
    // Measurement tonnages (Convention / Regulatory / Simplified) come as two rows, labelled
    // "Long Ton" and "Short Ton". They are volumes, not weights: the labels appear to mark
    // gross vs net (EURODAM: "Long Ton" 86,273 = its published gross tonnage). UNVERIFIED.
    const measured = /convention|regulatory|simplified|dual/i.test(type)
    const attribute = measured && /long/i.test(unit) ? 'tonnage_gt' : measured && /short/i.test(unit) ? 'net_tonnage' : null
    if (!attribute) { warnings.push(`tonnage "${type}" / "${unit}" not mapped; kept only in the raw record`); continue }
    push({ attribute, value_raw: `${t.MeasureOfWeight} (${type}, "${unit}")`, value_norm: n,
      detail: { tonnage_type: type, unit_label: unit,
        note: 'PSIX labels measurement tonnage rows "Long Ton" / "Short Ton"; read as gross / net (UNVERIFIED; EURODAM\'s "Long Ton" row equals its published GT).' } },
    snap, `${ref}:ton:${t.TonnageTypeLookupId ?? normName(type)}:${normName(unit)}`)
  }
  for (const d of R.documents) {
    const issued = when(d.IssueDtTm1, d.IssueDtTm)
    const exp = when(null, d.ExpiredDtTm)
    let period = { from: issued?.at ?? null, to: exp?.until ?? null, kind: issued || exp ? 'validity' : 'unknown' }
    if (period.from && period.to && period.from >= period.to) { warnings.push(`document ${d.TypeLookupName}: issue after expiry; unknown dates`); period = { from: null, to: null, kind: 'unknown' } }
    const num = blank(d.Number) ? null : d.Number
    push({ attribute: 'certificate', value_raw: `${d.TypeLookupName}${d.StatusLookupName ? ` (${d.StatusLookupName})` : ''}`,
      value_norm: `PSIX_${normName(d.TypeLookupName)}_${num ?? issued?.at?.slice(0, 10) ?? 'NA'}`,
      detail: { document: d.TypeLookupName, status: d.StatusLookupName ?? null, number: num, issuing_agency: blank(d.OrganizationAbbr) ? null : d.OrganizationAbbr,
        issued: d.IssueDtTm ?? null, expires: d.ExpiredDtTm ?? null, period_basis: 'issue date → expiry date (expiry is a date: valid through that day, UTC day precision)' } },
    period, `${ref}:doc:${normName(d.TypeLookupName)}:${num ?? issued?.at ?? ''}`)
  }
  for (const c of R.cases) {
    const s = when(c.StartDtTm, null)
    if (!s) { warnings.push(`activity ${c.ActivityId}: no zoned start time; kept only in the raw record`); continue }
    push({ attribute: 'uscg_activity',
      value_raw: `${c.TypeLookupName}${c.ProcessStatusSubTypeLookupName ? ` — ${c.ProcessStatusSubTypeLookupName}` : ''}${c.USCGZonePort ? ` (${c.USCGZonePort})` : ''}`,
      value_norm: `PSIX_ACT_${c.ActivityId}`,
      detail: { activity_id: c.ActivityId, type: c.TypeLookupName, status: c.ProcessStatusTypeLookupName ?? null,
        sub_status: c.ProcessStatusSubTypeLookupName ?? null, port: c.USCGZonePort ?? null,
        port_state_control_exam: c.PortStateControlRelatedExamination === 'true',
        administrative_deficiency_check: c.AdministrativeDeficiencyCheck === 'true' } },
    { from: s.at, to: s.at, kind: 'observed' }, `${ref}:act:${c.ActivityId}`)
  }
  return { assertions: out, warnings, summary: { id, name, callsign: blank(cs) ? null : cs, ident, idType } }
}
