#!/usr/bin/env node
/**
 * Import USCG incidents from CGMIX (docs/SHIP_INCIDENT_SOURCES.md §1–2, §13):
 *   iir  Incident Investigation Reports for every "Incident Investigation" activity that PSIX
 *        lists for one of OUR vessels (PSIX vessel entities with an accepted link).
 *   opc  PSIX operational controls for those vessels' "Vessel Operational Control" activities.
 *   def  PSIX deficiencies of their port-state-control exams since --since (default 2021-01-01);
 *        exams without deficiencies are logged, not stored.
 *
 *   npm run ships:import-incidents-cgmix                        # all three, scoped to our vessels
 *   npm run ships:import-incidents-cgmix -- --only iir --limit 50
 *   npm run ships:import-incidents-cgmix -- --iir-ids 7669720,7543400   # specific IIR activities
 *   npm run ships:import-incidents-cgmix -- --replay lib/ships/test/fixtures/cgmix-live-2026-09-26.json
 *   add --resume to skip activities already done (log: scripts/ships/bake-ais/build/incidents/cgmix-done.ndjson)
 *
 * Polite: one shared limiter, request starts ≥ 500 ms apart (≤ 2 req/s) however many lanes are in
 * flight (--lanes N, default 2; more lanes only hide database latency, not raise the request rate).
 * A 401/403 stops the run (never worked around) and is reported.
 */
import { mkdir, readFile, appendFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA, withTx, withRetry } from '../../lib/ships/db.js'
import { ensureIncidentSources, ingestIncident, tallyIncident } from '../../lib/ships/incidents.js'
import { IIR_SOURCE, PSIX_SOURCE, mapIir, mapPsixOpControl, mapPsixDeficiencies } from '../../lib/ships/incidentsCgmix.js'
import { parseDataset } from '../../lib/ships/psix.js'
import { startRun, finishRun } from '../../lib/ships/store.js'
import { cgmixClient } from './cgmixClient.js'

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bake-ais', 'build', 'incidents')
const DONE = path.join(BUILD, 'cgmix-done.ndjson')
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const limit = opt('limit') ? Number(opt('limit')) : Infinity
const only = new Set((opt('only') || 'iir,opc,def').split(','))
const since = opt('since') || '2021-01-01'
const LANES = Number(opt('lanes') || 2) // in-flight lanes; the shared limiter still keeps request starts ≥ 500 ms apart

const pool = shipsPool()
const stats = { iir: {}, opc: {}, def: {} }
let runId = null

async function ingest(kind, mapped, retrievalUrl) {
  if (!mapped) { stats[kind].empty = (stats[kind].empty || 0) + 1; return null }
  const r = await withRetry(() => ingestIncident(pool, schema, mapped, { runId, retrievalUrl }))
  tallyIncident(stats[kind], r)
  return r
}

try {
  await ensureIncidentSources(pool, schema, [IIR_SOURCE, PSIX_SOURCE])
  const params = Object.fromEntries(['only', 'iir-ids', 'replay', 'limit', 'since'].map((k) => [k, opt(k)]).filter(([, v]) => v))
  runId = await withTx(pool, (c) => startRun(c, schema, IIR_SOURCE.id, params))
  console.log(`import run ${runId} → schema "${schema}"`, params)

  if (opt('replay')) {
    const rec = JSON.parse(await readFile(opt('replay'), 'utf8'))
    const via = `replay:${path.basename(opt('replay'))}`
    for (const p of rec.iir || []) await ingest('iir', mapIir(p), via)
    for (const p of rec.psix_opcontrols || []) await ingest('opc', mapPsixOpControl(p), via)
    for (const p of rec.psix_deficiencies || []) await ingest('def', mapPsixDeficiencies(p), via)
  } else {
    // 1. Plan from our stored PSIX records (latest record of each accepted PSIX vessel entity).
    const work = { iir: new Map(), opc: new Map(), def: new Map() }
    for (const id of (opt('iir-ids') || '').split(',').map((s) => s.trim()).filter(Boolean)) work.iir.set(id, { activity_id: id })
    if (!opt('iir-ids')) {
      const { rows } = await pool.query(
        `SELECT se.entity_key AS vid,
                (SELECT value_raw FROM ${schema}.assertions n WHERE n.source_entity_id = se.id AND n.attribute = 'name' AND n.status = 'active' ORDER BY n.id LIMIT 1) AS name,
                (SELECT r.payload->'responses'->>'cases' FROM ${schema}.source_records r WHERE r.source_entity_id = se.id ORDER BY r.last_retrieved_at DESC, r.id DESC LIMIT 1) AS cases
           FROM ${schema}.source_entities se
           JOIN ${schema}.entity_links l ON l.source_entity_id = se.id AND l.status = 'accepted'
          WHERE se.source_id = 'uscg-psix' AND se.entity_kind = 'psix_vessel'`)
      for (const r of rows) {
        for (const cs of parseDataset(r.cases)) {
          const ctx = { psix_vessel_id: r.vid, vessel_name: r.name, case_start_raw: cs.StartDtTm ?? null, port: cs.USCGZonePort ?? null,
            activity_type: cs.TypeLookupName ?? null, port_state_control_exam: cs.PortStateControlRelatedExamination === 'true' }
          if (cs.TypeLookupName === 'Incident Investigation') work.iir.set(cs.ActivityId, { activity_id: cs.ActivityId })
          else if (cs.TypeLookupName === 'Vessel Operational Control') work.opc.set(cs.ActivityId, ctx)
          else if (ctx.port_state_control_exam && String(cs.StartDtTm || '') >= since) work.def.set(cs.ActivityId, ctx)
        }
      }
      stats.planned = { psixVessels: rows.length, iir: work.iir.size, opc: work.opc.size, def: work.def.size }
      console.log('planned', stats.planned)
    }
    await mkdir(BUILD, { recursive: true })
    const done = new Set()
    if (args.includes('--resume')) {
      const txt = await readFile(DONE, 'utf8').catch(() => '')
      for (const l of txt.split('\n').filter(Boolean)) { const o = JSON.parse(l); done.add(`${o.kind}:${o.id}`) }
      console.log(`resume: ${done.size} activities already done`)
    }
    const cg = cgmixClient({ pauseMs: 500 })
    for (const kind of ['iir', 'opc', 'def']) {
      if (!only.has(kind)) continue
      const todo = [...work[kind]].filter(([id]) => !done.has(`${kind}:${id}`)).slice(0, limit)
      stats[kind].skippedResume = work[kind].size - todo.length
      let j = 0, n = 0
      const lane = async () => {
        while (j < todo.length) {
          const [id, ctx] = todo[j++]
          let r
          if (kind === 'iir') r = await ingest(kind, mapIir(await cg.iir(id)), cg.endpoints.iir)
          else {
            const { xml } = await cg.call(kind === 'opc' ? 'opcontrols' : 'deficiencies', kind === 'opc' ? { ActivityID: id } : { ActivityNumber: id })
            const payload = { activity_id: String(id), retrieved_at: new Date().toISOString(), xml, context: ctx }
            r = await ingest(kind, kind === 'opc' ? mapPsixOpControl(payload) : mapPsixDeficiencies(payload), cg.endpoints.psix)
          }
          await appendFile(DONE, `${JSON.stringify({ kind, id, stored: !!r, at: new Date().toISOString() })}\n`)
          if (++n % 100 === 0) console.log(`  ${kind} ${n}/${todo.length} (requests ${cg.calls})`, JSON.stringify(stats[kind]))
        }
      }
      await Promise.all(Array.from({ length: LANES }, lane))
      console.log(`${kind} done`, stats[kind])
    }
    stats.requests = cg.calls
  }
  await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats }))
  console.log('done', JSON.stringify(stats, null, 1))
} catch (e) {
  if (runId) await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'failed', stats, error: String(e.stack || e) })).catch(() => {})
  console.error(e)
  process.exitCode = 1
} finally {
  await pool.end()
}
