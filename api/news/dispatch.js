/**
 * Fan-out dispatcher for per-feed processing.
 *
 * Fetches the list of enabled feeds, then fires off requests to
 * /api/news/process?feed=<id> so each feed runs in its own serverless
 * invocation with its own timeout budget.
 *
 * Fire-and-forget: returns immediately after dispatching. Workers
 * continue processing independently, so the caller can navigate away.
 *
 * Triggered by:
 *   - Vercel Cron: POST /api/news/dispatch
 *   - Admin "Update Feeds" button
 */

import { authorizeRequest, json } from '../../lib/auth.js'
import { migrate, getEnabledFeeds } from '../../lib/db.js'

export default { async fetch(req) {
  // Auth: Vercel Cron sends CRON_SECRET, admin via Bearer token or session cookie
  const auth = req.headers.get('authorization') || ''
  const cronSecret = process.env.CRON_SECRET

  const isCron = cronSecret && auth === `Bearer ${cronSecret}`
  const isAdmin = authorizeRequest(req)

  if (!isCron && !isAdmin) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const { searchParams } = new URL(req.url)
  const speciesFilter = searchParams.get('species') || null

  try {
    await migrate()

    const feeds = await getEnabledFeeds(speciesFilter)
    if (feeds.length === 0) {
      return json({ message: 'No enabled feeds found', dispatched: 0 })
    }

    // Build the base URL for worker requests
    const baseUrl = new URL(req.url)
    baseUrl.pathname = '/api/news/process'
    baseUrl.search = ''

    // Forward auth: pass along whichever credential the caller used
    const headers = { 'Content-Type': 'application/json' }
    if (isCron) {
      headers['Authorization'] = `Bearer ${cronSecret}`
    } else {
      const cookie = req.headers.get('cookie')
      if (cookie) headers['Cookie'] = cookie
      const adminAuth = req.headers.get('authorization')
      if (adminAuth) headers['Authorization'] = adminAuth
    }

    // Fire off all worker requests without awaiting them.
    // Each fetch() initiates a separate serverless invocation that
    // runs independently — even if this function returns first.
    for (const feed of feeds) {
      const url = new URL(baseUrl)
      url.searchParams.set('feed', feed.id)
      fetch(url.toString(), { method: 'POST', headers }).catch(() => {})
    }

    return json({
      dispatched: feeds.length,
      feeds: feeds.map(f => ({ id: f.id, name: f.name, species: f.species_slug })),
    })
  } catch (err) {
    console.error('Dispatch error:', err)
    return json({ error: err.message }, 500)
  }
}
}
