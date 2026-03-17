/**
 * Seed initial RSS feeds into the database.
 *
 * Usage: DATABASE_URL=postgres://... node scripts/seed-feeds.js
 *
 * Safe to run multiple times — checks for existing feeds by URL before inserting.
 */

import { neon } from '@neondatabase/serverless'

const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL
if (!dbUrl) {
  console.error('ERROR: DATABASE_URL or POSTGRES_URL environment variable is required')
  process.exit(1)
}

const sql = neon(dbUrl)
const exec = (q) => sql.query(q, [])
const query = (q, p) => sql.query(q, p)

// ─── Starter feeds per species ─────────────────────────────────────────────────

const FEEDS = [
  // Sharks
  { speciesSlug: 'sharks', name: 'Mongabay — Sharks',       url: 'https://news.mongabay.com/feed/?post_tag=sharks' },
  { speciesSlug: 'sharks', name: 'Oceana',                  url: 'https://oceana.org/feed/' },
  { speciesSlug: 'sharks', name: 'Shark Stewards',          url: 'https://www.sharkstewards.org/feed/' },

  // Whales
  { speciesSlug: 'whales', name: 'Mongabay — Whales',       url: 'https://news.mongabay.com/feed/?post_tag=whales' },
  { speciesSlug: 'whales', name: 'WDC UK',                  url: 'https://uk.whales.org/feed/' },

  // Dolphins
  { speciesSlug: 'dolphins', name: 'Mongabay — Dolphins',   url: 'https://news.mongabay.com/feed/?post_tag=dolphins' },
  { speciesSlug: 'dolphins', name: 'WDC UK',                url: 'https://uk.whales.org/feed/' },
  { speciesSlug: 'dolphins', name: 'Oceana',                url: 'https://oceana.org/feed/' },

  // Birds
  { speciesSlug: 'birds', name: 'Mongabay — Birds',         url: 'https://news.mongabay.com/feed/?post_tag=birds' },
  { speciesSlug: 'birds', name: 'All About Birds',          url: 'https://www.allaboutbirds.org/news/feed/' },
  { speciesSlug: 'birds', name: 'ScienceDaily — Birds',     url: 'https://www.sciencedaily.com/rss/plants_animals/birds.xml' },

  // Butterflies
  { speciesSlug: 'butterflies', name: 'Mongabay — Butterflies', url: 'https://news.mongabay.com/feed/?post_tag=butterflies' },
  { speciesSlug: 'butterflies', name: 'Monarch Watch Blog',     url: 'https://monarchwatch.org/blog/feed/' },

  // Bears
  { speciesSlug: 'bears', name: 'Mongabay — Bears',         url: 'https://news.mongabay.com/feed/?post_tag=bears' },
  { speciesSlug: 'bears', name: 'Born Free USA',            url: 'https://www.bornfreeusa.org/feed/' },

  // Elephants
  { speciesSlug: 'elephants', name: 'Mongabay — Elephants', url: 'https://news.mongabay.com/feed/?post_tag=elephants' },
  { speciesSlug: 'elephants', name: 'Save the Elephants',   url: 'https://www.savetheelephants.org/feed/' },

  // Lions
  { speciesSlug: 'lions', name: 'Mongabay — Lions',         url: 'https://news.mongabay.com/feed/?post_tag=lions' },
  { speciesSlug: 'lions', name: 'Born Free USA',            url: 'https://www.bornfreeusa.org/feed/' },

  // Tigers
  { speciesSlug: 'tigers', name: 'Mongabay — Tigers',       url: 'https://news.mongabay.com/feed/?post_tag=tigers' },
  { speciesSlug: 'tigers', name: 'Born Free USA',           url: 'https://www.bornfreeusa.org/feed/' },

  // Wolves
  { speciesSlug: 'wolves', name: 'Mongabay — Wolves',       url: 'https://news.mongabay.com/feed/?post_tag=wolves' },
  { speciesSlug: 'wolves', name: 'International Wolf Center', url: 'https://www.wolf.org/feed/' },

  // Condors
  { speciesSlug: 'condors', name: 'Mongabay — Birds of Prey', url: 'https://news.mongabay.com/feed/?post_tag=birds-of-prey' },

  // Monkeys
  { speciesSlug: 'monkeys', name: 'Mongabay — Primates',    url: 'https://news.mongabay.com/feed/?post_tag=primates' },
  { speciesSlug: 'monkeys', name: 'Jane Goodall Institute',  url: 'https://www.janegoodall.org/feed/' },

  // Hippos
  { speciesSlug: 'hippos', name: 'Mongabay — Hippos',       url: 'https://news.mongabay.com/feed/?post_tag=hippos' },

  // Sloths
  { speciesSlug: 'sloths', name: 'Mongabay — Sloths',       url: 'https://news.mongabay.com/feed/?post_tag=sloths' },
  { speciesSlug: 'sloths', name: 'Sloth Conservation Foundation', url: 'https://slothconservation.com/feed/' },

  // Fungi
  { speciesSlug: 'fungi', name: 'Mongabay — Fungi',         url: 'https://news.mongabay.com/feed/?post_tag=fungi' },
]

async function seed() {
  console.log('Running migration...')

  await exec(`
    CREATE TABLE IF NOT EXISTS feeds (
      id            SERIAL PRIMARY KEY,
      species_slug  VARCHAR(50) NOT NULL,
      name          VARCHAR(200) NOT NULL,
      url           TEXT NOT NULL,
      enabled       BOOLEAN DEFAULT true,
      last_fetched  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id              SERIAL PRIMARY KEY,
      feed_id         INTEGER REFERENCES feeds(id) ON DELETE SET NULL,
      species_slug    VARCHAR(50) NOT NULL,
      source_url      TEXT NOT NULL,
      original_title  TEXT NOT NULL,
      title           TEXT NOT NULL,
      summary         TEXT NOT NULL,
      slug            VARCHAR(300) NOT NULL,
      image_url       TEXT,
      image_credit    TEXT,
      source_name     VARCHAR(200),
      pub_date        TIMESTAMPTZ,
      content_hash    VARCHAR(64),
      status          VARCHAR(20) DEFAULT 'published',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id          SERIAL PRIMARY KEY,
      key         VARCHAR(64) NOT NULL UNIQUE,
      name        VARCHAR(200) NOT NULL,
      enabled     BOOLEAN DEFAULT true,
      rate_limit  INTEGER DEFAULT 100,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await exec(`CREATE INDEX IF NOT EXISTS idx_feeds_species ON feeds(species_slug)`)
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_source_url ON articles(source_url)`)
  await exec(`CREATE INDEX IF NOT EXISTS idx_articles_species_date ON articles(species_slug, pub_date DESC)`)
  await exec(`CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug)`)
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key)`)

  console.log('Migration complete\n')

  // Seed feeds
  let added = 0, skipped = 0
  for (const feed of FEEDS) {
    const existing = await query(`SELECT id FROM feeds WHERE url = $1 AND species_slug = $2 LIMIT 1`, [feed.url, feed.speciesSlug])
    if (existing.length > 0) {
      skipped++
      continue
    }
    await query(
      `INSERT INTO feeds (species_slug, name, url) VALUES ($1, $2, $3)`,
      [feed.speciesSlug, feed.name, feed.url]
    )
    console.log(`  + ${feed.speciesSlug}: ${feed.name}`)
    added++
  }

  console.log(`\n${added} feeds added, ${skipped} already existed`)

  // Show summary
  const counts = await query(`SELECT species_slug, COUNT(*) as count FROM feeds WHERE enabled = true GROUP BY species_slug ORDER BY species_slug`, [])
  console.log('\nFeeds per species:')
  for (const row of counts) {
    console.log(`  ${row.species_slug}: ${row.count}`)
  }
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
