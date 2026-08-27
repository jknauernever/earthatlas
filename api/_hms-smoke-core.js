/**
 * NOAA HMS smoke-plume core — shared by the Edge function (api/hms-smoke.js)
 * and the vite dev middleware. Mirrors the _hms-core split.
 *
 * NOAA's Hazard Mapping System analysts trace visible smoke extents off GOES
 * imagery several times a day and NESDIS publishes one cumulative KML per
 * UTC day (light/medium/heavy polygons with start/end times). The whole
 * continent is ~100 KB, so there's no bbox gating — fetch today's file
 * (falling back to yesterday around the UTC rollover), parse the
 * Placemarks, serve GeoJSON.
 */

export function hmsSmokeUrls(now = Date.now()) {
  const urls = []
  for (const backDays of [0, 1]) {
    const d = new Date(now - backDays * 8.64e7)
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    urls.push(`https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/${y}/${m}/hms_smoke${y}${m}${dd}.kml`)
  }
  return urls
}

// HMS stamps are year + day-of-year + time: "2026236 1500UTC".
function parseHmsTime(s) {
  const m = /^(\d{4})(\d{3})\s+(\d{2})(\d{2})/.exec(String(s).trim())
  if (!m) return null
  return Date.UTC(+m[1], 0, 1, +m[3], +m[4]) + (+m[2] - 1) * 8.64e7
}

export function parseHmsSmokeKml(kml, fetchedMs = Date.now()) {
  const features = []
  const pmRe = /<Placemark>([\s\S]*?)<\/Placemark>/g
  let pm
  while ((pm = pmRe.exec(kml))) {
    const body = pm[1]
    const style = /styleUrl>#Smoke_(Light|Medium|Heavy)/.exec(body)
    const density = style ? style[1].toLowerCase() : null
    const start = /Start Time:\s*([^<]+)/.exec(body)
    const end = /End Time:\s*([^<]+)/.exec(body)
    const sat = /Satellite:\s*([A-Za-z0-9-]+)/.exec(body)
    // Multiple <coordinates> blocks in one placemark = outer ring + holes.
    const coordsRe = /<coordinates>([\s\S]*?)<\/coordinates>/g
    const rings = []
    let cm
    while ((cm = coordsRe.exec(body))) {
      const ring = cm[1].trim().split(/\s+/)
        .map((t) => {
          const [lng, lat] = t.split(',').map(Number)
          return [Math.round(lng * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]
        })
        .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]))
      if (ring.length >= 4) rings.push(ring)
    }
    if (!rings.length || !density) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: rings },
      properties: {
        density,
        start_ms: start ? parseHmsTime(start[1]) : null,
        end_ms: end ? parseHmsTime(end[1]) : null,
        satellite: sat ? sat[1] : null,
      },
    })
  }
  return { type: 'FeatureCollection', features, _count: features.length, _fetched_ms: fetchedMs }
}

// Analysts update a handful of times a day; 15 minutes of edge staleness is
// invisible and shares the NESDIS pull across all visitors.
export const HMS_SMOKE_CACHE = 'public, s-maxage=900, stale-while-revalidate=1800'

/** Fetch + parse with the today→yesterday fallback. Throws on total failure. */
export async function fetchHmsSmoke(now = Date.now()) {
  let lastErr = null
  for (const url of hmsSmokeUrls(now)) {
    try {
      const r = await fetch(url)
      if (!r.ok) { lastErr = new Error(`hms smoke ${r.status}`); continue }
      const kml = await r.text()
      const fc = parseHmsSmokeKml(kml, now)
      if (fc.features.length || url.includes(new Date(now - 8.64e7).toISOString().slice(0, 10).replace(/-/g, ''))) return fc
      // Today's file exists but is empty this early in the UTC day — an
      // empty result is honest, return it rather than yesterday's plumes.
      return fc
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('hms smoke unreachable')
}
