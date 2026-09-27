// /ships read API: vessel identity from the separate ships Neon database
// (SHIPS_DATABASE_URL). Read-only. No third-party calls happen here: GFW data
// arrives only through the offline import (scripts/ships/import-gfw.mjs), so
// the GFW token never exists in this function.
//
//   /api/ships?op=search&q=<name | IMO | MMSI | callsign>[&kinds=CARGO,FISHING] → { results: [...] }   (≤ 25)
//   /api/ships?op=kinds                                    → { kinds: [{ kind, n }] }  (GFW classification)
//   /api/ships?op=vessel&id=<uuid>                         → { vessel, assertions, links, outgoing, sources }
//   /api/ships?op=record&id=<source record id>             → the raw source payload (traceability)
//   /api/ships?op=mmsi&mmsi=<9 digits>&at=<ISO time>       → { status, vesselIds }
//
// Rules: src/ships/CLAUDE.md.

import { shipsHttp, shipsPool, DEFAULT_SCHEMA } from '../lib/ships/db.js'
import { lookupShips, saveMmsis } from '../lib/ships/lookup.js'
import { gfwClient } from '../scripts/ships/gfwClient.js'
import { tracksForMmsi } from './ship-tracks.js'
import { searchVessels, vesselKinds, getVessel, getRecord, vesselsForMmsiAt } from '../lib/ships/queries.js'

const S = DEFAULT_SCHEMA

function send(res, status, body, cache = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600') {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', status === 200 ? cache : 'no-store')
  res.end(JSON.stringify(body))
}

// Guardrail for the click lookups (Josh, 2026-09-26): only MMSIs that really have a US track
// in that month reach GFW or the database, so the public page can't be used as a GFW relay or
// to fill the database with arbitrary ships.
async function hasTrack(mmsi, month) {
  try { return ((await tracksForMmsi(month, Number(mmsi), 'us')) || []).length > 0 } catch { return false }
}
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const gfwFor = () => (process.env.GFW_API_TOKEN ? gfwClient(process.env.GFW_API_TOKEN, { minIntervalMs: 0, log: () => {} }) : null)

export default async function handler(req, res) {
  const p = new URL(req.url, 'http://localhost').searchParams
  const op = p.get('op')
  let q
  try {
    const sql = shipsHttp()
    q = (text, params) => sql.query(text, params)
  } catch {
    return send(res, 503, { error: 'ships database not configured' })
  }
  try {
    if (op === 'search') {
      const text = (p.get('q') || '').slice(0, 80)
      const kinds = (p.get('kinds') || '').split(',').filter(Boolean)
      return send(res, 200, { query: text, kinds, results: await searchVessels(q, S, text, kinds) })
    }
    if (op === 'kinds') return send(res, 200, { kinds: await vesselKinds(q, S) })
    if (op === 'vessel') {
      const v = await getVessel(q, S, p.get('id') || '')
      return v ? send(res, 200, v) : send(res, 404, { error: 'vessel not found' })
    }
    if (op === 'record') {
      const r = await getRecord(q, S, p.get('id') || '')
      // Raw records are immutable, so they can be cached hard.
      return r ? send(res, 200, r, 'public, max-age=86400, s-maxage=2592000') : send(res, 404, { error: 'record not found' })
    }
    if (op === 'mmsi') {
      const at = new Date(p.get('at') || '')
      if (Number.isNaN(at.getTime())) return send(res, 400, { error: 'at must be an ISO timestamp' })
      return send(res, 200, await vesselsForMmsiAt(q, S, p.get('mmsi') || '', at.toISOString()))
    }
    //   /api/ships?op=lookup&items=<mmsi>:<YYYY-MM>:<unix t0>,…   (≤30) → { ships: [...] }
    if (op === 'lookup') {
      const items = (p.get('items') || '').split(',').slice(0, 30).map((x) => x.split(':'))
        .filter(([m, mo, t0]) => /^\d{9}$/.test(m) && MONTH.test(mo) && /^\d{9,10}$/.test(t0))
        .map(([m, mo, t0]) => ({ mmsi: m, month: mo, at: new Date(Number(t0) * 1000).toISOString() }))
      if (!items.length) return send(res, 400, { error: 'no valid items' })
      const ok = await Promise.all(items.map((i) => hasTrack(i.mmsi, i.month)))
      const real = items.filter((_, k) => ok[k])
      const ships = real.length ? await lookupShips(q, S, real, gfwFor()) : []
      return send(res, 200, { ships }, 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
    }
    //   POST /api/ships?op=save&items=<mmsi>:<YYYY-MM>,…   (≤10) → saves GFW's identities (idempotent)
    if (op === 'save') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
      const items = (p.get('items') || '').split(',').slice(0, 10).map((x) => x.split(':'))
        .filter(([m, mo]) => /^\d{9}$/.test(m) && MONTH.test(mo))
      if (!items.length) return send(res, 400, { error: 'no valid items' })
      const ok = await Promise.all(items.map(([m, mo]) => hasTrack(m, mo)))
      const mmsis = items.filter((_, k) => ok[k]).map(([m]) => m)
      if (!mmsis.length) return send(res, 404, { error: 'no tracks for these MMSIs in those months' })
      const gfw = gfwFor()
      if (!gfw) return send(res, 503, { error: 'GFW not configured' })
      const pool = shipsPool()
      try { return send(res, 200, await saveMmsis(pool, S, mmsis, gfw), 'no-store') } finally { await pool.end() }
    }
    return send(res, 400, { error: 'unknown op' })
  } catch (e) {
    console.error('ships api', op, e)
    return send(res, 502, { error: 'ships query failed' })
  }
}
