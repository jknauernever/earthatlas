/**
 * Storage cleanup for the Climate TRACE releases (called by
 * scripts/bake-climatetrace/publish.mjs right after it flips the pointer).
 *
 * Each monthly release is ~1.5 GB in Blob (one tile file per measure + the
 * detail pack). Keep exactly two: the live one and the one before it (a
 * visitor mid-session or a CDN copy can still reference the previous build
 * for a few minutes after the switch). Every other trace/<build>/ folder is
 * deleted.
 *
 * The caller names what to keep — publish.mjs knows exactly which build it
 * just made live and which one it replaced. This route used to read
 * trace/latest.json itself; right after a publish that read came back from
 * Blob's cache as the OLD pointer, and it deleted the release that had just
 * gone live (2026-09-23). So: no keep list, no deletion — and it still
 * refuses if the keep list doesn't include what the pointer names.
 *
 *   POST { keep: ['v…-YYYYMMDDHHmm', …] } (CRON_SECRET bearer) → { kept, deleted }
 */

import { list, del } from '@vercel/blob'

export const maxDuration = 60

const BUILD_DIR = /^trace\/(v\d+\.\d+\.\d+-\d{8}(?:\d{4})?)\//
const BUILD_NAME = /^v\d+\.\d+\.\d+-\d{8}(?:\d{4})?$/

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!secret || auth !== `Bearer ${secret}`) { res.statusCode = 401; return res.end('Unauthorized') }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only') }
  res.setHeader('content-type', 'application/json')
  try {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const { keep: keepList } = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    if (!Array.isArray(keepList) || !keepList.length || !keepList.every((b) => BUILD_NAME.test(b))) {
      throw new Error('keep list required: ["<live build>", "<previous build>"] — refusing to delete anything')
    }
    const keep = new Set(keepList)
    let pointer = null
    let cursor
    const blobs = []
    do {
      const page = await list({ prefix: 'trace/', cursor, limit: 1000 })
      blobs.push(...page.blobs)
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
    // Belt and braces: whatever copy of the pointer we can see must name a
    // kept build (a stale copy names the previous one, which is kept too).
    const ptr = blobs.find((b) => b.pathname === 'trace/latest.json')
    if (ptr) pointer = await (await fetch(`${ptr.url}?t=${Date.now()}`, { cache: 'no-store' })).json().catch(() => null)
    if (pointer?.build && !keep.has(pointer.build)) throw new Error(`pointer names ${pointer.build}, not in keep list — refusing`)
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
