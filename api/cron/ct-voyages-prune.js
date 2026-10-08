/**
 * Storage cleanup for the Climate TRACE voyage bakes (called by scripts/ships/bake-ct-voyages/publish.mjs right after
 * it flips ships/ct-voyages/latest.json; same pattern as trace-prune.js).
 *
 * Each monthly bake is one folder ships/ct-voyages/<version>/ (~75 MB: two packs, the matched stays, the manifest).
 * Keep exactly two: the live one and the one before it (a server instance can still read the previous packs for up
 * to 5 minutes after the switch, api/ship-tracks.js ctVoyagesNow). Every other <version>/ folder is deleted. The
 * hand-uploaded files directly under ships/ct-voyages/ (the trackSource.json fallback) and latest.json are never touched.
 *
 * The caller names what to keep (trace-prune.js learned on 2026-09-23 that a pointer read right after a publish can
 * come back stale), and the route still refuses if the pointer it can see names a version outside the keep list.
 *
 *   POST { keep: ['v3-YYYYMMDDHHMM', …], dryRun? } (CRON_SECRET bearer) → { kept, deleted, bytesFreed, paths? }
 */

import { list, del } from '@vercel/blob'

export const maxDuration = 60

const PREFIX = 'ships/ct-voyages/'
const VERSION_DIR = /^ships\/ct-voyages\/(v\d+-\d{12})\//
const VERSION_NAME = /^v\d+(-\d{12})?$/ // the hand-made fallback ('v3') may be named as kept; it has no folder

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!secret || auth !== `Bearer ${secret}`) { res.statusCode = 401; return res.end('Unauthorized') }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only') }
  res.setHeader('content-type', 'application/json')
  try {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const { keep: keepList, dryRun = false } = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    if (!Array.isArray(keepList) || !keepList.length || !keepList.every((v) => VERSION_NAME.test(v))) {
      throw new Error('keep list required: ["<live version>", "<previous version>"] — refusing to delete anything')
    }
    const keep = new Set(keepList)
    const blobs = []
    let cursor
    do {
      const page = await list({ prefix: PREFIX, cursor, limit: 1000 })
      blobs.push(...page.blobs)
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
    const ptr = blobs.find((b) => b.pathname === `${PREFIX}latest.json`)
    const pointer = ptr ? await (await fetch(`${ptr.url}?t=${Date.now()}`, { cache: 'no-store' })).json().catch(() => null) : null
    if (pointer?.version && !keep.has(pointer.version)) throw new Error(`pointer names ${pointer.version}, not in keep list — refusing`)
    const doomed = blobs.filter((b) => { const m = b.pathname.match(VERSION_DIR); return m && !keep.has(m[1]) })
    if (!dryRun) for (let i = 0; i < doomed.length; i += 100) await del(doomed.slice(i, i + 100).map((b) => b.url))
    res.end(JSON.stringify({ ok: true, dryRun, kept: [...keep], deleted: dryRun ? 0 : doomed.length, bytesFreed: dryRun ? 0 : doomed.reduce((a, b) => a + (b.size || 0), 0),
      ...(dryRun ? { wouldDelete: doomed.map((b) => b.pathname) } : {}) }))
  } catch (err) {
    res.statusCode = 500
    res.end(JSON.stringify({ ok: false, error: String(err).slice(0, 300) }))
  }
}
