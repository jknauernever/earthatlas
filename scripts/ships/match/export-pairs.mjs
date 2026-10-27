#!/usr/bin/env node
/**
 * B (match score, Josh 2026-10-19): export every same-MMSI candidate pair between two ACTIVE vessel records, with each
 * record's identity facts, for scoring (scripts/ships/match/score.py). Read-only. DEV unless SHIPS_DATABASE_URL says otherwise.
 *   node --env-file=.env.local scripts/ships/match/export-pairs.mjs [--limit N]   → scripts/ships/match/cache/pairs.json
 */
import { writeFile } from 'node:fs/promises'
import { shipsPool, DEFAULT_SCHEMA as S } from '../../../lib/ships/db.js'
import { realCallsignSql } from '../../../lib/ships/normalize.js'
import { DOC_SCHEMES, isGearName } from '../../../lib/ships/matchRules.js'

const args = process.argv.slice(2)
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : null
const pool = shipsPool()
const q = async (t, p) => (await pool.query(t, p)).rows
const pairs = await q(`
  SELECT DISTINCT LEAST(acc.vessel_id::text, cand.vessel_id::text) AS a, GREATEST(acc.vessel_id::text, cand.vessel_id::text) AS b, cand.evidence->>'mmsi' AS mmsi
    FROM ${S}.entity_links cand
    JOIN ${S}.entity_links acc ON acc.source_entity_id = cand.source_entity_id AND acc.status = 'accepted'
    JOIN ${S}.vessels va ON va.id = acc.vessel_id AND va.status = 'active'
    JOIN ${S}.vessels vb ON vb.id = cand.vessel_id AND vb.status = 'active'
   WHERE cand.status = 'candidate' AND cand.method = 'MMSI_TEMPORAL' AND acc.vessel_id <> cand.vessel_id
   ORDER BY 1, 2 ${limit ? `LIMIT ${limit}` : ''}`)
const ids = [...new Set(pairs.flatMap((p) => [p.a, p.b]))]
const rows = await q(`
  SELECT vessel_id::text v, attribute, source_id, evidence_class, value_norm, value_raw, detail->>'scheme' AS scheme,
         to_char(lower(period), 'YYYY-MM-DD') f, to_char(upper(period), 'YYYY-MM-DD') t
    FROM ${S}.vessel_assertions
   WHERE vessel_id = ANY($1::uuid[]) AND evidence_class <> 'community_curated'
     AND attribute IN ('name', 'mmsi', 'callsign', 'imo', 'length_m', 'width_m', 'vessel_type', 'flag', 'official_number', 'radio_licensee', 'registry_owner')
     AND NOT (attribute = 'callsign' AND NOT ${realCallsignSql('value_norm')})`, [ids])
const rec = Object.fromEntries(ids.map((id) => [id, { claims: 0, sources: new Set(), names: new Set(), callsigns: new Set(), imos: new Set(), lengths: [], widths: [], types: new Set(),
  flags: new Set(), official: new Set(), docs: new Set(), parties: new Set(), mmsi: [] }]))
const toM = (r) => { const n = parseFloat(r); return Number.isFinite(n) && n > 0 ? (/ft/i.test(r) ? n * 0.3048 : n) : null }
for (const r of rows) {
  const x = rec[r.v]; x.claims++; x.sources.add(r.source_id)
  if (r.attribute === 'name') { x.names.add(r.value_norm); if (isGearName(r.value_raw)) x.gear = true }
  if (r.attribute === 'callsign') x.callsigns.add(r.value_norm)
  if (r.attribute === 'imo' && r.evidence_class === 'registry') x.imos.add(r.value_norm)
  if (r.attribute === 'length_m') { const m = toM(r.value_raw); if (m) x.lengths.push(+m.toFixed(1)) }
  if (r.attribute === 'width_m') { const m = toM(r.value_raw); if (m) x.widths.push(+m.toFixed(1)) }
  if (r.attribute === 'vessel_type') x.types.add(`${r.source_id}:${r.value_norm}`)
  if (r.attribute === 'flag') x.flags.add(String(r.value_norm).slice(0, 3))
  if (r.attribute === 'official_number') x.official.add(r.value_norm)
  if (r.attribute === 'official_number' && r.evidence_class === 'registry' && DOC_SCHEMES.includes(r.scheme)) x.docs.add(`${r.scheme}:${r.value_norm}`)
  if (['radio_licensee', 'registry_owner'].includes(r.attribute) && r.value_norm !== 'WITHHELD') x.parties.add(r.value_norm)
  if (r.attribute === 'mmsi') x.mmsi.push({ mmsi: r.value_norm, f: r.f, t: r.t, src: r.source_id })
}
const ser = (x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v instanceof Set ? [...v] : v]))
// db = which database these came from (apply.mjs refuses to act on another one).
await writeFile('scripts/ships/match/cache/pairs.json', JSON.stringify({ db: new URL(process.env.SHIPS_DATABASE_URL).host.split('.')[0], exported_at: new Date().toISOString(), pairs, records: Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, ser(v)])) }))
console.log(`${pairs.length} pairs, ${ids.length} records → scripts/ships/match/cache/pairs.json`)
await pool.end()
