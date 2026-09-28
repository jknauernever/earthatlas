/**
 * IMO GISIS for /ships (docs/IMO_GISIS.md, "Built (dev)"). Rules: src/ships/CLAUDE.md. Schema: migrations/014.
 *
 * Josh, 2026-09-27: "For our purposes now, assume IMO has given us permission. I don't care about casualty data.
 * Scrubber and facility info is a go." Used on Josh's instruction assuming IMO permission; written permission not yet
 * obtained; the IMO Web Accounts policy otherwise forbids republishing. No casualty data is handled here.
 *
 * Two official GISIS exports, each downloaded once by hand with its own download button (never scraped):
 *   MARPOL Annex VI Reg. 4.2 "Download all data"   → 'imo-gisis-scrubbers'
 *   Maritime Security "Declared port facilities"    → 'imo-gisis-port-facilities' (Canada + United States rows only)
 *
 *   evidence        source_records: the CSV rows exactly as exported (column → value), grouped per IMO number for
 *                   Reg. 4.2; one row per facility for ISPS, with personal contact fields dropped before storing
 *   claim           Reg. 4.2: one assertion per row ('scrubber' when the row's own text says EGCS / scrubber, otherwise
 *                   'equivalent_compliance'), period 'unknown' (the export gives only the submitted date: in detail)
 *   interpretation  resolve.js v1.6: a Reg. 4.2 entity attaches only to the one vessel holding its IMO as a registry-class,
 *                   checksum-valid IMO (IMO_EXACT). Terminals: terminal_links role 'imo_port_facility' from the hand
 *                   crosswalk lib/ships/data/gisis-terminal-crosswalk.json, re-checked by name + position here.
 *
 * Pure functions first (unit-tested offline with REAL recorded rows), then persistence, then the read.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { canonicalJson, sha256, upsertSource, upsertAssertions } from './store.js'
import { storeRawRecords, haversineKm } from './ports.js'
import { normImo, normName } from './normalize.js'
import { nameWords } from './officialPorts.js'
import { parseCsv } from './terminals.js'
import { resolveEntity } from './resolve.js'

export const JOSH_DECISION = 'Josh, 2026-09-27: "For our purposes now, assume IMO has given us permission. I don\'t care about casualty data. '
  + 'Scrubber and facility info is a go." Used on Josh\'s instruction assuming IMO permission; written permission not yet obtained; '
  + 'the IMO Web Accounts policy otherwise forbids republishing.'
const TERMS = 'IMO Web Accounts policy §3 (https://webaccounts.imo.org/Common/PrivacyPolicy.aspx), quoted: "Unless otherwise specified '
  + 'and authorized by the IMO, the Services we provide are for your personal and non-commercial use. You may not modify, copy, '
  + 'distribute, transmit, display, perform, reproduce, publish, license, create derivative works from, transfer, or sell any '
  + 'information, software, products or services obtained from the Services." GISIS disclaimer: no liability for accuracy or '
  + 'timeliness; data maintained by the national maritime Administrations.'

export const REG42_URL = 'https://gisis.imo.org/Public/MARPOL6/Notifications.aspx?Reg=4.2'
export const ISPS_URL = 'https://gisis.imo.org/Public/ISPS/Download.aspx'

export const SCRUBBERS_SOURCE = {
  id: 'imo-gisis-scrubbers',
  name: 'IMO GISIS: MARPOL Annex VI Regulation 4.2 notifications (equivalent compliance methods, incl. exhaust gas cleaning systems)',
  publisher: 'International Maritime Organization (GISIS); data notified by flag Administrations',
  homepage_url: REG42_URL,
  license: 'IMO GISIS terms: personal, non-commercial use; publishing needs IMO authorization (see notes)',
  license_url: 'https://webaccounts.imo.org/Common/PrivacyPolicy.aspx',
  commercial_use: false,
  attribution_text: 'Source: IMO GISIS, MARPOL Annex VI Reg. 4.2 notifications (as notified by flag Administrations)',
  attribution_url: REG42_URL,
  notes: `${JOSH_DECISION} ${TERMS} Export: the page's "Download all data" button (CSV, 8 columns, no ship name; the IMO number is `
    + 'the only ship key). The export says only whether a certificate exists ("Has Certificate"), not its link. Loop type (open / '
    + 'closed / hybrid) is not a field: it is recorded only where the row\'s own text states it. Coverage = what flags notified: absence '
    + 'does not mean a ship has no scrubber.',
}
export const FACILITIES_SOURCE = {
  id: 'imo-gisis-port-facilities',
  name: 'IMO GISIS: Maritime Security (ISPS) declared port facilities',
  publisher: 'International Maritime Organization (GISIS); data declared by each Contracting Government',
  homepage_url: ISPS_URL,
  license: 'IMO GISIS terms: personal, non-commercial use; publishing needs IMO authorization (see notes)',
  license_url: 'https://webaccounts.imo.org/Common/PrivacyPolicy.aspx',
  commercial_use: false,
  attribution_text: 'Source: IMO GISIS, Maritime Security module (ISPS declared port facilities)',
  attribution_url: ISPS_URL,
  notes: `${JOSH_DECISION} ${TERMS} Export: "Declared port facilities" (CSV, UTF-8). Only Canada and United States rows are stored. `
    + 'Personal data: the facility contact files (named security officers, phones, emails) were NOT downloaded, and any contact-like '
    + 'column is dropped before storing (lib/ships/gisis.js FACILITY_COLUMNS). Coordinates are degrees + decimal minutes (DDMMmm). '
    + 'The United States declares Captain-of-the-Port areas (e.g. USSEA-0001 Puget Sound Port Area), not terminals.',
}
export const GISIS_SOURCES = [SCRUBBERS_SOURCE, FACILITIES_SOURCE]
export const GISIS_SOURCE_IDS = GISIS_SOURCES.map((s) => s.id)
export const KIND = { imo: 'marpol6_reg42_imo', row: 'marpol6_reg42_row', facility: 'isps_port_facility' }

// ── CSV ──────────────────────────────────────────────────────────────────────

/** GISIS CSV text → row objects (RFC 4180; a UTF-8 BOM, if any, is dropped). Pure. */
export const parseGisisCsv = (text) => parseCsv(String(text).replace(/^﻿/, ''))

export const REG42_COLUMNS = ['Notifying Party', 'Type of equivalent compliance method', 'IMO Number, if applicable', 'Manufacturer',
  'Type or model number', 'Submitted', 'Has Certificate', 'Has Additional Info']
/** Throws when the export's header is not the one this code was written for (a changed export must be looked at, not guessed). */
export function checkColumns(rows, expected) {
  const got = Object.keys(rows[0] || {})
  const missing = expected.filter((c) => !got.includes(c))
  if (missing.length) throw new Error(`GISIS export columns changed: missing ${missing.join(', ')}; got ${got.join(', ')}`)
}

// ── Reg. 4.2 (scrubbers) ─────────────────────────────────────────────────────

const tidy = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim())
// The row says it is an exhaust gas cleaning system: EGCS / scrubber words in the type, maker or model text.
const EGCS_RE = /scrubb|\begcs\b|\begc\b|\beggs\b|exhaust\s*gas\s*clean|puresox|\b(open|closed|hybrid)[\s\-‘’'"]*loop/i
const Q = `[\\s\\-‘’'"]*`
// "open loop", "closed-loop", "‘Open Loop’", and pairs written as "OPEN/CLOSED Loop" or "open and closed loop" (both stated).
const PAIR_RE = new RegExp(`\\b(open|closed)\\s*(?:/|,|&|\\band\\b|\\bor\\b)\\s*(open|closed)${Q}loop`, 'i')
const LOOP_RE = { open: new RegExp(`\\bopen${Q}loop`, 'i'), closed: new RegExp(`\\bclosed${Q}loop`, 'i'), hybrid: /\bhybrid\b/i }

/** The row's own words about what it is (type + maker + model). Pure. */
export const rowText = (r) => [r['Type of equivalent compliance method'], r.Manufacturer, r['Type or model number']].map(tidy).join(' ')
/** 'egcs' when the row's text says scrubber / EGCS; otherwise 'other'. Pure. Never guessed from a maker's name. */
export const rowCategory = (r) => (EGCS_RE.test(rowText(r)) ? 'egcs' : 'other')
/**
 * Loop types the row's text states (['open'], ['hybrid'], ['hybrid', 'open'] …), in a fixed order; [] = not stated. Only for
 * EGCS rows ("hybrid" in a scrubber row is its loop mode). Pure.
 */
export function statedLoops(r) {
  if (rowCategory(r) !== 'egcs') return []
  const t = rowText(r)
  const pair = PAIR_RE.exec(t)
  return ['open', 'closed', 'hybrid'].filter((k) => LOOP_RE[k].test(t) || (pair && [pair[1], pair[2]].map((x) => x.toLowerCase()).includes(k)))
}
/** "Maker model" as notified, without repeating the maker when the model already starts with it. Pure. */
export function makerModel(r) {
  const m = tidy(r.Manufacturer), t = tidy(r['Type or model number'])
  const na = (x) => !x || /^(n\/?a|-+|none)$/i.test(x)
  if (na(m) && na(t)) return null
  if (na(t)) return m
  if (na(m) || normName(t).startsWith(normName(m))) return t
  return `${m} ${t}`
}
/** "IMO 9751509" → { imo, valid } | null (no 7-digit number). Pure. */
export function rowImo(r) {
  const raw = tidy(r['IMO Number, if applicable'])
  if (!/^(IMO\s*)?\d{7}$/i.test(raw)) return null
  return { ...normImo(raw), raw }
}
const rowRef = (r) => `row ${sha256(canonicalJson(r)).slice(0, 16)}`

/**
 * All Reg. 4.2 rows → one group per IMO number (key 'IMO 1234567'); rows without a usable 7-digit IMO each get their own
 * group (key 'row <sha>'), stored but never resolvable. Identical rows are kept once per group, in file order. Pure.
 * → [{ key, kind, imo: { value, valid } | null, rows: [...] }]
 */
export function groupReg42(rows) {
  const by = new Map()
  for (const r of rows) {
    const i = rowImo(r)
    const key = i ? `IMO ${i.value}` : rowRef(r)
    const g = by.get(key) || { key, kind: i ? KIND.imo : KIND.row, imo: i ? { value: i.value, valid: i.valid } : null, rows: [] }
    if (!g.rows.some((x) => canonicalJson(x) === canonicalJson(r))) g.rows.push(r)
    by.set(key, g)
  }
  return [...by.values()]
}

/** One group → its claims (pure). One per distinct row: 'scrubber' for EGCS rows, 'equivalent_compliance' otherwise. */
export function reg42Assertions(g) {
  const out = []
  for (const r of g.rows) {
    const cat = rowCategory(r)
    const value = makerModel(r) ?? 'maker and model not stated'
    const loops = statedLoops(r)
    out.push({
      attribute: cat === 'egcs' ? 'scrubber' : 'equivalent_compliance',
      value_raw: value, value_norm: normName(value),
      period_from: null, period_to: null, period_kind: 'unknown',
      evidence_class: 'registry', sub_record_ref: rowRef(r),
      detail: {
        basis: 'flag Administration notification to IMO (MARPOL Annex VI Reg. 4.2)',
        flag: tidy(r['Notifying Party']) || null,
        type_raw: tidy(r['Type of equivalent compliance method']) || null,
        manufacturer: tidy(r.Manufacturer) || null, model: tidy(r['Type or model number']) || null,
        submitted: /^\d{4}-\d{2}-\d{2}$/.test(tidy(r.Submitted)) ? tidy(r.Submitted) : null, submitted_raw: r.Submitted ?? null,
        category: cat, category_basis: cat === 'egcs' ? 'the row\'s text names an EGCS / scrubber' : 'the row\'s text does not say it is an EGCS',
        loop: loops, loop_basis: loops.length ? 'stated in the row\'s text' : 'not stated',
        has_certificate: r['Has Certificate'] ?? null, has_additional_info: r['Has Additional Info'] ?? null,
        imo: g.imo?.value ?? null, imo_raw: r['IMO Number, if applicable'] ?? null, page_url: REG42_URL,
      },
    })
  }
  return out
}

// ── ISPS port facilities ─────────────────────────────────────────────────────

/** The only columns kept from the facility export. Anything else (any contact-like column a future export adds) is dropped. */
export const FACILITY_COLUMNS = ['Country Code', 'Country Name', 'Port Name', 'Facility Name', 'IMO Port Facility Number', 'Description',
  'Longitude', 'Latitude', 'Plan Approved?', 'Initial Approval Date', 'Review Date', 'SoC Issue Date', 'Security Plan Withdrawn?',
  'Withdrawn Date', 'Last Updated']

/**
 * Drop personal contact fields before a facility row is stored (pure): only FACILITY_COLUMNS are kept (an allow-list, so a
 * security officer's name, phone or email column added to a future export can never be stored). → { kept, dropped }
 */
export function stripPersonal(row) {
  const kept = {}, dropped = []
  for (const [k, v] of Object.entries(row || {})) (FACILITY_COLUMNS.includes(k) ? (kept[k] = v) : dropped.push(k))
  return { kept, dropped }
}

/**
 * GISIS coordinate → decimal degrees. Latitude "491722N" (DD MM mm) or "4917N" (DD MM); longitude "1225350W" (DDD MM mm) or
 * "07617E" (DDD MM). The minutes are decimal (MM.mm, not MM'SS"): 2,631 of the 24,564 full-length coordinates (12,282 rows) in the 2026-09-28 export
 * have a last pair above 59, and the facility pages show the same digits as "49° 17.22' N". null for an empty or malformed
 * value, or a hemisphere letter that doesn't fit the axis. Pure.
 */
export function gisisCoord(v, axis) {
  const s = String(v || '').trim()
  const m = axis === 'lat' ? /^(\d{2})(\d{2})(\d{2})?([NS])$/.exec(s) : /^(\d{3})(\d{2})(\d{2})?([EW])$/.exec(s)
  if (!m) return null
  const deg = Number(m[1]), min = Number(m[2]) + (m[3] ? Number(m[3]) / 100 : 0)
  if (min >= 60) return null
  const x = deg + min / 60
  if (x > (axis === 'lat' ? 90 : 180)) return null
  return Math.round(('SW'.includes(m[4]) ? -x : x) * 1e6) / 1e6
}
/** "23/07/2026 00:00:00" → '2026-07-23' (a calendar date: the export gives no time zone, so no instant is claimed). Pure. */
export function gisisDate(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?: \d{2}:\d{2}:\d{2})?$/.exec(String(v || '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}
const yes = (v) => (/^true$/i.test(String(v || '').trim()) ? true : /^false$/i.test(String(v || '').trim()) ? false : null)

/** One facility row → { key, payload (personal fields dropped), facility } or { error }. Pure. */
export function mapFacilityRow(row) {
  const { kept, dropped } = stripPersonal(row)
  const key = tidy(kept['IMO Port Facility Number'])
  if (!/^[A-Z]{2}[A-Z0-9]{3}-\d{4}$/.test(key)) return { error: `facility row without an IMO Port Facility Number (${key || 'blank'})` }
  const lat = gisisCoord(kept.Latitude, 'lat'), lon = gisisCoord(kept.Longitude, 'lon')
  return {
    key,
    payload: kept,
    dropped,
    facility: {
      number: key, name: tidy(kept['Facility Name']) || null, port: tidy(kept['Port Name']) || null, country: tidy(kept['Country Code']) || null,
      description: tidy(kept.Description) || null, lat, lon,
      plan_approved: yes(kept['Plan Approved?']), approved: gisisDate(kept['Initial Approval Date']), reviewed: gisisDate(kept['Review Date']),
      soc_issued: gisisDate(kept['SoC Issue Date']), withdrawn: yes(kept['Security Plan Withdrawn?']), withdrawn_date: gisisDate(kept['Withdrawn Date']),
      updated: gisisDate(kept['Last Updated']),
    },
  }
}

// Words that say what kind of company or place it is, not which one (on top of officialPorts.js nameWords' generic list).
const COMPANY_WORDS = new Set(['MARINE', 'TERMINALS', 'CANADA', 'CANADIAN', 'LTD', 'INC', 'LIMITED', 'PARTNERSHIP', 'COMPANY', 'CORPORATION',
  'CORP', 'ULC', 'PORTS', 'OPERATIONS', 'PRODUCTS', 'ENERGY', 'FACILITY', 'SERVICES', 'INTERNATIONAL', 'VANCOUVER', 'NORTH',
  'BRITISH', 'COLUMBIA', 'OSM', 'BULK'])

/**
 * Check one crosswalk row against the stored facility and the terminal (pure).
 * f = mapFacilityRow(..).facility; t = { key, name, berths: [{ lat, lon }] }. → { ok, name_agrees, shared, km, position_agrees, problems }
 * ok = the row may be linked: decision 'link', the names share a main word (facility name + port vs the terminal name), and
 * the GISIS point lies within positionKm of a berth OR the row explains why GISIS's point is wrong (position_note).
 */
export function checkCrosswalkRow(row, f, t, positionKm = 2.0) {
  const problems = []
  if (!f) return { ok: false, problems: [`facility ${row.facility} not stored`] }
  if (!t) return { ok: false, problems: [`terminal ${row.terminal} not listed`] }
  if (row.facility_name && tidy(row.facility_name) !== f.name) problems.push(`facility ${row.facility} is now "${f.name}", expected "${row.facility_name}"`)
  // + letter-digit codes nameWords drops ("G3").
  const words = (x) => [...nameWords(x).filter((w) => !COMPANY_WORDS.has(w)), ...(String(x || '').toUpperCase().match(/\b[A-Z]+\d+[A-Z0-9]*\b/g) || [])]
  const mine = new Set(words(t.name))
  const shared = [...new Set([...words(f.name), ...words(f.port)])].filter((w) => mine.has(w))
  const pts = (t.berths || []).filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lon))
  const km = Number.isFinite(f.lat) && Number.isFinite(f.lon) && pts.length
    ? Math.round(Math.min(...pts.map((b) => haversineKm(f.lat, f.lon, b.lat, b.lon))) * 1000) / 1000 : null
  const position_agrees = km != null && km <= positionKm
  if (!shared.length) problems.push(`names share no main word ("${f.name}" / "${t.name}")`)
  if (!position_agrees && !row.position_note) problems.push(`GISIS point is ${km ?? '?'} km from the nearest berth and the row has no position_note`)
  if (row.decision !== 'link') problems.push(`decision ${row.decision}`)
  return { ok: problems.length === 0, name_agrees: shared.length > 0, shared, km, position_agrees, problems }
}

// ── Persistence ──────────────────────────────────────────────────────────────

export async function ensureGisisSources(c, S) {
  for (const s of GISIS_SOURCES) await upsertSource(c, S, s)
}

/**
 * Reg. 4.2 rows → evidence + claims + resolution. Idempotent. groups = groupReg42(rows). Run in chunks by the caller
 * (each chunk in its own transaction); `finishReg42` then supersedes claims of entities no longer in the export.
 * → { groups, recordsCreated, claimsCreated, superseded, resolved: {accept, keep, unresolved} }
 */
export async function importReg42Chunk(c, S, groups, { runId = null, datasetVersion = null, file = null } = {}) {
  await c.query(`SELECT pg_advisory_xact_lock(hashtext('ships.gisis.reg42'))`)
  const out = { groups: groups.length, recordsCreated: 0, claimsCreated: 0, superseded: 0, resolved: {} }
  for (const kind of [KIND.imo, KIND.row]) {
    const gs = groups.filter((g) => g.kind === kind)
    if (!gs.length) continue
    const recs = await storeRawRecords(c, S, SCRUBBERS_SOURCE.id, kind,
      gs.map((g) => ({ key: g.key, payload: { imo: g.imo, rows: g.rows, file } })), { runId, retrievalUrl: REG42_URL, datasetVersion })
    out.recordsCreated += recs.created
    const { rows: ents } = await c.query(`SELECT id, entity_key FROM ${S}.source_entities WHERE source_id = $1 AND entity_kind = $2 AND entity_key = ANY($3)`,
      [SCRUBBERS_SOURCE.id, kind, gs.map((g) => g.key)])
    const eid = new Map(ents.map((e) => [e.entity_key, e.id]))
    for (const g of gs) {
      const r = await upsertAssertions(c, S, { entityId: eid.get(g.key), recordId: recs.byKey.get(g.key).at(-1), assertions: reg42Assertions(g) })
      out.claimsCreated += r.created; out.superseded += r.superseded
      const d = await resolveEntity(c, S, eid.get(g.key))
      const k = `${d.action}${d.reason ? `:${d.reason}` : ''}`
      out.resolved[k] = (out.resolved[k] || 0) + 1
    }
  }
  return out
}

/** Entities of this source that the export no longer lists: their active claims become 'superseded' (kept, never deleted). */
export async function finishReg42(c, S, keys) {
  const { rowCount } = await c.query(
    `UPDATE ${S}.assertions a SET status = 'superseded'
       FROM ${S}.source_entities se
      WHERE se.id = a.source_entity_id AND se.source_id = $1 AND NOT (se.entity_key = ANY($2)) AND a.status = 'active'`,
    [SCRUBBERS_SOURCE.id, keys])
  return { superseded: rowCount }
}

/** Facility rows (already filtered to the countries wanted) → evidence. Idempotent. → { facilities, recordsCreated, errors, dropped } */
export async function importFacilities(c, S, rows, { runId = null, datasetVersion = null, file = null } = {}) {
  const mapped = [], errors = [], dropped = new Set()
  for (const r of rows) { const m = mapFacilityRow(r); if (m.error) errors.push(m.error); else { mapped.push(m); m.dropped.forEach((d) => dropped.add(d)) } }
  const recs = await storeRawRecords(c, S, FACILITIES_SOURCE.id, KIND.facility,
    mapped.map((m) => ({ key: m.key, payload: { row: m.payload, file } })), { runId, retrievalUrl: ISPS_URL, datasetVersion })
  return { facilities: mapped.length, recordsCreated: recs.created, errors, dropped: [...dropped], byKey: recs.byKey }
}

/** The newest stored record of each facility → Map(number → { recordId, facility }). */
export async function storedFacilities(c, S, numbers = null) {
  const { rows } = await c.query(
    `SELECT DISTINCT ON (se.entity_key) se.entity_key, sr.id, sr.payload FROM ${S}.source_entities se
       JOIN ${S}.source_records sr ON sr.source_entity_id = se.id
      WHERE se.source_id = $1 AND se.entity_kind = $2 ${numbers ? 'AND se.entity_key = ANY($3)' : ''}
      ORDER BY se.entity_key, sr.last_retrieved_at DESC, sr.id DESC`,
    numbers ? [FACILITIES_SOURCE.id, KIND.facility, numbers] : [FACILITIES_SOURCE.id, KIND.facility])
  return new Map(rows.map((r) => [r.entity_key, { recordId: Number(r.id), facility: mapFacilityRow(r.payload.row).facility }]))
}

export const CROSSWALK_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'gisis-terminal-crosswalk.json')
export async function loadCrosswalk(file = CROSSWALK_FILE) { return JSON.parse(await readFile(file, 'utf8')) }

/**
 * Crosswalk → terminal_links (role 'imo_port_facility', source 'imo-gisis-port-facilities'). A row is linked only when
 * checkCrosswalkRow passes; earlier links of this role that no longer pass (or are gone from the file) become 'retired'.
 * Idempotent. → { linked, notLinked: [{ row, problems }], checks }
 */
export async function linkFacilitiesToTerminals(c, S, crosswalk) {
  const rows = crosswalk.rows || []
  const fac = await storedFacilities(c, S, [...new Set(rows.map((r) => r.facility))])
  const { rows: terms } = await c.query(`SELECT id, key, name FROM ${S}.terminals WHERE list_status = 'listed' AND key = ANY($1)`, [[...new Set(rows.map((r) => r.terminal))]])
  const { rows: berths } = await c.query(`SELECT terminal_id, lat, lon FROM ${S}.terminal_berths WHERE status = 'active' AND terminal_id = ANY($1)`, [terms.map((t) => t.id)])
  const tByKey = new Map(terms.map((t) => [t.key, { ...t, berths: berths.filter((b) => String(b.terminal_id) === String(t.id)) }]))
  const out = { linked: 0, notLinked: [], checks: [] }
  const keep = new Map() // terminal id → [facility numbers]
  for (const row of rows) {
    const f = fac.get(row.facility)
    const t = tByKey.get(row.terminal)
    const chk = checkCrosswalkRow(row, f?.facility, t, crosswalk.position_km ?? 2.0)
    out.checks.push({ terminal: row.terminal, facility: row.facility, decision: row.decision, ...chk })
    if (!chk.ok) { if (row.decision === 'link') out.notLinked.push({ row, problems: chk.problems }); continue }
    await c.query(
      `INSERT INTO ${S}.terminal_links (terminal_id, role, source_id, entity_key, source_record_id, status, detail)
       VALUES ($1, 'imo_port_facility', $2, $3, $4, 'active', $5)
       ON CONFLICT (terminal_id, role, source_id, entity_key) DO UPDATE SET source_record_id = EXCLUDED.source_record_id,
         status = 'active', detail = EXCLUDED.detail, last_seen_at = now()`,
      [t.id, FACILITIES_SOURCE.id, row.facility, f.recordId, {
        facility_name: f.facility.name, port: f.facility.port, description: f.facility.description,
        lat: f.facility.lat, lon: f.facility.lon, km_to_nearest_berth: chk.km, position_agrees: chk.position_agrees,
        ...(row.position_note ? { position_note: row.position_note } : {}), ...(row.note ? { note: row.note } : {}),
        shared_name_words: chk.shared, plan_approved: f.facility.plan_approved, withdrawn: f.facility.withdrawn,
        withdrawn_date: f.facility.withdrawn_date, updated: f.facility.updated, crosswalk_version: crosswalk.version ?? null,
      }])
    keep.set(t.id, [...(keep.get(t.id) || []), row.facility])
    out.linked++
  }
  const pairs = [...keep].flatMap(([tid, ns]) => ns.map((n) => `${tid}\u0001${n}`))
  const { rowCount } = await c.query(
    `UPDATE ${S}.terminal_links SET status = 'retired', last_seen_at = now()
      WHERE role = 'imo_port_facility' AND source_id = $1 AND status = 'active' AND NOT ((terminal_id::text || chr(1) || entity_key) = ANY($2))`,
    [FACILITIES_SOURCE.id, pairs])
  out.retired = rowCount
  return out
}
