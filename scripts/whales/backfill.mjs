#!/usr/bin/env node
/**
 * Whale history backfill, driven from anywhere, executed on PRODUCTION Vercel:
 * calls /api/cron/whales-ingest?feeds=<feed>&from=<month start>&to=<month end>
 * one feed-month at a time (each call ≤ 300 s on Vercel). Nothing is downloaded
 * here — this only orchestrates.
 *
 *   node --env-file=.env.local scripts/whales/backfill.mjs --from 2024-01 --to 2026-10 \
 *        [--feeds salishsea,maplify,happywhale,inaturalist,obis] [--host https://earthatlas.org] [--dry]
 *
 * Resumable: finished feed-months are recorded in scripts/whales/cache/backfill-state.json
 * (gitignored) and skipped on the next run; the log is scripts/whales/cache/backfill.log.
 * A month that answers "over the time budget" is split into halves.
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
  return acc
}, []))
const HOST = args.host || 'https://earthatlas.org'
const FEEDS = String(args.feeds || 'salishsea,maplify,happywhale,inaturalist,obis').split(',')
const SECRET = process.env.CRON_SECRET
if (!SECRET) { console.error('CRON_SECRET not set'); process.exit(2) }
if (!/^\d{4}-\d{2}$/.test(args.from || '') || !/^\d{4}-\d{2}$/.test(args.to || '')) { console.error('need --from YYYY-MM --to YYYY-MM'); process.exit(2) }

const DIR = new URL('./cache/', import.meta.url)
mkdirSync(DIR, { recursive: true })
const STATE = new URL('backfill-state.json', DIR)
const LOG = new URL('backfill.log', DIR)
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}
const log = (m) => { const line = `${new Date().toISOString()} ${m}`; console.log(line); appendFileSync(LOG, line + '\n') }

function months(from, to) {
  const out = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    const start = `${y}-${String(m).padStart(2, '0')}-01`
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    out.push([start, end])
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}

const today = new Date().toISOString().slice(0, 10)

async function run(feed, from, to, depth = 0) {
  const url = `${HOST}/api/cron/whales-ingest?feeds=${feed}&from=${from}&to=${to}`
  const t0 = Date.now()
  let res, body
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${SECRET}` } })
    body = await res.json().catch(() => null)
  } catch (e) {
    return { ok: false, note: `network: ${e.message}` }
  }
  const r = body?.feeds?.[feed]
  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  if (r?.ok) {
    log(`${feed} ${from}…${to} ok fetched=${r.fetched} inserted=${r.inserted} changed=${r.changed} removed=${r.removed} (${secs}s)`)
    return { ok: true }
  }
  const note = r?.note || r?.error || r?.skipped || `HTTP ${res?.status}`
  log(`${feed} ${from}…${to} FAILED: ${note} (${secs}s)`)
  // Too big for one call → halves.
  if (depth < 3 && /time budget|FUNCTION_INVOCATION_TIMEOUT|504|timed out/i.test(String(note) + res?.status) && from < to) {
    const mid = new Date((Date.parse(from) + Date.parse(to)) / 2).toISOString().slice(0, 10)
    const a = await run(feed, from, mid, depth + 1)
    const next = new Date(Date.parse(mid) + 86400000).toISOString().slice(0, 10)
    const b = await run(feed, next, to, depth + 1)
    return { ok: a.ok && b.ok }
  }
  return { ok: false, note }
}

const list = months(args.from, args.to)
log(`backfill ${args.from}…${args.to} feeds=${FEEDS.join(',')} host=${HOST}${args.dry ? ' (dry)' : ''}`)
let failures = 0
for (const feed of FEEDS) {
  for (const [from, endOfMonth] of list) {
    const to = endOfMonth > today ? today : endOfMonth
    const key = `${feed}|${from}`
    if (state[key] === 'ok') continue
    if (args.dry) { log(`would run ${feed} ${from}…${to}`); continue }
    let r = await run(feed, from, to)
    if (!r.ok) { await new Promise((ok) => setTimeout(ok, 15000)); r = await run(feed, from, to) }
    if (r.ok) { state[key] = 'ok'; writeFileSync(STATE, JSON.stringify(state, null, 1)) } else failures++
  }
}
log(`done; ${failures} feed-month(s) failed (re-run to retry them)`)
process.exit(failures ? 1 : 0)
