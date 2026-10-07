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
// Terminals (Josh 2026-09-28, UI "A + C"; lib/ships/terminalCard.js, docs/OIL_GAS_INFRASTRUCTURE_SOURCES.md "Terminal card (dev)"):
//   /api/ships?op=terminalsLayer                             → GeoJSON of our Salish terminals (k key, n name, t kind, s status)
//   /api/ships?op=terminal&key=<terminal key>&from=YYYY-MM&to=YYYY-MM[&fetch=1][&summary=1] → the terminal card (summary=1: the
//        map popup's headline only). Counts = our own AIS calls (terminal_calls, lib/ships/terminalCalls.js; Josh 2026-09-28), a
//        database read. GFW port visits are only a comparison now: only with fetch=1 is GFW asked for the terminal's surrounding
//        GFW port labels, every picked month the shared fetch log doesn't already hold (same log + daily budget as port cards).
//   /api/ships?op=terminalEmissions&key=<terminal key>&part=ships|refinery → Climate TRACE ids the list links (op=portEmissions shape)
//   /api/ships?op=terminalEmissions&key=<terminal key>&part=stays&from=YYYY-MM&to=YYYY-MM → Climate TRACE port stays placed at
//        the terminal (lib/ships/ctStays.js rule; terminalCard.js terminalCtStays)
// Anchorages (Josh 2026-09-30; lib/ships/anchorageCard.js):
//   /api/ships?op=anchoragesLayer                           → GeoJSON of the official / listed anchorage areas (i id, n name, l legal
//        status, x no-anchoring, a stays counted), cached a day
//   /api/ships?op=anchorage&id=<anchorage id>&from=YYYY-MM&to=YYYY-MM → the anchorage popup: the area, its "also known as" names
//        (anchorage_aliases) and the stays EarthAtlas counted from MarineCadastre AIS (anchorage_stays, lib/ships/anchorageStays.js)
//
// Rules: src/ships/CLAUDE.md.

import { shipsHttp, shipsPool, withTx, DEFAULT_SCHEMA } from '../lib/ships/db.js'
import { portClimateTrace } from '../lib/ships/climateTrace.js'
import { classIndex, mmsisOfClasses, classCountsFor } from '../lib/ships/typeSearch.js'
import { scrubberMmsis } from '../lib/ships/scrubberFilter.js'
import { scrubberReport, scrubberReportDays, readScrubberEdition, listScrubberEditions } from '../lib/ships/scrubberReport.js'
import { scrubberPortsBatch, scrubberWorldPorts } from '../lib/ships/scrubberPorts.js'
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
import { terminalsLayer, readTerminalCard, ensureTerminalCard, terminalEmissions, terminalCtStays } from '../lib/ships/terminalCard.js'
import { anchoragesLayer, readAnchorageCard } from '../lib/ships/anchorageCard.js'
import { terminalPermits, permitPage } from '../lib/ships/facilities.js'
import { typeLookup } from '../lib/ships/typeLookup.js'
import { importBatch } from '../lib/ships/gfwAis.js'
import { normalizeStops, storeActivityEstimates } from '../lib/ships/activityEstimates.js'
import { storeTerminalCalls, BAKE_VERSION as CALLS_VERSION, TERMINAL_CALLS_SOURCE } from '../lib/ships/terminalCalls.js'
import { storeAnchorageStays, STAY_BAKE_VERSION, ANCHORAGE_STAYS_SOURCE } from '../lib/ships/anchorageStays.js'
import { startRun, finishRun } from '../lib/ships/store.js'
import { importMcBatch } from '../lib/ships/mcMonths.js'
import { searchPlaces } from '../lib/ships/placeSearch.js'
import { timingSafeEqual } from 'node:crypto'
import { gzipSync } from 'node:zlib'

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
// GFW hourly lines (scripts/ships/bake-gfw/) count too: a ship we only know from those lines gets its
// identity from GFW on the first click, the same way.
async function hasTrack(mmsi, month) {
  for (const region of ['us', 'gfw']) {
    try { if (((await tracksForMmsi(month, Number(mmsi), region)) || []).length > 0) return true } catch { /* next */ }
  }
  return false
}
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const gfwFor = () => (process.env.GFW_API_TOKEN ? gfwClient(process.env.GFW_API_TOKEN, { minIntervalMs: 0, log: () => {} }) : null)

// Bake-only ops (Josh 2026-10-01: secret-locked). They hand out a whole compiled table in one response, so they answer
// only with the CRON_SECRET bearer the GitHub bakes hold; browsers and everyone else get 401 and never reach the DB.
const BAKE_OPS = new Set(['typeLookup', 'importGfwVessels', 'importActivity', 'importAisMonth', 'importMcIdentity', 'scrubberPortVisits'])
function bakeAuthorized(req) {
  const secret = process.env.CRON_SECRET
  const auth = String(req.headers['authorization'] || '')
  if (!secret || !auth.startsWith('Bearer ')) return false
  const a = Buffer.from(auth.slice(7)), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export default async function handler(req, res) {
  const p = new URL(req.url, 'http://localhost').searchParams
  const op = p.get('op')
  if (BAKE_OPS.has(op) && !bakeAuthorized(req)) return send(res, 401, { error: 'Unauthorized' })
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
    //   /api/ships?op=places&q=<text> → { places: [{ kind: terminal|anchorage|facility|port, id, name, matched, lat, lon, sub, area, terminalKey? }] }
    //   our own places for the "Fly to a place" box (lib/ships/placeSearch.js; Josh 2026-10-07)
    if (op === 'places') return send(res, 200, { places: await searchPlaces(q, S, p.get('q') || '') }, 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400')
    //   /api/ships?op=typeLookup  (CRON_SECRET bearer only)  → MMSI → EarthAtlas type over time (lib/ships/typeLookup.js), the same
    //                                               lookup the NOAA track bake uses; the GFW track bake re-types its lines with it
    //   POST /api/ships?op=importGfwVessels { offset }  (CRON_SECRET bearer only) → one resumable batch of the GFW ship-records
    //        import (lib/ships/gfwAis.js): { total, next, done, months, ingested, skipped, actions }
    if (op === 'importGfwVessels') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
      let body = req.body
      if (!body || typeof body !== 'object') {
        const chunks = []
        for await (const c of req) chunks.push(c)
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { body = {} }
      }
      const pool = shipsPool()
      try { return send(res, 200, await importBatch(pool, S, { offset: body.offset }), 'no-store') } finally { await pool.end() }
    }
    //   POST /api/ships?op=importActivity { kind, month, through, rule, inputs, rows }  (CRON_SECRET bearer only) → one month of
    //        GFW-estimated terminal visits or anchorage stays (activity.py stops.csv rows), replacing that month (lib/ships/activityEstimates.js)
    if (op === 'importActivity') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
      let body = req.body
      if (!body || typeof body !== 'object') {
        const chunks = []
        for await (const c of req) chunks.push(c)
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { return send(res, 400, { error: 'bad JSON' }) }
      }
      let rows
      try { rows = normalizeStops(body.kind, Array.isArray(body.rows) ? body.rows : []) } catch (e) { return send(res, 400, { error: String(e.message) }) }
      const pool = shipsPool()
      try {
        const r = await withTx(pool, (c) => storeActivityEstimates(c, S, { kind: body.kind, month: body.month, through: body.through || null, rule: body.rule, inputs: body.inputs || null, rows }))
        return send(res, 200, r, 'no-store')
      } catch (e) { return send(res, 400, { error: String(e.message) }) } finally { await pool.end() }
    }
    //   POST /api/ships?op=importAisMonth { kind: terminal|anchorage, month, version, bake, rows }  (CRON_SECRET bearer only) → one
    //        month of terminal calls / anchorage stays counted from NOAA AIS by the ships-noaa-month workflow (terminal-calls.mjs /
    //        anchorage-stays.mjs --post), replacing that month and adding it to the version's months (Part 1, 2026-10-07)
    //   POST /api/ships?op=importMcIdentity { offset }  (CRON_SECRET bearer only) → one resumable batch of the NOAA ship-identity import
    //        over every detailed Salish month on Blob (lib/ships/mcMonths.js): { total, next, done, months, ingested, skipped, actions }
    if (op === 'importMcIdentity') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
      let body = req.body
      if (!body || typeof body !== 'object') {
        const chunks = []
        for await (const c of req) chunks.push(c)
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { body = {} }
      }
      const pool = shipsPool()
      try { return send(res, 200, await importMcBatch(pool, S, { offset: body.offset }), 'no-store') } finally { await pool.end() }
    }
    if (op === 'importAisMonth') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
      let body = req.body
      if (!body || typeof body !== 'object') {
        const chunks = []
        for await (const c of req) chunks.push(c)
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { return send(res, 400, { error: 'bad JSON' }) }
      }
      const { kind, month, version, bake, rows } = body
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return send(res, 400, { error: 'month must be YYYY-MM' })
      if (!Array.isArray(rows) || !bake || typeof bake !== 'object') return send(res, 400, { error: 'rows and bake required' })
      const want = kind === 'terminal' ? CALLS_VERSION : kind === 'anchorage' ? STAY_BAKE_VERSION : null
      if (!want) return send(res, 400, { error: 'kind must be terminal or anchorage' })
      if (version !== want) return send(res, 400, { error: `version ${version} is not the current ${want}` })
      const src = kind === 'terminal' ? TERMINAL_CALLS_SOURCE : ANCHORAGE_STAYS_SOURCE
      const pool = shipsPool()
      try {
        const r = await withTx(pool, async (c) => {
          const runId = await startRun(c, S, src.id, { bake_version: version, month, via: 'importAisMonth' })
          const out = kind === 'terminal'
            ? await storeTerminalCalls(c, S, { calls: rows, bake, runId, months: [month] })
            : await storeAnchorageStays(c, S, { stays: rows, bake, runId, months: [month] })
          await finishRun(c, S, runId, { status: 'succeeded', stats: { rows: rows.length, month }, datasetVersion: version })
          return out
        })
        return send(res, 200, { kind, month, ...r }, 'no-store')
      } catch (e) { return send(res, 400, { error: String(e.message) }) } finally { await pool.end() }
    }
    if (op === 'typeLookup') {   // gzipped: the whole table is MBs and Vercel caps a function response at 4.5 MB
      const body = gzipSync(JSON.stringify(await typeLookup(q, S)))
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Content-Encoding', 'gzip')
      res.setHeader('Cache-Control', 'private, no-store')
      return res.end(body)
    }
    //   /api/ships?op=classes                     → { classes: [{ group, class, label, n }] }  (EarthAtlas kinds of ship, counts)
    //   /api/ships?op=classMmsis&classes=ferry,…   → { vessels, mmsis: [...] }  (a tracks filter for those kinds)
    if (op === 'classes') return send(res, 200, { classes: (await classIndex(q, S)).tally }, 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
    //   /api/ships?op=scrubberMmsis               → { vessels, mmsis, by: { gisis, mep, both, mep_inferred } }  (Scrubber-fitted
    //                                               tracks filter: IMO GISIS Reg. 4.2 scrubber notifications OR MEP Alliance lists, accepted links only)
    if (op === 'scrubberMmsis') return send(res, 200, await scrubberMmsis(q, S), 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
    //   /api/ships?op=scrubberReport&from=YYYY-MM&to=YYYY-MM   → the scrubber-ship calls report (lib/ships/scrubberReport.js)
    //   /api/ships?op=scrubberReportDays&month=YYYY-MM[&terminal=key] → that month day by day (drill-down)
    //   /api/ships?op=scrubberEdition&id=2026-10 → a frozen edition { id, title, params, created_at, payload } (never changes)
    //   /api/ships?op=scrubberEditions            → [{ id, title, params, created_at }]
    if (op === 'scrubberEdition') {
      const ed = await readScrubberEdition(q, S, String(p.get('id') || ''))
      return ed ? send(res, 200, ed, 'public, max-age=3600, s-maxage=31536000, immutable') : send(res, 404, { error: 'no such edition' })
    }
    if (op === 'scrubberEditions') return send(res, 200, { editions: await listScrubberEditions(q, S) }, 'public, max-age=0, s-maxage=300')
    //   POST /api/ships?op=scrubberPortVisits { offset }  (CRON_SECRET bearer only) → one time-boxed batch of GFW port-visit fetches for
    //        the scrubber-fitted ships (lib/ships/scrubberPorts.js): { total, next, done, ships, calls }
    //   /api/ships?op=scrubberWorldPorts&from=YYYY-MM&to=YYYY-MM → their port visits worldwide, by port and by country
    if (op === 'scrubberPortVisits') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
      let body = req.body
      if (!body || typeof body !== 'object') {
        const chunks = []
        for await (const c of req) chunks.push(c)
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { body = {} }
      }
      const gfw = gfwFor()
      if (!gfw) return send(res, 503, { error: 'GFW not configured' })
      const pool = shipsPool()
      try { return send(res, 200, await scrubberPortsBatch(pool, S, gfw, { offset: body.offset, budgetMs: 200_000 }), 'no-store') } finally { await pool.end() }
    }
    if (op === 'scrubberWorldPorts') {
      const from = p.get('from') || '', to = p.get('to') || ''
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(to) || from > to) return send(res, 400, { error: 'from / to must be YYYY-MM' })
      const geo = p.get('geo')
      const states = geo === 'WA' ? ['WA'] : geo === 'BC' ? ['BC'] : null
      return send(res, 200, await scrubberWorldPorts(q, S, { from, to, states }), 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
    }
    if (op === 'scrubberReport' || op === 'scrubberReportDays') {
      try {
        const out = op === 'scrubberReport'
          ? await scrubberReport(q, S, { from: p.get('from') || '', to: p.get('to') || '' })
          : { days: await scrubberReportDays(q, S, { month: p.get('month') || '', terminal: p.get('terminal') || null }) }
        return send(res, 200, out, 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
      } catch (e) { return send(res, 400, { error: String(e.message) }) }
    }
    //   POST /api/ships?op=classCounts  { mmsis: [≤20000 on-screen MMSIs], classes: [picked], scrub: bool }
    //        → { cls: { class: ships }, selected: ships | null }   ("Narrow to" chips' in-view counts). Only counts go out:
    //        the MMSI → class table stays on the server (Josh 2026-10-02).
    if (op === 'classCounts') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
      let body = req.body
      if (!body || typeof body !== 'object') {
        const chunks = []
        for await (const c of req) { chunks.push(c); if (chunks.reduce((n, x) => n + x.length, 0) > 400e3) return send(res, 413, { error: 'too large' }) }
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { return send(res, 400, { error: 'bad json' }) }
      }
      const mmsis = [...new Set((Array.isArray(body.mmsis) ? body.mmsis : []).map(Number).filter((x) => x >= 1e8 && x < 1e9))].slice(0, 20000)
      const classes = (Array.isArray(body.classes) ? body.classes : []).filter((c) => /^[a-z_]{2,40}$/.test(c)).slice(0, 20)
      const scrubSet = body.scrub ? new Set((await scrubberMmsis(q, S)).mmsis) : null
      return send(res, 200, await classCountsFor(q, S, mmsis, classes, scrubSet), 'no-store')
    }
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
      // An "unresolved" answer is never cached: the page saves GFW's identity right after it and asks again (2026-10-06:
      // the cached "unresolved" hid THEA KNUTSEN's just-saved record).
      const r = await vesselsForMmsiAt(q, S, p.get('mmsi') || '', at.toISOString())
      return send(res, 200, r, r.status === 'unresolved' ? 'no-store' : undefined)
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
    if (op === 'terminalsLayer') return send(res, 200, await terminalsLayer(q, S), 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800')
    //   /api/ships?op=terminalPermits&key=<terminal key> → the facility the terminal serves, its EPA permits / enforcement and
    //   WA SEPA reviews (lib/ships/facilities.js; pilot: BP Cherry Point, Marathon Anacortes). facilities: [] when none is linked.
    if (op === 'terminalPermits') {
      const key = p.get('key') || ''
      if (!/^(wa|bc)-[a-z0-9-]{1,60}$/.test(key)) return send(res, 400, { error: 'key must be a terminal key' })
      const r = await terminalPermits(q, S, key)
      return r ? send(res, 200, r, 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400') : send(res, 404, { error: 'terminal not found' })
    }
    //   /api/ships?op=permit&key=<permit id>[&system=<EPA system>] → one permit, readable (the /ships/permit/<id> page)
    if (op === 'permit') {
      const key = p.get('key') || '', system = p.get('system') || null
      if (!/^[A-Za-z0-9._-]{2,40}$/.test(key) || (system && !/^[A-Za-z0-9 -]{2,20}$/.test(system))) return send(res, 400, { error: 'bad permit id' })
      const r = await permitPage(q, S, key, system)
      return r ? send(res, 200, r, 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400') : send(res, 404, { error: 'permit not found' })
    }
    if (op === 'terminal' || op === 'terminalEmissions') {
      const key = p.get('key') || ''
      if (!/^(wa|bc)-[a-z0-9-]{1,60}$/.test(key)) return send(res, 400, { error: 'key must be a terminal key' })
      if (op === 'terminalEmissions' && p.get('part') === 'stays') {
        const win = parseCardWindow(p.get('from'), p.get('to'))
        if (win.error) return send(res, 400, { error: win.error })
        const r = await terminalCtStays(q, S, key, win)
        return r ? send(res, 200, r, 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400') : send(res, 404, { error: 'terminal not found' })
      }
      if (op === 'terminalEmissions') {
        const r = await terminalEmissions(q, S, key, p.get('part') === 'refinery' ? 'refinery' : 'ships')
        return r ? send(res, 200, r, 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400') : send(res, 404, { error: 'terminal not found' })
      }
      const win = parseCardWindow(p.get('from'), p.get('to'))
      if (win.error) return send(res, 400, { error: win.error })
      const summaryOnly = p.get('summary') === '1'
      let fetch = { status: 'read_only' }
      if (p.get('fetch') === '1' && !summaryOnly) {
        const pool = shipsPool()
        try { fetch = await ensureTerminalCard(pool, S, key, { win, gfw: gfwFor() }) } catch (e) { console.error('ships terminal fetch', key, e); fetch = { status: 'failed' } } finally { await pool.end() }
        if (fetch.status === 'not_found') return send(res, 404, { error: 'terminal not found' })
      }
      const card = await readTerminalCard(q, S, key, { win, summaryOnly })
      if (!card) return send(res, 404, { error: 'terminal not found' })
      const partial = fetch.status === 'failed' || ['failed', 'budget', 'no_gfw'].includes(fetch.discover) || (fetch.months && (fetch.months.failed || fetch.months.budget || fetch.months.no_gfw))
      return send(res, 200, { ...card, fetch }, partial || summaryOnly ? 'no-store' : 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
    }
    if (op === 'anchoragesLayer') return send(res, 200, await anchoragesLayer(q, S), 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800')
    if (op === 'anchorage') {
      const id = p.get('key') || p.get('id') || ''   // key = "source_id|source_key" (stable), id = row id
      if (!/^\d{1,12}$/.test(id) && !/^[a-z0-9-]{2,60}\|[A-Za-z0-9()._ -]{1,80}$/.test(id)) return send(res, 400, { error: 'id must be an anchorage id or key' })
      const win = parseCardWindow(p.get('from'), p.get('to'))
      if (win.error) return send(res, 400, { error: win.error })
      const r = await readAnchorageCard(q, S, id, { win })
      return r ? send(res, 200, r, 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400') : send(res, 404, { error: 'anchorage not found' })
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
