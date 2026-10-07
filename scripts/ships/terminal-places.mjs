#!/usr/bin/env node
/**
 * County and city / town of every listed US terminal (lib/ships/terminalPlaces.js; scrubber-ship calls report, Josh 2026-10-07).
 * One Census geocoder request per terminal (~60), one at a time. BC terminals get state_code 'BC' only (no county / municipality yet).
 * DEV database unless Josh says otherwise (SHIPS_DATABASE_URL from .env.local).
 *
 *   node --env-file=.env.local scripts/ships/terminal-places.mjs [--schema <name>] [--only <key,key>] [--missing]
 */
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { startRun, finishRun } from '../../lib/ships/store.js'
import { CENSUS_GEOCODER_SOURCE, geocoderUrl, storeTerminalPlaces, placeLabel } from '../../lib/ships/terminalPlaces.js'
import { upsertSource } from '../../lib/ships/store.js'

const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const S = opt('schema') || DEFAULT_SCHEMA
const only = opt('only')?.split(',')
const pool = shipsPool()
try {
  const terms = (await pool.query(`SELECT key, country, lat, lon FROM ${S}.terminals WHERE list_status = 'listed'
                                     ${args.includes('--missing') ? 'AND state_code IS NULL' : ''} ORDER BY key`)).rows
    .filter((t) => !only || only.includes(t.key))
  await pool.query(`UPDATE ${S}.terminals SET state_code = 'BC' WHERE country = 'CA' AND state_code IS NULL`)
  const us = terms.filter((t) => t.country === 'US')
  const runId = await withTx(pool, async (c) => { await upsertSource(c, S, CENSUS_GEOCODER_SOURCE); return startRun(c, S, CENSUS_GEOCODER_SOURCE.id, { terminals: us.length }) })
  let n = 0
  for (const t of us) {
    const url = geocoderUrl(t.lat, t.lon)
    let body = null
    for (let i = 0; i < 3 && !body; i++) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'EarthAtlas-ships/1.0 (+https://earthatlas.org/ships; terminal places)' } })
        if (r.ok) body = await r.json(); else await new Promise((ok) => setTimeout(ok, 2000 * (i + 1)))
      } catch { await new Promise((ok) => setTimeout(ok, 2000 * (i + 1))) }
    }
    if (!body) { console.log(`${t.key}: geocoder failed`); continue }
    const p = await withTx(pool, (c) => storeTerminalPlaces(c, S, { key: t.key, url, retrievedAt: new Date().toISOString(), body, runId }))
    n++
    console.log(`${t.key}: ${p.county_name || '?'} · ${placeLabel(p.place_name) || 'unincorporated'}${p.place_kind === 'cdp' ? ' (CDP)' : ''}`)
  }
  await withTx(pool, (c) => finishRun(c, S, runId, { status: 'succeeded', stats: { terminals: n } }))
} finally { await pool.end() }
