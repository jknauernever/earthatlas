/**
 * EU MRV (EMSA THETIS-MRV) for /ships: VERIFIED annual per-ship fuel and greenhouse-gas figures (Phase 4, authorized by Josh
 * 2026-09-29). Facts, fields and caveats: docs/SHIP_POLLUTION_SOURCES.md §1. Rules: src/ships/CLAUDE.md. Schema: migrations/019.
 *
 * What it is: under Regulation (EU) 2015/757 every ship over 5,000 GT carrying cargo or passengers on voyages to, from or between
 * EU/EEA ports reports its fuel and emissions per calendar year; an accredited verifier checks the report; EMSA publishes it.
 * The figures cover ONLY those EU/EEA-related voyages and time at berth in EU/EEA ports, never the ship's whole year.
 *
 *   evidence        source_records: the XLSX cells exactly as published (by column letter; empty cells are absent in the file too)
 *                     'eu_mrv_file'       one per file version: its three header rows (what every column letter means)
 *                     'eu_mrv_ship_year'  one per ship-year ('IMO 9378448 · 2024'): its Full-ERs row and each Partial-ERs row
 *   claim           'emissions_report', evidence class 'verified_report', one per published row, period = the row's reporting
 *                   period (validity); value = total CO₂ [t] as published; detail = the mapped figures with units
 *   interpretation  resolve.js v1.8: attaches only to the one vessel holding the IMO as a registry-class, checksum-valid IMO
 *
 * Full vs partial rows (2024 onward): a "Full ER" covers the whole year for the company holding the ship at the end of it; a
 * "Partial ER" covers the part of the year a company held the ship before a change. In the 2024 v245 and 2025 v58 files a Full
 * row is never smaller than the sum of the same ship's partial rows (equal for 199 of 726 ships in 2024), so partial rows are
 * parts of the year, NOT additions to it: never add them to the Full figure.
 *
 * Pure functions first (unit-tested offline with REAL rows), then persistence.
 */
import { canonicalJson, sha256, upsertSource, upsertAssertions } from './store.js'
import { storeRawRecords } from './ports.js'
import { normImo } from './normalize.js'
import { resolveEntity } from './resolve.js'

export const PORTAL_URL = 'https://mrv.emsa.europa.eu/#public/emission-report'
export const API_BASE = 'https://mrv.emsa.europa.eu/api/public-emission-report'
export const FILES_URL = `${API_BASE}/downloadable-files`
export const fileUrl = (year, version) => `${API_BASE}/reporting-period-document/binary/${year}/${version}`
/** The portal's own deep link for one ship and reporting year (route 'public/emission-report/ship/:imo/rp/:year' in its app). */
export const shipYearUrl = (imo, year) => `https://mrv.emsa.europa.eu/#public/emission-report/ship/${imo}/rp/${year}`
export const LICENSE_QUOTE = 'Reproduction is authorised, provided the source is acknowledged, save where otherwise stated.'

export const MRV_SOURCE = {
  id: 'emsa-thetis-mrv',
  name: 'EU MRV: annual fuel and greenhouse-gas emissions per ship (EMSA THETIS-MRV, publication of information)',
  publisher: 'European Maritime Safety Agency (EMSA); reports by shipping companies under Regulation (EU) 2015/757, checked by accredited verifiers',
  homepage_url: PORTAL_URL,
  license: `EMSA copyright notice: "${LICENSE_QUOTE}"`,
  license_url: 'https://www.emsa.europa.eu/disclaimer.html',
  commercial_use: true,
  attribution_text: 'Source: EMSA THETIS-MRV, EU MRV publication of information',
  attribution_url: PORTAL_URL,
  notes: 'Licence: EMSA site-wide disclaimer, "Copyright" section (checked live 2026-09-27 and 2026-09-29), quoted: "' + LICENSE_QUOTE
    + ' Where prior permission must be obtained for the reproduction or use of textual and multimedia information (sound, images, '
    + 'software, etc.), such permission shall cancel the above mentioned general permission and indicate clearly any restrictions on use." '
    + 'The MRV portal shows no terms of its own (its configuration has disclaimer:false) and no contrary statement was found on the '
    + 'publication, so reproduction with acknowledgement applies; commercial use is not restricted by that wording. '
    + 'Access: unauthenticated JSON + one XLSX per reporting year (2018 onward), no robots.txt on mrv.emsa.europa.eu (404). '
    + 'Scope: ships >5,000 GT on voyages to, from or between EU/EEA ports and at berth in them; the figures are NOT the ship\'s '
    + 'global annual emissions. Files are regenerated as late or corrected reports arrive (the version number climbs); each '
    + 'ship-year record keeps the file version it came from.',
}

export const KIND = { shipYear: 'eu_mrv_ship_year', file: 'eu_mrv_file' }
export const EVIDENCE_CLASS = 'verified_report'
export const ATTRIBUTE = 'emissions_report'

// ── Sheet layout ─────────────────────────────────────────────────────────────

/** 0-based column index → letters ("A", "AA"). */
export function colLetter(i) {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

/**
 * The three published header rows → one header per column: { col, group, sub, leaf }. Row 1 (group) and row 2 (sub-group) are
 * merged-cell labels that apply to the columns after them until the next label; row 3 is the column's own header. Pure.
 */
export function headerColumns(r1 = [], r2 = [], r3 = []) {
  const n = Math.max(r1.length, r2.length, r3.length)
  const out = []
  let g = '', s = ''
  for (let i = 0; i < n; i++) {
    if (tidy(r1[i])) { g = tidy(r1[i]); s = '' }
    if (tidy(r2[i])) s = tidy(r2[i])
    out.push({ col: colLetter(i), i, group: g, sub: s, leaf: tidy(r3[i]) })
  }
  return out
}

/**
 * Where each field sits, found by header text (never by position: the 2018–2023 files have 62 columns, 2024 onward 113, and
 * wording changed between years). Each entry: [group, leaf pattern]. The first matching column wins. The 'on laden' variants are
 * excluded by the $ anchors.
 */
const MS = 'ports under a MS jurisdiction'
const GASES = { co2: 'CO[₂2]', ch4: 'CH₄', n2o: 'N₂O', co2eq: 'CO₂eq' }
const FIELDS = {
  imo: ['Ship', /^IMO Number$/], name: ['Ship', /^Name$/], ship_type: ['Ship', /^Ship type$/], period: ['Ship', /^Reporting Period$/],
  technical_efficiency: ['Ship', /^Technical efficiency$/], port_of_registry: ['Ship', /^Port of Registry$/], home_port: ['Ship', /^Home Port$/],
  ice_class: ['Ship', /^Ice Class$/],
  company_imo: ['Company', /^IMO Number$/], company_name: ['Company', /^Name$/],
  doc_issue: ['DoC', /^DoC issue date$/], doc_expiry: ['DoC', /^DoC expiry date$/],
  verifier_name: ['Verifier', /^Verifier Name$/], verifier_city: ['Verifier', /^Verifier City$/], verifier_country: ['Verifier', /^Verifier Country$/],
  verifier_accreditation: ['Verifier', /^Verifier Accreditation number$/], verifier_nab: ['Verifier', /^Verifier NAB$/],
  fuel_t: ['Annual monitoring results', /^Total fuel consumption \[m tonnes\]$/],
  time_at_sea_h: ['Annual monitoring results', /^(Annual )?(Total )?[Tt]ime spent at sea \[hours\]$/],
  distance_through_ice_nm: [null, /^(Distance )?[Tt]hrough ice \[n miles\]$/],
  fuel_per_nm_kg: ['Annual monitoring results', /^(Annual average )?Fuel consumption per distance \[kg \/ n mile\]$/],
  co2_per_nm_kg: ['Annual monitoring results', /^(Annual average )?CO₂ emissions per distance \[kg CO₂ \/ n mile\]$/],
  co2eq_per_nm_kg: ['Annual monitoring results', /^CO₂eq emissions per distance \[kg CO₂eq \/ n mile\]$/],
  fuel_per_hour_t: ['Annual monitoring results', /^Fuel consumption per time spent at sea \[m tonnes \/ hour\]$/],
  co2_per_hour_t: ['Annual monitoring results', /^CO₂ emissions per time spent at sea \[m tonnes CO₂ \/ hour\]$/],
}
for (const [g, re] of Object.entries(GASES)) {
  FIELDS[`${g}_t`] = ['Annual monitoring results', new RegExp(`^Total ${re} emissions \\[m tonnes\\]$`)]
  FIELDS[`${g}_between_ms_t`] = ['Annual monitoring results', new RegExp(`^${re} emissions from all voyages between ${MS} \\[m tonnes\\]$`)]
  FIELDS[`${g}_departed_ms_t`] = ['Annual monitoring results', new RegExp(`^${re} emissions from all voyages which departed from ${MS} \\[m tonnes\\]$`)]
  FIELDS[`${g}_to_ms_t`] = ['Annual monitoring results', new RegExp(`^${re} emissions from all voyages to ${MS} \\[m tonnes\\]$`)]
  FIELDS[`${g}_at_berth_ms_t`] = ['Annual monitoring results', new RegExp(`^${re} emissions which occurred within ${MS} at berth \\[m tonnes\\]$`)]
  FIELDS[`${g}_within_ms_ports_t`] = ['Annual monitoring results', new RegExp(`^${re} emissions which occurred within ${MS} \\[m tonnes\\]$`)]
  FIELDS[`${g}_ets_t`] = ['Annual monitoring results', new RegExp(`^${re} emissions to be reported under Directive 2003/87/EC \\[m tonnes\\]$`)]
}
/** Fields every file must have (a file without them is refused, not guessed at). */
export const REQUIRED_FIELDS = ['imo', 'name', 'ship_type', 'period', 'technical_efficiency', 'verifier_name', 'fuel_t', 'co2_t',
  'co2_between_ms_t', 'co2_departed_ms_t', 'co2_to_ms_t', 'co2_at_berth_ms_t', 'time_at_sea_h', 'fuel_per_nm_kg', 'co2_per_nm_kg']
/** Units of the mapped numeric fields, as the headers state them ("m tonnes" = metric tonnes). */
export const UNITS = {
  _t: 'metric tonnes (published as "m tonnes")', time_at_sea_h: 'hours', distance_through_ice_nm: 'nautical miles',
  fuel_per_nm_kg: 'kg fuel per nautical mile', co2_per_nm_kg: 'kg CO₂ per nautical mile', co2eq_per_nm_kg: 'kg CO₂eq per nautical mile',
  fuel_per_hour_t: 'metric tonnes fuel per hour at sea', co2_per_hour_t: 'metric tonnes CO₂ per hour at sea',
}
const TW_RE = /^(Annual average )?(Fuel consumption|CO₂ emissions|CO₂eq emissions) per transport work \((mass|volume|dwt|pax|freight)\) \[(.+)\]$/

/**
 * header columns → layout { fields: {field: col letter}, methods: [{col, letter}], transportWork: [{col, what, basis, unit}] }.
 * Throws when a required field is missing (a changed file must be looked at). Pure.
 */
export function mrvLayout(cols) {
  const fields = {}
  for (const [k, [group, re]] of Object.entries(FIELDS)) {
    const c = cols.find((x) => (group == null || x.group === group) && re.test(x.leaf))
    if (c) fields[k] = c.col
  }
  const missing = REQUIRED_FIELDS.filter((k) => !fields[k])
  if (missing.length) throw new Error(`EU MRV file layout changed: no column for ${missing.join(', ')}`)
  const methods = cols.filter((x) => x.group === 'Monitoring methods' && /^[A-D]$/.test(x.leaf)).map((x) => ({ col: x.col, letter: x.leaf }))
  const transportWork = []
  for (const x of cols) {
    const m = TW_RE.exec(x.leaf)
    if (m && x.group === 'Annual monitoring results') transportWork.push({ col: x.col, what: m[2] === 'Fuel consumption' ? 'fuel' : m[2].startsWith('CO₂eq') ? 'co2eq' : 'co2', basis: m[3], unit: m[4] })
  }
  return { fields, methods, transportWork, columns: cols.length }
}

// ── Values ───────────────────────────────────────────────────────────────────

/** A published cell → number | null. 'N/A' and '' are null (not zero); a non-numeric cell is null too (kept raw in the record). Pure. */
export function mrvNumber(v) {
  const s = tidy(v)
  if (!/^-?\d+(\.\d+)?(E-?\d+)?$/i.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
/** 'N/A' | '' | text → text | null. Pure. */
const text = (v) => { const s = tidy(v); return s && s !== 'N/A' ? s : null }

/** '20/03/2025' → '2025-03-20' (a calendar date; the file gives no time zone). null otherwise. Pure. */
export function mrvDate(v) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(tidy(v))
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}

/**
 * 'Reporting Period' cell → { year, partial, from, to, raw }. Full year: '2024.0' (stored as a number) or '2024'. Partial:
 * '2024 (1/1 - 21/10)' = 1 January to 21 October inclusive (day/month). from/to are calendar dates; `to` is the last day covered.
 * null for anything else. Pure.
 */
export function mrvPeriod(v) {
  const s = tidy(v)
  let m = /^(\d{4})(\.0)?$/.exec(s)
  if (m) return { year: Number(m[1]), partial: false, from: `${m[1]}-01-01`, to: `${m[1]}-12-31`, raw: s }
  m = /^(\d{4}) \((\d{1,2})\/(\d{1,2}) - (\d{1,2})\/(\d{1,2})\)$/.exec(s)
  if (!m) return null
  const d = (dd, mm) => `${m[1]}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
  return { year: Number(m[1]), partial: true, from: d(m[2], m[3]), to: d(m[4], m[5]), raw: s }
}

/**
 * 'Technical efficiency' → { kind: 'EEDI'|'EEXI'|'EIV'|null, value: g CO₂ per tonne-nautical mile | null, raw }. Published forms:
 * 'EEXI (10.5 gCO₂/t·nm)', 'EIV (40.85 gCO₂/t·nm)', 'Not Applicable', 'Not Applicable (5.2 gCO₂/t·nm)', '12.3 gCO₂/t·nm', 'EEDI', ''.
 * Pure.
 */
export function technicalEfficiency(v) {
  const raw = tidy(v)
  if (!raw) return null
  const m = /^(EEDI|EEXI|EIV|Not Applicable)?\s*\(?\s*(?:(\d+(?:\.\d+)?)\s*gCO₂\/t·nm)?\s*\)?$/.exec(raw)
  if (!m) return { kind: null, value: null, raw }
  return { kind: m[1] && m[1] !== 'Not Applicable' ? m[1] : null, value: m[2] != null ? Number(m[2]) : null, not_applicable: m[1] === 'Not Applicable', raw }
}

/**
 * One published row (cells by column letter) → the figures the ship card uses, each with its unit in its name (_t metric tonnes,
 * _h hours, _nm nautical miles, _per_nm_kg kg per nautical mile). Numbers are copied, never recomputed. Pure.
 */
export function mapMrvRow(cells, layout) {
  const f = layout.fields
  const get = (k) => (f[k] ? cells[f[k]] ?? '' : undefined)
  const num = (k) => (f[k] ? mrvNumber(get(k)) : undefined)
  const imo = normImo(tidy(get('imo')))
  const period = mrvPeriod(get('period'))
  const out = {
    imo: imo.value, imo_valid: imo.valid, name: text(get('name')), ship_type: text(get('ship_type')),
    period, technical_efficiency: technicalEfficiency(get('technical_efficiency')),
    port_of_registry: text(get('port_of_registry')), home_port: text(get('home_port')), ice_class: text(get('ice_class')),
    company: f.company_name ? { name: text(get('company_name')), imo: text(get('company_imo')) } : null,
    doc: { issue: mrvDate(get('doc_issue')), expiry: mrvDate(get('doc_expiry')) },
    verifier: { name: text(get('verifier_name')), city: text(get('verifier_city')), country: text(get('verifier_country')),
      accreditation: text(get('verifier_accreditation')), nab: text(get('verifier_nab')) },
    monitoring_methods: layout.methods.filter((m) => /^yes$/i.test(tidy(cells[m.col]))).map((m) => m.letter),
    transport_work: layout.transportWork.map((t) => ({ what: t.what, basis: t.basis, unit: t.unit, value: mrvNumber(cells[t.col]) }))
      .filter((t) => t.value != null),
  }
  for (const k of Object.keys(FIELDS)) {
    if (/(_t|_h|_nm|_kg)$/.test(k)) { const v = num(k); if (v !== undefined) out[k] = v }
  }
  return out
}

// ── Workbook → ship-year groups ──────────────────────────────────────────────

/** Sheet name → 'full' | 'partial' ('2024 Full ERs', '2024 Partial ERs'; 2018–2023 files have one sheet named by the year). Pure. */
export const sheetKind = (name) => (/partial/i.test(name) ? 'partial' : 'full')

/**
 * Parsed sheets of one file → { groups, layout, header } where groups = one per ship-year (key 'IMO 1234567 · 2024') with its rows
 * ({ sheet, kind, row, cells }) and header = the file's header rows per sheet. sheets: [{ name, rows: [[cell…]…] }] as
 * lib/ships/xlsx.js sheetRows returns them (row 1–3 headers). Cells are kept exactly as stored; only empty cells are dropped
 * (the file omits them too). Pure.
 */
export function groupWorkbook(sheets, { year } = {}) {
  const by = new Map()
  const header = []
  let layout = null
  for (const sh of sheets) {
    const [r1, r2, r3, ...data] = sh.rows
    const cols = headerColumns(r1, r2, r3)
    const lay = mrvLayout(cols)
    if (layout && layout.columns !== lay.columns) throw new Error(`EU MRV sheets differ in layout (${layout.columns} vs ${lay.columns} columns)`)
    layout = lay
    header.push({ sheet: sh.name, rows: [r1, r2, r3] })
    data.forEach((r, i) => {
      if (!r.some((x) => tidy(x))) return
      const cells = {}
      r.forEach((v, j) => { if (v !== '' && v != null) cells[colLetter(j)] = v })
      const imo = normImo(tidy(cells[lay.fields.imo]))
      const p = mrvPeriod(cells[lay.fields.period])
      const y = p?.year ?? year
      const key = `IMO ${imo.value} · ${y}`
      const g = by.get(key) || { key, imo: imo.value, imo_valid: imo.valid, year: y, rows: [] }
      g.rows.push({ sheet: sh.name, kind: sheetKind(sh.name), row: i + 4, cells })
      by.set(key, g)
    })
  }
  return { groups: [...by.values()], layout, header }
}

/**
 * One ship-year group → its claims (pure). One 'emissions_report' per published row, value = total CO₂ as published. The period
 * is the row's reporting period as a validity range in UTC days ([first day, day after the last)); the file states calendar days
 * only, so detail.period keeps them as written.
 */
export function mrvAssertions(g, layout, file) {
  const out = []
  for (const r of g.rows) {
    const m = mapMrvRow(r.cells, layout)
    const co2Raw = tidy(r.cells[layout.fields.co2_t])
    if (!m.period || !co2Raw) continue
    const next = new Date(`${m.period.to}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1)
    out.push({
      attribute: ATTRIBUTE, value_raw: co2Raw, value_norm: String(mrvNumber(co2Raw) ?? co2Raw),
      period_from: `${m.period.from}T00:00:00Z`, period_to: next.toISOString(), period_kind: 'validity',
      evidence_class: EVIDENCE_CLASS,
      sub_record_ref: r.kind === 'full' ? 'full' : `partial ${m.period.raw}`,
      detail: {
        scheme: 'EU MRV (Regulation (EU) 2015/757)', scope: 'voyages to, from and between EU/EEA ports, and at berth in them',
        value_is: 'total CO₂, metric tonnes', report: r.kind, sheet: r.sheet, row: r.row,
        file: file ? { name: file.name, year: file.year, version: file.version, generated: file.generated } : null,
        page_url: shipYearUrl(g.imo, g.year), units: UNITS, ...m,
      },
    })
  }
  return out
}

// ── Formatting: lib/ships/euMrvFormat.js (browser-safe; re-exported here for scripts and tests) ──
export { tonnesText, smallEuShare, smallShareYears, SMALL_EU_SHARE } from './euMrvFormat.js'

// ── Persistence ──────────────────────────────────────────────────────────────

export async function ensureMrvSource(c, S) { await upsertSource(c, S, MRV_SOURCE) }

/** The file's header rows as evidence (entity 'eu_mrv_file', key '2024 v245'). Idempotent. → record id */
export async function storeFileHeader(c, S, file, header, { runId = null } = {}) {
  const key = `${file.year} v${file.version}`
  const recs = await storeRawRecords(c, S, MRV_SOURCE.id, KIND.file,
    [{ key, payload: { file, header } }], { runId, retrievalUrl: fileUrl(file.year, file.version), datasetVersion: key })
  return recs.byKey.get(key).at(-1)
}

/**
 * Ship-year groups → evidence + claims + resolution. Idempotent. Run in chunks by the caller (each in its own transaction).
 * → { groups, recordsCreated, claimsCreated, superseded, resolved: {accept, keep, unresolved:…} }
 */
export async function importMrvChunk(c, S, groups, layout, file, { runId = null } = {}) {
  await c.query(`SELECT pg_advisory_xact_lock(hashtext('ships.eu_mrv'))`)
  const out = { groups: groups.length, recordsCreated: 0, claimsCreated: 0, superseded: 0, resolved: {} }
  if (!groups.length) return out
  const version = `${file.year} v${file.version}`
  const recs = await storeRawRecords(c, S, MRV_SOURCE.id, KIND.shipYear,
    groups.map((g) => ({ key: g.key, payload: { file: { name: file.name, year: file.year, version: file.version, generated: file.generated, header_record: version }, rows: g.rows } })),
    { runId, retrievalUrl: fileUrl(file.year, file.version), datasetVersion: version })
  out.recordsCreated += recs.created
  const { rows: ents } = await c.query(`SELECT id, entity_key FROM ${S}.source_entities WHERE source_id = $1 AND entity_kind = $2 AND entity_key = ANY($3)`,
    [MRV_SOURCE.id, KIND.shipYear, groups.map((g) => g.key)])
  const eid = new Map(ents.map((e) => [e.entity_key, e.id]))
  for (const g of groups) {
    const r = await upsertAssertions(c, S, { entityId: eid.get(g.key), recordId: recs.byKey.get(g.key).at(-1), assertions: mrvAssertions(g, layout, file) })
    out.claimsCreated += r.created; out.superseded += r.superseded
    const d = await resolveEntity(c, S, eid.get(g.key))
    const k = `${d.action}${d.reason ? `:${d.reason}` : ''}`
    out.resolved[k] = (out.resolved[k] || 0) + 1
  }
  return out
}

/**
 * Ship-year entities of `year` that the newest file no longer lists at all: their active claims become 'superseded' (kept, never
 * deleted). `keys` = EVERY ship-year key in the file (not only the ones imported), so a filtered import never supersedes.
 */
export async function finishMrvYear(c, S, year, keys) {
  const { rowCount } = await c.query(
    `UPDATE ${S}.assertions a SET status = 'superseded'
       FROM ${S}.source_entities se
      WHERE se.id = a.source_entity_id AND se.source_id = $1 AND se.entity_kind = $2 AND se.entity_key LIKE $3
        AND NOT (se.entity_key = ANY($4)) AND a.status = 'active'`,
    [MRV_SOURCE.id, KIND.shipYear, `IMO _______ · ${year}`, keys])
  return { superseded: rowCount }
}

/** A stable fingerprint of what we store for a group (tests / dry runs). */
export const groupSha = (g) => sha256(canonicalJson(g.rows))
