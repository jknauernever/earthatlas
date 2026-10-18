/**
 * HappyWhale (production hwx API, worldwide), through the same core as
 * /happywhale (api/_happywhale-core.js: OAuth org token, POST /encounters).
 * Encounters carry a date only (no time of day). One request returns at most
 * 10,000 encounters (`limitExceeded`), so a range that overflows is split in
 * half until it fits. Josh 2026-10-17: storing HappyWhale data is fine.
 */
import { HWX_DEFAULT_BASE, HWX_OPS, createHwxTokenManager, hwxFetch } from '../../../api/_happywhale-core.js'
import { makeNorm, toInt, toNum, daysBetween } from '../norm.js'
import { happywhaleTaxon } from '../taxa.js'
import { photoTime } from '../exif.js'

export const FEED = 'happywhale'

let ctx = null
function hwx() {
  if (ctx) return ctx
  const base = process.env.HAPPYWHALE_API_BASE || HWX_DEFAULT_BASE
  const clientId = process.env.HAPPYWHALE_CLIENT_ID
  const clientSecret = process.env.HAPPYWHALE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('HAPPYWHALE_CLIENT_ID / HAPPYWHALE_CLIENT_SECRET not set')
  ctx = { base, tokens: createHwxTokenManager({ base, clientId, clientSecret }) }
  return ctx
}

async function call(op, body) {
  const { base, tokens } = hwx()
  const { res, badParams } = await hwxFetch({ base, tokens, op, searchParams: new URLSearchParams(), body })
  if (badParams) throw new Error('happywhale: bad params')
  if (!res.ok) throw new Error(`happywhale: HTTP ${res.status}`)
  return res.json()
}

let speciesConfig = null
async function configScientific() {
  if (!speciesConfig) {
    const list = await call(HWX_OPS.species)
    speciesConfig = new Map((Array.isArray(list) ? list : []).map((s) => [s.code, s.scientific]))
  }
  return speciesConfig
}

export function normalizeEncounter(e, sci = new Map()) {
  const [lat, lon] = (e.latlng || []).map(toNum)
  if (lat === null || lat === undefined || lon === null || lon === undefined || !e.date) return null
  const tx = happywhaleTaxon(e.speciesKey, sci.get(e.speciesKey))
  const taxon = tx.inat_id ? tx : tx.scientific ? { raw_name: e.speciesKey || '', raw_scientific: tx.scientific } : tx
  const ind = e.individual || null
  const media = e.media || null
  const label = ind ? [ind.primaryId, ind.nickname].filter(Boolean).join(' · ') || null : null
  const norm = makeNorm({
    taxon,
    raw_name: e.speciesKey || null,
    observed_at: null,
    observed_date: e.date,
    time_precision: 'day',
    lat, lon,
    count_min: toInt(e.minCount),
    count_max: toInt(e.maxCount),
    channel: 'HappyWhale',
    organization: 'HappyWhale',
    organization_url: 'https://happywhale.com',
    attribution: 'HappyWhale',
    url: `https://happywhale.com/encounter/${e.id}`,
    photo_url: media?.type === 'IMAGE' ? media.url || null : null,
    photo_thumb_url: media?.type === 'IMAGE' ? media.thumbUrl || null : null,
    photo_license: media?.licenseLevel || null,
    individual_id: ind?.id ? String(ind.id) : null,
    individual_label: label,
    remarks: e.region || null,
  })
  return { feed: FEED, feed_id: String(e.id), key: `hw:${e.id}`, feed_day: e.date, norm, raw: e }
}

async function encounters(from, to, log) {
  const j = await call(HWX_OPS.encounters, JSON.stringify({ date: { from, to } }))
  const list = j.results || j.encounters || []
  if (!j.limitExceeded) return list
  const days = daysBetween(from, to)
  if (days.length < 2) throw new Error(`happywhale: more than 10,000 encounters on ${from}`)
  const mid = Math.floor(days.length / 2)
  log(`  happywhale: ${from}…${to} over the cap; splitting`)
  return [...(await encounters(days[0], days[mid - 1], log)), ...(await encounters(days[mid], days.at(-1), log))]
}

export async function fetchWindow(from, to, { log = () => {} } = {}) {
  const sci = await configScientific()
  const records = []
  for (const e of await encounters(from, to, log)) {
    const r = normalizeEncounter(e, sci)
    if (r) records.push(r)
  }
  log(`  happywhale: ${records.length} records ${from}…${to}`)
  return { records, coveredDays: daysBetween(from, to) }
}

// ─── Capture times from the encounter photo's EXIF (Josh 2026-10-18) ─────────────────────────────────────────────
// HappyWhale gives a date only. Its photos keep the camera's EXIF, so an encounter whose photo has a GPS time, or a
// local time with its UTC offset, gets that exact time (lib/whales/exif.js). Each photo is read once (photo_times);
// a time that doesn't fall on the encounter's date (±1 day, for time zones) is not used. Salish Sea for now, where
// /whalewatch and /shiptraffic need times; widen EXIF_BOX to cover more.
const EXIF_BOX = [-125.5, 46.8, -121.8, 50.6]
const EXIF_CONCURRENCY = 6
const EXIF_BUDGET_MS = 90000

export async function enrich(c, S, records, { log = () => {} } = {}) {
  const inBox = (n) => n.lon >= EXIF_BOX[0] && n.lon <= EXIF_BOX[2] && n.lat >= EXIF_BOX[1] && n.lat <= EXIF_BOX[3]
  const want = records.filter((r) => r.norm.photo_url && inBox(r.norm))
  if (!want.length) return { checked: 0, timed: 0 }
  const urls = [...new Set(want.map((r) => r.norm.photo_url))]
  const { rows } = await c.query(
    `SELECT url, taken_at, how FROM ${S}.photo_times WHERE url = ANY($1::text[]) AND NOT (how = 'error' AND checked_at < now() - interval '1 day')`, [urls])
  const known = new Map(rows.map((r) => [r.url, r]))
  const todo = urls.filter((u) => !known.has(u))
  const t0 = Date.now()
  let next = 0, checked = 0
  const worker = async () => {
    while (next < todo.length && Date.now() - t0 < EXIF_BUDGET_MS) {
      const url = todo[next++]
      let r
      try { r = await photoTime(url, { signal: AbortSignal.timeout(15000) }) } catch (e) { r = { at: null, how: 'error', local: String(e.message || e).slice(0, 80) } }
      await c.query(
        `INSERT INTO ${S}.photo_times (url, taken_at, how, local) VALUES ($1, $2, $3, $4)
         ON CONFLICT (url) DO UPDATE SET checked_at = now(), taken_at = EXCLUDED.taken_at, how = EXCLUDED.how, local = EXCLUDED.local`,
        [url, r.at, r.how, r.local || null])
      known.set(url, { url, taken_at: r.at, how: r.how })
      checked++
    }
  }
  await Promise.all(Array.from({ length: EXIF_CONCURRENCY }, worker))
  let timed = 0
  for (const r of want) {
    const k = known.get(r.norm.photo_url)
    if (!k?.taken_at) continue
    const at = new Date(k.taken_at)
    const off = Math.abs(at.getTime() - Date.parse(`${r.feed_day}T12:00:00Z`)) / 86400000
    if (off > 1.5) continue // not this encounter's day: a wrong camera clock, or an older photo
    r.norm.observed_at = at.toISOString()
    r.norm.time_precision = 'exact'
    r.norm.remarks = [r.norm.remarks, `time from the photo’s ${k.how === 'gps' ? 'GPS' : 'camera'} timestamp`].filter(Boolean).join(' · ')
    timed++
  }
  log(`  happywhale: photo times — ${checked} photos read now (${todo.length - checked} left for later runs), ${timed} encounters timed`)
  return { checked, timed }
}
