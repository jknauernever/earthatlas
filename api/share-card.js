/**
 * Per-view social share cards — storage endpoint (Vercel Blob).
 *
 *   POST /api/share-card?id=<sha1>          raw image/jpeg body → stored at
 *                                           share-cards/<id>.jpg (public)
 *   GET  /api/share-card?id=<sha1>&check=1  → { exists: boolean }
 *   GET  /api/share-card?id=<sha1>          → 302 to the blob URL (this is
 *                                           what og:image points at, so the
 *                                           blob store URL never appears in
 *                                           markup and middleware needs no
 *                                           extra env)
 *
 * <id> is SHA-1(pathname + search) of the canonical view URL, computed
 * identically by src/lib/shareCard.js (uploader) and middleware.js (reader).
 * Cards are small (~150–400 KB JPEG), deduped by id, overwritable so a
 * re-shared view refreshes its image. Node runtime (@vercel/blob needs
 * node:stream).
 */
import { put, head } from '@vercel/blob'

const ID_RE = /^[0-9a-f]{40}$/
const MAX_BYTES = 1_500_000
const pathFor = (id) => `share-cards/${id}.jpg`

async function readBody(req, limit) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limit) throw new Error('too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  const id = String(req.query.id || '')
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad id' })

  // HEAD must behave like GET — crawlers (Facebook included) often HEAD an
  // og:image before fetching it, and a 405 there kills the preview.
  if (req.method === 'GET' || req.method === 'HEAD') {
    let blob = null
    try { blob = await head(pathFor(id)) } catch { /* not found */ }
    if (req.query.check) {
      res.setHeader('Cache-Control', 'no-store') // existence flips on upload
      return res.status(200).json({ exists: !!blob })
    }
    if (!blob) return res.status(404).json({ error: 'not found' })
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600')
    res.setHeader('Location', blob.url)
    return res.status(302).end()
  }

  if (req.method === 'POST') {
    let body
    try { body = await readBody(req, MAX_BYTES) } catch {
      return res.status(413).json({ error: 'image too large' })
    }
    // JPEG magic bytes — this endpoint stores photos of map views, nothing else.
    if (body.length < 1000 || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) {
      return res.status(400).json({ error: 'not a jpeg' })
    }
    try {
      await put(pathFor(id), body, {
        access: 'public',
        contentType: 'image/jpeg',
        addRandomSuffix: false,
        allowOverwrite: true, // newer capture of the same view wins
        cacheControlMaxAge: 86400,
      })
    } catch (err) {
      console.error('[share-card] put failed:', err.message)
      return res.status(500).json({ error: 'store failed' })
    }
    return res.status(200).json({ ok: true })
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'method not allowed' })
}
