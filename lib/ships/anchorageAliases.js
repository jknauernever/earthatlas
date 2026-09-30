/**
 * "Also known as" names for official / listed anchorages (Josh 2026-09-30). Rules: src/ships/CLAUDE.md.
 *
 *   evidence        Global Fishing Watch's reviewed anchorage-name list (pipe-anchorages anchorage_overrides.csv, one source record
 *                   per row, lib/ships/ports.js), and GFW port-visit events (port_visits: the anchorage cell each visit names, with
 *                   GFW's own name for it). Both already stored; nothing is fetched here.
 *   derived         anchorage_aliases (migration 020): a name GFW uses for a point that lies inside, or within ALIAS_RULE.nearM of,
 *                   an anchorage polygon, when that name is not already the anchorage's own name.
 *   interpretation  status. `accepted` (shown as "also known as") only in the clear case: a name GFW gives the anchorage point
 *                   itself (the reviewed list's `label`, or GFW's own event name; never a code like "USA-1547" or an abbreviation
 *                   like "CA VAN") at a point INSIDE exactly one anchorage, a name GFW uses inside no other anchorage, and not
 *                   another anchorage's name. Everything else is a `candidate`, kept with the reason, never shown as a name:
 *                   - the reviewed list's `sublabel` is GFW's PORT GROUP for the point (e.g. cell 54859d89, label "USA-1547",
 *                     sublabel "ANACORTES"; cells at Deer Harbor and in the Strait of Georgia carry the same group), so it says
 *                     which port the spot serves, not what the spot is called;
 *                   - EarthAtlas's own place hint for a GFW port (ports.js rule (d) "near <nearest World Port Index port>", or
 *                     a WPI port within 4 km) says where a place is, not what it is called.
 *                   DECISIONS lists the aliases Josh accepted by hand (with the date); they are stored as accepted.
 */
import { pointInGeometry, distanceToGeometryM } from './anchorages.js'
import { isCodeName, OVERRIDES_SOURCE, WPI_SOURCE } from './ports.js'
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'

export const ALIAS_RULE = Object.freeze({ nearM: 1000 })
/** Aliases accepted by hand: anchorage key (source_id|source_key) + alias + source + method → accepted, with who and when. */
export const DECISIONS = Object.freeze([
  // Josh 2026-09-30: Vendovi South is also called "Anacortes". Evidence: GFW's reviewed anchorage list files cell 54859d89
  // (48.5952 N, 122.6025 W, inside the polygon) under ANACORTES (sublabel; the cell's own label is the code USA-1547), so GFW
  // port visits at this spot are reported as Anacortes.
  { anchorage: 'uscg-vts-ps-nondesignated|(a)(15)(i)', alias_norm: 'ANACORTES', source_id: 'gfw-anchorage-overrides', method: 'gfw_override_group_inside',
    decided: 'Josh 2026-09-30' },
])
/** A name that itself says it is an anchorage ("North Beach Anchorage", "Holmes Harbor Anch", "Hampton Roads"). */
export const ANCHORAGE_WORD = /\b(anchorage|anchorages|anch|roads|roadstead|holding area)\b/i
/** An abbreviation, not a name: every word is 3 letters or fewer, or any word is 1-2 letters ("CA VAN", "BD FLT", "C FR", "ASK"). */
export const isAbbreviation = (s) => { const w = String(s || '').trim().split(/\s+/).filter(Boolean); return !w.length || w.every((x) => x.length <= 3) || w.some((x) => x.length <= 2) }
const PORT_VISITS_SOURCE_ID = 'gfw-port-visits'

// Words that describe the kind of area, not its name ("Vendovi Anchorage" and "Vendovi East General Anchorage" share the name).
const GENERIC = new Set(['ANCHORAGE', 'ANCHORAGES', 'GENERAL', 'AREA', 'THE', 'OF', 'AND', 'A', 'B', 'C', 'NO', 'ANCH', 'ANCHOR'])
/** Name → its distinctive words, upper-case A–Z0–9 (pure). */
export function nameWords(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !GENERIC.has(w))
}
/** Normalized alias key (normalize.js style: A–Z0–9, no spaces). */
export const aliasNorm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
/** Does `alias` already say the anchorage's own name? True when every distinctive word of the alias is in the name (pure). */
export function sameName(alias, name) {
  const a = nameWords(alias), n = new Set(nameWords(name))
  return a.length === 0 || a.every((w) => n.has(w))
}
const titleCase = (s) => String(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())

/**
 * GFW's named points near any active anchorage (read-only; q(text, params) → rows):
 *   { kind: 'override', s2, label, sublabel, lat, lon, record_id }                reviewed list rows
 *   { kind: 'visit', s2, label, name, lat, lon, visits, record_id, port }          anchorage cells named in stored port visits,
 *        port = our port for that GFW label { id, name, name_method, name_source_id, name_record_id, distance_km }
 */
export async function gfwAnchoragePoints(q, S, padDeg = 0.02) {
  const box = `EXISTS (SELECT 1 FROM ${S}.anchorages a WHERE a.status = 'active' AND a.geometry IS NOT NULL
                  AND %LAT% BETWEEN a.min_lat - ${padDeg} AND a.max_lat + ${padDeg} AND %LON% BETWEEN a.min_lon - ${padDeg} AND a.max_lon + ${padDeg})`
  const ov = await q(
    `SELECT sr.id AS record_id, sr.payload->>'s2id' AS s2, sr.payload->>'label' AS label, nullif(sr.payload->>'sublabel', '') AS sublabel,
            (sr.payload->>'latitude')::float8 AS lat, (sr.payload->>'longitude')::float8 AS lon
       FROM ${S}.source_records sr
      WHERE sr.source_id = $1 AND sr.payload ? 'latitude'
        AND ${box.replace('%LAT%', `(sr.payload->>'latitude')::float8`).replace('%LON%', `(sr.payload->>'longitude')::float8`)}`, [OVERRIDES_SOURCE.id])
  const vis = await q(
    `WITH p AS (
       SELECT start_anchorage_id AS s2, start_port_label AS label, start_name AS name, start_lat AS lat, start_lon AS lon, first_source_record_id AS rid FROM ${S}.port_visits WHERE start_anchorage_id IS NOT NULL
       UNION ALL SELECT int_anchorage_id, int_port_label, int_name, int_lat, int_lon, first_source_record_id FROM ${S}.port_visits WHERE int_anchorage_id IS NOT NULL
       UNION ALL SELECT end_anchorage_id, end_port_label, end_name, end_lat, end_lon, first_source_record_id FROM ${S}.port_visits WHERE end_anchorage_id IS NOT NULL
     ), g AS (
       SELECT s2, mode() WITHIN GROUP (ORDER BY label) AS label, mode() WITHIN GROUP (ORDER BY name) AS name, avg(lat) AS lat, avg(lon) AS lon,
              count(*)::int AS visits, min(rid) AS record_id
         FROM p WHERE lat IS NOT NULL GROUP BY s2
     )
     SELECT g.*, po.id AS port_id, po.name AS port_name, po.name_method, po.name_source_id, po.name_source_record_id, (pa.detail->>'distance_km')::float8 AS port_km
       FROM g
       LEFT JOIN ${S}.port_aliases pa ON pa.key_kind = 'gfw_port_label' AND pa.key = g.label AND pa.status = 'accepted'
       LEFT JOIN ${S}.ports po ON po.id = pa.port_id
      WHERE ${box.replace('%LAT%', 'g.lat').replace('%LON%', 'g.lon')}`)
  return [
    ...ov.map((r) => ({ kind: 'override', s2: r.s2, label: r.label, sublabel: r.sublabel ?? null, lat: r.lat, lon: r.lon, record_id: Number(r.record_id) })),
    ...vis.map((r) => ({ kind: 'visit', s2: r.s2, label: r.label, name: r.name, lat: Number(r.lat), lon: Number(r.lon), visits: r.visits,
      record_id: r.record_id == null ? null : Number(r.record_id),
      port: r.port_id == null ? null : { id: Number(r.port_id), name: r.port_name, name_method: r.name_method, name_source_id: r.name_source_id,
        name_record_id: r.name_source_record_id == null ? null : Number(r.name_source_record_id), distance_km: r.port_km } })),
  ]
}

// ── USCG Puget Sound VTS User's Manual (Josh 2026-09-30) ─────────────────────

export const VTS_MANUAL_SOURCE = {
  id: 'uscg-vts-ps-users-manual',
  name: 'USCG Puget Sound Vessel Traffic Service User’s Manual (2024), p. 3-6 “Puget Sound Anchorages – Quick Reference Sheet”',
  publisher: 'U.S. Coast Guard, Puget Sound Vessel Traffic Service (NAVCEN)',
  homepage_url: 'https://www.navcen.uscg.gov/sites/default/files/pdf/VTS%20User%20Guides/VTS_PS_UsersManual_(2024).pdf',
  license: 'US Government work (17 U.S.C. §105)',
  license_url: 'https://www.law.cornell.edu/uscode/text/17/105',
  commercial_use: true,
  attribution_text: 'Anchorage names and codes: U.S. Coast Guard, Puget Sound VTS User’s Manual (2024), p. 3-6.',
  attribution_url: 'https://www.navcen.uscg.gov/sites/default/files/pdf/VTS%20User%20Guides/VTS_PS_UsersManual_(2024).pdf',
  notes: 'The names and codes VTS Puget Sound uses for its anchorages (general, special and non-designated). No coordinates. '
    + 'Read 2026-09-27 (docs/ANCHORAGE_AREAS_SOURCES.md §1.4); the record holds that transcription of p. 3-6, not the PDF itself.',
}
/**
 * p. 3-6 as transcribed on 2026-09-27 (docs/ANCHORAGE_AREAS_SOURCES.md §1.4). `name` only where the manual's own words were
 * transcribed; for the GENERAL / SPECIAL rows only the codes were. `ours` = the anchorage (source_id|source_key) EarthAtlas
 * pairs it with, and how sure: 'same_area' (the same named area, 1:1: accepted) or 'initials' / 'probable' (candidate only).
 */
export const VTS_MANUAL_PAGE = Object.freeze({
  url: VTS_MANUAL_SOURCE.homepage_url, title: 'VTS Puget Sound User’s Manual (2024)', pdf_created: '2025-02-07', page: '3-6',
  section: 'PUGET SOUND ANCHORAGES – Quick Reference Sheet', accessed: '2026-09-27',
  transcription: 'docs/ANCHORAGE_AREAS_SOURCES.md §1.4 (EarthAtlas notes of 2026-09-27; codes and names as printed, vessel/day limits where noted)',
  entries: [
    ...['EBE', 'EBW', 'SCE', 'SCW', 'YH', 'COM', 'PG', 'HH', 'BB', 'ANW', 'ANC', 'ANE'].map((code) => ({ group: 'GENERAL', code, name: null })),
    { group: 'GENERAL', code: 'CP', name: 'Cherry Point', limits: '1 vessel, 15 days' },
    ...['PTX1', 'PTX2', 'BBX', 'TBX', 'FBX'].map((code) => ({ group: 'SPECIAL', code, name: null })),
    { group: 'NON-DESIGNATED', code: 'PA', name: 'Port Angeles Harbor' },
    { group: 'NON-DESIGNATED', code: 'PT', name: 'Port Townsend Harbor' },
    { group: 'NON-DESIGNATED', code: 'VIE', name: 'Vendovi Island East', limits: '4 vessels, 10 days' },
    { group: 'NON-DESIGNATED', code: 'VIS', name: 'Vendovi Island South', limits: '1 vessel, 10 days' },
    ...['Quartermaster Harbor', 'Ruston', 'Budd Inlet', 'Budd Inlet North'].map((name) => ({ group: 'NON-DESIGNATED', code: null, name })),
    { group: 'NON-DESIGNATED', code: null, name: 'William Point', limits: 'ATBs only' },
  ],
})
const MC = (k) => `noaa-mc-anchorages|${k}`, ND = (k) => `uscg-vts-ps-nondesignated|${k}`
/** code (or name) → [{ ours, how }]. Initials matches are EarthAtlas's reading of a bare code: never accepted without review. */
export const VTS_MANUAL_PAIRS = Object.freeze({
  VIS: [{ ours: ND('(a)(15)(i)'), how: 'same_area', decided: 'Josh 2026-09-30' }],
  VIE: [{ ours: ND('(a)(15)(ii)'), how: 'same_area' }],
  PA: [{ ours: ND('(a)(14)(ii)'), how: 'probable', why: 'the manual’s non-designated “Port Angeles Harbor” is most likely the proposed Port Angeles General Anchorage, but the manual gives no boundary and Port Angeles also has tug-and-barge areas' }],
  PT: [{ ours: ND('(a)(3)(iii)'), how: 'probable', why: 'the manual’s non-designated “Port Townsend Harbor” is most likely the proposed Port Townsend General Anchorage; no boundary in the manual' }],
  CP: [{ ours: MC('605'), how: 'initials', why: 'code only: CP = Cherry Point by its initials' }],
  EBE: [{ ours: MC('602'), how: 'initials' }], EBW: [{ ours: MC('603'), how: 'initials' }], SCE: [{ ours: MC('601'), how: 'initials' }],
  SCW: [{ ours: MC('600'), how: 'initials' }], YH: [{ ours: MC('604'), how: 'initials' }], COM: [{ ours: MC('611'), how: 'initials' }],
  HH: [{ ours: MC('597'), how: 'initials' }], PG: [{ ours: MC('598'), how: 'initials' }],
  BB: [{ ours: MC('593'), how: 'initials' }, { ours: MC('594'), how: 'initials' }],
  ANW: [{ ours: MC('608'), how: 'initials' }], ANC: [{ ours: MC('607'), how: 'initials' }], ANE: [{ ours: MC('606'), how: 'initials' }],
  TBX: [{ ours: MC('599'), how: 'initials', why: 'code only: TBX read as Thorndike Bay explosives' }],
  FBX: [{ ours: MC('592'), how: 'initials', why: 'code only: FBX read as Freshwater Bay explosives' }],
  PTX1: [{ ours: MC('595'), how: 'initials' }, { ours: MC('596'), how: 'initials' }], PTX2: [{ ours: MC('595'), how: 'initials' }, { ours: MC('596'), how: 'initials' }],
})

/**
 * The manual's names / codes → alias rows (pure). anchorages: active rows; recordId: the stored manual record. A name the
 * anchorage already carries (Ruston, Budd Inlet, …) is not an alias. 'same_area' pairs are accepted; the rest are candidates.
 */
export function vtsManualAliases(anchorages, recordId, page = VTS_MANUAL_PAGE, pairs = VTS_MANUAL_PAIRS) {
  const byKey = new Map(anchorages.map((a) => [`${a.source_id}|${a.source_key}`, a]))
  const out = []
  for (const e of page.entries) {
    const alias = e.name && e.code ? `${e.name} (${e.code})` : e.name || e.code
    for (const p of pairs[e.code || e.name] || []) {
      const a = byKey.get(p.ours)
      if (!a || (e.name && sameName(e.name, a.name) && !e.code)) continue
      const accepted = p.how === 'same_area'
      out.push({ anchorage_source_id: a.source_id, anchorage_source_key: a.source_key, anchorage_name: a.name, alias, alias_norm: aliasNorm(alias),
        source_id: VTS_MANUAL_SOURCE.id, source_record_id: recordId ?? null, status: accepted ? 'accepted' : 'candidate',
        method: `vts_manual_${p.how}`, distance_m: null,
        detail: { page: page.page, section: page.section, group: e.group, code: e.code, name_in_manual: e.name, ...(e.limits ? { limits: e.limits } : {}),
          ...(p.decided ? { decided: p.decided } : {}), ...(accepted ? {} : { why: p.why || `code only: “${e.code}” read by its initials as ${a.name}; the manual gives no names or boundaries for its general anchorages` }) } })
    }
  }
  return out
}

/** Store the manual's page as a source record (the transcription above, with URL, page and access date). Returns its id. */
export async function storeVtsManualRecord(c, S, page = VTS_MANUAL_PAGE) {
  await upsertSource(c, S, VTS_MANUAL_SOURCE)
  const ent = await findOrCreateEntity(c, S, { sourceId: VTS_MANUAL_SOURCE.id, kind: 'manual_page', anchor: `2024:p${page.page}` })
  const rec = await upsertRecord(c, S, { sourceId: VTS_MANUAL_SOURCE.id, entityId: ent.id, payload: page, datasetVersion: '2024', retrievalUrl: page.url, runId: null })
  return Number(rec.id)
}

/**
 * The alias rule (pure). anchorages: active rows (source_id, source_key, name, geometry, no_anchoring, bbox); points:
 * gfwAnchoragePoints(). Returns one row per (anchorage, alias, source, method): { anchorage_source_id, anchorage_source_key,
 * anchorage_name, alias, alias_norm, source_id, source_record_id, status, method, distance_m, detail }.
 */
export function aliasCandidates(anchorages, points, rule = ALIAS_RULE, decisions = DECISIONS) {
  const areas = anchorages.filter((a) => a.geometry && !a.no_anchoring)
  const allNames = areas.map((a) => ({ key: `${a.source_id}|${a.source_key}`, name: a.name }))
  const out = new Map()
  const put = (row) => {
    const k = `${row.anchorage_source_id}|${row.anchorage_source_key}|${row.alias_norm}|${row.source_id}|${row.method}`
    const had = out.get(k)
    if (!had || row.distance_m < had.distance_m || (row.distance_m === had.distance_m && (row.detail.visits || 0) > (had.detail.visits || 0))) out.set(k, row)
  }
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue
    const pad = rule.nearM / 111195, padLon = pad / Math.max(0.01, Math.cos((p.lat * Math.PI) / 180))
    const hits = []
    for (const a of areas) {
      if (p.lat < a.min_lat - pad || p.lat > a.max_lat + pad || p.lon < a.min_lon - padLon || p.lon > a.max_lon + padLon) continue
      if (pointInGeometry(a.geometry, p.lat, p.lon)) hits.push({ a, d: 0 })
      else { const d = distanceToGeometryM(a.geometry, p.lat, p.lon); if (d <= rule.nearM) hits.push({ a, d: Math.round(d) }) }
    }
    if (!hits.length) continue
    const insideN = hits.filter((h) => h.d === 0).length
    const names = []
    if (p.kind === 'override' && p.label && !isCodeName(p.label)) names.push({ alias: titleCase(p.label), source_id: OVERRIDES_SOURCE.id, record_id: p.record_id, how: 'gfw_override_label', gfwOwn: true })
    if (p.kind === 'override' && p.sublabel && !isCodeName(p.sublabel)) names.push({ alias: titleCase(p.sublabel), source_id: OVERRIDES_SOURCE.id, record_id: p.record_id, how: 'gfw_override_group', gfwOwn: false })
    if (p.kind === 'visit' && p.name && !isCodeName(p.name)) names.push({ alias: titleCase(p.name), source_id: PORT_VISITS_SOURCE_ID, record_id: p.record_id, how: 'gfw_anchorage_name', gfwOwn: true })
    // EarthAtlas's place hint for the GFW port this cell belongs to (only when GFW gives no name of its own for it).
    if (p.kind === 'visit' && p.port?.name && String(p.port.name_method || '').startsWith('wpi_') && (!p.name || isCodeName(p.name))) {
      names.push({ alias: p.port.name, source_id: p.port.name_source_id || WPI_SOURCE.id, record_id: p.port.name_record_id, how: 'earthatlas_place_hint', gfwOwn: false })
    }
    for (const n of names) {
      for (const { a, d } of hits) {
        if (sameName(n.alias, a.name)) continue
        const otherAnchorage = allNames.find((x) => x.key !== `${a.source_id}|${a.source_key}` && sameName(n.alias, x.name) && nameWords(n.alias).length > 0)
        let status = 'candidate', why = null
        if (n.how === 'gfw_override_group') why = `GFW’s reviewed anchorage list files this point (cell ${p.s2}, label “${p.label}”) under the port group “${p.sublabel}”: the port the spot serves, not a name for it`
        else if (!n.gfwOwn) why = `EarthAtlas’s own place hint for GFW port ${p.label} (${p.port.name_method}: nearest World Port Index port${p.port.distance_km != null ? `, ${Math.round(p.port.distance_km * 10) / 10} km` : ''}); GFW names this cell ${p.name ? `“${p.name}”, a code` : 'nothing'}. A location hint, not a name`
        else if (isAbbreviation(n.alias)) why = `“${n.alias}” looks like an abbreviation, not a name`
        else if (d > 0) why = `the point lies ${d} m outside the polygon`
        else if (insideN > 1) why = `the point lies inside ${insideN} anchorages`
        else if (!ANCHORAGE_WORD.test(n.alias)) why = `“${n.alias}” reads as a place or port name (no anchorage word in it), so it is not taken as this anchorage’s name without review`
        else if (otherAnchorage) why = `“${n.alias}” is the name of another anchorage (${otherAnchorage.name})`
        else status = 'accepted'
        put({ anchorage_source_id: a.source_id, anchorage_source_key: a.source_key, anchorage_name: a.name, alias: n.alias, alias_norm: aliasNorm(n.alias),
          source_id: n.source_id, source_record_id: n.record_id ?? null, status, method: `${n.how}_${d === 0 ? 'inside' : 'near'}`, distance_m: d,
          detail: { rule: { ...rule }, point: { kind: p.kind, s2: p.s2, ...(p.kind === 'override' ? { label: p.label, sublabel: p.sublabel ?? null } : {}), lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6 },
            ...(p.label ? { gfw_port_label: p.label } : {}), ...(p.kind === 'visit' ? { gfw_name: p.name ?? null, visits: p.visits } : {}),
            ...(p.port ? { port_id: p.port.id, port_name_method: p.port.name_method, port_distance_km: p.port.distance_km } : {}), ...(why ? { why } : {}) } })
      }
    }
  }
  // A GFW name found inside more than one anchorage names a place or port, not one anchorage.
  const insideOf = new Map()
  for (const r of out.values()) if (r.distance_m === 0) (insideOf.get(`${r.alias_norm}|${r.method}`) || insideOf.set(`${r.alias_norm}|${r.method}`, new Set()).get(`${r.alias_norm}|${r.method}`)).add(`${r.anchorage_source_id}|${r.anchorage_source_key}`)
  for (const r of out.values()) {
    const n = insideOf.get(`${r.alias_norm}|${r.method}`)?.size || 0
    if (r.status === 'accepted' && n > 1) { r.status = 'candidate'; r.detail.why = `GFW uses “${r.alias}” inside ${n} anchorages: a place name, not this anchorage’s` }
    const dec = decisions.find((x) => x.anchorage === `${r.anchorage_source_id}|${r.anchorage_source_key}` && x.alias_norm === r.alias_norm && x.source_id === r.source_id && x.method === r.method)
    if (dec) { r.status = 'accepted'; r.detail.decided = dec.decided; if (r.detail.why) { r.detail.evidence = r.detail.why; delete r.detail.why } }
  }
  return [...out.values()].sort((x, y) => x.anchorage_name.localeCompare(y.anchorage_name) || x.alias.localeCompare(y.alias) || x.method.localeCompare(y.method))
}

/**
 * Store aliases (c inside withTx). Idempotent: the same (anchorage, alias, source, method) only updates last_seen, status, record
 * and detail. A human decision is never overwritten: rows already 'rejected' stay rejected. Returns { inserted, updated }.
 */
export async function storeAnchorageAliases(c, S, rows) {
  if (!rows.length) return { inserted: 0, updated: 0 }
  const { rows: r } = await c.query(
    `INSERT INTO ${S}.anchorage_aliases AS t (anchorage_source_id, anchorage_source_key, alias, alias_norm, source_id, source_record_id, status, method, distance_m, detail)
     SELECT x.asrc, x.akey, x.alias, x.norm, x.src, x.rid, x.status, x.method, x.d, x.detail
       FROM jsonb_to_recordset($1::jsonb) AS x(asrc text, akey text, alias text, norm text, src text, rid bigint, status text, method text, d real, detail jsonb)
     ON CONFLICT (anchorage_source_id, anchorage_source_key, alias_norm, source_id, method) DO UPDATE
       SET last_seen_at = now(), alias = EXCLUDED.alias, source_record_id = EXCLUDED.source_record_id, distance_m = EXCLUDED.distance_m, detail = EXCLUDED.detail,
           status = CASE WHEN t.status = 'rejected' THEN t.status ELSE EXCLUDED.status END
     RETURNING (xmax = 0) AS inserted`,
    [JSON.stringify(rows.map((x) => ({ asrc: x.anchorage_source_id, akey: x.anchorage_source_key, alias: x.alias, norm: x.alias_norm, src: x.source_id,
      rid: x.source_record_id, status: x.status, method: x.method, d: x.distance_m, detail: x.detail })))])
  const inserted = r.filter((x) => x.inserted).length
  return { inserted, updated: r.length - inserted }
}

/** Aliases of one anchorage for the popup: accepted first, then candidates (with the reason). Read-only; [] before migration 020. */
export async function readAnchorageAliases(q, S, a) {
  try {
    const rows = await q(
      `SELECT al.alias, al.source_id, al.source_record_id, al.status, al.method, al.distance_m, al.detail, s.name AS source_name
         FROM ${S}.anchorage_aliases al LEFT JOIN ${S}.sources s ON s.id = al.source_id
        WHERE al.anchorage_source_id = $1 AND al.anchorage_source_key = $2 AND al.status IN ('accepted', 'candidate')
        ORDER BY (al.status = 'accepted') DESC, (al.source_id = 'uscg-vts-ps-users-manual') DESC, al.distance_m, al.alias`, [a.source_id, a.source_key])
    return rows.map((r) => ({ alias: r.alias, sourceId: r.source_id, sourceName: r.source_name, recordId: r.source_record_id == null ? null : Number(r.source_record_id),
      status: r.status, method: r.method, distanceM: r.distance_m == null ? null : Number(r.distance_m), why: r.detail?.why ?? null,
      gfwPortLabel: r.detail?.gfw_port_label ?? null, page: r.detail?.page ?? null, gfwName: r.detail?.gfw_name ?? null, portDistanceKm: r.detail?.port_distance_km ?? null }))
  } catch (e) {
    if (e?.code === '42P01') return []
    throw e
  }
}
