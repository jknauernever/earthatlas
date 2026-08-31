/**
 * "Has Carbon Mapper ever looked here?" — survey-coverage answer for empty
 * clicks on the gas layers.
 *
 * GET /api/geo/cm-coverage?lat=…&lng=…
 * → { ok, count, latest } — scenes whose footprint covers a ~0.15° box
 *   around the point, and the newest acquisition date.
 *
 * Proxied because api.carbonmapper.org sends no CORS headers (verified —
 * see docs/CARBONMAPPER_API.md). Coverage history only grows, and slowly:
 * cache a day at the edge per rounded coordinate.
 */

export const config = { runtime: 'edge' }

export default async function handler(req) {
  const u = new URL(req.url)
  const lat = Number(u.searchParams.get('lat'))
  const lng = Number(u.searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return new Response(JSON.stringify({ ok: false, error: 'bad coordinates' }), { status: 400 })
  }
  const d = 0.075
  const bbox = [lng - d, lat - d, lng + d, lat + d]
  const qs = bbox.map((v) => `bbox=${v.toFixed(4)}`).join('&')
  try {
    const r = await fetch(
      `https://api.carbonmapper.org/api/v1/catalog/scenes/annotated?${qs}&limit=50`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) },
    )
    if (!r.ok) throw new Error(`carbonmapper scenes ${r.status}`)
    const j = await r.json()
    const items = j.items || []
    const count = j.count ?? items.length
    let latest = null
    for (const sc of items) {
      const t = Date.parse(sc.timestamp)
      if (Number.isFinite(t) && (!latest || t > latest)) latest = t
    }
    return new Response(JSON.stringify({
      ok: true,
      count,
      latest: latest ? new Date(latest).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null,
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=3600, s-maxage=86400',
      },
    })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err).slice(0, 200) }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=60' },
    })
  }
}
