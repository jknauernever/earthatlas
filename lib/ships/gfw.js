/**
 * Global Fishing Watch Vessels API → EarthAtlas assertions (pure; no I/O).
 * Field semantics and quirks: docs/GFW_VESSELS_API.md.
 *
 * One GFW entry = one GFW vessel grouping: several AIS identities
 * (selfReportedInfo), registry records, owners and authorizations. The whole
 * entry becomes ONE source entity. Each claim keeps the sub-record it came
 * from (sub_record_ref), so a GFW grouping can later be split without
 * re-fetching.
 */
import { normName, normCallsign, normFlag, normImo, normMmsi, parseUtc } from './normalize.js'

export const GFW_SOURCE = {
  id: 'gfw-vessel-identity',
  name: 'Global Fishing Watch Vessels API (public-global-vessel-identity)',
  publisher: 'Global Fishing Watch, Inc.',
  homepage_url: 'https://globalfishingwatch.org/our-apis/documentation/docs/v3/vessels',
  license: 'CC BY-NC 4.0',
  license_url: 'https://creativecommons.org/licenses/by-nc/4.0/',
  commercial_use: false,
  attribution_text: 'Powered by Global Fishing Watch.',
  attribution_url: 'https://globalfishingwatch.org',
  notes: 'API token is server-side only (Terms 2.G). 50k requests/day, 1.5M/month per user. Registry data is GFW-processed; GFW does not disclose raw registry records.',
}

export const GFW_ENTITY_KIND = 'gfw_vessel_entry'

/** GFW vessel ids (selfReportedInfo[].id) in an entry: stable ids shared across GFW's APIs. */
export function memberIds(entry) {
  return (entry.selfReportedInfo || []).map((s) => s.id).filter(Boolean).sort()
}

export function registryRefs(entry) {
  return (entry.registryInfo || []).map((r) => r.vesselInfoReference || r.id).filter(Boolean).sort()
}

/**
 * What identifies a GFW entry across fetches.
 * AIS identity ids are NOT enough: GFW puts one AIS identity into several
 * entries when it can't tell whose it was. Real case, 2026-09-24: sister ships
 * CRESTY (IMO 9637143) and GOLDENEYE (IMO 9637131) share AIS id 0d8d0aedd-….
 * Registry-backed entries are therefore identified by their registry
 * references, which do not overlap. AIS-only entries (no registry data) fall
 * back to their AIS identity ids.
 */
export function entryIdentity(entry) {
  const regs = registryRefs(entry)
  if (regs.length) return { anchor: `reg:${regs[0]}`, refs: regs, refClass: 'registry' }
  const ids = memberIds(entry)
  if (ids.length) return { anchor: `ais:${ids[0]}`, refs: ids, refClass: 'ais_self_reported' }
  throw new Error('GFW entry has neither registry references nor selfReportedInfo ids')
}

const has = (v) => v !== null && v !== undefined && String(v).trim() !== ''

function yearStart(y) { return has(y) ? `${Number(y)}-01-01T00:00:00.000Z` : null }
function yearEnd(y) { return has(y) ? `${Number(y)}-12-31T23:59:59.999Z` : null }

/**
 * Map one entry to assertion rows (not yet persisted).
 * Returns { assertions, warnings }. A bad timestamp drops only the affected
 * claim and records a warning; nothing is silently guessed.
 */
export function mapEntry(entry) {
  const out = []
  const warnings = []

  const push = (a) => {
    if (!has(a.value_raw)) return
    out.push({
      detail: {},
      sub_record_ref: '',
      ...a,
      value_raw: String(a.value_raw).trim(),
      value_norm: a.value_norm ?? String(a.value_raw).trim(),
    })
  }

  const period = (from, to, where) => {
    try {
      const f = parseUtc(from), t = parseUtc(to)
      return { from: f, to: t, kind: f || t ? 'observed' : 'unknown' }
    } catch (e) {
      warnings.push(`${where}: ${e.message}`)
      return null
    }
  }

  // ── AIS identities (what the vessel broadcast) ─────────────────────────────
  for (const s of entry.selfReportedInfo || []) {
    const p = period(s.transmissionDateFrom, s.transmissionDateTo, `selfReportedInfo ${s.id}`)
    if (!p) continue
    const base = { period_from: p.from, period_to: p.to, period_kind: p.kind, evidence_class: 'ais_self_reported', sub_record_ref: s.id }
    const m = normMmsi(s.ssvid)
    push({ ...base, attribute: 'mmsi', value_raw: s.ssvid, value_norm: m.value,
      detail: { valid: m.valid, ship_station: m.ship, matchFields: s.matchFields ?? null,
        messagesCounter: s.messagesCounter ?? null, positionsCounter: s.positionsCounter ?? null } })
    push({ ...base, attribute: 'name', value_raw: s.shipname, value_norm: normName(s.shipname), detail: { gfw_nShipname: s.nShipname ?? null } })
    push({ ...base, attribute: 'callsign', value_raw: s.callsign, value_norm: normCallsign(s.callsign) })
    push({ ...base, attribute: 'flag', value_raw: s.flag, value_norm: normFlag(s.flag), detail: { basis: 'GFW flag for an AIS identity (MMSI-derived)' } })
    if (has(s.imo)) {
      const i = normImo(s.imo)
      push({ ...base, attribute: 'imo', value_raw: s.imo, value_norm: i.value, detail: { checksum_ok: i.valid } })
    }
    if (has(s.shiptype)) push({ ...base, attribute: 'vessel_type', value_raw: s.shiptype, value_norm: String(s.shiptype).toUpperCase(), detail: { byYear: s.shiptypesByYear ?? null } })
    if (has(s.geartype)) push({ ...base, attribute: 'gear_type', value_raw: s.geartype, value_norm: String(s.geartype).toUpperCase() })
  }

  // ── Registry records (as processed by GFW from 40+ registries) ─────────────
  for (const r of entry.registryInfo || []) {
    const ref = r.vesselInfoReference || r.id
    const p = period(r.transmissionDateFrom, r.transmissionDateTo, `registryInfo ${ref}`)
    if (!p) continue
    const codes = Array.isArray(r.sourceCode) ? r.sourceCode : has(r.sourceCode) ? [r.sourceCode] : []
    const base = { period_from: p.from, period_to: p.to, period_kind: p.kind, evidence_class: 'registry', sub_record_ref: ref }
    const d = { registries: codes, latestVesselInfo: r.latestVesselInfo ?? null, gfw_registry_id: r.id ?? null,
      period_basis: 'AIS window GFW matched this registry record to (not the registry validity period)' }
    if (has(r.imo)) {
      const i = normImo(r.imo)
      push({ ...base, attribute: 'imo', value_raw: r.imo, value_norm: i.value, detail: { ...d, checksum_ok: i.valid } })
    }
    if (has(r.ssvid)) {
      const m = normMmsi(r.ssvid)
      push({ ...base, attribute: 'mmsi', value_raw: r.ssvid, value_norm: m.value, detail: { ...d, valid: m.valid, ship_station: m.ship } })
    }
    push({ ...base, attribute: 'name', value_raw: r.shipname, value_norm: normName(r.shipname), detail: { ...d, gfw_nShipname: r.nShipname ?? null } })
    push({ ...base, attribute: 'callsign', value_raw: r.callsign, value_norm: normCallsign(r.callsign), detail: d })
    push({ ...base, attribute: 'flag', value_raw: r.flag, value_norm: normFlag(r.flag), detail: d })
    for (const g of [].concat(r.geartype ?? r.geartypes ?? [])) {
      push({ ...base, attribute: 'gear_type', value_raw: g, value_norm: String(g).toUpperCase(), detail: d })
    }
    if (has(r.lengthM)) push({ ...base, attribute: 'length_m', value_raw: r.lengthM, value_norm: String(Number(r.lengthM)), detail: d })
    if (has(r.tonnageGt)) push({ ...base, attribute: 'tonnage_gt', value_raw: r.tonnageGt, value_norm: String(Number(r.tonnageGt)), detail: d })
  }

  // ── Owners: registry-listed; GFW does not say registered vs beneficial ────
  for (const o of entry.registryOwners || []) {
    const p = period(o.dateFrom, o.dateTo, `registryOwners ${o.name}`)
    if (!p) continue
    push({ period_from: p.from, period_to: p.to, period_kind: p.kind, evidence_class: 'registry',
      sub_record_ref: `owner:${o.sourceCode ?? ''}:${o.ssvid ?? ''}`,
      attribute: 'registry_owner', value_raw: o.name, value_norm: normName(o.name),
      detail: { owner_flag: o.flag ?? null, ssvid: o.ssvid ?? null, registry: o.sourceCode ?? null,
        role_note: 'Owner as listed by a registry; the source does not state registered vs beneficial.' } })
  }

  // ── Public authorizations (e.g. RFMO lists) ────────────────────────────────
  for (const au of entry.registryPublicAuthorizations || entry.registryAuthorizations || []) {
    const p = period(au.dateFrom, au.dateTo, `authorization ${au.sourceCode}`)
    if (!p) continue
    const codes = [].concat(au.sourceCode ?? [])
    for (const c of codes) {
      push({ period_from: p.from, period_to: p.to, period_kind: p.kind, evidence_class: 'registry',
        sub_record_ref: `auth:${c}:${au.ssvid ?? ''}`, attribute: 'authorization', value_raw: c,
        value_norm: String(c).toUpperCase(), detail: { ssvid: au.ssvid ?? null } })
    }
  }

  // ── GFW's fused classification (models + registries) ──────────────────────
  for (const c of entry.combinedSourcesInfo || []) {
    for (const [field, attribute] of [['shiptypes', 'vessel_type'], ['geartypes', 'gear_type']]) {
      for (const t of c[field] || []) {
        push({ period_from: yearStart(t.yearFrom), period_to: yearEnd(t.yearTo),
          period_kind: has(t.yearFrom) || has(t.yearTo) ? 'observed' : 'unknown', evidence_class: 'inferred',
          sub_record_ref: `combined:${t.source ?? ''}`, attribute, value_raw: t.name, value_norm: String(t.name).toUpperCase(),
          detail: { gfw_source: t.source ?? null, granularity: 'year' } })
      }
    }
  }

  return { assertions: out, warnings }
}
