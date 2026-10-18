/**
 * Upload passes for the /ships track bakes (.github/workflows/ships-us-tracks-bake.yml, ships-gfw-*.yml; scripts/ships/bake-us/)
 * the Climate TRACE voyage bake (.github/workflows/ct-voyages-bake.yml) and the /shiptraffic overlap bake
 * (.github/workflows/shiptraffic-overlap-bake.yml) and the aisstream recorder on Fly.io (scripts/ships/aisstream/recorder.mjs).
 *
 * Same pattern as api/cron/trace-upload-token.js: the bake runs in GitHub
 * Actions (Vercel can't run tippecanoe or stream 1.6 GB of Parquet), its
 * outputs are far too big to POST through a function, and CI never holds the
 * Blob read-write token. CI asks here, with the CRON_SECRET bearer, for a
 * short-lived client token scoped to ONE allowlisted pathname, then uploads
 * straight to Blob.
 *
 *   POST { pathname } → { token }
 */

import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client'

// One folder per rules version and month; index.json lists the months. tracks-clsN / manifest-clsN: a month's
// zoomed-out tiles rebuilt with ship classes (scripts/ships/bake-us/add_classes.py).
const MONTH_FILE = /^ships\/tracks\/(us|gfw|salish)-v\d+\/\d{4}-(0[1-9]|1[0-2])\/(tracks\.pmtiles|tracks\.pack|manifest\.json|vessels\.json\.gz|identity\.ndjson\.gz|tracks-cls\d+\.pmtiles|manifest-cls\d+\.json)$/
const INDEX = /^ships\/tracks\/(us|gfw|salish|aisstream)-v\d+\/index\.json$/
// Climate TRACE voyages (.github/workflows/ct-voyages-bake.yml): one folder per bake version; latest.json points at the live one.
const CT_FILE = /^ships\/ct-voyages\/v\d+-\d{12}\/(ct-voyages-(mmsi|imo)\.pack|ct-stays-matched\.ndjson\.gz|manifest\.json)$/
const CT_POINTER = 'ships/ct-voyages/latest.json'
// /shiptraffic overlap + close passes (.github/workflows/shiptraffic-overlap-bake.yml, scripts/shiptraffic/overlap-bake.mjs).
const ST_FILE = /^shiptraffic\/overlap-v\d+\/\d{4}-(0[1-9]|1[0-2])\/(grid|closepasses)\.json$/
const ST_INDEX = /^shiptraffic\/overlap-v\d+\/index\.json$/
// aisstream recorder (scripts/ships/aisstream/recorder.mjs): one NOAA-shaped Parquet per recorded UTC day + small index/status.
const AIS_DAY = /^ships\/bake-inputs\/salish-v\d+\/aisstream\/points\/\d{4}-\d{2}-\d{2}\.parquet$/
const AIS_SMALL = /^ships\/bake-inputs\/salish-v\d+\/aisstream\/(index|status)\.json$/
// The recorder's live snapshot (latest position per ship, rewritten every 60 s) for /whalewatch's LIVE view.
const AIS_LIVE = /^ships\/live\/salish-v\d+\.json$/
// The recorder's /ships track packs, one folder per UTC day: tracks-HHMM.pack while the day is recorded (a new name each
// hour, so cached copies never go stale), tracks.pack once it ends. Listed in ships/tracks/aisstream-vN/index.json (INDEX).
const AIS_PACK = /^ships\/tracks\/aisstream-v\d+\/\d{4}-\d{2}-\d{2}\/tracks(-\d{4})?\.pack$/

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!secret || auth !== `Bearer ${secret}`) { res.statusCode = 401; return res.end('Unauthorized') }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only') }
  try {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const { pathname } = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const isLive = AIS_LIVE.test(pathname || '')
    const isIndex = INDEX.test(pathname || '') || pathname === CT_POINTER || ST_INDEX.test(pathname || '') || AIS_SMALL.test(pathname || '')
    if (!isIndex && !MONTH_FILE.test(pathname || '') && !CT_FILE.test(pathname || '') && !ST_FILE.test(pathname || '') && !AIS_DAY.test(pathname || '') && !AIS_PACK.test(pathname || '') && !isLive) throw new Error(`path not allowed: ${pathname}`)
    const token = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      addRandomSuffix: false,
      allowOverwrite: true, // a re-bake of the same month replaces its own files
      maximumSizeInBytes: isIndex ? 256 * 1024 : isLive ? 8 * 1024 ** 2 : 5 * 1024 ** 3,
      // The index must turn over quickly; a month's files change only on a re-bake.
      cacheControlMaxAge: isIndex || isLive ? 60 : 60 * 60 * 24 * 30,   // 60 s is Blob's minimum
      validUntil: Date.now() + 2 * 60 * 60 * 1000,
    })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ token }))
  } catch (err) {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: String(err).slice(0, 300) }))
  }
}
