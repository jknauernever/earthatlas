#!/usr/bin/env node
/**
 * Ports reference for /ships (Phase 3 step 2; docs/PORTS_SOURCES.md). Dev DB only unless Josh says otherwise.
 *
 *   npm run ships:import-countries  -- [--fetch]   # GeoNames countryInfo.txt (CC BY 4.0): ISO2 / ISO3 / English name
 *   npm run ships:import-wpi        -- [--fetch]   # NGA World Port Index JSON (public domain), 2,951 ports
 *   npm run ships:import-locode     -- [--fetch] [--pre-release] [--all]
 *                                                  # UN/LOCODE official CSV. Default scope: rows flagged as ports
 *                                                  # (Function position 1) + every code WPI references; --all = every row
 *   npm run ships:import-anchorages -- [--fetch]   # GFW pipe-anchorages anchorage_overrides.csv (Apache-2.0)
 *   npm run ships:match-ports                      # GFW port labels in port_visits → our ports; fills port_visits.port_id
 *                                                  #   --labels a,b  only these GFW port labels
 *   node … import-ports.mjs places --labels a,b --geonames-dir D [--cgndb]
 *                                                  # GeoNames (US.txt, CA.txt in D) + CGNDB names near those ports (lib/ships/placeNames.js);
 *                                                  #   run match afterwards. --cgndb: one CGNDB request per Canadian port point
 * Common: --schema <name> (default "ships"), --file <path>, --resume (skip keys already stored).
 * Order on a fresh database: countries → wpi → locode → anchorages → match. Every step is idempotent.
 *
 * Downloads go to scripts/ships/bake-ais/build/ports/ (gitignored), with a .meta.json (URL, Last-Modified,
 * fetched_at). One request per file; nothing is fetched without --fetch.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA, withTx, withRetry } from '../../lib/ships/db.js'
import { startRun, finishRun, sha256, canonicalJson } from '../../lib/ships/store.js'
import {
  ensurePortSources, ingestCountries, ingestWpiPorts, ingestLocodeRows, checkLocodeAliases, ingestOverrides, matchPortLabels,
  parseCountryInfo, mapLocodeRow, csvRows, parseOverridesCsv, mapWpiPort,
  WPI_SOURCE, LOCODE_SOURCE, OVERRIDES_SOURCE, COUNTRIES_SOURCE, KIND,
  WPI_URL, LOCODE_RELEASE_URL, LOCODE_PRERELEASE_URL, OVERRIDES_URL, COUNTRIES_URL,
} from '../../lib/ships/ports.js'

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bake-ais', 'build', 'ports')
const UA = 'EarthAtlas-ships/0.1 (+https://earthatlas.org)'
const [what, ...args] = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const flag = (n) => args.includes(`--${n}`)
// --box w,s,e,n: the GFW port labels with an anchorage point inside it (places / match), or the WPI ports inside it (positions).
const boxOpt = () => { const b = (opt('box') || '').split(',').map(Number); return b.length === 4 && b.every(Number.isFinite) ? b : null }
async function labelsInBox(pool, schema, [w, s, e, n]) {
  const { rows } = await pool.query(
    `SELECT DISTINCT x.port_label FROM ${schema}.port_visits pv
       CROSS JOIN LATERAL (VALUES (pv.start_port_label, pv.start_lat, pv.start_lon), (pv.int_port_label, pv.int_lat, pv.int_lon),
                                  (pv.end_port_label, pv.end_lat, pv.end_lon)) AS x(port_label, lat, lon)
      WHERE pv.status = 'active' AND x.port_label IS NOT NULL AND x.lat BETWEEN $2 AND $4 AND x.lon BETWEEN $1 AND $3`, [w, s, e, n])
  return rows.map((r) => r.port_label)
}
const schema = opt('schema') || DEFAULT_SCHEMA
const CHUNK = 2000

const FILES = {
  countries: { url: COUNTRIES_URL, file: 'countryInfo.txt', source: COUNTRIES_SOURCE },
  wpi: { url: WPI_URL, file: 'wpi.json', source: WPI_SOURCE },
  locode: { url: flag('pre-release') ? LOCODE_PRERELEASE_URL : LOCODE_RELEASE_URL, file: flag('pre-release') ? 'unlocode-latest.zip' : 'unlocode-2025-1.zip', source: LOCODE_SOURCE },
  anchorages: { url: OVERRIDES_URL, file: 'anchorage_overrides.csv', source: OVERRIDES_SOURCE },
}

async function download(spec) {
  await mkdir(BUILD, { recursive: true })
  const file = opt('file') || path.join(BUILD, spec.file)
  if (flag('fetch')) {
    const res = await fetch(spec.url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(300000) })
    if (!res.ok) throw new Error(`${spec.url}: HTTP ${res.status}`)
    await writeFile(file, Buffer.from(await res.arrayBuffer()))
    const lm = res.headers.get('last-modified')
    await writeFile(`${file}.meta.json`, JSON.stringify({ url: spec.url, final_url: res.url, last_modified: lm ? new Date(lm).toISOString() : null, fetched_at: new Date().toISOString() }, null, 1))
    console.log(`fetched ${spec.url} → ${file} (Last-Modified ${lm ?? 'none'})`)
  }
  let meta
  try { meta = JSON.parse(await readFile(`${file}.meta.json`, 'utf8')) } catch { throw new Error(`${file}.meta.json missing: run with --fetch first`) }
  return { file, meta }
}

async function chunked(pool, items, fn) {
  const acc = {}
  for (let i = 0; i < items.length; i += CHUNK) {
    const r = await withRetry(() => withTx(pool, (c) => fn(c, items.slice(i, i + CHUNK))))
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number') acc[k] = (acc[k] || 0) + v
      else if (Array.isArray(v)) acc[k] = [...(acc[k] || []), ...v].slice(0, 20)
    if (items.length > CHUNK) console.log(`  ${Math.min(i + CHUNK, items.length)}/${items.length}`)
  }
  return acc
}

async function skipStored(pool, sourceId, kind, items) {
  if (!flag('resume')) return items
  const { rows } = await pool.query(`SELECT entity_key FROM ${schema}.source_entities WHERE source_id = $1 AND entity_kind = $2`, [sourceId, kind])
  const have = new Set(rows.map((r) => r.entity_key))
  return items.filter((i) => !have.has(i.key))
}

const pool = shipsPool()
let runId = null, stats = {}
try {
  if (!['countries', 'wpi', 'locode', 'anchorages', 'match', 'places', 'positions', 'geonames-ports'].includes(what)) throw new Error('usage: import-ports.mjs countries|wpi|locode|anchorages|match|places [--fetch] …')
  console.log(`ports ${what} → schema "${schema}" on ${new URL(process.env.SHIPS_DATABASE_URL).host}`)
  await ensurePortSources(pool, schema)
  if (what === 'match') {
    const { rows: [pvs] } = await pool.query(`SELECT count(*)::int AS n FROM ${schema}.sources WHERE id = 'gfw-port-visits'`)
    if (!pvs.n) throw new Error('no port visits stored yet (source gfw-port-visits missing)')
    const labels = opt('labels') ? opt('labels').split(',').map((x) => x.trim()).filter(Boolean) : boxOpt() ? await labelsInBox(pool, schema, boxOpt()) : null
    if (labels) console.log(`  ${labels.length} labels`)
    // --dry-run: the same match inside a transaction that is rolled back; prints only the names that would change.
    const dry = args.includes('--dry-run')
    const r = dry ? await (async () => {
      const c = await pool.connect()
      try {
        await c.query('BEGIN')
        const before = new Map((await c.query(`SELECT a.key AS label, p.name FROM ${schema}.port_aliases a JOIN ${schema}.ports p ON p.id = a.port_id WHERE a.key_kind = 'gfw_port_label'`)).rows.map((x) => [x.label, x.name]))
        const out = await matchPortLabels(c, schema, { labels })
        for (const d of out.decisions) d.before = before.get(d.label)
        return out
      } finally { await c.query('ROLLBACK').catch(() => {}); c.release() }
    })() : await withRetry(() => withTx(pool, (c) => matchPortLabels(c, schema, { labels })))
    if (dry) {
      const changed = r.decisions.filter((d) => d.before !== d.name).sort((a, b) => a.label.localeCompare(b.label))
      console.log(`  dry run (rolled back): ${changed.length} of ${r.decisions.length} names would change`)
      for (const d of changed) console.log(`  ${d.label.padEnd(30)} ${String(d.before ?? '—').padEnd(30)} → ${d.name}  [${d.method}${d.place ? `, ${d.place.code} ${Math.round(d.place.distance_km * 1000)} m` : ''}]`)
      process.exit(0)
    }
    stats = { labels: r.labels, byMethod: r.byMethod, visitsUpdated: r.visitsUpdated }
    for (const d of r.decisions.sort((a, b) => a.label.localeCompare(b.label))) {
      console.log(`  ${d.label.padEnd(30)} ${d.method.padEnd(24)} ${String(d.name ?? '—').padEnd(28)} ${d.distance_km != null ? `${d.distance_km} km` : ''}${d.candidates.length ? `  candidates: ${d.candidates.map((x) => `${x.name}${x.distance_km != null ? ` ${x.distance_km} km` : ''} (${x.reason ?? x.kind})`).join('; ')}` : ''}${d.notes.length ? `  [${d.notes.join('; ')}]` : ''}`)
    }
  } else if (what === 'geonames-ports') {
    // GeoNames marinas / harbors no port of ours covers (lib/ships/placeNames.js importGeonamesPorts): --box w,s,e,n --geonames-dir D
    const bx = (opt('box') || '').split(',').map(Number)
    const dir = opt('geonames-dir')
    if (bx.length !== 4 || bx.some((x) => !Number.isFinite(x)) || !dir) throw new Error('geonames-ports needs --box w,s,e,n and --geonames-dir D')
    const pn = await import('../../lib/ships/placeNames.js')
    const { portsLayer } = await import('../../lib/ships/portCard.js')
    const q = async (t, p) => (await pool.query(t, p)).rows
    const drawn = (await portsLayer(q, schema)).features.map((f) => ({ id: f.properties.i, name: f.properties.n, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
    const { rows: geo } = await pool.query(`SELECT id FROM ${schema}.ports WHERE origin = 'geonames'`)
    const geoIds = new Set(geo.map((r) => Number(r.id)))
    const r = await withTx(pool, async (c) => {
      await pn.ensurePlaceSources(c, schema)
      return pn.importGeonamesPorts(c, schema, ['US.txt', 'CA.txt'].map((f) => path.join(dir, f)), bx,
        drawn.map((d) => ({ ...d, origin: geoIds.has(Number(d.id)) ? 'geonames' : 'other' })))
    })
    for (const d of r.decisions) console.log(`  ${d.port_id ? 'added  ' : 'skipped'} ${d.name}${d.skipped ? ` (port "${d.skipped}" ${d.km} km)` : ''}`)
    stats = { listed: r.listed, added: r.added, skipped: r.skipped }
  } else if (what === 'positions') {
    // Better drawing positions for WPI ports (lib/ships/placeNames.js positionWpiPorts): --ids 1725,2895 --geonames-dir D
    let ids = (opt('ids') || '').split(',').map(Number).filter(Boolean)
    if (!ids.length && boxOpt()) {
      const [w, s, e, n] = boxOpt()
      ids = (await pool.query(`SELECT id FROM ${schema}.ports WHERE origin = 'wpi' AND lat BETWEEN $2 AND $4 AND lon BETWEEN $1 AND $3`, [w, s, e, n])).rows.map((r) => Number(r.id))
    }
    const dir = opt('geonames-dir')
    if (!ids.length || !dir) throw new Error('positions needs --ids a,b or --box w,s,e,n (WPI ports) and --geonames-dir D')
    const pn = await import('../../lib/ships/placeNames.js')
    const { rows: pts } = await pool.query(`SELECT lat::float8 AS lat, lon::float8 AS lon FROM ${schema}.ports WHERE origin = 'wpi' AND id = ANY($1::bigint[])`, [ids])
    const work = async (c) => {
      await pn.ensurePlaceSources(c, schema)
      await pn.ingestGeonamesNear(c, schema, ['US.txt', 'CA.txt'].map((f) => path.join(dir, f)), pts)
      return pn.positionWpiPorts(c, schema, ids)
    }
    // --dry-run: inside a transaction that is rolled back; prints only the ports whose drawn position would move.
    if (args.includes('--dry-run')) {
      const c = await pool.connect()
      try {
        await c.query('BEGIN')
        const before = new Map((await c.query(`SELECT id, detail->'position' AS pos FROM ${schema}.ports WHERE id = ANY($1::bigint[])`, [ids])).rows.map((r) => [String(r.id), r.pos]))
        const ds = await work(c)
        const moved = ds.filter((d) => { const b = before.get(String(d.id)); return (b?.lat ?? null) !== (d.position?.lat ?? null) || (b?.lon ?? null) !== (d.position?.lon ?? null) })
        console.log(`  dry run (rolled back): ${moved.length} of ${ds.length} WPI ports would move`)
        for (const d of moved) { const b = before.get(String(d.id)); console.log(`  ${d.name.padEnd(18)} ${b ? `${b.method} "${b.name}"` : 'WPI point'} → ${d.position ? `${d.position.method} "${d.position.name}" (${d.position.lat.toFixed(5)}, ${d.position.lon.toFixed(5)})${d.position.town ? `, ${Math.round(d.position.town.distance_km * 1000)} m from the town` : ''}` : 'WPI point'}`) }
      } finally { await c.query('ROLLBACK').catch(() => {}); c.release() }
      process.exit(0)
    }
    const decisions = await withTx(pool, work)
    for (const d of decisions) console.log(`  ${d.name.padEnd(16)} WPI ${d.wpi.map((x) => x.toFixed(4)).join(',')}  → ${d.position ? `${d.position.lat.toFixed(4)},${d.position.lon.toFixed(4)} ${d.position.method} "${d.position.name}" ${d.position.distance_km} km` : 'WPI position kept'}`)
    stats = { ports: decisions.length, moved: decisions.filter((d) => d.position).length }
  } else if (what === 'places') {
    const labels = boxOpt() && !opt('labels') ? await labelsInBox(pool, schema, boxOpt()) : (opt('labels') || '').split(',').map((x) => x.trim()).filter(Boolean)
    if (!labels.length) throw new Error('places needs --labels a,b or --box w,s,e,n (the GFW port labels to name)')
    const dir = opt('geonames-dir')
    if (!dir) throw new Error('places needs --geonames-dir D (GeoNames US.txt / CA.txt from https://download.geonames.org/export/dump/)')
    const { rows: pts } = await pool.query(
      `SELECT x.port_label, avg(x.lat)::float8 AS lat, avg(x.lon)::float8 AS lon, max(x.iso3) AS iso3
         FROM ${schema}.port_visits pv
         CROSS JOIN LATERAL (VALUES (pv.start_port_label, pv.start_anchorage_id, pv.start_iso3, pv.start_lat, pv.start_lon),
                                    (pv.int_port_label, pv.int_anchorage_id, pv.int_iso3, pv.int_lat, pv.int_lon),
                                    (pv.end_port_label, pv.end_anchorage_id, pv.end_iso3, pv.end_lat, pv.end_lon)) AS x(port_label, anchorage_id, iso3, lat, lon)
        WHERE pv.status = 'active' AND x.port_label = ANY($1) AND x.lat IS NOT NULL
        GROUP BY x.port_label, x.anchorage_id`, [labels])
    console.log(`  ${pts.length} anchorage points for ${new Set(pts.map((p) => p.port_label)).size} of ${labels.length} labels`)
    const pn = await import('../../lib/ships/placeNames.js')
    const files = ['US.txt', 'CA.txt'].map((f) => path.join(dir, f))
    stats = await withTx(pool, async (c) => {
      await pn.ensurePlaceSources(c, schema)
      const g = await pn.ingestGeonamesNear(c, schema, files, pts)
      const ca = pts.filter((p) => p.iso3 === 'CAN')
      const cg = flag('cgndb') && ca.length
        ? await pn.ingestCgndbNear(c, schema, ca, { fetchText: async (u) => { const r = await fetch(u, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(`CGNDB ${r.status}`); return r.text() } })
        : { requests: 0, kept: 0, created: 0 }
      return { geonames: g, cgndb: cg }
    })
    console.log(stats)
  } else {
    const spec = FILES[what]
    const { file, meta } = await download(spec)
    const lm = meta.last_modified ? meta.last_modified.slice(0, 10) : null
    const fetched = meta.fetched_at.slice(0, 10)
    const opts = { retrievalUrl: meta.url }
    if (what === 'countries') {
      const parsed = await skipStored(pool, spec.source.id, KIND.country, parseCountryInfo(await readFile(file, 'utf8')))
      opts.datasetVersion = `countryInfo.txt Last-Modified ${lm ?? 'unknown'}`
      runId = opts.runId = await withTx(pool, (c) => startRun(c, schema, spec.source.id, { file: path.basename(file), dataset: opts.datasetVersion }))
      stats = await withRetry(() => withTx(pool, (c) => ingestCountries(c, schema, parsed, opts)))
      stats.wpiPortsIso3Filled = (await pool.query(
        `UPDATE ${schema}.ports p SET iso3 = c.iso3, updated_at = now() FROM ${schema}.countries c
          WHERE p.origin = 'wpi' AND p.iso2 = c.iso2 AND p.iso3 IS DISTINCT FROM c.iso3`)).rowCount
    } else if (what === 'wpi') {
      const raw = JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')).ports
      const { rows: [cc] } = await pool.query(`SELECT count(*)::int AS n FROM ${schema}.countries`)
      if (!cc.n) console.warn('  warning: countries not imported yet; WPI ports get iso3 when ships:import-countries runs')
      const items = await skipStored(pool, spec.source.id, KIND.wpi, raw.map((p) => ({ key: mapWpiPort(p).key, p })))
      opts.datasetVersion = `retrieved ${fetched}` // WPI carries no edition/date field (docs/PORTS_SOURCES.md §1)
      runId = opts.runId = await withTx(pool, (c) => startRun(c, schema, spec.source.id, { file: path.basename(file), ports: raw.length }))
      stats = await chunked(pool, items.map((i) => i.p), (c, part) => ingestWpiPorts(c, schema, part, opts))
      stats.locodeCheck = await withTx(pool, (c) => checkLocodeAliases(c, schema))
    } else if (what === 'locode') {
      const parts = execFileSync('unzip', ['-Z1', file]).toString('utf8').split('\n').filter((n) => /release\/csv\/UNLOCODE CodeListPart\d\.csv$/.test(n)).sort()
      if (!parts.length) throw new Error('no CodeListPart*.csv in the zip')
      const all = []
      for (const p of parts) for (const f of csvRows(execFileSync('unzip', ['-p', file, p], { maxBuffer: 1 << 30 }).toString('utf8'))) all.push(mapLocodeRow(f))
      const good = all.filter((m) => m.key)
      stats.csvRows = all.length; stats.countryHeaderRows = all.filter((m) => m.skip).length; stats.badRows = all.filter((m) => m.error).length
      const { rows: wpiCodes } = await pool.query(`SELECT DISTINCT unlocode FROM ${schema}.ports WHERE unlocode IS NOT NULL`)
      const want = new Set(wpiCodes.map((r) => r.unlocode))
      let scope = flag('all') ? good : good.filter((m) => m.locode.is_port || want.has(m.key))
      stats.scope = flag('all') ? 'all rows' : 'port-function rows + codes WPI references'
      stats.inScope = scope.length
      scope = await skipStored(pool, spec.source.id, KIND.locode, scope)
      opts.datasetVersion = flag('pre-release') ? `pre-release (zip Last-Modified ${lm})` : '2025-1'
      runId = opts.runId = await withTx(pool, (c) => startRun(c, schema, spec.source.id, { file: path.basename(file), parts, scope: stats.scope, dataset: opts.datasetVersion }))
      Object.assign(stats, await chunked(pool, scope, (c, part) => ingestLocodeRows(c, schema, part, opts)))
      stats.locodeCheck = await withTx(pool, (c) => checkLocodeAliases(c, schema))
    } else if (what === 'anchorages') {
      const { header, rows, errors } = parseOverridesCsv(await readFile(file, 'utf8'))
      if (header.join(',') !== 's2id,latitude,longitude,label,sublabel,iso3') throw new Error(`unexpected header ${header.join(',')}`)
      stats.csvRows = rows.length + errors.length; stats.badRows = errors.length
      const dupes = rows.length - new Set(rows.map((r) => r.key)).size
      if (dupes) { stats.duplicateS2 = dupes; console.warn(`  ${dupes} rows repeat an s2id: every distinct row is kept as its own record of that cell`) }
      // Rows without a usable s2id are kept as evidence too, keyed by their content hash (never matched).
      const unkeyed = errors.map((e) => ({ key: `unkeyed:${sha256(canonicalJson(e.raw)).slice(0, 16)}`, raw: e.raw }))
      const items = await skipStored(pool, spec.source.id, KIND.override, [...rows, ...unkeyed])
      opts.datasetVersion = `pipe-anchorages main, fetched ${fetched}`
      runId = opts.runId = await withTx(pool, (c) => startRun(c, schema, spec.source.id, { file: path.basename(file), rows: rows.length }))
      Object.assign(stats, await chunked(pool, items, (c, part) => ingestOverrides(c, schema, part, opts)))
    }
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
