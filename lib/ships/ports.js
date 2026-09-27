/**
 * Ports reference (/ships Phase 3 step 2; Josh, 2026-09-26): our own ports, used to give real
 * names to GFW port visits. Naming rule (Josh): World Port Index name first, then GFW's label.
 * Source facts: docs/PORTS_SOURCES.md (verified live 2026-09-26). Rules: src/ships/CLAUDE.md.
 *
 *   evidence        source_records: one per WPI port / UN/LOCODE row / GFW override row / country row,
 *                   exactly as received (SHA-256 versioned, never edited)
 *   claim           ports (from WPI), countries, and port_aliases that restate a source's own key
 *                   (wpi_number, unlocode, gfw_anchorage_s2 from the overrides list)
 *   interpretation  port_aliases of kind gfw_port_label (+ the anchorage cells seen in visits):
 *                   which of our ports a GFW port label is, with method, distance and candidates.
 *                   port_visits.port_id is filled from these; a later re-run can change its mind.
 *
 * Pure parsing and matching first (unit-tested with recorded live extracts), then persistence
 * (bulk, idempotent), then the matcher that runs over the stored visits.
 */
import { canonicalJson, sha256, upsertSource } from './store.js'
import { withTx } from './db.js'

// ── Sources (licence facts: docs/PORTS_SOURCES.md) ───────────────────────────

export const WPI_SOURCE = {
  id: 'nga-wpi',
  name: 'World Port Index (NGA Pub 150)',
  publisher: 'National Geospatial-Intelligence Agency (NGA), Maritime Safety Information',
  homepage_url: 'https://msi.nga.mil/Publications/WPI',
  license: 'US Government work, no copyright claimed (17 U.S.C. §105)',
  license_url: 'https://www.law.cornell.edu/uscode/text/17/105',
  commercial_use: true,
  attribution_text: 'World Port Index (Pub 150), National Geospatial-Intelligence Agency.',
  attribution_url: 'https://msi.nga.mil/Publications/WPI',
  notes: 'Pub 150 title page: "NO COPYRIGHT CLAIMED UNDER TITLE 17 U.S.C." No attribution is legally required; we credit it '
    + '(inline-provenance rule). Downloaded from https://msi.nga.mil/api/publications/world-port-index?output=json (no auth). '
    + 'No edition/date field: dataset_version = retrieval date. Coordinates are rounded to whole arc-minutes.',
}
export const LOCODE_SOURCE = {
  id: 'unece-unlocode',
  name: 'UN/LOCODE code list (UNECE)',
  publisher: 'United Nations Economic Commission for Europe (UNECE), UN/CEFACT',
  homepage_url: 'https://unlocode.unece.org/publications',
  license: 'CC BY 4.0 (site footer: "All UN/CEFACT standards are free to use under CC By 4.0 license")',
  license_url: 'https://creativecommons.org/licenses/by/4.0/',
  commercial_use: true,
  attribution_text: 'UN/LOCODE, United Nations Economic Commission for Europe (UNECE), CC BY 4.0.',
  attribution_url: 'https://unlocode.unece.org',
  notes: 'LICENCE CONFLICT (flagged for Josh 2026-09-26): the footer grants CC BY 4.0 for UN/CEFACT standards, but the '
    + 'site\'s /terms page is the general UN text ("personal, non-commercial use, without any right to resell or '
    + 'redistribute them or to compile or create derivative works therefrom"). We store codes as a join key only and '
    + 'show nothing from UN/LOCODE on the card. Download: production release zip linked from /publications.',
}
export const OVERRIDES_SOURCE = {
  id: 'gfw-anchorage-overrides',
  name: 'GFW pipe-anchorages: anchorage_overrides.csv',
  publisher: 'Global Fishing Watch, Inc.',
  homepage_url: 'https://github.com/GlobalFishingWatch/pipe-anchorages/blob/main/src/pipe_anchorages/assets/data/port_lists/anchorage_overrides.csv',
  license: 'Apache-2.0 (repository licence)',
  license_url: 'https://github.com/GlobalFishingWatch/pipe-anchorages/blob/main/LICENSE',
  commercial_use: true,
  attribution_text: 'Anchorage names: Global Fishing Watch pipe-anchorages overrides list (Apache-2.0).',
  attribution_url: 'https://github.com/GlobalFishingWatch/pipe-anchorages',
  notes: 'The manually reviewed / user-contributed name list GFW applies first when naming anchorages '
    + '(globalfishingwatch.org/datasets-and-code-anchorages). Columns s2id,latitude,longitude,label,sublabel,iso3. '
    + 'Apache-2.0 is the repository licence; no separate data licence was found for the CSV.',
}
export const COUNTRIES_SOURCE = {
  id: 'geonames-countries',
  name: 'GeoNames countryInfo.txt (ISO 3166 codes and English country names)',
  publisher: 'GeoNames',
  homepage_url: 'https://download.geonames.org/export/dump/countryInfo.txt',
  license: 'CC BY 4.0',
  license_url: 'https://creativecommons.org/licenses/by/4.0/',
  commercial_use: true,
  attribution_text: 'Country names: GeoNames (geonames.org), CC BY 4.0.',
  attribution_url: 'https://www.geonames.org',
  notes: 'readme.txt of the dump: "This work is licensed under a Creative Commons Attribution 4.0 License". Used to turn '
    + 'GFW\'s ISO3 and WPI/UN/LOCODE alpha-2 into one English name. UN M49 was not used: unstats.un.org falls under the '
    + 'general UN terms (personal, non-commercial, no redistribution).',
}
export const PORT_SOURCES = [WPI_SOURCE, LOCODE_SOURCE, OVERRIDES_SOURCE, COUNTRIES_SOURCE]

export const WPI_URL = 'https://msi.nga.mil/api/publications/world-port-index?output=json'
export const LOCODE_RELEASE_URL = 'https://opensource.unicc.org/un/unece/uncefact/vocab-locode/-/jobs/artifacts/2025-1/download?job=package-release'
export const LOCODE_PRERELEASE_URL = 'https://unlocode.unece.org/downloads/unlocode-latest.zip'
export const OVERRIDES_URL = 'https://raw.githubusercontent.com/GlobalFishingWatch/pipe-anchorages/main/src/pipe_anchorages/assets/data/port_lists/anchorage_overrides.csv'
export const COUNTRIES_URL = 'https://download.geonames.org/export/dump/countryInfo.txt'

export const KIND = { wpi: 'wpi_port', locode: 'unlocode_row', override: 'gfw_anchorage_override', country: 'country' }

// ── Pure parsing ─────────────────────────────────────────────────────────────

const str = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v))
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
/** Collapse runs of whitespace (WPI has "Roche  Harbor"); the raw value stays in the source record. */
export const tidyName = (s) => (str(s) ? String(s).replace(/\s+/g, ' ').trim() : null)

/** RFC 4180 CSV → arrays of fields (quotes, doubled quotes, CRLF). */
export function csvRows(text) {
  const rows = []
  let row = [], f = '', q = false
  const t = String(text).replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else q = false } else f += ch; continue }
    if (ch === '"') q = true
    else if (ch === ',') { row.push(f); f = '' }
    else if (ch === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = '' }
    else f += ch
  }
  if (f || row.length) { row.push(f.replace(/\r$/, '')); rows.push(row) }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

export const HARBOR_SIZE = { L: 'large', M: 'medium', S: 'small', V: 'very small' }

/** One WPI JSON port → our port fields (the raw object is kept as the source record). */
export function mapWpiPort(p) {
  const n = num(p?.portNumber)
  if (n === null) return { error: 'WPI port without portNumber' }
  const lat = num(p.ycoord), lon = num(p.xcoord)
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { key: String(n), error: 'WPI port without valid ycoord/xcoord' }
  const unlo = str(p.unloCode) ? String(p.unloCode).trim().toUpperCase().replace(/\s+/g, ' ') : null
  return {
    key: String(n),
    port: {
      wpi_number: n, name: tidyName(p.portName), name_raw: p.portName ?? null, alternate_name: str(p.alternateName),
      iso2: str(p.countryCode)?.toUpperCase() ?? null, country_name_wpi: str(p.countryName),
      lat, lon, harbor_size: str(p.harborSize), harbor_type: str(p.harborType),
      unlocode: unlo && /^[A-Z]{2} [A-Z0-9]{3}$/.test(unlo) ? unlo : null, unlocode_raw: str(p.unloCode),
      region_name: str(p.regionName), global_id: str(p.globalId),
    },
  }
}

/** UN/LOCODE coordinates "ddmmN dddmmW" → decimal degrees (null when absent or malformed). */
export function parseLocodeCoords(s) {
  const m = /^(\d{2})(\d{2})([NS])\s+(\d{3})(\d{2})([EW])$/.exec(String(s || '').trim())
  if (!m) return null
  const lat = (Number(m[1]) + Number(m[2]) / 60) * (m[3] === 'S' ? -1 : 1)
  const lon = (Number(m[4]) + Number(m[5]) / 60) * (m[6] === 'W' ? -1 : 1)
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 }
}

export const LOCODE_FIELDS = ['Change', 'Country', 'Location', 'Name', 'NameWoDiacritics', 'Subdivision', 'Function', 'Status', 'Date', 'IATA', 'Coordinates', 'Remarks']
/**
 * One row of the official UN/LOCODE CSV (no header; the column order of the official CodeListPart files,
 * verified 2026-09-26: Change, Country, Location, Name, NameWoDiacritics, Subdivision, Function, Status,
 * Date, IATA, Coordinates, Remarks). Country header rows (".ANDORRA", no Location) return { skip }.
 */
export function mapLocodeRow(fields) {
  const row = Object.fromEntries(LOCODE_FIELDS.map((k, i) => [k, fields[i] ?? '']))
  const cc = row.Country.trim().toUpperCase(), loc = row.Location.trim().toUpperCase()
  if (!loc) return { skip: 'country header row', row }
  if (!/^[A-Z]{2}$/.test(cc) || !/^[A-Z0-9]{3}$/.test(loc)) return { error: `bad code ${cc} ${loc}`, row }
  const fn = row.Function
  return {
    key: `${cc} ${loc}`, row,
    locode: { locode: `${cc} ${loc}`, iso2: cc, name: tidyName(row.Name), function: fn, is_port: fn[0] === '1',
      change: str(row.Change), status: str(row.Status), coords: parseLocodeCoords(row.Coordinates) },
  }
}

/**
 * anchorage_overrides.csv text → { header, rows: [{ key, raw, override }], errors: [{ error, raw }] } (raw = the row as
 * an object, exactly as in the file). errors = rows whose s2id is not a token (431 on 2026-09-26, e.g. "1.46E+83":
 * spreadsheet-mangled); they are still stored as evidence under an 'unkeyed:' key.
 */
export function parseOverridesCsv(text) {
  const [head, ...rows] = csvRows(text)
  const out = [], errors = []
  for (const r of rows) {
    const raw = Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))
    const m = mapOverrideRow(raw)
    if (m.error) errors.push({ error: m.error, raw }); else out.push({ ...m, raw })
  }
  return { header: head, rows: out, errors }
}

/** One anchorage_overrides.csv row (header s2id,latitude,longitude,label,sublabel,iso3) → fields. */
export function mapOverrideRow(obj) {
  const s2 = str(obj?.s2id)?.toLowerCase()
  if (!s2 || !/^[0-9a-f]{1,16}$/.test(s2)) return { error: `bad s2id ${obj?.s2id}` }
  return { key: s2, override: { s2id: s2, lat: num(obj.latitude), lon: num(obj.longitude), label: tidyName(obj.label), sublabel: tidyName(obj.sublabel), iso3: str(obj.iso3)?.toUpperCase() ?? null } }
}

export const COUNTRY_FIELDS = ['ISO', 'ISO3', 'ISO-Numeric', 'fips', 'Country', 'Capital', 'Area(in sq km)', 'Population', 'Continent', 'tld',
  'CurrencyCode', 'CurrencyName', 'Phone', 'Postal Code Format', 'Postal Code Regex', 'Languages', 'geonameid', 'neighbours', 'EquivalentFipsCode']
/** GeoNames countryInfo.txt (tab-separated, '#' comment lines) → [{ key, row, country }]. */
export function parseCountryInfo(text) {
  const out = []
  for (const line of String(text).split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue
    const f = line.replace(/\r$/, '').split('\t')
    const row = Object.fromEntries(COUNTRY_FIELDS.map((k, i) => [k, f[i] ?? '']))
    const iso2 = row.ISO.trim().toUpperCase(), iso3 = row.ISO3.trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(iso2) || !/^[A-Z]{3}$/.test(iso3) || !row.Country.trim()) continue
    out.push({ key: iso2, row, line: line.replace(/\r$/, ''), country: { iso2, iso3, iso_numeric: str(row['ISO-Numeric']), name: row.Country.trim() } })
  }
  return out
}

// ── Pure matching ────────────────────────────────────────────────────────────

export const MATCH_KM = 4        // GFW groups anchorages within 4 km into one port (docs/PORTS_SOURCES.md §4)
export const CLEAR_RATIO = 0.5   // with several WPI ports in range, the nearest wins only at < half the next distance
export const NEAR_KM = 25        // last resort: "near <nearest WPI port>" (approximate, labelled so; Josh 2026-09-26)

/** Great-circle distance in km (mean Earth radius 6371.0088 km). */
export function haversineKm(aLat, aLon, bLat, bLon) {
  const r = (d) => (d * Math.PI) / 180
  const dLat = r(bLat - aLat), dLon = r(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)))
}
const round3 = (x) => Math.round(x * 1000) / 1000

/** GFW fills `name` with its own code for unnamed ports ("USA-1843", "VIR-19"); that is not a name. */
export const isCodeName = (s) => /^[A-Z]{3}-\d+$/i.test(String(s || '').trim())
// A WPI entry that names a facility rather than the place (Josh 2026-09-26: GFW's label beats a
// terminal name, e.g. "Coles Bay Oil Terminal", "Acajutla Offshore Terminal").
export const isFacilityName = (s) => /\b(terminal|refinery|oil|offshore|jetty|buoy|berth|loading|mooring|pipeline)\b/i.test(String(s || ''))

/** The value carrying more than half of the weight, or null (ties and pluralities don't count). */
function majority(weights) {
  const tot = [...weights.values()].reduce((a, b) => a + b, 0)
  const [best] = [...weights.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  return best && best[1] * 2 > tot ? best[0] : null
}

/**
 * What the overrides list says about one S2 cell (pure). rows: every stored row for that cell.
 * Code-like labels ("ESP-113") are not names. One distinct real label → { label, sublabel, record_id };
 * several → { ambiguous: [labels] }; none → null.
 */
export function cellOverride(rows) {
  const real = (rows || []).filter((r) => r?.label && !isCodeName(r.label))
  const names = [...new Set(real.map((r) => r.label.toUpperCase()))].sort()
  if (!names.length) return null
  if (names.length > 1) return { ambiguous: names }
  const r = real[0]
  return { label: r.label, sublabel: r.sublabel ?? null, record_id: r.record_id ?? null }
}

/**
 * Decide which port a GFW port label is, and what to call it (pure). Conservative: a wrong name is
 * worse than a raw label.
 *   label:     { label, iso3, points: [{ anchorage_id, lat, lon, name, iso3, visits }] }  (anchorages seen for it)
 *   wpi:       [{ wpi_number, name, iso3, lat, lon, record_id }]  (iso3 already derived from WPI's alpha-2)
 *   overrides: Map s2id → { label, sublabel, iso3, lat, lon, record_id }
 * Order (Josh 2026-09-26: WPI first, then GFW):
 *   (a) WPI port within MATCH_KM of any anchorage point, same country: one → it; several → the nearest
 *       only when < CLEAR_RATIO × the next, else candidates and no WPI name;
 *   (b) the overrides list's label for the label's anchorage cells (one label, or one with > half the visits);
 *   (b2) GFW's own override rule: the nearest overrides-list point within MATCH_KM of an anchorage
 *        (lower confidence than an exact cell; Josh 2026-09-26);
 *   (c) GFW's own anchorage name (not a code like "USA-1843"; one, or one with > half the visits);
 *   (d) approximate: the nearest WPI port within NEAR_KM, same country, shown as "near X · N km"
 *       (method wpi_near_approx; it says where the place is, never that it IS that port);
 *   (e) unnamed: the raw label is shown.
 * A WPI pick that is a facility name (isFacilityName) gives way to (b)/(b2)/(c) when one of them has
 * a name; the WPI port stays recorded as the match (wpi_number) either way.
 */
export function matchLabel(label, wpi, overrides) {
  const pts = (label.points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
  const out = { label: label.label, iso3: label.iso3 ?? null, method: 'unnamed', name: null, name_source_id: null, name_record_id: null,
    wpi_number: null, distance_km: null, candidates: [], notes: [] }
  // (a) WPI within 4 km (and, for rule d, the nearest one within NEAR_KM)
  const near = []
  let approx = null
  for (const w of wpi) {
    let best = Infinity, via = null
    for (const p of pts) { const d = haversineKm(p.lat, p.lon, w.lat, w.lon); if (d < best) { best = d; via = p.anchorage_id } }
    if (best <= MATCH_KM) near.push({ wpi_number: w.wpi_number, name: w.name, iso3: w.iso3, distance_km: round3(best), via_anchorage: via, record_id: w.record_id ?? null })
    const sameCountry = !label.iso3 || !w.iso3 || w.iso3 === label.iso3
    if (sameCountry && best <= NEAR_KM && (!approx || best < approx.distance_km)) approx = { wpi_number: w.wpi_number, name: w.name, distance_km: round3(best), via_anchorage: via, record_id: w.record_id ?? null }
  }
  near.sort((a, b) => a.distance_km - b.distance_km || a.wpi_number - b.wpi_number)
  const same = near.filter((n) => !out.iso3 || !n.iso3 || n.iso3 === out.iso3)
  for (const n of near) if (!same.includes(n)) out.candidates.push({ kind: 'wpi', reason: 'other country', ...n })
  let pick = null
  if (same.length === 1) pick = { ...same[0], method: 'wpi_within_4km' }
  else if (same.length > 1) {
    if (same[0].distance_km < CLEAR_RATIO * same[1].distance_km) pick = { ...same[0], method: 'wpi_nearest_clear' }
    else { for (const n of same) out.candidates.push({ kind: 'wpi', reason: 'not clearly nearest', ...n }); out.notes.push(`${same.length} WPI ports within ${MATCH_KM} km, none clearly nearest`) }
  }
  let wpiResult = null
  if (pick) {
    for (const n of same.slice(1)) out.candidates.push({ kind: 'wpi', reason: 'farther', ...n })
    wpiResult = { ...out, method: pick.method, name: pick.name, name_source_id: WPI_SOURCE.id, name_record_id: pick.record_id,
      wpi_number: pick.wpi_number, distance_km: pick.distance_km, via_anchorage: pick.via_anchorage }
    if (!isFacilityName(pick.name)) return wpiResult
    out.notes.push(`WPI "${pick.name}" names a facility; a GFW label wins if there is one`)
  }
  // A GFW-based name found below, carried with the WPI match when WPI named a facility.
  const withWpi = (r) => (wpiResult ? { ...r, wpi_number: wpiResult.wpi_number, distance_km: wpiResult.distance_km,
    via_anchorage: wpiResult.via_anchorage, method: `${r.method}_over_wpi_facility` } : r)
  // (b) overrides list (exact S2 cell; a cell the list repeats with different real labels is not used)
  const ov = new Map(), ovRec = new Map()
  for (const p of pts) {
    const cell = String(p.anchorage_id || '').toLowerCase()
    const o = cellOverride(overrides.get(cell))
    if (!o) continue
    if (o.ambiguous) { out.notes.push(`overrides list names cell ${cell} differently: ${o.ambiguous.join(' / ')}`); continue }
    const k = o.label.toUpperCase()
    ov.set(k, (ov.get(k) || 0) + (p.visits || 1))
    if (!ovRec.has(k)) ovRec.set(k, { ...o, s2id: cell })
  }
  if (ov.size) {
    const k = ov.size === 1 ? [...ov.keys()][0] : majority(ov)
    if (k) {
      const o = ovRec.get(k)
      return withWpi({ ...out, method: ov.size === 1 ? 'gfw_override_label' : 'gfw_override_label_majority', name: o.label,
        name_source_id: OVERRIDES_SOURCE.id, name_record_id: o.record_id ?? null, override_s2id: o.s2id })
    }
    for (const [name, w] of ov) out.candidates.push({ kind: 'override', name, visits: w })
    out.notes.push('overrides list gives several labels, none with more than half the visits')
  }
  // (b2) GFW's own override rule: nearest overrides-list point within MATCH_KM of an anchorage point.
  if (!ov.size) {
    let best = null
    for (const [cell, rows] of overrides) {
      const o = cellOverride(rows)
      if (!o || o.ambiguous) continue
      const r0 = (rows || [])[0]
      if (!Number.isFinite(r0?.lat) || !Number.isFinite(r0?.lon)) continue
      if (out.iso3 && r0.iso3 && r0.iso3 !== out.iso3) continue
      for (const p of pts) {
        const d = haversineKm(p.lat, p.lon, r0.lat, r0.lon)
        if (d <= MATCH_KM && (!best || d < best.d)) best = { d, o, cell }
      }
    }
    if (best) return withWpi({ ...out, method: 'gfw_override_nearest', name: best.o.label, name_source_id: OVERRIDES_SOURCE.id,
      name_record_id: best.o.record_id ?? null, override_s2id: best.cell, override_distance_km: round3(best.d) })
  }
  // (c) GFW's own name
  const nm = new Map(), nmRec = new Map()
  for (const p of [...pts].sort((a, b) => (b.visits || 1) - (a.visits || 1))) {
    if (!p.name) continue
    if (isCodeName(p.name)) { if (!out.notes.includes(`GFW name "${p.name}" is a code, not a name`)) out.notes.push(`GFW name "${p.name}" is a code, not a name`); continue }
    const k = p.name.toUpperCase()
    nm.set(k, (nm.get(k) || 0) + (p.visits || 1))
    if (!nmRec.has(k)) nmRec.set(k, p.record_id ?? null) // a GFW event whose anchorage carries this name
  }
  if (nm.size) {
    const k = nm.size === 1 ? [...nm.keys()][0] : majority(nm)
    if (k) return withWpi({ ...out, method: 'gfw_event_name', name: k, name_source_id: 'gfw-port-visits', name_record_id: nmRec.get(k) })
    for (const [name, w] of nm) out.candidates.push({ kind: 'gfw_name', name, visits: w })
  }
  if (wpiResult) return wpiResult
  // (d) approximate: nearest WPI port within NEAR_KM (and not already rejected as "not clearly nearest").
  if (approx && !out.candidates.some((c) => c.kind === 'wpi' && c.reason === 'not clearly nearest')) {
    return { ...out, method: 'wpi_near_approx', name: approx.name, name_source_id: WPI_SOURCE.id, name_record_id: approx.record_id,
      wpi_number: approx.wpi_number, distance_km: approx.distance_km, via_anchorage: approx.via_anchorage }
  }
  return out
}

/**
 * Group anchorage points by GFW port label from stored visit rows (pure).
 * rows: [{ port_label, anchorage_id, name, iso3, lat, lon, visits }] (one per label × anchorage).
 */
export function labelsFromAnchorages(rows) {
  const by = new Map()
  for (const r of rows) {
    if (!r.port_label) continue
    let l = by.get(r.port_label)
    if (!l) by.set(r.port_label, (l = { label: r.port_label, iso3: null, points: [], iso3w: new Map() }))
    l.points.push({ anchorage_id: r.anchorage_id, lat: num(r.lat), lon: num(r.lon), name: str(r.name), iso3: str(r.iso3), visits: Number(r.visits) || 1,
      ...(r.record_id != null ? { record_id: Number(r.record_id) } : {}) })
    if (r.iso3) l.iso3w.set(r.iso3, (l.iso3w.get(r.iso3) || 0) + (Number(r.visits) || 1))
  }
  return [...by.values()].map(({ iso3w, ...l }) => ({ ...l, iso3: [...iso3w.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }))
}

// ── Persistence ──────────────────────────────────────────────────────────────

export async function ensurePortSources(pool, S) {
  await withTx(pool, async (c) => { for (const s of PORT_SOURCES) await upsertSource(c, S, s) })
}

/**
 * Bulk-store raw source rows (one transaction per call): one source entity per key, one source record per
 * distinct payload (SHA-256). A key the file repeats with different content keeps every version (the
 * overrides list repeats 4,394 S2 cells with different labels). Idempotent: re-importing the same payload
 * only touches last_* columns. items: [{ key, payload }].
 * Returns { byKey: Map key → record ids in item order, created: number of new records }.
 */
export async function storeRawRecords(c, S, sourceId, kind, items, { runId = null, retrievalUrl = null, datasetVersion = null } = {}) {
  if (!items.length) return { byKey: new Map(), created: 0 }
  const withSha = items.map((i) => ({ ...i, sha: sha256(canonicalJson(i.payload)) }))
  const uniq = [...new Map(withSha.map((i) => [`${i.key}\u0001${i.sha}`, i])).values()]
  const keys = [...new Set(uniq.map((i) => i.key))]
  const { rows: ents } = await c.query(
    `INSERT INTO ${S}.source_entities (source_id, entity_kind, entity_key)
     SELECT $1, $2, k FROM unnest($3::text[]) AS k
     ON CONFLICT (source_id, entity_kind, entity_key) DO UPDATE SET last_seen_at = now()
     RETURNING id, entity_key`, [sourceId, kind, keys])
  const entId = new Map(ents.map((e) => [e.entity_key, e.id]))
  const { rows: recs } = await c.query(
    `INSERT INTO ${S}.source_records (source_id, source_entity_id, payload, payload_sha256, dataset_version,
       retrieval_url, first_import_run_id, last_import_run_id)
     SELECT $1, r.eid, r.payload, r.sha, $2, $3, $4, $4
       FROM jsonb_to_recordset($5::jsonb) AS r(eid bigint, payload jsonb, sha text)
     ON CONFLICT (source_entity_id, payload_sha256) DO UPDATE
       SET last_import_run_id = EXCLUDED.last_import_run_id, last_retrieved_at = now()
     RETURNING id, source_entity_id, payload_sha256, (xmax = 0) AS created`,
    [sourceId, datasetVersion, retrievalUrl, runId,
      JSON.stringify(uniq.map((i) => ({ eid: entId.get(i.key), payload: i.payload, sha: i.sha })))])
  const rec = new Map(recs.map((r) => [`${r.source_entity_id}\u0001${r.payload_sha256}`, r.id]))
  const byKey = new Map()
  for (const i of withSha) {
    const id = rec.get(`${entId.get(i.key)}\u0001${i.sha}`)
    const l = byKey.get(i.key) || []
    if (!l.includes(id)) l.push(id)
    byKey.set(i.key, l)
  }
  return { byKey, created: recs.filter((r) => r.created).length }
}

/** Countries (GeoNames rows) → ships.countries. Idempotent. */
export async function ingestCountries(c, S, parsed, opts = {}) {
  const recs = await storeRawRecords(c, S, COUNTRIES_SOURCE.id, KIND.country, parsed.map((p) => ({ key: p.key, payload: { line: p.line, fields: p.row } })), opts)
  const rows = parsed.map((p) => ({ ...p.country, rid: recs.byKey.get(p.key).at(-1) }))
  const { rowCount } = await c.query(
    `INSERT INTO ${S}.countries (iso2, iso3, iso_numeric, name, source_id, source_record_id)
     SELECT r.iso2, r.iso3, r.iso_numeric, r.name, $2, r.rid FROM jsonb_to_recordset($1::jsonb) AS r(iso2 text, iso3 text, iso_numeric text, name text, rid bigint)
     ON CONFLICT (iso2) DO UPDATE SET iso3 = EXCLUDED.iso3, iso_numeric = EXCLUDED.iso_numeric, name = EXCLUDED.name,
       source_id = EXCLUDED.source_id, source_record_id = EXCLUDED.source_record_id, updated_at = now()
     WHERE (${S}.countries.iso3, ${S}.countries.name, ${S}.countries.source_record_id) IS DISTINCT FROM (EXCLUDED.iso3, EXCLUDED.name, EXCLUDED.source_record_id)`,
    [JSON.stringify(rows), COUNTRIES_SOURCE.id])
  return { rows: parsed.length, recordsCreated: recs.created, countriesChanged: rowCount }
}

/**
 * WPI ports (raw JSON objects) → source records + ships.ports (origin 'wpi') + aliases wpi_number / unlocode.
 * Idempotent; a changed WPI record updates the port's fields (the old raw record stays).
 */
export async function ingestWpiPorts(c, S, raw, opts = {}) {
  const mapped = [], errors = []
  for (const p of raw) { const m = mapWpiPort(p); if (m.error) errors.push(`${m.key ?? '?'}: ${m.error}`); else mapped.push({ ...m, raw: p }) }
  const recs = await storeRawRecords(c, S, WPI_SOURCE.id, KIND.wpi, mapped.map((m) => ({ key: m.key, payload: m.raw })), opts)
  const rows = mapped.map((m) => ({ ...m.port, rid: recs.byKey.get(m.key).at(-1), key: m.key }))
  const { rows: ports } = await c.query(
    `INSERT INTO ${S}.ports AS t (origin, origin_key, name, name_source_id, name_field, name_method, name_source_record_id,
       iso2, iso3, lat, lon, harbor_size, harbor_type, unlocode, wpi_number, detail)
     SELECT 'wpi', r.key, r.name, $2, 'portName', 'wpi_portName', r.rid, r.iso2, cn.iso3, r.lat, r.lon, r.harbor_size, r.harbor_type,
            r.unlocode, r.wpi_number, jsonb_build_object('alternate_name', r.alternate_name, 'country_name_wpi', r.country_name_wpi, 'region_name', r.region_name, 'global_id', r.global_id)
       FROM jsonb_to_recordset($1::jsonb) AS r(key text, wpi_number int, name text, alternate_name text, iso2 text, country_name_wpi text,
            lat double precision, lon double precision, harbor_size text, harbor_type text, unlocode text, region_name text, global_id text, rid bigint)
       LEFT JOIN ${S}.countries cn ON cn.iso2 = r.iso2
     ON CONFLICT (origin, origin_key) DO UPDATE SET name = EXCLUDED.name, name_source_record_id = EXCLUDED.name_source_record_id,
       iso2 = EXCLUDED.iso2, iso3 = EXCLUDED.iso3, lat = EXCLUDED.lat, lon = EXCLUDED.lon, harbor_size = EXCLUDED.harbor_size,
       harbor_type = EXCLUDED.harbor_type, unlocode = EXCLUDED.unlocode, detail = EXCLUDED.detail, updated_at = now()
     WHERE (t.name_source_record_id, t.iso3) IS DISTINCT FROM (EXCLUDED.name_source_record_id, EXCLUDED.iso3)
     RETURNING id, origin_key, (xmax = 0) AS created`,
    [JSON.stringify(rows), WPI_SOURCE.id])
  const { rows: all } = await c.query(`SELECT id, origin_key FROM ${S}.ports WHERE origin = 'wpi' AND origin_key = ANY($1)`, [rows.map((r) => r.key)])
  const pid = new Map(all.map((p) => [p.origin_key, p.id]))
  const aliases = []
  for (const r of rows) {
    aliases.push({ port_id: pid.get(r.key), key_kind: 'wpi_number', key: r.key, name_raw: r.name_raw ?? r.name, lat: r.lat, lon: r.lon, rid: r.rid, method: 'source_key', detail: {} })
    if (r.unlocode) aliases.push({ port_id: pid.get(r.key), key_kind: 'unlocode', key: r.unlocode, name_raw: r.name_raw ?? r.name, lat: r.lat, lon: r.lon, rid: r.rid, method: 'wpi_unloCode', detail: {} })
  }
  await upsertAliases(c, S, WPI_SOURCE.id, aliases)
  return { rows: raw.length, mapped: mapped.length, errors, recordsCreated: recs.created,
    portsWritten: ports.length, portsCreated: ports.filter((p) => p.created).length }
}

/** Upsert source-key aliases (accepted, method recorded). Same (port, kind, key, source) → last_seen + fields. */
async function upsertAliases(c, S, sourceId, aliases) {
  if (!aliases.length) return 0
  const { rowCount } = await c.query(
    `INSERT INTO ${S}.port_aliases AS t (port_id, source_id, key_kind, key, name_raw, lat, lon, source_record_id, status, method, distance_km, detail)
     SELECT r.port_id, $2, r.key_kind, r.key, r.name_raw, r.lat, r.lon, r.rid, 'accepted', r.method, r.distance_km, coalesce(r.detail, '{}')
       FROM jsonb_to_recordset($1::jsonb) AS r(port_id bigint, key_kind text, key text, name_raw text, lat double precision, lon double precision,
            rid bigint, method text, distance_km double precision, detail jsonb)
     ON CONFLICT (port_id, key_kind, key, source_id) DO UPDATE SET name_raw = EXCLUDED.name_raw, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
       source_record_id = EXCLUDED.source_record_id, method = EXCLUDED.method, distance_km = EXCLUDED.distance_km, detail = EXCLUDED.detail,
       status = CASE WHEN t.status = 'superseded' THEN 'accepted' ELSE t.status END, last_seen_at = now()`,
    [JSON.stringify(aliases), sourceId])
  return rowCount
}

/**
 * UN/LOCODE rows → source records; then each WPI unloCode alias is checked against them (detail.locode:
 * found / is_port / name / record id). The LOCODE key itself comes from WPI (public domain), so the
 * PortWatch crosswalk (its ports carry LOCODE) works through port_aliases key_kind 'unlocode'.
 */
export async function ingestLocodeRows(c, S, mapped, opts = {}) {
  const recs = await storeRawRecords(c, S, LOCODE_SOURCE.id, KIND.locode, mapped.map((m) => ({ key: m.key, payload: m.row })), opts)
  return { rows: mapped.length, recordsCreated: recs.created }
}

/** Annotate the unlocode aliases with what the stored UN/LOCODE rows say (re-runnable). */
export async function checkLocodeAliases(c, S) {
  const { rowCount } = await c.query(
    `UPDATE ${S}.port_aliases a SET detail = a.detail || jsonb_build_object('locode', CASE WHEN r.id IS NULL
         THEN jsonb_build_object('found', false)
         ELSE jsonb_build_object('found', true, 'record_id', r.id, 'name', r.payload->>'Name', 'function', r.payload->>'Function',
                                 'is_port', left(r.payload->>'Function', 1) = '1', 'status', r.payload->>'Status', 'dataset_version', r.dataset_version) END)
       FROM ${S}.port_aliases a2
       LEFT JOIN LATERAL (SELECT sr.id, sr.payload, sr.dataset_version FROM ${S}.source_entities se
                            JOIN ${S}.source_records sr ON sr.source_entity_id = se.id
                           WHERE se.source_id = $1 AND se.entity_kind = $2 AND se.entity_key = a2.key
                           ORDER BY sr.last_retrieved_at DESC, sr.id DESC LIMIT 1) r ON true
      WHERE a.id = a2.id AND a.key_kind = 'unlocode'`, [LOCODE_SOURCE.id, KIND.locode])
  const [s] = (await c.query(`SELECT count(*) FILTER (WHERE (detail->'locode'->>'found')::boolean) AS found,
       count(*) FILTER (WHERE NOT (detail->'locode'->>'found')::boolean) AS missing,
       count(*) FILTER (WHERE (detail->'locode'->>'is_port')::boolean) AS port_function
       FROM ${S}.port_aliases WHERE key_kind = 'unlocode'`)).rows
  return { checked: rowCount, found: Number(s.found), missing: Number(s.missing), portFunction: Number(s.port_function) }
}

/** Overrides CSV rows → source records (one per S2 cell). Names are read from these by the matcher. */
export async function ingestOverrides(c, S, parsed, opts = {}) {
  const recs = await storeRawRecords(c, S, OVERRIDES_SOURCE.id, KIND.override, parsed.map((p) => ({ key: p.key, payload: p.raw })), opts)
  return { rows: parsed.length, recordsCreated: recs.created }
}

// ── Matching over stored visits (re-runnable) ────────────────────────────────

/**
 * Resolve GFW port labels seen in port_visits to our ports, then fill port_visits.port_id.
 * - Every anchorage slot (start / intermediate / end) contributes its point to its own label.
 * - A label matched to a WPI port → alias gfw_port_label on that port. Otherwise a port of origin
 *   'gfw_port_label' is created (or updated) for it, named by (b)/(c) or left unnamed.
 * - An accepted alias whose decision changed is marked 'superseded' (kept), never deleted.
 * - The anchorage cells seen are stored as gfw_anchorage_s2 aliases of the same port.
 * labels: optional list to limit the run (API: the labels of one vessel's visits). Returns stats + decisions.
 */
export async function matchPortLabels(c, S, { labels = null } = {}) {
  await c.query(`SELECT pg_advisory_xact_lock(hashtext('ships.ports.match'))`)
  const lim = labels ? `AND x.port_label = ANY($1)` : ''
  const { rows: anch } = await c.query(
    `SELECT x.port_label, x.anchorage_id, max(x.name) AS name, max(x.iso3) AS iso3, avg(x.lat) AS lat, avg(x.lon) AS lon, count(*)::int AS visits,
            max(pv.last_source_record_id) FILTER (WHERE x.name IS NOT NULL) AS record_id
       FROM ${S}.port_visits pv
       CROSS JOIN LATERAL (VALUES (pv.start_port_label, pv.start_anchorage_id, pv.start_name, pv.start_iso3, pv.start_lat, pv.start_lon),
                                  (pv.int_port_label, pv.int_anchorage_id, pv.int_name, pv.int_iso3, pv.int_lat, pv.int_lon),
                                  (pv.end_port_label, pv.end_anchorage_id, pv.end_name, pv.end_iso3, pv.end_lat, pv.end_lon))
                          AS x(port_label, anchorage_id, name, iso3, lat, lon)
      WHERE pv.status = 'active' AND x.port_label IS NOT NULL ${lim}
      GROUP BY x.port_label, x.anchorage_id`, labels ? [labels] : [])
  const groups = labelsFromAnchorages(anch)
  if (!groups.length) return { labels: 0, byMethod: {}, decisions: [], visitsUpdated: 0 }
  // WPI ports near any point (a coarse box first, exact distance in matchLabel).
  const pts = groups.flatMap((g) => g.points)
  const { rows: wpi } = await c.query(
    `SELECT p.id, p.wpi_number, p.name, p.iso3, p.lat, p.lon, p.name_source_record_id AS record_id
       FROM ${S}.ports p JOIN jsonb_to_recordset($1::jsonb) AS q(lat double precision, lon double precision)
         ON p.lat BETWEEN q.lat - 0.25 AND q.lat + 0.25 AND p.lon BETWEEN q.lon - 0.25 / greatest(cos(radians(q.lat)), 0.01) AND q.lon + 0.25 / greatest(cos(radians(q.lat)), 0.01)
      WHERE p.origin = 'wpi' GROUP BY p.id`,
    [JSON.stringify(pts.map((p) => ({ lat: p.lat, lon: p.lon })))])
  const wpiPortId = new Map(wpi.map((w) => [w.wpi_number, w.id]))
  const cells = [...new Set(pts.map((p) => String(p.anchorage_id || '').toLowerCase()).filter(Boolean))]
  // Exact anchorage cells, plus any override point within ~5 km of an anchorage (rule b2 picks ≤ MATCH_KM).
  const { rows: ovr } = await c.query(
    `SELECT DISTINCT se.entity_key AS s2id, sr.id AS record_id, sr.payload
       FROM ${S}.source_entities se JOIN ${S}.source_records sr ON sr.source_entity_id = se.id
       LEFT JOIN jsonb_to_recordset($4::jsonb) AS q(lat double precision, lon double precision)
         ON (sr.payload->>'latitude') ~ '^-?[0-9.]+$' AND (sr.payload->>'longitude') ~ '^-?[0-9.]+$'
        AND (sr.payload->>'latitude')::float8 BETWEEN q.lat - 0.05 AND q.lat + 0.05
        AND (sr.payload->>'longitude')::float8 BETWEEN q.lon - 0.05 / greatest(cos(radians(q.lat)), 0.01) AND q.lon + 0.05 / greatest(cos(radians(q.lat)), 0.01)
      WHERE se.source_id = $1 AND se.entity_kind = $2 AND (se.entity_key = ANY($3) OR q.lat IS NOT NULL)
      ORDER BY se.entity_key, sr.id`, [OVERRIDES_SOURCE.id, KIND.override, cells, JSON.stringify(pts.map((p) => ({ lat: p.lat, lon: p.lon })))])
  const overrides = new Map()
  for (const o of ovr) {
    const m = mapOverrideRow(o.payload)
    if (m.override) overrides.set(o.s2id, [...(overrides.get(o.s2id) || []), { ...m.override, record_id: o.record_id }])
  }
  const { rows: cty } = await c.query(`SELECT iso2, iso3 FROM ${S}.countries`)
  const iso2of = new Map(cty.map((r) => [r.iso3, r.iso2]))

  const byMethod = {}, decisions = []
  for (const g of groups) {
    const d = matchLabel(g, wpi.map((w) => ({ ...w, lat: Number(w.lat), lon: Number(w.lon) })), overrides)
    byMethod[d.method] = (byMethod[d.method] || 0) + 1
    // Where the port sits when it isn't a WPI port: the most-visited anchorage point GFW gave (a real point, not a centroid).
    const main = [...g.points].sort((a, b) => b.visits - a.visits || String(a.anchorage_id).localeCompare(String(b.anchorage_id)))[0]
    let portId
    // Only a real WPI match IS the WPI port. "near X" (approximate) and a GFW label that beat a WPI
    // facility name get their own port row (named as decided), keeping the WPI port as a reference only.
    if (d.wpi_number != null && (d.method === 'wpi_within_4km' || d.method === 'wpi_nearest_clear')) portId = wpiPortId.get(d.wpi_number)
    else {
      const [p] = (await c.query(
        `INSERT INTO ${S}.ports AS t (origin, origin_key, name, name_source_id, name_field, name_method, name_source_record_id, iso2, iso3, lat, lon, detail)
         VALUES ('gfw_port_label', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (origin, origin_key) DO UPDATE SET name = EXCLUDED.name, name_source_id = EXCLUDED.name_source_id, name_field = EXCLUDED.name_field,
           name_method = EXCLUDED.name_method, name_source_record_id = EXCLUDED.name_source_record_id, iso2 = EXCLUDED.iso2, iso3 = EXCLUDED.iso3,
           lat = EXCLUDED.lat, lon = EXCLUDED.lon, detail = EXCLUDED.detail, updated_at = now()
         RETURNING id`,
        [g.label, d.name, d.name_source_id, d.method === 'unnamed' ? null : d.name_source_id === OVERRIDES_SOURCE.id ? 'label' : 'name', d.method, d.name_record_id,
          iso2of.get(g.iso3) ?? null, g.iso3, main?.lat ?? null, main?.lon ?? null,
          { anchorage_id: main?.anchorage_id ?? null, override_s2id: d.override_s2id ?? null, notes: d.notes }])).rows
      portId = p.id
    }
    // gfw_port_label alias: supersede a different accepted decision, then upsert this one.
    await c.query(
      `UPDATE ${S}.port_aliases SET status = 'superseded', last_seen_at = now()
        WHERE key_kind = 'gfw_port_label' AND key = $1 AND status = 'accepted' AND (port_id <> $2 OR method IS DISTINCT FROM $3)`,
      [g.label, portId, d.method])
    await c.query(
      `INSERT INTO ${S}.port_aliases AS t (port_id, source_id, key_kind, key, name_raw, lat, lon, source_record_id, status, method, distance_km, detail)
       VALUES ($1, 'gfw-port-visits', 'gfw_port_label', $2, $3, $4, $5, $6, 'accepted', $7, $8, $9)
       ON CONFLICT (port_id, key_kind, key, source_id) DO UPDATE SET name_raw = EXCLUDED.name_raw, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
         source_record_id = EXCLUDED.source_record_id, status = 'accepted', method = EXCLUDED.method, distance_km = EXCLUDED.distance_km,
         detail = EXCLUDED.detail, last_seen_at = now()`,
      [portId, g.label, main?.name ?? null, main?.lat ?? null, main?.lon ?? null, d.name_record_id, d.method, d.distance_km,
        { name: d.name, name_source_id: d.name_source_id, candidates: d.candidates, notes: d.notes, via_anchorage: d.via_anchorage ?? null,
          override_s2id: d.override_s2id ?? null, iso3: g.iso3, anchorages: g.points.length }])
    // Anchorage cells of this label (accepted alongside the label; the override row is referenced when there is one).
    for (const p of g.points) {
      if (!p.anchorage_id) continue
      const oc = cellOverride(overrides.get(String(p.anchorage_id).toLowerCase()))
      const o = oc && !oc.ambiguous ? oc : null
      await c.query(
        `UPDATE ${S}.port_aliases SET status = 'superseded', last_seen_at = now()
          WHERE key_kind = 'gfw_anchorage_s2' AND key = $1 AND status = 'accepted' AND (port_id <> $2 OR source_id <> $3)`,
        [String(p.anchorage_id).toLowerCase(), portId, o ? OVERRIDES_SOURCE.id : 'gfw-port-visits'])
      await c.query(
        `INSERT INTO ${S}.port_aliases AS t (port_id, source_id, key_kind, key, name_raw, lat, lon, source_record_id, status, method, distance_km, detail)
         VALUES ($1, $2, 'gfw_anchorage_s2', $3, $4, $5, $6, $7, 'accepted', 'gfw_port_label_member', NULL, $8)
         ON CONFLICT (port_id, key_kind, key, source_id) DO UPDATE SET name_raw = EXCLUDED.name_raw, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
           source_record_id = EXCLUDED.source_record_id, status = 'accepted', detail = EXCLUDED.detail, last_seen_at = now()`,
        [portId, o ? OVERRIDES_SOURCE.id : 'gfw-port-visits', String(p.anchorage_id).toLowerCase(), o?.label ?? p.name, p.lat, p.lon, o?.record_id ?? null,
          { port_label: g.label, gfw_name: p.name, visits: p.visits, override_sublabel: o?.sublabel ?? null }])
    }
    decisions.push({ ...d, port_id: portId })
  }
  const { rowCount: visitsUpdated } = await c.query(
    `UPDATE ${S}.port_visits pv SET port_id = a.port_id
       FROM ${S}.port_aliases a
      WHERE a.key_kind = 'gfw_port_label' AND a.status = 'accepted' AND a.key = pv.int_port_label
        AND pv.port_id IS DISTINCT FROM a.port_id ${labels ? 'AND pv.int_port_label = ANY($1)' : ''}`, labels ? [labels] : [])
  return { labels: groups.length, byMethod, decisions, visitsUpdated }
}

/** Short label for a naming source, as the card links it. */
export const NAME_SOURCE_LABEL = { [WPI_SOURCE.id]: 'WPI', [OVERRIDES_SOURCE.id]: 'GFW anchorages', 'gfw-port-visits': 'GFW', [LOCODE_SOURCE.id]: 'UN/LOCODE' }

/**
 * After new visits arrive (api/ships.js op=ports): resolve the GFW labels of this vessel's visits that have no
 * port yet. Same rules as the batch matcher; only those labels are (re)decided.
 */
export async function nameVisits(pool, S, gfwIds) {
  const { rows } = await pool.query(
    `SELECT DISTINCT int_port_label AS l FROM ${S}.port_visits
      WHERE status = 'active' AND gfw_vessel_id = ANY($1) AND port_id IS NULL AND int_port_label IS NOT NULL`, [gfwIds])
  if (!rows.length) return { labels: 0, visitsUpdated: 0 }
  return withTx(pool, (c) => matchPortLabels(c, S, { labels: rows.map((r) => r.l) }))
}

/** The sources a Ports tab may cite for names and countries (ids as in ships.sources). */
export const NAME_SOURCE_IDS = [WPI_SOURCE.id, OVERRIDES_SOURCE.id, COUNTRIES_SOURCE.id, 'gfw-port-visits']
