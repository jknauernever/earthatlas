#!/usr/bin/env node
/**
 * Official anchorage areas for /ships (Phase 3 step 3; docs/ANCHORAGE_AREAS_SOURCES.md). Dev DB only unless Josh
 * says otherwise (production: zsh scripts/ships/prod.sh import-anchorages).
 *
 *   npm run ships:import-anchorages-us            -- [--fetch]  # MarineCadastre "Anchorages" (NOAA/USCG, public domain),
 *                                                                # 679 polygons, + the eCFR Part 110 version list
 *                                                                # (flags rows amended since the layer's CFR date)
 *   npm run ships:import-anchorages-ca            -- [--fetch]  # DFO Active Commercial Shipping Anchorages in Pacific
 *                                                                # Canada (OGL-Canada 2.0), 117 points → swing-radius circles
 *   npm run ships:import-anchorages-nondesignated -- [--fetch]  # Puget Sound non-designated anchorages from the withdrawn
 *                                                                # 2017 proposed rule 82 FR 10313 (GPO plain text)
 * Common: --schema <name> (default "ships"). Every step is idempotent; each is a complete import of its source, so
 * rows the source no longer has are marked 'withdrawn' (kept).
 *
 * Downloads go to scripts/ships/bake-ais/build/anchorages/ (gitignored) with a .meta.json (URL, Last-Modified,
 * fetched_at). One request per file; nothing is fetched without --fetch. Generic User-Agent, no personal data.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA, withTx, withRetry } from '../../lib/ships/db.js'
import { startRun, finishRun } from '../../lib/ships/store.js'
import { storeRawRecords } from '../../lib/ships/ports.js'
import {
  ensureAnchorageSources, ingestAnchorages, withdrawMissingAnchorages, amendedSince,
  mapMcFeature, mapDfoFeature, parseProposedParagraphs, mapProposedParagraph,
  MC_SOURCE, DFO_SOURCE, NONDES_SOURCE, ECFR_SOURCE, KIND, FR_DOC,
  MC_URL, MC_LAYER_URL, DFO_URL, FR_TEXT_URL, ECFR_VERSIONS_URL,
} from '../../lib/ships/anchorages.js'

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bake-ais', 'build', 'anchorages')
const UA = 'Mozilla/5.0 (compatible; EarthAtlas data import)'
const [what, ...args] = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const flag = (n) => args.includes(`--${n}`)
const schema = opt('schema') || DEFAULT_SCHEMA
const CHUNK = 100

async function download(url, file, { compressed = false } = {}) {
  await mkdir(BUILD, { recursive: true })
  const full = path.join(BUILD, file)
  if (flag('fetch')) {
    // fetch() negotiates gzip itself; the eCFR API refuses requests without Accept-Encoding (406).
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...(compressed ? { 'Accept-Encoding': 'gzip' } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(300000) })
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    await writeFile(full, Buffer.from(await res.arrayBuffer()))
    const lm = res.headers.get('last-modified')
    await writeFile(`${full}.meta.json`, JSON.stringify({ url, final_url: res.url, last_modified: lm ? new Date(lm).toISOString() : null, fetched_at: new Date().toISOString() }, null, 1))
    console.log(`fetched ${url} → ${full} (Last-Modified ${lm ?? 'none'})`)
  }
  let meta
  try { meta = JSON.parse(await readFile(`${full}.meta.json`, 'utf8')) } catch { throw new Error(`${full}.meta.json missing: run with --fetch first`) }
  return { file: full, meta, text: await readFile(full, 'utf8') }
}

/** Complete import of one source: chunks of CHUNK items, then withdraw keys the file no longer has. */
async function importAll(pool, source, kind, items, opts) {
  const acc = { rows: 0, recordsCreated: 0, created: 0, seenAgain: 0, superseded: 0 }
  for (let i = 0; i < items.length; i += CHUNK) {
    const r = await withRetry(() => withTx(pool, (c) => ingestAnchorages(c, schema, source.id, kind, items.slice(i, i + CHUNK), opts)))
    for (const k of Object.keys(acc)) acc[k] += r[k]
  }
  acc.withdrawn = await withTx(pool, (c) => withdrawMissingAnchorages(c, schema, source.id, items.filter((i) => i.row).map((i) => i.key)))
  return acc
}

const pool = shipsPool()
let runId = null, stats = {}
try {
  if (!['us', 'ca', 'nondesignated'].includes(what)) throw new Error('usage: import-anchorages.mjs us|ca|nondesignated [--fetch] [--schema <name>]')
  console.log(`anchorages ${what} → schema "${schema}" on ${new URL(process.env.SHIPS_DATABASE_URL).host}`)
  await ensureAnchorageSources(pool, schema)
  const day = (m) => m.fetched_at.slice(0, 10)
  if (what === 'us') {
    // 1. eCFR Part 110 versions (evidence for the "older boundary" flag).
    const ecfr = await download(ECFR_VERSIONS_URL, 'ecfr-part110-versions.json', { compressed: true })
    const versions = JSON.parse(ecfr.text)
    const ecfrRec = await withTx(pool, (c) => storeRawRecords(c, schema, ECFR_SOURCE.id, KIND.ecfr, [{ key: 'title-33-part-110', payload: versions }],
      { retrievalUrl: ecfr.meta.url, datasetVersion: `latest amendment ${versions.meta?.latest_amendment_date ?? '?'}, fetched ${day(ecfr.meta)}` }))
    const amendRid = ecfrRec.byKey.get('title-33-part-110').at(-1)
    const amended = amendedSince(versions)
    // 2. The layer itself (+ its layer info for lastEditDate).
    const layer = await download(MC_LAYER_URL, 'mc-layer.json')
    const lastEdit = JSON.parse(layer.text)?.editingInfo?.lastEditDate
    const fc = await download(MC_URL, 'mc.geojson')
    const gj = JSON.parse(fc.text)
    if (gj.type !== 'FeatureCollection' || gj.exceededTransferLimit || gj.properties?.exceededTransferLimit) throw new Error('MarineCadastre response incomplete (exceededTransferLimit)')
    const mapped = gj.features.map((f) => ({ f, m: mapMcFeature(f, { amended, amendRid }) }))
    const items = mapped.filter((x) => x.m.key).map((x) => ({ key: x.m.key, payload: x.f, row: x.m.row ?? null }))
    stats.features = gj.features.length
    stats.errors = mapped.filter((x) => x.m.error).map((x) => `${x.m.key}: ${x.m.error}`)
    stats.olderBoundary = items.filter((i) => i.row?.boundary_note).length
    stats.noAnchoring = items.filter((i) => i.row?.no_anchoring).length
    const opts = { retrievalUrl: MC_URL, datasetVersion: `FeatureServer lastEditDate ${lastEdit ? new Date(lastEdit).toISOString().slice(0, 10) : '?'}, fetched ${day(fc.meta)}` }
    runId = opts.runId = await withTx(pool, (c) => startRun(c, schema, MC_SOURCE.id, { features: gj.features.length, dataset: opts.datasetVersion }))
    Object.assign(stats, await importAll(pool, MC_SOURCE, KIND.mc, items, opts))
  } else if (what === 'ca') {
    const fc = await download(DFO_URL, 'dfo.geojson')
    const gj = JSON.parse(fc.text)
    if (gj.type !== 'FeatureCollection' || gj.exceededTransferLimit || gj.properties?.exceededTransferLimit) throw new Error('DFO response incomplete (exceededTransferLimit)')
    const mapped = gj.features.map((f) => ({ f, m: mapDfoFeature(f) }))
    const items = mapped.filter((x) => x.m.key).map((x) => ({ key: x.m.key, payload: x.f, row: x.m.row ?? null }))
    stats.features = gj.features.length
    stats.errors = mapped.filter((x) => x.m.error).map((x) => `${x.m.key}: ${x.m.error}`)
    stats.circles = items.filter((i) => i.row?.geometry).length
    stats.noRadius = items.filter((i) => i.row && !i.row.geometry).length
    const opts = { retrievalUrl: DFO_URL, datasetVersion: `retrieved ${day(fc.meta)}` }
    runId = opts.runId = await withTx(pool, (c) => startRun(c, schema, DFO_SOURCE.id, { features: gj.features.length, dataset: opts.datasetVersion }))
    Object.assign(stats, await importAll(pool, DFO_SOURCE, KIND.dfo, items, opts))
  } else {
    const doc = await download(FR_TEXT_URL, 'fr-2017-02683.txt')
    const paras = parseProposedParagraphs(doc.text)
    // Every proposed paragraph is kept as evidence; only the ones that are not in today's §110.230 become anchorages.
    const items = paras.map((p) => {
      const m = mapProposedParagraph(p)
      return { key: p.para, row: m.row ?? null,
        payload: { document: FR_DOC.number, citation: FR_DOC.citation, published: FR_DOC.published, section: '33 CFR 110.230 (proposed)',
          paragraph: p.para, heading: p.heading, text: p.text, source_url: FR_TEXT_URL } }
    })
    stats.paragraphs = paras.length
    stats.skipped = paras.filter((p) => !mapProposedParagraph(p).row).map((p) => p.para)
    stats.withGeometry = items.filter((i) => i.row?.geometry).length
    stats.namedOnly = items.filter((i) => i.row && !i.row.geometry).map((i) => `${i.key} ${i.row.name}`)
    const opts = { retrievalUrl: FR_TEXT_URL, datasetVersion: `${FR_DOC.citation} (FR doc ${FR_DOC.number}), fetched ${day(doc.meta)}` }
    runId = opts.runId = await withTx(pool, (c) => startRun(c, schema, NONDES_SOURCE.id, { paragraphs: paras.length, dataset: opts.datasetVersion }))
    Object.assign(stats, await importAll(pool, NONDES_SOURCE, KIND.fr, items, opts))
  }
  if (runId) await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats }))
  console.log('done', JSON.stringify(stats, null, 1))
} catch (e) {
  if (runId) await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'failed', stats, error: String(e.stack || e) })).catch(() => {})
  console.error(e)
  process.exitCode = 1
} finally {
  await pool.end()
}
