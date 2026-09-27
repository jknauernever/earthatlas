#!/usr/bin/env node
/**
 * Pre-load port cards so they open instantly (Josh, 2026-09-27): for every port on the map inside a bounding box,
 * fetch and store what the card shows — GFW arrival totals per window, the ship list per listed month, PortWatch —
 * through the same ensurePortCard() the API uses. Settled months are then kept for good (lib/ships/portCard.js
 * fetchIsFresh), so these cards never wait on GFW again. Idempotent: anything already stored is skipped.
 *
 *   node --env-file=.env.local scripts/ships/warm-port-cards.mjs
 *     [--bbox W,S,E,N]            default: the Salish Sea (-125.5,47,-122,50.5)
 *     [--months 2026-01..2026-06] listed months to load (each port-month's ship list)
 *     [--windows 2025-07..2026-06,2026-01..2026-06]  card windows whose monthly totals to load
 *     [--budget 20000]            GFW calls allowed per 24 h for this run (GFW's own limit is 50,000/day)
 *     [--force]                   re-pull even what is stored (a deliberate refresh)
 *     [--limit N]                 first N ports only (testing)
 */
import { shipsPool, DEFAULT_SCHEMA as S } from '../../lib/ships/db.js'
import { ensurePortCard, parseCardWindow, nextMonth, MAP_NAME_METHODS } from '../../lib/ships/portCard.js'
import { gfwClient } from './gfwClient.js'

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const range = (s) => { const [a, b] = s.split('..'); const out = []; for (let m = a; m <= (b || a); m = nextMonth(m)) out.push(m); return out }
const [W, Sb, E, N] = opt('bbox', '-125.5,47,-122,50.5').split(',').map(Number)
const months = range(opt('months', '2026-01..2026-06'))
const windows = opt('windows', '2025-07..2026-06,2026-01..2026-06').split(',').map((w) => { const r = range(w); return [r[0], r[r.length - 1]] })
const budget = Number(opt('budget', 20000)), force = args.includes('--force'), limit = Number(opt('limit', 0)) || null

const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EarthAtlas-ships/0.1)' } }
const fetchJson = async (u) => { const r = await fetch(u, { ...UA, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }
const gfw = gfwClient(process.env.GFW_API_TOKEN, { minIntervalMs: 250, log: () => {} })
const pool = shipsPool()

// The ports the map layer shows (lib/ships/portCard.js portsLayer rule): WPI ports + GFW-named ports.
const { rows: ports } = await pool.query(
  `SELECT id, name, origin FROM ${S}.ports
    WHERE lat BETWEEN $1 AND $2 AND lon BETWEEN $3 AND $4
      AND (origin = 'wpi' OR (origin = 'gfw_port_label' AND name_method = ANY($5)
           AND EXISTS (SELECT 1 FROM ${S}.port_aliases a WHERE a.port_id = ports.id AND a.key_kind = 'gfw_port_label' AND a.status = 'accepted')))
    ORDER BY origin, id`, [Sb, N, W, E, MAP_NAME_METHODS])
const list = limit ? ports.slice(0, limit) : ports
console.log(`warming ${list.length} ports × windows ${windows.map((w) => w.join('..')).join(', ')} × months ${months.join(' ')} on ${new URL(process.env.SHIPS_DATABASE_URL).host}`)

const tally = { ports: 0, gfwCalls: 0, pwCalls: 0, failed: 0, budgetStops: 0 }
try {
  for (const p of list) {
    tally.ports++
    const seen = []
    for (const [from, to] of windows) {
      for (const m of months) {
        const win = parseCardWindow(from, to, m)
        if (win.error || !win.months.includes(m)) continue
        const r = await ensurePortCard(pool, S, p.id, { win, gfw, fetchJson, budget, force })
        tally.gfwCalls += r.calls?.gfw || 0; tally.pwCalls += r.calls?.portwatch || 0
        if (['discover', 'stats', 'events', 'portwatch'].some((k) => r[k] === 'failed')) tally.failed++
        if (['discover', 'stats', 'events'].some((k) => r[k] === 'budget')) tally.budgetStops++
        seen.push(`${m}:${r.events}/${r.stats}`)
      }
    }
    console.log(`  ${tally.ports}/${list.length} ${p.name || p.id} (${p.origin} ${p.id}) gfw calls so far ${tally.gfwCalls} · ${seen.slice(-2).join(' ')}`)
    if (tally.budgetStops) { console.log('budget reached; stopping (re-run later; stored work is kept)'); break }
  }
} finally {
  await pool.end()
}
console.log('done', tally)
