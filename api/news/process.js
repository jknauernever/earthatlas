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
import { migrate, getEnabledFeeds, getFeedById, articleExists, classifiedUrlExists, markClassifiedUrl, imageExistsForSpecies, upsertArticle, touchFeed, getAllKeywords } from '../../lib/db.js'
import { fetchRSSFeed } from '../../lib/rss.js'
import { rewriteArticle, classifyArticle } from '../../lib/ai.js'
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
  const feedId = searchParams.get('feed') || null

  try {
    await migrate()

    let feeds
    if (feedId) {
      const feed = await getFeedById(parseInt(feedId, 10))
      feeds = feed ? [feed] : []
    } else {
      feeds = await getEnabledFeeds(speciesFilter)
    }
    if (feeds.length === 0) {
      return json({ message: feedId ? 'Feed not found' : 'No enabled feeds found', processed: 0 })
    }

    const results = { processed: 0, skipped: 0, errors: 0, feeds: feeds.length }
    const SPECIES_SLUGS = Object.keys(SPECIES_NAMES)

    // Build keyword map for general feed classification
    const keywordRows = await getAllKeywords()
    const keywordMap = {}
    for (const row of keywordRows) {
      if (!keywordMap[row.species_slug]) keywordMap[row.species_slug] = []
      keywordMap[row.species_slug].push(row.keyword)
    }

    for (const feed of feeds) {
      try {
        const isGeneral = feed.species_slug === 'general'
        const items = await fetchRSSFeed(feed.url, { maxItems: 10 })

        for (const item of items) {
          try {
            // Normalize URL for dedup
            const sourceUrl = normalizeUrl(item.link)

            // Content for AI
            const rawContent = item.content || item.description || ''
            if (!rawContent || rawContent.length < 50) {
              results.skipped++
              continue
            }

            const contentHash = createHash('md5')
              .update(item.title + rawContent)
              .digest('hex')

            // For general feeds: classify which species this article matches
            let targetSlugs
            if (isGeneral) {
              // Skip if already classified (matched or not) or stored as an article
              if (await classifiedUrlExists(sourceUrl) || await articleExists(sourceUrl)) {
                results.skipped++
                continue
              }
              targetSlugs = await classifyArticle({
                title: item.title,
                content: rawContent.slice(0, 3000),
                speciesList: SPECIES_SLUGS,
                keywordMap,
              })
              // Mark as classified regardless of match, so we never re-classify
              await markClassifiedUrl(sourceUrl, feed.id)
              if (targetSlugs.length === 0) {
                results.skipped++ // not relevant to any tracked species
                continue
              }
            } else {
              // Species-specific feed: skip if already processed for this species
              if (await articleExists(sourceUrl, feed.species_slug)) {
                results.skipped++
                continue
              }
              targetSlugs = [feed.species_slug]
            }

            // AI rewrite (once per article, not per species)
            const speciesName = isGeneral
              ? targetSlugs.map(s => SPECIES_NAMES[s] || s).join(', ')
              : (SPECIES_NAMES[feed.species_slug] || feed.species_slug)
            const rewritten = await rewriteArticle({
              title: item.title,
              content: rawContent.slice(0, 3000),
              speciesName,
            })

            if (!rewritten) {
              results.errors++
              continue
            }

            const slug = slugify(rewritten.title)

            // Insert one article row per matched species
            for (const speciesSlug of targetSlugs) {
              try {
                // Resolve image per species (skip duplicates within the same species)
                const isDuplicate = (url) => imageExistsForSpecies(url, speciesSlug)
                const { url: imageUrl, credit: imageCredit } = await resolveImage({
                  rssImage: item.image,
                  articleUrl: item.link,
                  imageKeywords: rewritten.imageKeywords,
                  isDuplicate,
                })

                await upsertArticle({
                  feedId: feed.id,
                  speciesSlug,
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
              } catch (speciesErr) {
                console.error(`Error storing article for species "${speciesSlug}":`, speciesErr.message)
                results.errors++
              }
            }
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

