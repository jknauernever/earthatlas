/**
 * NIFC snapshot cron — decouples the /fire "Active wildfires (US)" layer from
 * NIFC's live ArcGIS quota, which rate-limits (429) during fire season.
 *
 * Runs on a schedule (see vercel.json "crons", every 3 h). Each run pulls the
 * WFIGS perimeters + incident-locations feeds, normalizes them, and writes each
 * as a public GeoJSON object to Vercel Blob at a stable, deterministic path
 * (fire/nifc-<layer>.json). /api/nifc reads those directly, so NIFC sees ~16
 * requests/day total instead of one per visitor.
 *
 * Node runtime (NOT edge): @vercel/blob's `put` pulls in node:stream / undici,
 * which the Edge runtime rejects — mirrors api/vessel-tiles.js.
 *
 * SAFETY: a failed or empty pull is SKIPPED — it never overwrites the last good
 * snapshot — so a transient 429 can't blank the map. A `_fetched_ms` stamp on
 * each snapshot drives the "updated N ago" provenance shown in the UI.
 */

import { put } from '@vercel/blob'
import { resolveNifcRequest, normalizeNifc, simplifyNifc } from '../_nifc-core.js'

const LAYERS = ['perimeters', 'incidents']
const blobPath = (layer) => `fire/nifc-${layer}.json`

const putJson = (path, body) => put(path, body, {
  access: 'public',
  addRandomSuffix: false,
  allowOverwrite: true,
  contentType: 'application/json',
  cacheControlMaxAge: 300,
})

async function snapshotLayer(layer) {
  const resolved = resolveNifcRequest(new URLSearchParams({ layer }))
  const r = await fetch(resolved.url, { headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(`upstream ${r.status}`)
  const raw = await r.json()
  if (raw && raw.error) throw new Error(`arcgis ${raw.error.code || 'error'}`)
  const fc = normalizeNifc(raw, layer)
  // Never overwrite a good snapshot with an empty one (upstream hiccup).
  if (!fc.features.length) throw new Error('empty result')
  fc._fetched_ms = Date.now()
  await putJson(blobPath(layer), JSON.stringify(fc))
  // Perimeters also get a simplified variant (same pull, no extra NIFC load):
  // the client fetches this ~10× smaller file when zoomed out and upgrades to
  // full geometry on zoom-in. Every fire keeps its perimeter in both.
  let low = null
  if (layer === 'perimeters') {
    const lowFc = simplifyNifc(fc)
    await putJson('fire/nifc-perimeters-low.json', JSON.stringify(lowFc))
    low = lowFc.features.length
  }
  return { layer, count: fc.features.length, ...(low != null ? { low } : {}) }
}

export default async function handler(req, res) {
  // Vercel injects `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set;
  // reject anything else so the endpoint can't be triggered by the public.
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (secret && auth !== `Bearer ${secret}`) {
    res.statusCode = 401
    res.end('Unauthorized')
    return
  }
  const results = []
  for (const layer of LAYERS) {
    try {
      results.push(await snapshotLayer(layer))
    } catch (err) {
      // Skip this layer this run; the previous snapshot stays in place.
      results.push({ layer, skipped: true, error: String(err).slice(0, 120) })
    }
  }
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify({ ok: true, results }))
}
