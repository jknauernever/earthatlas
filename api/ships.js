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
//   /api/ships?op=ports&id=<uuid>[&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=&offset=] → the ship's port visits, newest first
//        each visit carries our port's name (World Port Index first, then GFW; lib/ships/ports.js), its source record,
//        and the country name (GeoNames); the official anchorage area its position lies in / is near (lib/ships/anchorages.js);
//        nameSources = those sources' licences.
//
// Exceptions to "no third-party calls" (Josh, 2026-09-26): op=lookup / op=save (click lookups) and
// op=ports call GFW server-side with GFW_API_TOKEN; the token never reaches the browser.
// op=photos (Josh, 2026-09-27) calls Wikimedia Commons (no key) for one ship's photos:
//   /api/ships?op=photos&id=<uuid> → { status, images } (docs/COMMONS_PHOTOS.md). Only a vessel in our database
//   with exactly one registry IMO, no photo yet and no Commons check in the last 30 days reaches Commons.
// Ports on the map + port card (Josh, 2026-09-27; lib/ships/portCard.js, docs/GFW_ACTIVITY_API.md "Port visits by port"):
//   /api/ships?op=portsLayer                                → GeoJSON of our ports (WPI + named GFW ports + Climate TRACE-only
//        + DFO small-craft-harbour-only ports), cached a day
//   /api/ships?op=port&id=<port id>&from=YYYY-MM&to=YYYY-MM[&m=YYYY-MM&limit=&offset=] → the port card
//        (+ `official`: the official name / status line, lib/ships/officialPorts.js)
//        GFW (server-side token) and IMF PortWatch are asked only for ports in ships.ports, only when the fetch log
//        says the stored answer is stale, and within a daily GFW call budget.
//   POST /api/ships?op=portShip&gfw=<GFW vessel id>        → saves a listed ship's GFW identity (only ids in stored visits)
//
// Rules: src/ships/CLAUDE.md.

import { shipsHttp, shipsPool, DEFAULT_SCHEMA } from '../lib/ships/db.js'
import { portClimateTrace } from '../lib/ships/climateTrace.js'
import { classIndex, mmsisOfClasses } from '../lib/ships/typeSearch.js'
import { lookupShips, saveMmsis } from '../lib/ships/lookup.js'
import { gfwClient } from '../scripts/ships/gfwClient.js'
import { tracksForMmsi } from './ship-tracks.js'
import { searchVesselsFull, vesselKinds, getVessel, getRecord, getRecordView, getIncidentRecord, vesselsForMmsiAt } from '../lib/ships/queries.js'
import { parseWindow, portVisitPlan, ensurePortVisits, vesselPortVisits, PORT_VISITS_SOURCE } from '../lib/ships/portVisits.js'
import { nameVisits, NAME_SOURCE_IDS } from '../lib/ships/ports.js'
import { ANCHORAGE_SOURCE_IDS } from '../lib/ships/anchorages.js'
import { commonsPlan, fetchImo, ingestImo, vesselImages } from '../lib/ships/ingestCommons.js'
import { commonsClient } from '../scripts/ships/commonsClient.js'
import { parseCardWindow, ensurePortCard, readPortCard, portsLayer, savePortShip, PORT_CARD_SOURCE_IDS } from '../lib/ships/portCard.js'
import { portOfficial, OFFICIAL_SOURCE_IDS } from '../lib/ships/officialPorts.js'

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
      const r = await searchVesselsFull(q, S, text, kinds)
      return send(res, 200, { query: text, kinds, results: r.results, type: r.type, total: r.total, capped: r.capped || false })
    }
    if (op === 'kinds') return send(res, 200, { kinds: await vesselKinds(q, S) })
    //   /api/ships?op=classes                     → { classes: [{ group, class, label, n }] }  (EarthAtlas kinds of ship, counts)
    //   /api/ships?op=classMmsis&classes=ferry,…   → { vessels, mmsis: [...] }  (a tracks filter for those kinds)
    if (op === 'classes') return send(res, 200, { classes: (await classIndex(q, S)).tally }, 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
    if (op === 'classMmsis') {
      const cls = (p.get('classes') || '').split(',').filter((c) => /^[a-z_]{2,40}$/.test(c)).slice(0, 20)
      if (!cls.length) return send(res, 400, { error: 'classes required' })
      return send(res, 200, await mmsisOfClasses(q, S, cls), 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
    }
    if (op === 'vessel') {
      const v = await getVessel(q, S, p.get('id') || '')
      return v ? send(res, 200, v) : send(res, 404, { error: 'vessel not found' })
    }
    // Readable view of one record (the /ships/source/<id> page).
    if (op === 'recordView') {
      const r = await getRecordView(q, S, p.get('id') || '')
      return r ? send(res, 200, r, 'public, max-age=3600, s-maxage=86400') : send(res, 404, { error: 'record not found' })
    }
    if (op === 'record') {
      const r = await getRecord(q, S, p.get('id') || '')
      // Raw records are immutable, so they can be cached hard.
      return r ? send(res, 200, r, 'public, max-age=86400, s-maxage=2592000') : send(res, 404, { error: 'record not found' })
    }
    //   /api/ships?op=incident&id=<incident id> → { incident, refs, record, source } (narratives withheld)
    // CGMIX / PSIX have no per-report web address, so the card shows the official record itself.
    if (op === 'incident') {
      const r = await getIncidentRecord(q, S, p.get('id') || '')
      return r ? send(res, 200, r, 'public, max-age=3600, s-maxage=86400') : send(res, 404, { error: 'incident not found' })
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
    // Ports of call (docs/GFW_ACTIVITY_API.md, "Port visits for one vessel"). Guardrail: only vessels in our
    // database that carry a GFW identity id ever reach GFW, and only when the fetch log says the stored
    // visits are missing or stale (FRESH_HOURS); otherwise this is a database read.
    if (op === 'ports') {
      const id = p.get('id') || ''
      if (!/^[0-9a-f-]{36}$/i.test(id)) return send(res, 400, { error: 'id must be a vessel uuid' })
      const win = parseWindow(p.get('from'), p.get('to'))
      if (win.error) return send(res, 400, { error: win.error })
      const [vessel] = await q(`SELECT id FROM ${S}.vessels WHERE id = $1`, [id])
      if (!vessel) return send(res, 404, { error: 'vessel not found' })
      const { own, plan } = await portVisitPlan(q, S, id, win)
      if (!own.use.length) return send(res, 200, { vesselId: id, window: win, gfwIds: [], total: 0, visits: [], topPorts: [], fetch: { status: 'no_gfw_identity' } })
      let fetch = { status: 'fresh' }
      if (plan.fetch) {
        const gfw = gfwFor()
        if (!gfw) fetch = { status: 'stale_no_gfw' }
        else {
          const pool = shipsPool()
          try {
            const r = await ensurePortVisits(pool, S, id, gfw, win)
            fetch = { status: r.status, calls: r.calls ?? 0, incremental: !!r.plan?.incremental, stats: r.stats }
            // Name the new visits' ports (World Port Index first, then GFW; lib/ships/ports.js). A failure here
            // only leaves raw labels on the card.
            try { fetch.named = (await nameVisits(pool, S, r.gfwIds || own.use)).visitsUpdated ?? 0 } catch (e) { console.error('ships ports naming', id, e) }
          } catch (e) {
            // Show what we have; say that the refresh failed. Never cache this answer.
            console.error('ships ports fetch', id, e)
            fetch = { status: 'failed' }
          } finally { await pool.end() }
        }
      }
      const out = await vesselPortVisits(q, S, id, { ...win, limit: p.get('limit'), offset: p.get('offset') })
      const [source] = await q(`SELECT id, name, publisher, homepage_url, license, license_url, commercial_use,
                                       attribution_text, attribution_url FROM ${S}.sources WHERE id = $1`, [PORT_VISITS_SOURCE.id])
      const nameSources = await q(`SELECT id, name, publisher, homepage_url, license, license_url, attribution_text, attribution_url
                                     FROM ${S}.sources WHERE id = ANY($1)`, [[...NAME_SOURCE_IDS, ...ANCHORAGE_SOURCE_IDS]])
      const body = { vesselId: id, window: win, ...out, fetch, source: source ?? null, nameSources }
      return send(res, 200, body, fetch.status === 'failed' || fetch.status === 'stale_no_gfw' ? 'no-store'
        : 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
    }
    if (op === 'photos') {
      const id = p.get('id') || ''
      if (!/^[0-9a-f-]{36}$/i.test(id)) return send(res, 400, { error: 'id must be a vessel uuid' })
      const plan = await commonsPlan(q, S, id)
      if (plan.status === 'not_found') return send(res, 404, { error: 'vessel not found' })
      let status = plan.status
      if (plan.status === 'fetch') {
        const pool = shipsPool()
        try {
          const r = await ingestImo(pool, S, await fetchImo(commonsClient({ minIntervalMs: 0, log: () => {} }), plan.imo, { maxFiles: 50 }))
          status = r.resolution.vesselId === id ? 'fetched' : r.exists ? `fetched_not_linked:${r.resolution.reason}` : 'fetched_no_category'
        } catch (e) {
          console.error('ships photos fetch', id, e)
          return send(res, 200, { vesselId: id, status: 'failed', images: await vesselImages(q, S, id) }, 'no-store')
        } finally { await pool.end() }
      }
      return send(res, 200, { vesselId: id, status, imo: plan.imo ?? null, images: await vesselImages(q, S, id) },
        'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
    }
    if (op === 'portsLayer') return send(res, 200, await portsLayer(q, S), 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800')
    if (op === 'port') {
      const win = parseCardWindow(p.get('from'), p.get('to'), p.get('m'))
      if (win.error) return send(res, 400, { error: win.error })
      const id = p.get('id') || ''
      if (!/^\d{1,12}$/.test(id)) return send(res, 400, { error: 'id must be a port id' })
      let fetch = { status: 'read_only' }
      if (p.get('fetch') !== '0') {
        const pool = shipsPool()
        const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EarthAtlas-ships/0.1)' } }
        try {
          fetch = await ensurePortCard(pool, S, id, { win, gfw: gfwFor(),
            fetchJson: async (u) => { const r = await globalThis.fetch(u, { ...UA, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() } })
        } catch (e) { console.error('ships port fetch', id, e); fetch = { status: 'failed' } } finally { await pool.end() }
        if (fetch.status === 'not_found') return send(res, 404, { error: 'port not found' })
      }
      const card = await readPortCard(q, S, id, { win, limit: p.get('limit'), offset: p.get('offset') })
      if (!card) return send(res, 404, { error: 'port not found' })
      // Official name / status (DFO, Transport Canada / Canada Marine Act, USACE port areas): accepted matches only.
      const official = await portOfficial(q, S, card.port.id)
      const sources = await q(`SELECT id, name, publisher, homepage_url, license, license_url, commercial_use, attribution_text, attribution_url
                                 FROM ${S}.sources WHERE id = ANY($1)`, [[...PORT_CARD_SOURCE_IDS, ...NAME_SOURCE_IDS, ...OFFICIAL_SOURCE_IDS]])
      const partial = ['discover', 'stats', 'events', 'portwatch'].some((k) => ['failed', 'budget', 'no_gfw'].includes(fetch[k])) || fetch.status === 'failed'
      return send(res, 200, { ...card, official, fetch, sources }, partial ? 'no-store' : 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
    }
    //   /api/ships?op=portEmissions&id=<port id> → the Climate TRACE port sources joined to this port (lib/ships/climateTrace.js)
    if (op === 'portEmissions') {
      const id = p.get('id') || ''
      if (!/^\d{1,12}$/.test(id)) return send(res, 400, { error: 'id must be a port id' })
      const r = await portClimateTrace(q, S, id)
      return r ? send(res, 200, r, 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400') : send(res, 404, { error: 'port not found' })
    }
    if (op === 'portShip') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
      const pool = shipsPool()
      try {
        const r = await savePortShip(pool, S, p.get('gfw') || '', gfwFor())
        return send(res, r.vesselId ? 200 : r.status === 'bad_id' ? 400 : 404, r, 'no-store')
      } finally { await pool.end() }
    }
    return send(res, 400, { error: 'unknown op' })
  } catch (e) {
    console.error('ships api', op, e)
    return send(res, 502, { error: 'ships query failed' })
  }
}
