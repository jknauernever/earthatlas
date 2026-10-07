#!/usr/bin/env node
/**
 * Anchorage stays from our own AIS positions (lib/ships/anchorageStays.js) + anchorage aliases (lib/ships/anchorageAliases.js);
 * Josh 2026-09-30. Steps:
 *
 *   node --env-file=.env.local scripts/ships/anchorage-stays.mjs polygons
 *       → scripts/ships/bake-ais/cache/anchorage-stays/anchorages.json: every active anchorage with a polygon (DEV DB), its
 *         overlap priority, whether the AIS points box covers it, and its polygon edges (for the bake's point-in-polygon).
 *   cd scripts/ships/bake-ais && python3 anchorage_stays.py [--days YYYY-MM-DD ...] [--export]
 *       → stopped positions inside an anchorage polygon, per day, then hits.csv sorted by anchorage, MMSI, time.
 *   node --env-file=.env.local scripts/ships/anchorage-stays.mjs import [--schema <name>] [--dry-run]
 *       → splits hits.csv into stays (splitStays) and stores them in <schema>.anchorage_stays with one bake record.
 *         Idempotent per STAY_BAKE_VERSION.
 *   node --env-file=.env.local scripts/ships/anchorage-stays.mjs aliases [--schema <name>] [--dry-run]
 *       → Global Fishing Watch anchorage points inside / within 1 km of an anchorage whose name differs → anchorage_aliases
 *         (accepted only for clear cases; the rest are candidates).
 */
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { upsertSource, startRun, finishRun } from '../../lib/ships/store.js'
import { STAY_BAKE_VERSION, STAY_RULE, ANCHORAGE_STAYS_SOURCE, bakeAnchorages, polygonEdges, staySplitter, storeAnchorageStays } from '../../lib/ships/anchorageStays.js'
import { gfwAnchoragePoints, aliasCandidates, storeAnchorageAliases, ALIAS_RULE, vtsManualAliases, storeVtsManualRecord } from '../../lib/ships/anchorageAliases.js'

const DIR = 'scripts/ships/bake-ais/cache/anchorage-stays'
const args = process.argv.slice(2)
const cmd = args[0]
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const dry = args.includes('--dry-run')
const post = opt('post'), postMonthArg = opt('month')
if (post && !/^\d{4}-(0[1-9]|1[0-2])$/.test(postMonthArg || '')) throw new Error('--post needs --month YYYY-MM')

const pool = post ? null : shipsPool()
const q = async (text, params) => (await pool.query(text, params)).rows
try {
  const host = post ? new URL(post).host : new URL(process.env.SHIPS_DATABASE_URL).host
  if (cmd === 'import' && post) { console.log(`anchorage stays ${postMonthArg} → ${post}${dry ? ' (dry run)' : ''}`); await importStays() }
  else if (cmd === 'polygons') await polygons()
  else if (cmd === 'import') { console.log(`anchorage stays → schema "${schema}" on ${host}${dry ? ' (dry run)' : ''}`); await importStays() }
  else if (cmd === 'aliases') { console.log(`anchorage aliases → schema "${schema}" on ${host}${dry ? ' (dry run)' : ''}`); await aliases() }
  else { console.error('usage: anchorage-stays.mjs polygons | import [--schema s] [--dry-run] | aliases [--schema s] [--dry-run]'); process.exitCode = 2 }
} finally { await pool?.end() }

// --post URL --month YYYY-MM (ships-noaa-month workflow, 2026-10-07): send one month to op=importAisMonth (CRON_SECRET bearer)
// instead of writing a database; no database connection is opened.
async function postMonth(body) {
  const r = await fetch(`${post}?op=importAisMonth`, { method: 'POST', body: JSON.stringify(body),
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'content-type': 'application/json', 'user-agent': 'earthatlas-bake/1.0' } })
  const t = await r.text()
  if (!r.ok) throw new Error(`importAisMonth: HTTP ${r.status} ${t.slice(0, 300)}`)
  console.log(`posted: ${t.slice(0, 300)}`)
}

async function activeAnchorages() {
  return q(`SELECT id, source_id, source_key, name, kind, legal_status, no_anchoring, geometry, built_from, min_lat, max_lat, min_lon, max_lon
              FROM ${schema}.anchorages WHERE status = 'active' ORDER BY source_id, source_key`)
}

async function polygons() {
  const list = bakeAnchorages(await activeAnchorages())
  const covered = list.filter((a) => a.coverage === 'covered')
  const edges = covered.flatMap((a) => polygonEdges(a.key, a.geometry))
  await mkdir(DIR, { recursive: true })
  await writeFile(path.join(DIR, 'anchorages.json'), JSON.stringify({ bake_version: STAY_BAKE_VERSION, rule: STAY_RULE,
    anchorages: list.map(({ geometry, ...a }) => a), edges }, null, 0))
  const by = (k) => list.filter((a) => a.coverage === k).length
  console.log(`${list.length} anchorages with a polygon (no-anchoring areas left out): covered ${by('covered')}, partial ${by('partial')}, outside ${by('none')}; ${edges.length} edges → ${DIR}/anchorages.json`)
}

async function importStays() {
  const meta = JSON.parse(await readFile(path.join(DIR, 'meta.json'), 'utf8'))
  const aj = JSON.parse(await readFile(path.join(DIR, 'anchorages.json'), 'utf8'))
  if (meta.bake_version !== STAY_BAKE_VERSION || aj.bake_version !== STAY_BAKE_VERSION) throw new Error(`bake version mismatch: meta ${meta.bake_version}, anchorages ${aj.bake_version}, code ${STAY_BAKE_VERSION}`)
  const stays = []
  const split = staySplitter((s) => stays.push(s))
  const rl = createInterface({ input: createReadStream(path.join(DIR, 'hits.csv')), crlfDelay: Infinity })
  let header = null, n = 0
  for await (const line of rl) {
    if (!header) { header = line.split(','); continue }
    const f = parseCsvLine(line)
    const r = Object.fromEntries(header.map((h, i) => [h, f[i]]))
    split.push(r.anchorage, r.mmsi, { t: Date.parse(r.t), also: r.also ? r.also.split('#') : null,
      name: r.name || null, imo: r.imo || null, type: r.type === '' ? null : Number(r.type), length: r.length === '' ? null : Number(r.length) })
    n++
  }
  split.end()
  const anchN = new Set(stays.map((s) => s.anchorage)).size
  console.log(`${n.toLocaleString()} stopped positions → ${stays.length.toLocaleString()} stays at ${anchN} anchorages`)
  if (dry) { for (const s of stays.slice(0, 5)) console.log(JSON.stringify(s)); return }
  // Posting: the server resolves each anchorage by its stable key in its own database (storeAnchorageStays) and refuses unknown ones.
  if (post) return postMonth({ kind: 'anchorage', month: postMonthArg, version: STAY_BAKE_VERSION, rows: stays,
    bake: { rule: STAY_RULE, input: meta.input, days: meta.days, months: meta.months, hits: n, baked_at: meta.baked_at, polygons_sha: meta.polygons_sha,
      anchorages: aj.anchorages.filter((a) => a.coverage === 'covered' || stays.some((s) => s.anchorage === a.key)) } })
  // The bake's anchorage ids must be this database's (dev and prod ids differ): re-key by source_id + source_key.
  const live = new Map((await activeAnchorages()).map((a) => [`${a.source_id}|${a.source_key}`, a]))
  // …and must be the same polygons the bake used (same bounding box): a changed or missing anchorage stops the import.
  const bad = aj.anchorages.filter((a) => a.coverage === 'covered').filter((a) => { const l = live.get(a.key)
    return !l || [l.min_lat, l.max_lat, l.min_lon, l.max_lon].some((v, i) => Math.abs(Number(v) - a.bbox[i]) > 1e-9) })
  if (bad.length) throw new Error(`anchorages differ from the bake's polygons (re-run polygons + the bake): ${bad.slice(0, 5).map((a) => a.key).join(', ')}${bad.length > 5 ? ` +${bad.length - 5}` : ''}`)
  const anchorages = aj.anchorages.filter((a) => live.has(a.key)).map((a) => ({ ...a, id: Number(live.get(a.key).id) }))
  const bake = { rule: STAY_RULE, input: meta.input, days: meta.days, months: meta.months, hits: n, baked_at: meta.baked_at, polygons_sha: meta.polygons_sha, anchorages }
  await withTx(pool, async (c) => {
    await upsertSource(c, schema, ANCHORAGE_STAYS_SOURCE)
    const runId = await startRun(c, schema, ANCHORAGE_STAYS_SOURCE.id, { bake_version: STAY_BAKE_VERSION, days: meta.days.length })
    const r = await storeAnchorageStays(c, schema, { stays, bake, runId })
    await finishRun(c, schema, runId, { status: 'succeeded', stats: { hits: n, stays: stays.length, anchorages: anchN }, datasetVersion: STAY_BAKE_VERSION })
    console.log(`stored ${r.stays} stays; bake record ${r.recordId}${r.recordCreated ? ' (new)' : ' (unchanged)'}`)
  })
}

async function aliases() {
  const anch = await activeAnchorages()
  const pts = await gfwAnchoragePoints(q, schema)
  // The VTS manual's names (Josh 2026-09-30): its record is stored first so each alias links to it (dry run: no record id yet).
  const manualRid = dry ? null : await withTx(pool, (c) => storeVtsManualRecord(c, schema))
  const found = [...aliasCandidates(anch, pts), ...vtsManualAliases(anch, manualRid)]
  const acc = found.filter((f) => f.status === 'accepted'), cand = found.filter((f) => f.status === 'candidate')
  console.log(`${pts.length} GFW anchorage points; rule ${JSON.stringify(ALIAS_RULE)}`)
  console.log(`${acc.length} accepted, ${cand.length} candidates`)
  for (const f of found) console.log(`${f.status.padEnd(9)} ${f.anchorage_name} ← “${f.alias}” (${f.source_id}, ${f.method}${f.distance_m == null ? '' : `, ${f.distance_m} m`})${f.detail.why ? ` — ${f.detail.why}` : ''}`)
  if (dry) return
  await withTx(pool, async (c) => {
    const r = await storeAnchorageAliases(c, schema, found)
    console.log(`stored: ${r.inserted} new, ${r.updated} seen again`)
  })
}

/** hits.csv is written by DuckDB COPY (RFC 4180 quoting). */
function parseCsvLine(s) {
  const out = []
  let i = 0
  while (i <= s.length) {
    if (s[i] === '"') {
      let v = '', j = i + 1
      for (;;) {
        if (s[j] === '"' && s[j + 1] === '"') { v += '"'; j += 2 } else if (s[j] === '"') { j++; break } else if (j >= s.length) break; else v += s[j++]
      }
      out.push(v); i = j + 1
    } else {
      const j = s.indexOf(',', i)
      if (j < 0) { out.push(s.slice(i)); break }
      out.push(s.slice(i, j)); i = j + 1
    }
  }
  return out
}
