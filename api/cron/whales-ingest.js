/**
 * Hourly whale-sightings refresh (docs/WHALES_DB.md). Each run re-reads the last
 * 7 days from every live feed — SalishSea.io, Maplify (Whale Alert),
 * HappyWhale, iNaturalist (+ iNaturalist uploads from the last 2 days, any
 * observed date) — so new reports, edits and deletions all land within the hour.
 * OBIS is history only and never runs here unless asked (?feeds=obis).
 *
 * ?feeds=a,b   subset of feeds      ?days=N   window length (1–31, default 7)
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD    backfill an explicit window (≤ 31 days; mode 'backfill'),
 *                                   driven one month at a time by scripts/whales/backfill.mjs
 * Same contract as the other crons: CRON_SECRET guard; one feed failing never
 * stops the others; the run log is in whales.ingest_runs.
 */
import { whalesPool, DEFAULT_SCHEMA } from '../../lib/whales/db.js'
import { migrate } from '../../lib/whales/migrate.js'
import { runFeed, FEEDS, LIVE_FEEDS } from '../../lib/whales/ingest.js'
import { addDays } from '../../lib/whales/norm.js'

export const maxDuration = 300

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (secret && auth !== `Bearer ${secret}`) {
    res.statusCode = 401
    res.end('Unauthorized')
    return
  }
  const sp = new URL(req.url, 'http://x').searchParams
  const feeds = (sp.get('feeds') || LIVE_FEEDS.join(',')).split(',').map((s) => s.trim()).filter((f) => FEEDS[f])
  const days = Math.min(31, Math.max(1, parseInt(sp.get('days') || '7', 10) || 7))
  const DAY = /^\d{4}-\d{2}-\d{2}$/
  const backfill = DAY.test(sp.get('from') || '') && DAY.test(sp.get('to') || '')
  const today = new Date().toISOString().slice(0, 10)
  const to = backfill ? sp.get('to') : today
  const from = backfill ? sp.get('from') : addDays(to, -(days - 1))
  if (backfill && (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 30)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'backfill window must be from ≤ to, at most 31 days' }))
    return
  }

  // Tests / localhost may aim at a throwaway schema; production always writes "whales".
  const schema = process.env.VERCEL_ENV !== 'production' && process.env.WHALES_SCHEMA ? process.env.WHALES_SCHEMA : DEFAULT_SCHEMA

  const t0 = Date.now()
  const pool = whalesPool()
  const out = { ok: true, from, to, feeds: {} }
  try {
    await migrate(pool, schema)
    for (const feed of feeds) {
      if (Date.now() - t0 > 240000) { out.feeds[feed] = { skipped: 'time budget' }; out.ok = false; continue }
      try {
        out.feeds[feed] = await runFeed(pool, schema, feed, from, to, {
          mode: backfill ? 'backfill' : 'hourly',
          createdSince: !backfill && feed === 'inaturalist' ? addDays(to, -1) : undefined,
        })
      } catch (e) {
        out.ok = false
        out.feeds[feed] = e.run || { error: String(e?.message || e).slice(0, 300) }
      }
    }
  } finally {
    await pool.end().catch(() => {})
  }
  out.ms = Date.now() - t0
  res.statusCode = out.ok ? 200 : 207
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(out))
}
