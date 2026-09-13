#!/usr/bin/env node
/**
 * bake-mars.js — transform UNEP IMEO MARS "sources and plumes" export into
 * the slim source-level artifact /inmotion's overlay consumes.
 *
 * Input: the official public export from
 * https://methanedata.unep.org/download-dataset ("MARS sources and plumes",
 * GeoJSON) — a zip holding unep_methanedata_detected_plumes.geojson (~29k
 * plumes, 2020→now) and unep_methanedata_detected_sources.geojson (~4k
 * persistent sources). The portal is Cloudflare-gated against server-side
 * fetches, so this bake runs LOCALLY against a manually-downloaded zip until
 * UNEP grants programmatic access (the public feed lags ~30 days anyway):
 *
 *   node scripts/bake-mars.js ~/Downloads/unep_methanedata_detected_plumes_geojson.zip
 *
 * Output: public/dev-data/systems/mars-sources.json (localhost QA path per
 * loadSystemsJson) — copy/upload the same JSON to Blob systems/ for prod.
 *
 * License: CC BY-NC-SA 4.0 — credit UNEP's International Methane Emissions
 * Observatory; the artifact carries the license + attribution in `source`.
 *
 * Row shape mirrors the Carbon Mapper ch4-sources rows so the shared overlay
 * renders both (see src/systems/methanePlumesOverlay.js):
 *   [lat, lng, kgh, unc, t_last_ms, sector, label, persist_pct, n_plumes,
 *    t_first_ms, source_name, country, actionable, notified, srcType, sat]
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const zipPath = process.argv[2]
if (!zipPath) {
  console.error('usage: node scripts/bake-mars.js <unep_methanedata_detected_plumes_geojson.zip>')
  process.exit(1)
}

const tmp = mkdtempSync(join(tmpdir(), 'mars-'))
execFileSync('unzip', ['-o', '-q', zipPath, '-d', tmp])
const plumesFC = JSON.parse(readFileSync(join(tmp, 'unep_methanedata_detected_plumes.geojson'), 'utf8'))
const sourcesFC = JSON.parse(readFileSync(join(tmp, 'unep_methanedata_detected_sources.geojson'), 'utf8'))

// MARS timestamps are UTC ISO-8601 without a zone suffix.
const ms = (s) => (s ? Date.parse(String(s).endsWith('Z') ? s : s + 'Z') : null)

// Per-source aggregates from the plume table: first seen, latest plume's
// rate ± std and satellite, whether any plume was deemed actionable.
const bySource = new Map()
for (const f of plumesFC.features || []) {
  const p = f.properties || {}
  if (!p.source_name) continue
  const t = ms(p.tile_date)
  let a = bySource.get(p.source_name)
  if (!a) bySource.set(p.source_name, (a = { first: t, last: null, kgh: null, std: null, sat: null, actionable: false, n: 0 }))
  a.n++
  if (t != null && (a.first == null || t < a.first)) a.first = t
  if (t != null && (a.last == null || t > a.last)) {
    a.last = t
    a.kgh = Number.isFinite(p.ch4_fluxrate) ? Math.round(p.ch4_fluxrate) : null
    a.std = Number.isFinite(p.ch4_fluxrate_std) ? Math.round(p.ch4_fluxrate_std) : null
    a.sat = p.satellite || null
  }
  if (String(p.actionable).toLowerCase() === 'yes') a.actionable = true
}

const SATS = [...new Set([...bySource.values()].map((a) => a.sat).filter(Boolean))].sort()
const rows = []
for (const f of sourcesFC.features || []) {
  const p = f.properties || {}
  const lat = Number(p.lat), lng = Number(p.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
  const a = bySource.get(p.source_name) || {}
  const tLast = ms(p.last_plume_date) ?? a.last
  if (tLast == null) continue // a source with no dated plume can't be age-graded honestly
  rows.push([
    Math.round(lat * 1e5) / 1e5,
    Math.round(lng * 1e5) / 1e5,
    a.kgh ?? null,
    a.std ?? null,
    tLast,
    p.sector || '',
    p.source_type || '',
    p.persistency == null ? null : Math.round(p.persistency * 100),
    p.n_plumes_detected ?? a.n ?? 0,
    a.first ?? null,
    p.source_name || '',
    p.country || '',
    a.actionable ? 1 : 0,
    String(p.notified).toLowerCase() === 'yes' ? 1 : 0,
    SATS.indexOf(a.sat),
  ])
}

const now = Date.now()
const out = {
  version: 1,
  kind: 'mars-sources',
  fetched_ms: now,
  valid_ms: now,
  run_ms: now,
  count: rows.length,
  plumes_total: (plumesFC.features || []).length,
  satellites: SATS,
  columns: ['lat', 'lng', 'kgh', 'kgh_std', 't_last_ms', 'sector', 'source_type', 'persist_pct', 'n_plumes', 't_first_ms', 'source_name', 'country', 'actionable', 'notified', 'sat_idx'],
  source: 'UNEP International Methane Emissions Observatory — Methane Alert and Response System (MARS) detected sources and plumes; CC BY-NC-SA 4.0, adapted (source-level aggregation) by EarthAtlas. Public feed lags ~30 days behind observation.',
  source_url: 'https://methanedata.unep.org/map',
  license: 'CC BY-NC-SA 4.0',
  sources: rows,
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'public', 'dev-data', 'systems')
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'mars-sources.json')
writeFileSync(outPath, JSON.stringify(out))
const newest = rows.reduce((m, r) => Math.max(m, r[4] || 0), 0)
console.log(`wrote ${outPath}: ${rows.length} sources (${(plumesFC.features || []).length} plumes joined), newest detection ${new Date(newest).toISOString().slice(0, 10)}, ${Math.round(JSON.stringify(out).length / 1024)} KB`)
