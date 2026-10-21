/**
 * Which humpback population (ESA distinct population segment) a photo-identified whale belongs to, from where Happywhale
 * has seen the same individual on a breeding ground. Only the Mexico (threatened) and Central America (endangered)
 * populations are federally listed among the humpbacks that feed off Washington; Hawaii's is not. A sighting alone
 * can't say which; a winter sighting of the same whale on its breeding ground can.
 *
 *   dpsFromEncounters(encs) -> { dps, listed, status, label, evidence: { date, region } } | { dps: null } | { dps: 'mixed' }
 *   fetchHumpbackDps(ids)   -> Map(individualId -> result)   (Happywhale /individual/info, cached a day per whale)
 *
 * Rules, deliberately narrow: breeding season only (December–April; Central America also sees Southern Hemisphere
 * humpbacks July–October, which this excludes), Pacific waters only, and each area as NOAA's population is defined by.
 */
import { createHwxTokenManager, hwxFetch, HWX_OPS, HWX_DEFAULT_BASE } from '../../api/_happywhale-core.js'

const BREEDING_MONTHS = new Set([12, 1, 2, 3, 4])
const CENTRAL_AMERICA = /\b(Guatemala|El Salvador|Honduras|Nicaragua|Costa Rica|Panama)\b/i
const WNP = /\b(Japan|Philippines|Taiwan|Northern Mariana Islands|Guam)\b/i

export const DPS = {
  hawaii: { label: 'Hawaii population', listed: false, status: 'not federally listed' },
  mexico: { label: 'Mexico population', listed: true, status: 'federally threatened' },
  'central-america': { label: 'Central America population', listed: true, status: 'federally endangered' },
  'western-north-pacific': { label: 'Western North Pacific population', listed: true, status: 'federally endangered' },
}

function breedingArea(e) {
  const month = Number(String(e.date || '').slice(5, 7))
  if (!BREEDING_MONTHS.has(month) || !Array.isArray(e.latlng)) return null
  const [lat, lng] = e.latlng
  const region = e.region || ''
  const pacific = /pacific/i.test(e.ocean || '') || (!e.ocean && lng < -90)
  if (/Hawaii/i.test(region) || (lat > 18 && lat < 23.5 && lng > -161 && lng < -154)) return 'hawaii'
  if (/\bMexico\b/i.test(region) && pacific && lat < 28.5) return 'mexico'   // mainland Mexico, Baja California Sur, Revillagigedo
  if (CENTRAL_AMERICA.test(region) && pacific) return 'central-america'
  if (WNP.test(region) && lat < 30) return 'western-north-pacific'           // Okinawa, Ogasawara, Philippines, Marianas
  return null
}

export function dpsFromEncounters(encs = []) {
  const found = new Map()
  for (const e of encs) {
    const a = breedingArea(e)
    if (a && !found.has(a)) found.set(a, { date: e.date, region: e.region })
  }
  if (!found.size) return { dps: null }
  if (found.size > 1) return { dps: 'mixed', areas: [...found.keys()] }   // seen on two breeding grounds: don't guess
  const [[dps, evidence]] = found
  return { dps, ...DPS[dps], evidence }
}

// ─── Happywhale ─────────────────────────────────────────────────────────────
const cache = new Map()   // id -> { at, result }
const DAY = 86400000
let tokens = null
function hwx() {
  const base = process.env.HAPPYWHALE_API_BASE || HWX_DEFAULT_BASE
  if (!tokens && process.env.HAPPYWHALE_CLIENT_ID && process.env.HAPPYWHALE_CLIENT_SECRET) {
    tokens = createHwxTokenManager({ base, clientId: process.env.HAPPYWHALE_CLIENT_ID, clientSecret: process.env.HAPPYWHALE_CLIENT_SECRET })
  }
  return tokens ? { base, tokens } : null
}

/** Populations for up to `max` individuals (most-recorded first), 4 requests at a time. Never throws. */
export async function fetchHumpbackDps(ids, { max = 40 } = {}) {
  const out = new Map()
  const api = hwx()
  if (!api) return { results: out, note: 'Happywhale credentials not configured' }
  const todo = [...new Set(ids.map(String))].slice(0, max)
  let failed = 0
  const work = todo.map((id) => async () => {
    const hit = cache.get(id)
    if (hit && Date.now() - hit.at < DAY) { out.set(id, hit.result); return }
    try {
      const { res } = await hwxFetch({ ...api, op: HWX_OPS.individual, searchParams: new URLSearchParams({ id }) })
      if (!res?.ok) throw new Error(String(res?.status))
      const d = await res.json()
      const result = { ...dpsFromEncounters(d.encs), name: d.individual?.nickname || d.individual?.primaryId || null, url: `https://happywhale.com/individual/${id}` }
      cache.set(id, { at: Date.now(), result })
      out.set(id, result)
    } catch { failed++ }
  })
  for (let i = 0; i < work.length; i += 4) await Promise.all(work.slice(i, i + 4).map((f) => f()))
  const skipped = new Set(ids.map(String)).size - todo.length
  return { results: out, note: [failed ? `${failed} Happywhale individuals could not be read` : null, skipped > 0 ? `${skipped} more individuals not checked` : null].filter(Boolean).join('; ') || null }
}
