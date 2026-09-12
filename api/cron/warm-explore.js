/**
 * warm-explore — pre-fills the gbif-proxy / inat-proxy edge caches for the
 * explore subsites' most popular views, so the first visitor of the hour
 * anywhere in the world lands on warm answers with ZERO upstream calls.
 *
 * Uses src/explore/wildQuery.js — the SAME quantization the browser uses —
 * so the warmed cache keys are byte-identical to what real users request.
 * Warms, per curated location: the recent GBIF window, the first iNat page,
 * and the all-species seasonal pattern (patterns cache 24h; recents 1h,
 * matching the hourly schedule in vercel.json).
 *
 * CRON_SECRET-guarded like the other crons. Extend WARM_LOCATIONS as
 * analytics reveal where people actually look.
 */

import { quantizeBounds, boundsFromZoom, recentWindow } from '../../src/explore/wildQuery.js'

// Per-subsite curated cells: the places people demonstrably go looking.
// taxa = the subsite's GBIF taxon keys (mirror of its config).
const WHALE_TAXA = ['733']
const WARM_LOCATIONS = [
  // slug, label, lat, lng, zoom, gbif taxa, iNat taxon ids
  { slug: 'whales', label: 'Salish Sea',       lat: 48.5,  lng: -123.0,  z: 8,   taxa: WHALE_TAXA, inat: '152871' },
  { slug: 'whales', label: 'Ucluelet/Tofino',  lat: 48.9,  lng: -125.5,  z: 8,   taxa: WHALE_TAXA, inat: '152871' },
  { slug: 'whales', label: 'Monterey Bay',     lat: 36.7,  lng: -122.0,  z: 8,   taxa: WHALE_TAXA, inat: '152871' },
  { slug: 'whales', label: 'San Francisco',    lat: 37.7,  lng: -122.8,  z: 8,   taxa: WHALE_TAXA, inat: '152871' },
  { slug: 'whales', label: 'Channel Islands',  lat: 34.0,  lng: -119.7,  z: 8,   taxa: WHALE_TAXA, inat: '152871' },
  { slug: 'whales', label: 'Stellwagen/Boston', lat: 42.4, lng: -70.5,   z: 8,   taxa: WHALE_TAXA, inat: '152871' },
  { slug: 'whales', label: 'New York Bight',   lat: 40.4,  lng: -73.6,   z: 8,   taxa: WHALE_TAXA, inat: '152871' },
  { slug: 'whales', label: 'Maui',             lat: 20.8,  lng: -156.6,  z: 8,   taxa: WHALE_TAXA, inat: '152871' },
]

const DAYS = 90 // mirror of explore configs' defaults.days

function warmUrls(origin, loc) {
  const bb = quantizeBounds(boundsFromZoom(loc.lat, loc.lng, loc.z))
  const { d1, d2 } = recentWindow(DAYS)
  const bases = ['HUMAN_OBSERVATION', 'OBSERVATION', 'OCCURRENCE']

  // BYTE-PARITY WARNING: the edge cache key is the exact URL. Param order
  // and number formatting below mirror shared-service.js's construction
  // (gbifSearchParams / fetchINatSightings) — change one, change both.
  const withTaxa = (base) => {
    const p = new URLSearchParams(base)
    for (const t of loc.taxa) p.append('taxonKey', t)
    for (const b of bases) p.append('basisOfRecord', b)
    return p
  }

  const recent = withTaxa({
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${bb.minLat},${bb.maxLat}`,
    decimalLongitude: `${bb.minLng},${bb.maxLng}`,
    eventDate: `${d1},${d2}`,
    limit: 300,
  })

  const pattern = withTaxa({
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${bb.minLat},${bb.maxLat}`,
    decimalLongitude: `${bb.minLng},${bb.maxLng}`,
    limit: '0',
    facet: 'month',
    'month.facetLimit': '12',
  })

  const inat = new URLSearchParams({
    taxon_id: loc.inat,
    nelat: bb.maxLat, nelng: bb.maxLng, swlat: bb.minLat, swlng: bb.minLng,
    d1, d2,
    order_by: 'observed_on',
    per_page: 200,
    geo: 'true',
    captive: 'false',
    page: 1,
  })

  return [
    `${origin}/api/gbif-proxy?${recent}`,
    `${origin}/api/gbif-proxy?${pattern}`,
    `${origin}/api/inat-proxy?${inat}`,
  ]
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`
  const out = []
  for (const loc of WARM_LOCATIONS) {
    for (const url of warmUrls(origin, loc)) {
      try {
        const r = await fetch(url)
        out.push({ loc: loc.label, ok: r.ok, cache: r.headers.get('x-vercel-cache') || null })
      } catch (err) {
        out.push({ loc: loc.label, ok: false, error: String(err).slice(0, 120) })
      }
      // Gentle pacing — misses fan out to GBIF/iNat.
      await new Promise((r2) => setTimeout(r2, 400))
    }
  }
  const misses = out.filter((o) => o.cache === 'MISS').length
  return res.status(200).json({ warmed: out.length, upstreamMisses: misses, results: out })
}
