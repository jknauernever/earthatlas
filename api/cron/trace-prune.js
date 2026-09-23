/**
 * Storage cleanup for the Climate TRACE releases (called by
 * scripts/bake-climatetrace/publish.mjs right after it flips the pointer).
 *
 * Each monthly release is ~1.5 GB in Blob (one tile file per measure + the
 * detail pack). Keep exactly two: the live one and the one before it (a
 * visitor mid-session or a CDN copy can still reference the previous build
 * for a few minutes after the switch). Every other trace/<build>/ folder is
 * deleted. The pointer decides what's live — nothing else is trusted.
 *
 *   POST (CRON_SECRET bearer) → { kept: [...], deleted: n }
 */

import { list, del } from '@vercel/blob'

export const maxDuration = 60

const BUILD_DIR = /^trace\/(v\d+\.\d+\.\d+-\d{8}(?:\d{4})?)\//

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!secret || auth !== `Bearer ${secret}`) { res.statusCode = 401; return res.end('Unauthorized') }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only') }
  res.setHeader('content-type', 'application/json')
  try {
    // The pointer is the only authority on what's live.
    let pointer = null
    let cursor
    const blobs = []
    do {
      const page = await list({ prefix: 'trace/', cursor, limit: 1000 })
      blobs.push(...page.blobs)
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
    const ptr = blobs.find((b) => b.pathname === 'trace/latest.json')
    if (ptr) pointer = await (await fetch(`${ptr.url}?t=${Date.now()}`, { cache: 'no-store' })).json()
    if (!pointer?.build) throw new Error('no live pointer — refusing to delete anything')
    const keep = new Set([pointer.build, pointer.previous].filter(Boolean))
    const doomed = blobs.filter((b) => {
      const m = b.pathname.match(BUILD_DIR)
      return m && !keep.has(m[1])
    })
    for (let i = 0; i < doomed.length; i += 100) await del(doomed.slice(i, i + 100).map((b) => b.url))
    res.end(JSON.stringify({ ok: true, kept: [...keep], deleted: doomed.length, bytesFreed: doomed.reduce((a, b) => a + (b.size || 0), 0) }))
  } catch (err) {
    res.statusCode = 500
    res.end(JSON.stringify({ ok: false, error: String(err).slice(0, 300) }))
  }
}
