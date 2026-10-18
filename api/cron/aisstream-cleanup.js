/**
 * Hourly cleanup of the aisstream recorder's superseded track packs on Blob (scripts/ships/aisstream/recorder.mjs).
 *
 * While a UTC day is recorded, the recorder uploads a new ships/tracks/aisstream-v1/YYYY-MM-DD/tracks-HHMM.pack every hour
 * (a new name each time, so no cached copy is ever read against a newer index) and points the index at the newest one.
 * The older hourly copies are never read again; left alone they'd add up to ~2 GB a month. This deletes every
 * tracks-HHMM.pack the index doesn't point to and that is more than 3 hours old (a reader that fetched the index just
 * before a rebuild may still be range-reading the previous pack). tracks.pack (a finished day) is never deleted.
 * If the index can't be read, nothing is deleted.
 *
 * GET /api/cron/aisstream-cleanup[?dry=1] — CRON_SECRET-guarded (Vercel cron). Needs BLOB_READ_WRITE_TOKEN (server only).
 */
import { list, del } from '@vercel/blob'

const PREFIX = 'ships/tracks/aisstream-v1/'
const INDEX = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/tracks/aisstream-v1/index.json'
const HOURLY = /^ships\/tracks\/aisstream-v1\/\d{4}-\d{2}-\d{2}\/tracks-\d{4}\.pack$/
const KEEP_MS = 3 * 60 * 60 * 1000

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!secret || auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' })
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN not set' })
  const dry = req.query?.dry === '1'

  let idx
  try {
    const r = await fetch(`${INDEX}?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    idx = await r.json()
  } catch (e) {
    return res.status(502).json({ error: `index unreadable, nothing deleted: ${e.message}` })
  }
  const referenced = new Set(Object.values(idx.days || {}).map((d) => d.pack && new URL(d.pack).pathname.slice(1)).filter(Boolean))

  const doomed = []
  let listed = 0, cursor
  do {
    const page = await list({ prefix: PREFIX, limit: 1000, cursor, token })
    listed += page.blobs.length
    for (const b of page.blobs) {
      if (!HOURLY.test(b.pathname) || referenced.has(b.pathname)) continue
      if (Date.now() - new Date(b.uploadedAt).getTime() < KEEP_MS) continue
      doomed.push(b)
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)

  if (!dry) for (let i = 0; i < doomed.length; i += 100) await del(doomed.slice(i, i + 100).map((b) => b.url), { token })
  const bytes = doomed.reduce((n, b) => n + b.size, 0)
  return res.status(200).json({ ok: true, dry, listed, referenced: referenced.size, deleted: dry ? 0 : doomed.length,
    wouldDelete: dry ? doomed.map((b) => b.pathname) : undefined, freedBytes: dry ? 0 : bytes })
}
