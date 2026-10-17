/**
 * GET /api/whales — whale sightings from our own database (docs/WHALES_DB.md),
 * for every earthatlas.org site. Never calls the upstream sources.
 *
 *   bbox=w,s,e,n | lat,lng,radius_km      area (or neither, with a taxon: worldwide)
 *   from, to (YYYY-MM-DD)                 default: the last 30 days
 *   taxon=<iNaturalist taxon id>          includes everything below it (152871 = all cetaceans)
 *   group=cetacean,pinniped,…|all         default cetacean (unless a taxon is given)
 *   sources= / exclude=                   maplify,inaturalist,happywhale,obis,salishsea,orcasound
 *   kind=sighting|acoustic                default both
 *   limit (≤ 2000, default 500)
 *
 * Returns { count, total, truncated, sources:[{id,label,url,count,…}], updated:{feed:time}, sightings:[…] },
 * newest first. Each sighting carries its own source, channel, observer, link and license
 * (inline provenance). Edge-cached 5 minutes; callers should send grid-snapped areas
 * (src/lib/whales.js does) so visitors share cache entries.
 */
import { whalesHttp, DEFAULT_SCHEMA } from '../lib/whales/db.js'
import { parseWhaleQuery, queryWhales } from '../lib/whales/query.js'

function send(res, status, body, cache = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600') {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', status === 200 ? cache : 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.end(JSON.stringify(body))
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' })
  const sp = new URL(req.url, 'http://x').searchParams
  const parsed = parseWhaleQuery(sp)
  if (!parsed.ok) return send(res, 400, { error: parsed.error })
  // Localhost may read a throwaway schema; production always reads "whales".
  const schema = process.env.VERCEL_ENV !== 'production' && process.env.WHALES_SCHEMA ? process.env.WHALES_SCHEMA : DEFAULT_SCHEMA
  try {
    const out = await queryWhales(whalesHttp(), parsed.q, schema)
    return send(res, 200, out)
  } catch (e) {
    // Before the first ingest the schema doesn't exist yet: an honest empty answer.
    if (/relation .* does not exist/.test(String(e?.message))) return send(res, 200, { count: 0, total: 0, truncated: false, sources: [], updated: {}, sightings: [], note: 'no whale data loaded yet' }, 'no-store')
    return send(res, 502, { error: 'whale database unavailable' })
  }
}
