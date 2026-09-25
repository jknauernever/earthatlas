/**
 * MarineCadastre AIS static identity → EarthAtlas claims (pure; no I/O).
 * Input comes from scripts/ships/bake-ais/build_tracks.py identity-YYYY-MM.ndjson:
 * rows { mmsi, attr, value, first_seen, last_seen, n }, one per distinct
 * static value per month. Semantics: docs/MARINECADASTRE_AIS.md.
 *
 * One source entity per MMSI (the only identifier AIS guarantees). The MMSI
 * itself is 'ais_self_reported': it's the transmitted id and NOAA doesn't
 * overwrite it. Every other static field is 'ais_published', because NOAA
 * may have replaced it from the USCG AIS Vessel Identification Database
 * without saying so.
 */
import { normName, normCallsign, normImo, normMmsi } from './normalize.js'

export const MC_SOURCE = {
  id: 'marinecadastre-ais',
  name: 'MarineCadastre Nationwide AIS (daily points)',
  publisher: 'NOAA Office for Coastal Management / BOEM; data from U.S. Coast Guard Navigation Center',
  homepage_url: 'https://github.com/ocm-marinecadastre/ais-vessel-traffic',
  license: 'CC0 1.0',
  license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  commercial_use: true,
  attribution_text: 'MarineCadastre AIS (NOAA / BOEM / USCG)',
  attribution_url: 'https://hub.marinecadastre.gov/pages/vesseltraffic',
  notes: 'US terrestrial receivers only; Alaska removed; ~1 position/minute. Static fields may be USCG-corrected (AVID) without marking which.',
}
export const MC_ENTITY_KIND = 'mc_mmsi'

// NOAA/USCG vessel groups for AIS + USCG extended type codes (docs/MARINECADASTRE_AIS.md).
export function vesselGroup(code) {
  const v = Number(code)
  if (!v) return 'Not available'
  if ([30, 1001, 1002].includes(v)) return 'Fishing'
  if ([31, 32, 52, 1023, 1025].includes(v)) return 'Tug / tow'
  if ([36, 37, 1019].includes(v)) return 'Pleasure craft / sailing'
  if (v === 40 || (v >= 60 && v <= 69) || [1012, 1013, 1014, 1015].includes(v)) return 'Passenger'
  if ((v >= 70 && v <= 79) || [1003, 1004, 1016].includes(v)) return 'Cargo'
  if ((v >= 80 && v <= 89) || [1017, 1024].includes(v)) return 'Tanker'
  return 'Other'
}

/**
 * MarineCadastre timestamps carry no zone marker ("2026-06-01 00:00:05"). The
 * source specification states UTC for every product ("Coordinated Universal
 * Time - UTC"), which is the one case where src/ships/CLAUDE.md allows
 * assigning UTC.
 */
export function mcTime(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).trim().replace(' ', 'T')
  const t = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`)
  if (Number.isNaN(t.getTime())) throw new Error(`unparseable MarineCadastre timestamp: ${raw}`)
  return t.toISOString()
}

/** Merge monthly rows into one per (mmsi, attr, value) with overall first/last seen. */
export function aggregateRows(rows) {
  const byMmsi = new Map()
  for (const r of rows) {
    const mmsi = String(r.mmsi)
    const key = `${r.attr}\u0001${r.value}`
    const m = byMmsi.get(mmsi) || new Map()
    const cur = m.get(key)
    const first = mcTime(r.first_seen), last = mcTime(r.last_seen)
    if (!cur) m.set(key, { attr: r.attr, value: String(r.value), first, last, n: Number(r.n) || 0 })
    else {
      if (first < cur.first) cur.first = first
      if (last > cur.last) cur.last = last
      cur.n += Number(r.n) || 0
    }
    byMmsi.set(mmsi, m)
  }
  return [...byMmsi.entries()].map(([mmsi, m]) => ({
    mmsi,
    values: [...m.values()].sort((a, b) => a.attr.localeCompare(b.attr) || a.first.localeCompare(b.first) || a.value.localeCompare(b.value)),
  }))
}

/** One aggregated MMSI → assertion rows. */
export function mapMmsi({ mmsi, values }) {
  const out = []
  const m = normMmsi(mmsi)
  const firstAll = values.reduce((a, v) => (!a || v.first < a ? v.first : a), null)
  const lastAll = values.reduce((a, v) => (!a || v.last > a ? v.last : a), null)
  out.push({ attribute: 'mmsi', value_raw: mmsi, value_norm: m.value, period_from: firstAll, period_to: lastAll,
    period_kind: 'observed', evidence_class: 'ais_self_reported', sub_record_ref: `mc:${mmsi}`,
    detail: { valid: m.valid, ship_station: m.ship, basis: 'first/last position in the baked MarineCadastre months' } })
  for (const v of values) {
    const base = { period_from: v.first, period_to: v.last, period_kind: 'observed', evidence_class: 'ais_published',
      sub_record_ref: `mc:${mmsi}`, value_raw: v.value, detail: { positions: v.n, corrected_possible: true } }
    if (v.attr === 'name') out.push({ ...base, attribute: 'name', value_norm: normName(v.value) })
    else if (v.attr === 'callsign') out.push({ ...base, attribute: 'callsign', value_norm: normCallsign(v.value) })
    else if (v.attr === 'imo') {
      const i = normImo(v.value)
      out.push({ ...base, attribute: 'imo', value_norm: i.value, detail: { ...base.detail, checksum_ok: i.valid } })
    } else if (v.attr === 'vessel_type') {
      out.push({ ...base, attribute: 'vessel_type', value_raw: `${v.value} · ${vesselGroup(v.value)}`, value_norm: `AIS_${Number(v.value)}`,
        detail: { ...base.detail, code: Number(v.value), group: vesselGroup(v.value) } })
    } else if (v.attr === 'length_m') out.push({ ...base, attribute: 'length_m', value_norm: String(Number(v.value)) })
    else if (v.attr === 'width_m') out.push({ ...base, attribute: 'width_m', value_norm: String(Number(v.value)) })
    else if (v.attr === 'transceiver') out.push({ ...base, attribute: 'transceiver', value_norm: String(v.value).toUpperCase() })
  }
  return out.filter((a) => a.value_raw !== '' && a.value_norm !== '')
}
