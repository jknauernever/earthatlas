/**
 * Shared InciWeb core — used by BOTH the production Edge function (api/inciweb.js)
 * and the vite dev middleware.
 *
 * InciWeb is the interagency incident-information system: the public site where
 * agencies post NAMED wildfire updates (name, location, size, status). It carries
 * fire NAMES — the thing FIRMS/HMS heat detections lack — often before a mapped
 * WFIGS perimeter exists. It only lists significant incidents (not every tiny
 * start), and its RSS is the ~50 most recently updated, nationally.
 *
 * The RSS has no structured geo/size fields — coordinates and acreage live in the
 * description prose — so we parse them out with regexes (Edge has no XML parser).
 */

export const INCIWEB_RSS = 'https://inciweb.wildfire.gov/incidents/rss.xml'

// "48° 0 58" (deg min sec) → decimal degrees. Missing min/sec default to 0.
function dmsToDec(str) {
  const m = /(-?\d+)[°\s]+(\d+)?[\s']*(\d+)?/.exec(String(str || ''))
  if (!m) return null
  const deg = Number(m[1]), min = Number(m[2] || 0), sec = Number(m[3] || 0)
  if (!Number.isFinite(deg)) return null
  const sign = deg < 0 ? -1 : 1
  return sign * (Math.abs(deg) + min / 60 + sec / 3600)
}

const strip = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

// Titles carry a leading unit code ("MTBDF Sand Creek", "WAOWF Little Giant
// Fire") — drop it for a clean display name.
function cleanName(title) {
  const t = strip(title)
  return t.replace(/^[A-Z0-9]{4,6}\s+/, '').trim() || t
}

/**
 * Parse the InciWeb RSS into a GeoJSON FeatureCollection of named incident
 * points. Skips items without parseable coordinates.
 */
export function parseInciwebRss(xml) {
  const items = String(xml || '').match(/<item>[\s\S]*?<\/item>/g) || []
  const feats = []
  for (const it of items) {
    const title = (it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ''
    const link = strip((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '')
    const desc = (it.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || ''
    const text = strip(desc)

    const latM = /Latitude:\s*([-\d°'\s]+?)\s*Longitude/i.exec(text)
    const lngM = /Longitude:\s*([-\d°'\s]+?)(?:\s{2,}|NOTE|Incident|$)/i.exec(text)
    const lat = latM ? dmsToDec(latM[1]) : null
    let lng = lngM ? dmsToDec(lngM[1]) : null
    if (lat == null || lng == null) continue
    // InciWeb lists US longitudes as positive magnitudes — make them west.
    if (lng > 0) lng = -lng
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue

    const type = (/type of incident is\s+([A-Za-z /]+?)\s+and/i.exec(text) || [])[1] || null
    const stateM = (/State:\s*([A-Za-z ]+?)\s*(?:Coordinates|NOTE|Incident|$)/i.exec(text) || [])[1]
    const acresM = (/([\d,]+)\s*acres/i.exec(text) || [])[1]
    const updatedM = (/Last updated:\s*([\d-]+)/i.exec(text) || [])[1]

    feats.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        name: cleanName(title),
        url: link || null,
        type: type ? type.trim() : null,
        state: stateM ? stateM.trim() : null,
        acres: acresM ? Number(acresM.replace(/,/g, '')) : null,
        updated: updatedM || null,
      },
    })
  }
  return { type: 'FeatureCollection', features: feats, _count: feats.length }
}
