#!/usr/bin/env node
/**
 * Import the NAME-ONLY incident sources (docs/SHIP_INCIDENT_SOURCES.md §4, §6, §13):
 *   nrc           National Response Center yearly workbooks: Washington reports with a vessel row
 *   incidentnews  NOAA IncidentNews CSV: WA / BC-waters rows whose title indicates a vessel
 * Every vessel link is a CANDIDATE (never accepted, never shown on the card).
 *
 *   npm run ships:import-incidents-names                         # both; NRC years 2023–2026
 *   npm run ships:import-incidents-names -- --only nrc --years 2020-2026
 *   npm run ships:import-incidents-names -- --replay lib/ships/test/fixtures/names-live-2026-09-26.json
 * Downloads are kept in scripts/ships/bake-ais/build/incidents/ (gitignored) and reused with --cached.
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA, withTx, withRetry } from '../../lib/ships/db.js'
import { ensureIncidentSources, ingestIncident, tallyIncident } from '../../lib/ships/incidents.js'
import { NRC_SOURCE, INCIDENTNEWS_SOURCE, mapNrc, mapIncidentNews, redactNrcCall, incidentNewsWanted } from '../../lib/ships/incidentsNames.js'
import { sharedStrings, sheetRows, rowsToObjects } from '../../lib/ships/xlsx.js'
import { startRun, finishRun } from '../../lib/ships/store.js'

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bake-ais', 'build', 'incidents')
const UA = 'EarthAtlas-ships/0.1 (+https://earthatlas.org; vessel incident research)'
const IN_URL = 'https://incidentnews.noaa.gov/raw/incidents.csv'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const only = new Set((opt('only') || 'nrc,incidentnews').split(','))
const [y0, y1] = (opt('years') || '2023-2026').split('-').map(Number)
const cached = args.includes('--cached')

async function fetchTo(url, file) {
  if (cached && (await stat(file).catch(() => null))) return JSON.parse(await readFile(`${file}.meta.json`, 'utf8'))
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300000) })
  if (res.status === 401 || res.status === 403) throw new Error(`${url}: HTTP ${res.status} (access refused; not worked around)`)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  await writeFile(file, Buffer.from(await res.arrayBuffer()))
  const meta = { url, last_modified: res.headers.get('last-modified') ? new Date(res.headers.get('last-modified')).toISOString() : null, retrieved_at: new Date().toISOString() }
  await writeFile(`${file}.meta.json`, JSON.stringify(meta))
  return meta
}

/** Minimal CSV parser (RFC 4180 quotes). */
function parseCsv(text) {
  const rows = []
  let row = [], f = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += ch; continue }
    if (ch === '"') q = true
    else if (ch === ',') { row.push(f); f = '' }
    else if (ch === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = '' }
    else f += ch
  }
  if (f || row.length) { row.push(f); rows.push(row) }
  const [head, ...data] = rows
  return data.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

/** Sheets of an xlsx by name → rows as objects. */
function workbook(file, names) {
  const un = (p) => execFileSync('unzip', ['-p', file, p], { maxBuffer: 1 << 30 }).toString('utf8')
  const wb = un('xl/workbook.xml'), rels = un('xl/_rels/workbook.xml.rels')
  const ss = sharedStrings(un('xl/sharedStrings.xml'))
  const out = {}
  for (const n of names) {
    const rid = new RegExp(`<sheet name="${n}"[^>]*r:id="(rId\\d+)"`).exec(wb)?.[1]
    const target = rid && new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
    out[n] = target ? rowsToObjects(sheetRows(un(`xl/${target.replace(/^\/?xl\//, '')}`), ss)) : []
  }
  return out
}
const bySeq = (rows) => { const m = new Map(); for (const r of rows) { if (!m.has(r.SEQNOS)) m.set(r.SEQNOS, []); m.get(r.SEQNOS).push(r) } return m }

const pool = shipsPool()
const stats = { nrc: {}, incidentnews: {} }
let runId = null
const ingest = async (kind, m, url) => {
  if (!m) return
  const r = await withRetry(() => ingestIncident(pool, schema, m, { runId, retrievalUrl: url, nameOnly: true }))
  tallyIncident(stats[kind], r)
  if (stats[kind].events % 200 === 0) console.log(`  ${kind} ${stats[kind].events}`, JSON.stringify(stats[kind]))
}

try {
  await ensureIncidentSources(pool, schema, [NRC_SOURCE, INCIDENTNEWS_SOURCE])
  const params = Object.fromEntries(['only', 'years', 'replay'].map((k) => [k, opt(k)]).filter(([, v]) => v))
  runId = await withTx(pool, (c) => startRun(c, schema, NRC_SOURCE.id, params))
  console.log(`import run ${runId} → schema "${schema}"`, params)
  await mkdir(BUILD, { recursive: true })

  if (opt('replay')) {
    const rec = JSON.parse(await readFile(opt('replay'), 'utf8'))
    for (const p of rec.nrc || []) await ingest('nrc', mapNrc(p), `replay:${path.basename(opt('replay'))}`)
    for (const p of rec.incidentnews || []) await ingest('incidentnews', mapIncidentNews(p), `replay:${path.basename(opt('replay'))}`)
  } else {
    if (only.has('nrc')) {
      for (let y = y0; y <= y1; y++) {
        const name = `CY${String(y).slice(2)}.xlsx`
        const url = `https://nrc.uscg.mil/FOIAFiles/${name}`
        const file = path.join(BUILD, `nrc-${name}`)
        const meta = await fetchTo(url, file)
        const S = workbook(file, ['CALLS', 'INCIDENT_COMMONS', 'INCIDENT_DETAILS', 'MATERIAL_INVOLVED', 'VESSELS_DETAIL'])
        const commons = new Map(S.INCIDENT_COMMONS.map((r) => [r.SEQNOS, r]))
        const calls = new Map(S.CALLS.map((r) => [r.SEQNOS, r]))
        const details = new Map(S.INCIDENT_DETAILS.map((r) => [r.SEQNOS, r]))
        const mats = bySeq(S.MATERIAL_INVOLVED), vessels = bySeq(S.VESSELS_DETAIL)
        let n = 0
        for (const [seq, vs] of vessels) {
          const c = commons.get(seq)
          if (!c || c.LOCATION_STATE !== 'WA') continue
          const { call, redaction } = redactNrcCall(calls.get(seq))
          n++
          await ingest('nrc', mapNrc({ seqnos: seq, file: name, file_last_modified: meta.last_modified, retrieved_at: meta.retrieved_at,
            call, redaction, commons: c, details: details.get(seq) ?? null, materials: mats.get(seq) ?? [], vessels: vs }), url)
        }
        stats.nrc[`reports_${y}`] = n
        console.log(`NRC ${name}: ${n} Washington reports with a vessel row`)
      }
    }
    if (only.has('incidentnews')) {
      const file = path.join(BUILD, 'incidentnews-incidents.csv')
      const meta = await fetchTo(IN_URL, file)
      const rows = parseCsv(await readFile(file, 'utf8'))
      const keep = rows.filter(incidentNewsWanted)
      stats.incidentnews.rowsInFile = rows.length
      stats.incidentnews.rowsKept = keep.length
      for (const r of keep) await ingest('incidentnews', mapIncidentNews({ row: r, retrieved_at: meta.retrieved_at, file_url: IN_URL }), IN_URL)
    }
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
