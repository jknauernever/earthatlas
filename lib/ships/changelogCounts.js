/**
 * The numbers on the /ships changelog's "Data on the site" cards (src/ships/shipsChangelog.js COUNTS), computed the way the
 * site shows them: the terminal and anchorage cards' own read functions (readTerminalCard, terminalCtStays, readAnchorageCard),
 * the scrubber filter, the ports layer with place search's one-port-per-name rule, and the published track indexes.
 * Reusing the card code, never a second copy of its rules, keeps these totals equal to what the cards add up to.
 *
 * Read only. q = (text, params) → rows. Callers: scripts/ships/changelog-counts.mjs (prod.sh counts) and the daily refresh.
 *
 * Speed (Josh 2026-10-08: same rules, fewer round trips): each card is opened ONCE over the whole period (not per 12-month
 * card window), anchorages with no stays and no estimates are not opened (their card would show none), and cards are read
 * `concurrency` at a time.
 */
import { readTerminalCard, terminalCtStays } from './terminalCard.js'
import { readAnchorageCard } from './anchorageCard.js'
import { parseCardWindow, portsLayer } from './portCard.js'
import { scrubberMmsis } from './scrubberFilter.js'

export const ACTIVITY_FIRST = '2025-01' // first month of terminal / anchorage activity data
export const CT_FIRST = '2024-01'       // first month of the Climate TRACE port-stay pull
export const PARTS = ['base', 'terminals', 'anchorages', 'tracks']

/** One card window from `first` through this month (parseCardWindow caps at 12 months, so the pieces are joined). */
export function wholeWindow(first, now = new Date()) {
  const cur = now.toISOString().slice(0, 7)
  const pieces = []
  for (let y = +first.slice(0, 4), m = +first.slice(5); `${y}-${String(m).padStart(2, '0')}` <= cur;) {
    const from = `${y}-${String(m).padStart(2, '0')}`
    m += 11; while (m > 12) { m -= 12; y++ }
    const to = `${y}-${String(m).padStart(2, '0')}`
    pieces.push(parseCardWindow(from, to < cur ? to : cur, null, now))
    m++; if (m > 12) { m = 1; y++ }
  }
  const last = pieces[pieces.length - 1]
  return { ...last, months: pieces.flatMap((p) => p.months), from: pieces[0].from, capped: false }
}

async function mapLimit(items, n, f) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await f(items[k]) }
  }))
  return out
}

/** Place search's rule (lib/ships/placeSearch.js): ports with the same name within ~25 km are one port. */
export function uniquePorts(features) {
  const km = (a, b) => { const r = Math.PI / 180, h = Math.sin((b[1] - a[1]) * r / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin((b[0] - a[0]) * r / 2) ** 2
    return 12742 * Math.asin(Math.sqrt(h)) }
  const byName = new Map()
  let n = 0
  for (const f of features) {
    const name = String(f.properties?.n || '').toLowerCase(), c = f.geometry?.coordinates
    if (!c) continue
    const seen = byName.get(name) || []
    if (seen.some((k) => km(k, c) < 25)) continue
    seen.push(c); byName.set(name, seen); n++
  }
  return n
}

/**
 * → { asOf, ships, scrubberShips, terminals, berths, anchorages, portVisits, incidents, ports, terminalVisits,
 *     terminalEmissions, anchorageStays, shipTracks } (only the asked-for parts).
 * trackSource = src/ships/trackSource.json (its us / gfw index URLs); fetchJson = (url) → parsed JSON.
 */
export async function changelogCounts(q, S, { parts = PARTS, limit = Infinity, concurrency = 8, now = new Date(), trackSource = null, fetchJson = null } = {}) {
  const out = { asOf: now.toISOString().slice(0, 10) }
  const one = async (t, p) => Number((await q(t, p))[0].n)
  const terms = async () => (await q(`SELECT key FROM ${S}.terminals WHERE list_status = 'listed' ORDER BY key`)).map((r) => r.key)

  if (parts.includes('base')) {
    out.ships = await one(`SELECT count(*) n FROM ${S}.vessels WHERE status = 'active'`)
    out.scrubberShips = (await scrubberMmsis(q, S)).vessels
    out.terminals = await one(`SELECT count(*) n FROM ${S}.terminals WHERE list_status = 'listed'`)
    out.berths = await one(`SELECT count(*) n FROM ${S}.terminal_berths b JOIN ${S}.terminals t ON t.id = b.terminal_id
                             WHERE b.status = 'active' AND t.list_status = 'listed'`)
    out.anchorages = await one(`SELECT count(*) n FROM ${S}.anchorages WHERE status = 'active'`)
    out.portVisits = await one(`SELECT count(*) n FROM ${S}.port_visits WHERE status = 'active'`)
    out.incidents = await one(`SELECT count(*) n FROM ${S}.incident_events WHERE status = 'active'`)
    out.ports = uniquePorts((await portsLayer(q, S)).features)
  }

  if (parts.includes('terminals')) {
    const keys = (await terms()).slice(0, limit)
    // Visits as the cards count them: ships of the kinds each terminal serves (fits); estimated visits only in months or
    // places NOAA's AIS doesn't cover; estimated visits two terminals share are not added (they'd count twice).
    const win = wholeWindow(ACTIVITY_FIRST, now)
    const visits = await mapLimit(keys, concurrency, async (key) => {
      const card = await readTerminalCard(q, S, key, { win, summaryOnly: true })
      return { counted: card.summary.visits, estimated: card.estimated?.visits || 0 }
    })
    out.terminalVisits = { counted: 0, estimated: 0, terminalsWithVisits: 0, from: win.months[0], to: win.months[win.months.length - 1] }
    for (const v of visits) {
      out.terminalVisits.counted += v.counted; out.terminalVisits.estimated += v.estimated
      if (v.counted + v.estimated) out.terminalVisits.terminalsWithVisits++
    }
    // Ship emissions at the berths as the Emissions tab shows them: Climate TRACE port stays by the kinds of ship each
    // terminal serves (fits), tonnes CO2e (100-year), every month the pull covers.
    const ctWin = wholeWindow(CT_FIRST, now)
    const em = await mapLimit(keys, concurrency, (key) => terminalCtStays(q, S, key, ctWin))
    const te = { stays: 0, co2eTonnes: 0, terminals: 0 }, months = new Set()
    for (const e of em) {
      if (e?.state !== 'ok') continue
      te.stays += e.fits.stays; te.co2eTonnes += e.fits.co2e
      if (e.fits.stays) te.terminals++
      for (const m of e.months.covered) months.add(m)
    }
    const ms = [...months].sort()
    out.terminalEmissions = { ...te, co2eTonnes: Math.round(te.co2eTonnes), from: ms[0] || null, to: ms[ms.length - 1] || null }
  }

  if (parts.includes('anchorages')) {
    // Only anchorages with any stay or estimate row; the rest would show none on their card.
    const keys = (await q(`SELECT a.source_id || '|' || a.source_key AS k FROM ${S}.anchorages a
                            WHERE a.status = 'active' AND (
                              EXISTS (SELECT 1 FROM ${S}.anchorage_stays s WHERE s.anchorage_source_id = a.source_id AND s.anchorage_source_key = a.source_key)
                              OR EXISTS (SELECT 1 FROM ${S}.anchorage_stay_estimates e WHERE e.anchorage_source_id = a.source_id AND e.anchorage_source_key = a.source_key))
                            ORDER BY 1`)).map((r) => r.k).slice(0, limit)
    const win = wholeWindow(ACTIVITY_FIRST, now)
    const stays = await mapLimit(keys, concurrency, async (k) => {
      const card = await readAnchorageCard(q, S, k, { win, top: 0 })
      return { counted: card?.stays?.summary?.stays || 0, estimated: card?.estimated?.stays || 0 }
    })
    out.anchorageStays = { counted: 0, estimated: 0, anchoragesWithStays: 0, from: win.months[0], to: win.months[win.months.length - 1] }
    for (const s of stays) {
      out.anchorageStays.counted += s.counted; out.anchorageStays.estimated += s.estimated
      if (s.counted + s.estimated) out.anchorageStays.anchoragesWithStays++
    }
  }

  if (parts.includes('tracks') && trackSource && fetchJson) {
    // One ship's path in one month. NOAA per-minute AIS = the US-wide index (the Salish layer is the same NOAA data inside
    // the US-wide bake, so it is not added); GFW hourly lines cover the months / areas NOAA doesn't.
    const sum = async (url) => Object.values((await fetchJson(url)).months).reduce((n, m) => n + (m.vessels || 0), 0)
    const minute = await sum(trackSource.us.index), hourly = await sum(trackSource.gfw.index)
    out.shipTracks = { minute, hourly, total: minute + hourly }
  }
  return out
}
