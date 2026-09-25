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

import { shipsHttp, DEFAULT_SCHEMA } from '../lib/ships/db.js'
import { searchVessels, vesselKinds, getVessel, getRecord, vesselsForMmsiAt } from '../lib/ships/queries.js'

const S = DEFAULT_SCHEMA

function send(res, status, body, cache = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600') {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', status === 200 ? cache : 'no-store')
  res.end(JSON.stringify(body))
}

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
    return send(res, 400, { error: 'unknown op' })
  } catch (e) {
    console.error('ships api', op, e)
    return send(res, 502, { error: 'ships query failed' })
  }
}
