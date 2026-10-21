#!/usr/bin/env node
/**
 * Bake federal critical habitat for Washington (NOAA Fisheries + USFWS) into one stored file, so the species-of-concern
 * lookup never asks the agencies' map services at click time. Those services sit on ArcGIS Online, which caps requests
 * that return shapes at 60 a minute (lookups hit it; see lib/speciesOfConcern/regulatory.js).
 *
 *   node scripts/species-of-concern/bake-critical-habitat.mjs [--only "<listed entity text>"] [--out file] [--upload]
 *
 * Full precision, cut into 0.25° tiles (about 28 x 18 km here) so a lookup reads only the tiles its circle touches:
 * Washington's designations are 100+ MB, far too much to load per lookup. Paced to ~40 shape requests a minute.
 * Output directory: index.json ({ designations: [fields regulatory.js shows], tiles: ["x_y", …] }) + t/<x>_<y>.json.gz
 * (pieces of each designation clipped exactly to that tile, by designation index). --upload puts the directory on Blob
 * under species-of-concern/critical-habitat/wa-<stamp>/ and then wa-latest.json (the pointer the lookup reads).
 * Needs BLOB_READ_WRITE_TOKEN (.env.local) for --upload.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { esriToGeoJSONExact, bboxOf, clipExact, TILE, tileKeysFor, tileBox } from '../../lib/speciesOfConcern/geometry.js'
import { normalizeNoaa, normalizeUsfws, NOAA, USFWS, NOAA_FIELDS, USFWS_FIELDS } from '../../lib/speciesOfConcern/regulatory.js'

const args = process.argv.slice(2)
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const only = flag('--only')
const outDir = flag('--out') || path.join(os.tmpdir(), 'earthatlas-species-of-concern', only ? 'critical-habitat-sample' : 'wa-critical-habitat')
const upload = args.includes('--upload')

// Washington, its outer-coast waters and a margin (designations crossing into OR/ID/BC are clipped here).
export const WA_BOX = [-125.8, 45.4, -116.8, 49.2]
const ENVELOPE = JSON.stringify({ xmin: WA_BOX[0], ymin: WA_BOX[1], xmax: WA_BOX[2], ymax: WA_BOX[3], spatialReference: { wkid: 4326 } })

const UA = { 'User-Agent': 'EarthAtlas critical-habitat bake (earthatlas.org)' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let lastShape = 0
async function query(layer, params, { shapes = false } = {}) {
  if (shapes) { const wait = lastShape + 1500 - Date.now(); if (wait > 0) await sleep(wait); lastShape = Date.now() }   // ≤ 40 a minute
  // POSTed as a form: a page of 1,000 object ids is too long for a GET URL (HTTP 400)
  const body = new URLSearchParams({ f: 'json', ...params })
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${layer}/query`, { method: 'POST', body, headers: { ...UA, 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(120000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      if (d.error) throw Object.assign(new Error(d.error.message + (d.error.details?.length ? ` (${d.error.details.join('; ')})` : '')), { quota: /too many requests|quota/i.test(JSON.stringify(d.error)) })
      return d
    } catch (e) {
      if (attempt >= 5) throw e
      await sleep(e.quota ? 61000 : 3000 * attempt)   // the shape quota resets each minute
    }
  }
}

const where = (fld) => (only ? `${fld} LIKE '%${only.replace(/'/g, "''")}%'` : '1=1')
const spatial = { geometry: ENVELOPE, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' }

// Each finished layer is kept beside the output, so a rerun after a failure resumes instead of downloading it again.
const partDir = `${outDir}.parts`
async function bakeLayer(layer) {
  const part = path.join(partDir, `${layer.url.split('/services/')[1].replace(/\W+/g, '_')}${only ? `-${only.replace(/\W+/g, '_')}` : ''}.json`)
  if (fs.existsSync(part)) { const f = JSON.parse(fs.readFileSync(part, 'utf8')); console.log(`  ${part}: ${f.length} features (kept from the last run)`); return f }
  const features = await downloadLayer(layer)
  fs.mkdirSync(partDir, { recursive: true })
  fs.writeFileSync(part, JSON.stringify(features))
  return features
}

async function downloadLayer({ url, fields, filterField, perPage, normalize, kind }) {
  const { objectIds = [] } = await query(url, { where: where(filterField), ...spatial, returnIdsOnly: 'true' })
  const features = []
  for (let i = 0; i < objectIds.length; i += perPage) {
    const ids = objectIds.slice(i, i + perPage)
    const d = await query(url, { objectIds: ids.join(','), outFields: fields, returnGeometry: 'true', outSR: '4326', geometryPrecision: '6' }, { shapes: true })
    for (const f of d.features || []) {
      const geometry = esriToGeoJSONExact(f.geometry, WA_BOX)
      if (!geometry) continue
      features.push({ type: 'Feature', bbox: bboxOf(geometry), geometry, properties: { ...normalize(f.attributes, kind === 'line'), source_id: f.attributes.OBJECTID } })
    }
    process.stdout.write(`\r  ${url.split('/services/')[1]}: ${Math.min(i + perPage, objectIds.length)}/${objectIds.length}`)
  }
  if (objectIds.length) process.stdout.write('\n')
  return features
}

const t0 = Date.now()
const layers = [
  { url: `${NOAA}/1`, fields: NOAA_FIELDS, filterField: 'LISTENTITY', perPage: 20, normalize: normalizeNoaa, kind: 'area' },
  { url: `${NOAA}/0`, fields: NOAA_FIELDS, filterField: 'LISTENTITY', perPage: 1000, normalize: normalizeNoaa, kind: 'line' },
  { url: `${USFWS}/0`, fields: USFWS_FIELDS, filterField: 'comname', perPage: 1, normalize: (a) => normalizeUsfws(a, 'Final'), kind: 'area' },
  { url: `${USFWS}/2`, fields: USFWS_FIELDS, filterField: 'comname', perPage: 1, normalize: (a) => normalizeUsfws(a, 'Proposed'), kind: 'area' },
]
const features = []
for (const l of layers) features.push(...await bakeLayer(l))

// The services' own last-edit dates, so the lookup can say how current the data is.
const edited = {}
for (const [k, u] of [['noaa', `${NOAA}/1`], ['usfws', `${USFWS}/0`]]) {
  const r = await fetch(`${u}?f=json`, { headers: UA }).then((x) => x.json()).catch(() => null)
  edited[k] = r?.editingInfo?.lastEditDate ? new Date(r.editingInfo.lastEditDate).toISOString().slice(0, 10) : null
}
// Designations once (shared fields), pieces per tile.
const designations = []
const dIndex = new Map()
const tiles = new Map()   // "x_y" -> [{ d, g }]
for (const f of features) {
  const { source_id, ...props } = f.properties
  const key = JSON.stringify(props)
  if (!dIndex.has(key)) { dIndex.set(key, designations.length); designations.push(props) }
  const d = dIndex.get(key)
  for (const tk of tileKeysFor(f.bbox)) {
    const g = clipExact(f.geometry, tileBox(tk))
    if (!g) continue
    if (!tiles.has(tk)) tiles.set(tk, [])
    tiles.get(tk).push({ d, bbox: bboxOf(g), g })
  }
}
const meta = { baked: new Date().toISOString(), box: WA_BOX, tile: TILE, only: only || null, source_edited: edited, features: features.length }
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(path.join(outDir, 't'), { recursive: true })
const index = { meta, designations, tiles: [...tiles.keys()].sort() }
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index))
let bytes = 0, biggest = 0
for (const [tk, pieces] of tiles) {
  const body = zlib.gzipSync(JSON.stringify(pieces))
  bytes += body.length; biggest = Math.max(biggest, body.length)
  fs.writeFileSync(path.join(outDir, 't', `${tk}.json.gz`), body)
}
fs.rmSync(partDir, { recursive: true, force: true })   // done: no resume needed
console.log(`${features.length} features, ${designations.length} designations, ${tiles.size} tiles, ${(bytes / 1e6).toFixed(1)} MB gzipped (largest tile ${(biggest / 1e6).toFixed(2)} MB), ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${outDir}`)

if (upload) {
  if (only) throw new Error('refusing to upload a --only sample')
  // GitHub Actions: one-file tokens from earthatlas.org (CRON_SECRET + PERMITS_TOKEN_URL), never a Blob token in CI.
  // Locally: BLOB_READ_WRITE_TOKEN from .env.local.
  const env = fs.existsSync('.env.local') ? Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')])) : {}
  const rw = process.env.BLOB_READ_WRITE_TOKEN || env.BLOB_READ_WRITE_TOKEN
  const tokenUrl = process.env.PERMITS_TOKEN_URL, cron = process.env.CRON_SECRET
  if (!rw && !(tokenUrl && cron)) throw new Error('need BLOB_READ_WRITE_TOKEN (local) or PERMITS_TOKEN_URL + CRON_SECRET (CI)')
  const blob = rw ? await import('@vercel/blob') : await import('@vercel/blob/client')
  const tokenFor = async (pathname) => {
    if (rw) return rw
    const r = await fetch(tokenUrl, { method: 'POST', headers: { authorization: `Bearer ${cron}`, 'content-type': 'application/json' }, body: JSON.stringify({ pathname }) })
    if (!r.ok) throw new Error(`upload token for ${pathname}: HTTP ${r.status} ${await r.text()}`)
    return (await r.json()).token
  }
  const put = async (pathname, body, o) => blob.put(pathname, body, { ...o, token: await tokenFor(pathname) })
  const stamp = meta.baked.slice(0, 19).replace(/[-:T]/g, '')
  const base = `species-of-concern/critical-habitat/wa-${stamp}`
  const opts = (type) => ({ access: 'public', contentType: type, addRandomSuffix: false, ...(rw ? { cacheControlMaxAge: 31536000 } : {}) })
  const files = fs.readdirSync(path.join(outDir, 't'))
  for (let i = 0; i < files.length; i += 8) {
    await Promise.all(files.slice(i, i + 8).map((f) => put(`${base}/t/${f}`, fs.readFileSync(path.join(outDir, 't', f)), opts('application/gzip'))))
    process.stdout.write(`\r  uploaded ${Math.min(i + 8, files.length)}/${files.length} tiles`)
  }
  const idx = await put(`${base}/index.json`, JSON.stringify(index), opts('application/json'))
  const latest = { base: idx.url.replace(/\/index\.json$/, ''), baked: meta.baked, source_edited: edited, features: features.length, designations: designations.length, tiles: tiles.size, bytes }
  await put('species-of-concern/critical-habitat/wa-latest.json', JSON.stringify(latest), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, ...(rw ? { cacheControlMaxAge: 300 } : {}) })
  console.log(`\nuploaded -> ${latest.base}`)
}
