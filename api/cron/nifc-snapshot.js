/**
 * NIFC snapshot cron — decouples the /fire "Active wildfires (US)" layer from
 * NIFC's live ArcGIS quota, which rate-limits (429) during fire season.
 *
 * Runs on a schedule (see vercel.json "crons", every 3 h). Each run pulls the
 * WFIGS perimeters + incident-locations feeds, normalizes them, and writes each
 * as a public GeoJSON object to Vercel Blob at a stable path. /api/nifc then
 * serves these snapshots, so NIFC sees ~16 requests/day total instead of one per
 * visitor.
 *
 * SAFETY: a failed or empty pull is SKIPPED — it never overwrites the last good
 * snapshot — so a transient 429 can't blank the map. A `_fetched_ms` stamp on
 * each snapshot drives the "updated N ago" provenance shown in the UI.
 */

import { put } from '@vercel/blob'
import { resolveNifcRequest, normalizeNifc } from '../_nifc-core.js'

export const config = { runtime: 'edge' }

const LAYERS = ['perimeters', 'incidents']
export const blobPath = (layer) => `fire/nifc-${layer}.json`

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
  await put(blobPath(layer), JSON.stringify(fc), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 300,
  })
  return { layer, count: fc.features.length }
}

export default async function handler(req) {
  // Vercel injects `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set;
  // reject anything else so the endpoint can't be triggered by the public.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
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
  return new Response(JSON.stringify({ ok: true, results }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
