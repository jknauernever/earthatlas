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
