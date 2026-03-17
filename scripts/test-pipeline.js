/**
 * Test the full pipeline for one species.
 *
 * Usage:
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... PEXELS_API_KEY=... node scripts/test-pipeline.js sharks
 *
 * Processes up to 2 articles from the first working feed for the given species.
 */

import { migrate, getEnabledFeeds, articleExists, upsertArticle, touchFeed } from '../lib/db.js'
import { fetchRSSFeed } from '../lib/rss.js'
import { rewriteArticle } from '../lib/ai.js'
import { resolveImage } from '../lib/images.js'
import { slugify } from '../lib/slugify.js'
import { createHash } from 'crypto'

const species = process.argv[2] || 'sharks'
console.log(`Testing pipeline for: ${species}\n`)

await migrate()
const feeds = await getEnabledFeeds(species)
console.log(`Found ${feeds.length} feeds\n`)

let processed = 0, skipped = 0, errors = 0

for (const feed of feeds) {
  let items
  try {
    items = await fetchRSSFeed(feed.url, { maxItems: 3 })
    console.log(`${feed.name}: ${items.length} items`)
  } catch (e) {
    console.log(`${feed.name}: ERROR — ${e.message}`)
    continue
  }

  for (const item of items.slice(0, 2)) {
    const sourceUrl = item.link
    if (await articleExists(sourceUrl)) {
      console.log(`  SKIP (exists): ${item.title.slice(0, 60)}`)
      skipped++
      continue
    }

    const rawContent = item.content || item.description || ''
    if (rawContent.length < 50) { skipped++; continue }

    const contentHash = createHash('md5').update(item.title + rawContent).digest('hex')

    console.log(`  Rewriting: ${item.title.slice(0, 70)}`)
    try {
      const rewritten = await rewriteArticle({
        title: item.title,
        content: rawContent.slice(0, 3000),
        speciesName: species,
      })
      if (!rewritten) { errors++; console.log('    FAILED (no AI response)'); continue }

      console.log(`    → ${rewritten.title}`)
      console.log(`    → Keywords: ${rewritten.imageKeywords}`)

      const { url: imageUrl, credit } = await resolveImage({
        rssImage: item.image,
        articleUrl: item.link,
        imageKeywords: rewritten.imageKeywords,
      })
      console.log(`    → Image: ${imageUrl ? 'YES' : 'none'} ${credit || ''}`)

      const slug = slugify(rewritten.title)
      await upsertArticle({
        feedId: feed.id, speciesSlug: species, sourceUrl,
        originalTitle: item.title, title: rewritten.title,
        summary: rewritten.summary, slug, imageUrl, imageCredit: credit,
        sourceName: item.source || feed.name,
        pubDate: item.pubDate ? new Date(item.pubDate).toISOString() : null,
        contentHash,
      })
      processed++
      console.log(`    → Stored: /news/${species}/${slug}`)
    } catch (e) {
      console.log(`    ERROR: ${e.message}`)
      errors++
    }
  }
  await touchFeed(feed.id)
}

console.log(`\nDone: ${processed} processed, ${skipped} skipped, ${errors} errors`)
