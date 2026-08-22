/**
 * GET /api/systems-explain?f=<base64url facts JSON> — AI narration for the
 * /systems "Explain this view" button. See api/_systems-explain-core.js.
 *
 * GET + normalized, coarsely-rounded facts means identical views share one
 * cache entry: `s-maxage=3600` lets Vercel's CDN serve popular views without
 * touching the model at all — the main cost lever. Errors return 200-shaped
 * JSON with an `error` field (never cached) so the client can show honest
 * states.
 */

import { decodeFacts, narrateFacts } from './_systems-explain-core.js'

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json')
  const facts = decodeFacts(new URL(req.url, 'http://x').searchParams.get('f'))
  if (!facts) {
    res.statusCode = 400
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify({ error: 'bad_facts' }))
    return
  }
  try {
    const out = await narrateFacts(facts)
    res.statusCode = 200
    res.setHeader('cache-control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    res.end(JSON.stringify(out))
  } catch (err) {
    res.statusCode = err.code === 'not_configured' ? 503 : 502
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify({ error: err.code === 'not_configured' ? 'not_configured' : 'narration_failed' }))
  }
}
