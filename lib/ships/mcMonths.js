/**
 * MarineCadastre (NOAA) ship identities for every detailed Salish month, imported from the files the ships-noaa-month workflow
 * publishes (docs/SHIPS_ACTIVITY_FUSION.md Part 1, Josh 2026-10-07). Same evidence and resolver as scripts/ships/import-mc.mjs;
 * only the delivery differs: each month's identity-YYYY-MM.ndjson is on Blob (the Salish index's `identity` URL), and
 * POST /api/ships?op=importMcIdentity { offset } imports them in time-boxed, resumable batches (the GFW ship-records pattern).
 *
 * All months are aggregated together, as import-mc.mjs does, so each value carries its overall first / last seen; a new month
 * extends those periods (the shorter ones are superseded, never deleted). An MMSI whose aggregated record is already stored
 * unchanged (same payload hash) is skipped.
 */
import { gunzipSync } from 'node:zlib'
import { aggregateRows, MC_SOURCE } from './marinecadastre.js'
import { ensureMcSource, ingestMcMmsi } from './ingestMc.js'
import { sha256, canonicalJson } from './store.js'
import manifest from '../../src/ships/trackSource.json' with { type: 'json' }

let merged = null // { key, months, list } — kept while warm: every batch of one import reads the same files

/** Every month's identity rows (Salish index entries with an `identity` URL), aggregated per MMSI, in a stable order. */
export async function mergedMcIdentity(indexUrl = manifest.salishIndex) {
  const r = await fetch(`${indexUrl}?t=${Math.floor(Date.now() / 300000)}`)
  if (!r.ok) throw new Error(`salish index: HTTP ${r.status}`)
  const idx = await r.json()
  const months = Object.entries(idx.months || {}).filter(([, e]) => e.identity).sort(([a], [b]) => a.localeCompare(b))
  const key = months.map(([m, e]) => `${m}:${e.built}`).join(',')
  if (merged?.key === key) return merged
  const rows = []
  for (const [m, e] of months) {
    const f = await fetch(e.identity)
    if (!f.ok) throw new Error(`identity ${m}: HTTP ${f.status}`)
    const buf = Buffer.from(await f.arrayBuffer())
    const text = (e.identity.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8')
    for (const line of text.split('\n')) if (line.trim()) rows.push(JSON.parse(line))
  }
  const list = aggregateRows(rows).sort((a, b) => String(a.mmsi).localeCompare(String(b.mmsi)))
  merged = { key, months: months.map(([m]) => m), list }
  return merged
}

export const mcPayloadHash = (agg) => sha256(canonicalJson(agg)) // ingestMcMmsi stores the aggregate itself as the payload

async function knownMcPayloads(pool, S, hashes) {
  if (!hashes.length) return new Set()
  const { rows } = await pool.query(`SELECT payload_sha256 FROM ${S}.source_records WHERE source_id = $1 AND payload_sha256 = ANY($2)`, [MC_SOURCE.id, hashes])
  return new Set(rows.map((r) => r.payload_sha256))
}

/** One time-boxed batch from `offset`; returns { total, next, done, months, ingested, skipped, actions }. */
export async function importMcBatch(pool, S, { offset = 0, budgetMs = 45000, chunk = 300, runId = null } = {}) {
  const t0 = Date.now()
  await ensureMcSource(pool, S)
  const { months, list } = await mergedMcIdentity()
  const actions = {}
  let i = Math.max(0, Number(offset) || 0), ingested = 0, skipped = 0
  while (i < list.length && Date.now() - t0 < budgetMs) {
    const part = list.slice(i, i + chunk)
    const hashes = part.map(mcPayloadHash)
    const known = await knownMcPayloads(pool, S, hashes)
    for (let k = 0; k < part.length; k++) {
      if (Date.now() - t0 >= budgetMs) return { total: list.length, next: i + k, done: false, months, ingested, skipped, actions }
      if (known.has(hashes[k])) { skipped++; continue }
      const r = await ingestMcMmsi(pool, S, part[k], { runId, retrievalUrl: `salish-index:${months.join('+')}` })
      ingested++
      const a = `${r.resolution.action}${r.resolution.method ? ':' + r.resolution.method : ''}`
      actions[a] = (actions[a] || 0) + 1
    }
    i += part.length
  }
  return { total: list.length, next: i, done: i >= list.length, months, ingested, skipped, actions }
}
