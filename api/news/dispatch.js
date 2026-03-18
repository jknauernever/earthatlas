/**
 * Fan-out dispatcher for per-feed processing.
 *
 * Fetches the list of enabled feeds, then fires parallel requests to
 * /api/news/process?feed=<id> so each feed runs in its own serverless
 * invocation with its own timeout budget.
 *
 * We await each worker's initial response to ensure the request is
 * accepted (the worker continues processing independently). The client
 * can navigate away once the dispatch response is received — workers
 * are already running in their own invocations.
 *
 * Triggered by:
 *   - Vercel Cron: POST /api/news/dispatch
 *   - Admin "Update Feeds" button
 */

import { authorizeRequest, json } from '../../lib/auth.js'
import { migrate, getEnabledFeeds } from '../../lib/db.js'

const CONCURRENCY_LIMIT = 5

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

    // Dispatch in batches with concurrency limit.
    // We await each batch to ensure requests are accepted by Vercel,
    // but we only wait for the response status — each worker processes
    // independently in its own serverless invocation.
    const results = []
    for (let i = 0; i < feeds.length; i += CONCURRENCY_LIMIT) {
      const batch = feeds.slice(i, i + CONCURRENCY_LIMIT)
      const batchResults = await Promise.allSettled(
        batch.map(async (feed) => {
          const url = new URL(baseUrl)
          url.searchParams.set('feed', feed.id)
          const res = await fetch(url.toString(), { method: 'POST', headers })
          // Read the response so the connection is fully established,
          // but the worker has already started processing
          const body = await res.json().catch(() => ({}))
          return { feedId: feed.id, name: feed.name, status: res.status, ...body }
        })
      )
      results.push(...batchResults)
    }

    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    return json({
      dispatched: feeds.length,
      succeeded,
      failed,
      results: results.map(r =>
        r.status === 'fulfilled'
          ? { status: 'ok', ...r.value }
          : { status: 'error', error: r.reason?.message || String(r.reason) }
      ),
    })
  } catch (err) {
    console.error('Dispatch error:', err)
    return json({ error: err.message }, 500)
  }
}
}
