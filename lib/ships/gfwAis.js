/**
 * Global Fishing Watch hourly positions → ship identity evidence (Josh 2026-10-02: every ship seen in the GFW track
 * lines gets a record, filled in with what we have).
 *
 * Each month the GFW track bake (scripts/ships/bake-gfw/) writes vessels.json.gz next to its tiles: per GFW vessel id,
 * every identity value its 4Wings rows carried that month (MMSI, name, call sign, IMO, flag, GFW vessel type) with the
 * first and last hour seen. This module merges the published months and maps one vessel to assertions, the same way
 * lib/ships/marinecadastre.js does for NOAA's AIS:
 *   MMSI                       ais_self_reported   (the ship's own transmissions)
 *   name, call sign, IMO, flag ais_published       (what came with the positions, as served by GFW)
 *   vessel_type                inferred            (GFW's vesselType is GFW's classification: low rank in taxonomy.combine)
 * Windows are the exact first and last hour seen (observed, inclusive). Only COMPLETED months are imported (the importer
 * skips the month still being updated daily), so a vessel's record changes at most once a month: never invented dates,
 * no daily record versions. A ship first seen in the current month gets its record when the month closes; until then
 * the track popup shows its broadcast name from the line itself.
 * The resolver decides links with its generic rules (VESSEL_ENTITY_KINDS): IMO, or MMSI + same name / call sign in an
 * overlapping window; an MMSI alone never merges.
 */
import { normMmsi, normName, normCallsign, normImo, normFlag } from './normalize.js'
import { upsertSource, findOrCreateEntity, upsertRecord, upsertAssertions, sha256, canonicalJson } from './store.js'
import { resolveEntity } from './resolve.js'
import { withTx } from './db.js'

export const GFW_AIS_SOURCE = {
  id: 'gfw-4wings-ais',
  name: 'Global Fishing Watch hourly vessel positions (4Wings presence): identity as broadcast',
  publisher: 'Global Fishing Watch',
  homepage_url: 'https://globalfishingwatch.org/our-apis/',
  license: 'CC BY-NC 4.0',
  license_url: 'https://creativecommons.org/licenses/by-nc/4.0/',
  commercial_use: false,
  attribution_text: 'Powered by Global Fishing Watch',
  attribution_url: 'https://globalfishingwatch.org',
  notes: 'Name, call sign, IMO and flag as they came with the hourly positions (AIS broadcast, as served by GFW); vessel type is GFW’s classification. Completed months only; first/last hour seen.',
}
export const GFW_AIS_ENTITY_KIND = 'gfw_ais_vessel'

/**
 * Several months' vessels files (arrays) → one item per vessel id: { vid, values: [{ attr, value, first, last, n }] },
 * each value's window = earliest first … latest last across the months. Pure; tested.
 */
export function mergeMonths(months) {
  const by = new Map()
  for (const list of months) {
    for (const it of list || []) {
      const m = by.get(it.vid) || new Map()
      for (const v of it.values || []) {
        if (v.value == null || v.value === '') continue
        const k = `${v.attr}\u0001${v.value}`
        const f = v.first, l = v.last
        const cur = m.get(k)
        if (!cur) m.set(k, { attr: v.attr, value: String(v.value), first: f, last: l, n: Number(v.n) || 0 })
        else { if (f < cur.first) cur.first = f; if (l > cur.last) cur.last = l; cur.n += Number(v.n) || 0 }
      }
      by.set(it.vid, m)
    }
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([vid, m]) => ({ vid, values: [...m.values()].sort((a, b) => a.attr.localeCompare(b.attr) || a.first.localeCompare(b.first) || a.value.localeCompare(b.value)) }))
}

/** The record payload: the vessel's merged values without counts, so a record version changes only with what was seen. */
export const payloadOf = (agg) => ({ vid: agg.vid, values: agg.values.map(({ attr, value, first, last }) => ({ attr, value, first, last })) })

/** One merged vessel → assertion rows. Pure; tested. */
export function mapVessel(agg) {
  const out = []
  const ref = `gfw4w:${agg.vid}`
  for (const v of agg.values) {
    const base = { period_from: v.first, period_to: v.last, period_kind: 'observed', sub_record_ref: ref, value_raw: v.value,
      detail: { positions: v.n, basis: 'GFW hourly positions (4Wings): first and last hour seen' } }
    if (v.attr === 'mmsi') {
      const m = normMmsi(v.value)
      out.push({ ...base, attribute: 'mmsi', value_norm: m.value, evidence_class: 'ais_self_reported',
        detail: { ...base.detail, valid: m.valid, ship_station: m.ship } })
    } else if (v.attr === 'name') out.push({ ...base, attribute: 'name', value_norm: normName(v.value), evidence_class: 'ais_published' })
    else if (v.attr === 'callsign') out.push({ ...base, attribute: 'callsign', value_norm: normCallsign(v.value), evidence_class: 'ais_published' })
    else if (v.attr === 'imo') {
      const i = normImo(v.value)
      out.push({ ...base, attribute: 'imo', value_norm: i.value, evidence_class: 'ais_published', detail: { ...base.detail, checksum_ok: i.valid } })
    } else if (v.attr === 'flag') {
      out.push({ ...base, attribute: 'flag', value_norm: normFlag(v.value), evidence_class: 'ais_published',
        detail: { ...base.detail, basis: 'GFW flag for an AIS identity (MMSI-derived)' } })
    } else if (v.attr === 'gfw_type') {
      out.push({ ...base, attribute: 'vessel_type', value_norm: String(v.value).trim().toUpperCase(), evidence_class: 'inferred',
        detail: { ...base.detail, basis: 'Global Fishing Watch vessel type (its classification)' } })
    }
  }
  return out.filter((a) => a.value_raw !== '' && a.value_norm != null && a.value_norm !== '')
}

export async function ensureGfwAisSource(pool, S) {
  await withTx(pool, (c) => upsertSource(c, S, GFW_AIS_SOURCE))
}

/** Payload hashes already stored for this source (skip unchanged vessels without opening a transaction each). */
export async function knownPayloads(pool, S, hashes) {
  if (!hashes.length) return new Set()
  const { rows } = await pool.query(
    `SELECT payload_sha256 FROM ${S}.source_records WHERE source_id = $1 AND payload_sha256 = ANY($2)`, [GFW_AIS_SOURCE.id, hashes])
  return new Set(rows.map((r) => r.payload_sha256))
}
export const payloadHash = (agg) => sha256(canonicalJson(payloadOf(agg)))

/** One merged vessel → evidence → interpretation. One transaction, like ingestMcMmsi. */
export async function ingestGfwAisVessel(pool, S, agg, { runId = null, retrievalUrl = null } = {}) {
  const assertions = mapVessel(agg)
  return withTx(pool, async (c) => {
    const ent = await findOrCreateEntity(c, S, { sourceId: GFW_AIS_SOURCE.id, kind: GFW_AIS_ENTITY_KIND, anchor: agg.vid })
    const rec = await upsertRecord(c, S, { sourceId: GFW_AIS_SOURCE.id, entityId: ent.id, payload: payloadOf(agg), datasetVersion: null, retrievalUrl, runId })
    const a = await upsertAssertions(c, S, { entityId: ent.id, recordId: rec.id, assertions })
    const d = await resolveEntity(c, S, ent.id)
    return { entityCreated: ent.created, recordCreated: rec.created, assertions: a, action: d.action, method: d.method ?? null, needsReview: d.needsReview }
  })
}

// ─── The import (api/ships.js op=importGfwVessels, run by .github/workflows/ships-gfw-identities.yml) ───────────────
export const GFW_INDEX_URL = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/tracks/gfw-v1/index.json'
const REVISION_DAYS = 5   // GFW revises recent days; the daily run re-fetches them (ships-gfw-tracks-bake.yml)

/** Months whose data can no longer change: the whole month is older than fetched_through − REVISION_DAYS. Pure; tested. */
export function completedMonths(index) {
  const thr = index?.fetched_through ? new Date(`${index.fetched_through}T00:00:00Z`) : null
  if (!thr) return []
  const cut = new Date(thr.getTime() - REVISION_DAYS * 86400e3)
  return Object.entries(index.months || {}).filter(([m, e]) => {
    if (!e?.vessels) return false
    const next = new Date(`${m}-01T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1)
    return next <= cut
  }).map(([m, e]) => ({ month: m, url: e.vessels, built: e.built })).sort((a, b) => a.month.localeCompare(b.month))
}

let mergedCache = null   // { key, list } per warm instance: the batches of one run share the merge
async function mergedVessels(fetchFn = fetch) {
  const index = await (await fetchFn(`${GFW_INDEX_URL}?t=${Date.now()}`, { cache: 'no-store' })).json()
  const months = completedMonths(index)
  const key = months.map((m) => `${m.month}@${m.built}`).join(',')
  if (mergedCache?.key === key) return { months, list: mergedCache.list }
  const { gunzipSync } = await import('node:zlib')
  const lists = []
  for (const m of months) {
    const buf = Buffer.from(await (await fetchFn(m.url)).arrayBuffer())
    lists.push(JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString()))
  }
  const list = mergeMonths(lists)
  mergedCache = { key, list }
  return { months, list }
}

/**
 * One batch: from `offset`, ingest the vessels whose payload changed, until `budgetMs` is spent. Resumable.
 * → { total, next, done, months, checked, ingested, skipped, actions }
 */
export async function importBatch(pool, S, { offset = 0, budgetMs = 45000, chunk = 300 } = {}) {
  const t0 = Date.now()
  await ensureGfwAisSource(pool, S)
  const { months, list } = await mergedVessels()
  const actions = {}
  let i = Math.max(0, Number(offset) || 0), ingested = 0, skipped = 0
  while (i < list.length && Date.now() - t0 < budgetMs) {
    const part = list.slice(i, i + chunk)
    const hashes = part.map(payloadHash)
    const known = await knownPayloads(pool, S, hashes)
    for (let k = 0; k < part.length; k++) {
      if (Date.now() - t0 >= budgetMs) { i += k; return { total: list.length, next: i, done: false, months: months.map((m) => m.month), ingested, skipped, actions } }
      if (known.has(hashes[k])) { skipped++; continue }
      const r = await ingestGfwAisVessel(pool, S, part[k], { retrievalUrl: GFW_INDEX_URL })
      ingested++
      const a = `${r.action}${r.method ? ':' + r.method : ''}`
      actions[a] = (actions[a] || 0) + 1
    }
    i += part.length
  }
  return { total: list.length, next: i, done: i >= list.length, months: months.map((m) => m.month), ingested, skipped, actions }
}
