#!/usr/bin/env node
/**
 * Publish a /spills bake to Vercel Blob `spills/<stamp>/`, then point `spills/manifest.json` at it. In production the
 * app reads the manifest first (src/spills/spillsShared.js, loadSpillsFiles), so a new bake goes live without a deploy.
 * Files are written under their stamp and never overwritten; only the manifest changes, with a 60 s cache. The four
 * newest stamps are kept (a browser that loaded an older manifest can still finish); older ones are deleted.
 *
 *   node --env-file=.env.local scripts/bake-spills/upload.mjs <stamp>          (weekly.sh runs this after a bake)
 *   node --env-file=.env.local scripts/bake-spills/upload.mjs <stamp> --check  (list what would be uploaded)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { put, list, del } from '@vercel/blob'

const [stamp, flag] = process.argv.slice(2)
if (!stamp || !/^[\w.-]+$/.test(stamp)) throw new Error('usage: upload.mjs <stamp> [--check]')
const check = flag === '--check'
if (!check && !process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN missing (use --env-file=.env.local)')
const DIR = 'public/spills-data'

// What a bake writes (analyze.py, phmsa.py), all named with the stamp.
// Pipeline and gas accidents are the national dataset `phmsa` now (scripts/national/publish.mjs); older bakes still
// carry their own copies, which are published when present.
const main = { lm: `lm-spills-${stamp}.json`, esi: `esi-shoreline-${stamp}.geojson`, protected: `protected-${stamp}.geojson`, regions: `regions-${stamp}.json` }
for (const f of Object.values(main)) if (!existsSync(join(DIR, f))) throw new Error(`missing ${join(DIR, f)}`)
for (const [k, f] of [['pipe', `pipeline-${stamp}.json`], ['gas', `gas-${stamp}.json`]]) if (existsSync(join(DIR, f))) main[k] = f
// Per-year detail files of the two PHMSA layers, and one file per state (national.py).
const detailDirs = [`pipeline-${stamp}`, `gas-${stamp}`, `state-${stamp}`, `state-pa-${stamp}`].filter((d) => existsSync(join(DIR, d)))
const details = detailDirs.flatMap((dir) => {
  const fs = readdirSync(join(DIR, dir)).filter((f) => /^(\d{4}|[A-Z]{2})\.(json|geojson)$/.test(f)).map((f) => `${dir}/${f}`)
  if (!fs.length) throw new Error(`no detail files in ${join(DIR, dir)}`)
  return fs
})

// Sanity check before anything goes live: the new bake must not have lost data.
const lm = JSON.parse(readFileSync(join(DIR, main.lm)))
const pipe = main.pipe ? JSON.parse(readFileSync(join(DIR, main.pipe))) : null
const gas = main.gas ? JSON.parse(readFileSync(join(DIR, main.gas))) : null
const regions = JSON.parse(readFileSync(join(DIR, main.regions)))
const summary = { incidents: lm.summary.incidents, located: lm.summary.located, nrcThrough: lm.points.reduce((m, p) => (p.d > m ? p.d : m), '').slice(0, 10),
  ...(pipe ? { pipelineAccidents: pipe.rows.length, pipelineThrough: pipe.range[1] } : {}), ...(gas ? { gasIncidents: gas.rows.length } : {}),
  usIncidents: regions.regions.reduce((n, r) => n + r.n, 0), states: regions.regions.length, areas: lm.areas?.length || 0, species: lm.species.length }
const BASE = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com'
const prev = await fetch(`${BASE}/spills/manifest.json`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
if (prev?.summary) {
  for (const k of ['incidents', 'pipelineAccidents', 'gasIncidents', 'areas', 'usIncidents']) {
    if (prev.summary[k] == null || summary[k] == null) continue
    if (summary[k] < prev.summary[k] * 0.95) throw new Error(`${k} fell from ${prev.summary[k]} to ${summary[k]}; not publishing`)
  }
}

const files = [...Object.values(main), ...details]
const total = files.reduce((n, f) => n + statSync(join(DIR, f)).size, 0)
console.log(`${files.length} files, ${(total / 1e6).toFixed(1)} MB → spills/${stamp}/`, JSON.stringify(summary))
if (check) process.exit(0)

const urls = {}
for (const f of files) {
  const { url } = await put(`spills/${stamp}/${f}`, readFileSync(join(DIR, f)), {
    access: 'public', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json', cacheControlMaxAge: 31536000,
  })
  urls[f] = url
}
const manifest = {
  stamp, published: new Date().toISOString(), summary,
  files: Object.fromEntries(Object.entries(main).map(([k, f]) => [k, urls[f]])),
  ...(pipe ? { pipeDetail: `${BASE}/spills/${stamp}/pipeline-${stamp}/` } : {}),
  ...(gas ? { gasDetail: `${BASE}/spills/${stamp}/gas-${stamp}/` } : {}),
  stateDir: `${BASE}/spills/${stamp}/state-${stamp}/`,
  statePaDir: `${BASE}/spills/${stamp}/state-pa-${stamp}/`,
}
await put('spills/manifest.json', JSON.stringify(manifest), {
  access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60,
})
console.log(`manifest → spills/${stamp}`)

// Keep the four newest bakes.
const stamps = new Map()
let cursor
do {
  const page = await list({ prefix: 'spills/', cursor, limit: 1000 })
  for (const b of page.blobs) {
    const m = b.pathname.match(/^spills\/([^/]+)\//)
    if (m) (stamps.get(m[1]) || stamps.set(m[1], []).get(m[1])).push(b.url)
  }
  cursor = page.cursor
} while (cursor)
const old = [...stamps.keys()].sort().reverse().slice(4)
for (const s of old) await del(stamps.get(s))
if (old.length) console.log(`deleted old bakes: ${old.join(', ')}`)
