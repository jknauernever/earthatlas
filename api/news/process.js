/**
 * Cron-triggered article processing pipeline.
 *
 * Fetches RSS feeds → deduplicates → AI rewrites → resolves images → stores.
 *
 * Triggered by:
 *   - Vercel Cron (every 2 hours): POST /api/news/process
 *   - Admin manual trigger: POST /api/news/process?species=sharks
 */

import { authorizeRequest, json } from '../../lib/auth.js'
import { migrate, getEnabledFeeds, articleExists, imageExistsForSpecies, upsertArticle, touchFeed } from '../../lib/db.js'
import { fetchRSSFeed } from '../../lib/rss.js'
import { rewriteArticle } from '../../lib/ai.js'
import { resolveImage } from '../../lib/images.js'
import { slugify } from '../../lib/slugify.js'
import { createHash } from 'crypto'

// Species display names for AI context
const SPECIES_NAMES = {
  sharks: 'sharks',
  whales: 'whales',
  dolphins: 'dolphins',
  birds: 'birds',
  butterflies: 'butterflies',
  bears: 'bears',
  condors: 'condors',
  elephants: 'elephants',
  fungi: 'fungi',
  hippos: 'hippos',
  lions: 'lions',
  monkeys: 'monkeys and primates',
  sloths: 'sloths',
  tigers: 'tigers',
  wolves: 'wolves',
}

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
      return json({ message: 'No enabled feeds found', processed: 0 })
    }

    const results = { processed: 0, skipped: 0, errors: 0, feeds: feeds.length }

    for (const feed of feeds) {
      try {
        const items = await fetchRSSFeed(feed.url, { maxItems: 10 })

        for (const item of items) {
          try {
            // Normalize URL for dedup
            const sourceUrl = normalizeUrl(item.link)

            // Skip if already processed
            if (await articleExists(sourceUrl)) {
              results.skipped++
              continue
            }

            // Content for AI
            const rawContent = item.content || item.description || ''
            if (!rawContent || rawContent.length < 50) {
              results.skipped++
              continue
            }

            const contentHash = createHash('md5')
              .update(item.title + rawContent)
              .digest('hex')

            // AI rewrite
            const speciesName = SPECIES_NAMES[feed.species_slug] || feed.species_slug
            const rewritten = await rewriteArticle({
              title: item.title,
              content: rawContent.slice(0, 3000),
              speciesName,
            })

            if (!rewritten) {
              results.errors++
              continue
            }

            // Resolve image (skip duplicates within the same species)
            const isDuplicate = (url) => imageExistsForSpecies(url, feed.species_slug)
            const { url: imageUrl, credit: imageCredit } = await resolveImage({
              rssImage: item.image,
              articleUrl: item.link,
              imageKeywords: rewritten.imageKeywords,
              isDuplicate,
            })

            // Generate slug
            const slug = slugify(rewritten.title)

            // Store
            await upsertArticle({
              feedId: feed.id,
              speciesSlug: feed.species_slug,
              sourceUrl,
              originalTitle: item.title,
              title: rewritten.title,
              summary: rewritten.summary,
              slug,
              imageUrl,
              imageCredit,
              sourceName: item.source || feed.name,
              pubDate: item.pubDate ? new Date(item.pubDate).toISOString() : null,
              contentHash,
            })

            results.processed++
          } catch (itemErr) {
            console.error(`Error processing item "${item.title}":`, itemErr.message)
            results.errors++
          }
        }

        await touchFeed(feed.id)
      } catch (feedErr) {
        console.error(`Error processing feed "${feed.name}":`, feedErr.message)
        results.errors++
      }
    }

    return json(results)
  } catch (err) {
    console.error('Pipeline error:', err)
    return json({ error: err.message }, 500)
  }
}
}

function normalizeUrl(url) {
  try {
    const u = new URL(url)
    // Strip tracking params
    for (const key of [...u.searchParams.keys()]) {
      if (/^utm_/i.test(key)) u.searchParams.delete(key)
    }
    // Remove trailing slash
    u.pathname = u.pathname.replace(/\/+$/, '') || '/'
    return u.toString()
  } catch {
    return url
  }
}

