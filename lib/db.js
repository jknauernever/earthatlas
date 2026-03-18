/**
 * Database layer — Neon serverless Postgres.
 *
 * Uses DATABASE_URL (or POSTGRES_URL) env var for connection.
 * Neon's `neon()` returns a tagged-template function: sql`query`
 * For parameterized queries use: sql.query('SELECT $1', [value])
 */

import { neon } from '@neondatabase/serverless'

let sql = null

function getDb() {
  if (!sql) {
    const connStr = process.env.DATABASE_URL || process.env.POSTGRES_URL
    if (!connStr) throw new Error('DATABASE_URL or POSTGRES_URL not set')
    sql = neon(connStr)
  }
  return sql
}

/** Helper: run a static SQL statement (no params) */
async function exec(query) {
  const db = getDb()
  return db.query(query, [])
}

/** Helper: run a parameterized query */
async function query(sql, params) {
  const db = getDb()
  return db.query(sql, params)
}

/**
 * Run the schema migration. Safe to call repeatedly (IF NOT EXISTS).
 */
export async function migrate() {
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

  // Migration: allow same source_url across different species (for general feeds)
  // Replace the old unique-on-source_url with unique-on-(source_url, species_slug)
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_source_species ON articles(source_url, species_slug)`)
  // Drop old unique index if it exists (safe — new index covers the dedup case)
  await exec(`DROP INDEX IF EXISTS idx_articles_source_url`)
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key)`)

  // Species keyword mapping for general feed classification
  await exec(`
    CREATE TABLE IF NOT EXISTS species_keywords (
      id            SERIAL PRIMARY KEY,
      species_slug  VARCHAR(50) NOT NULL,
      keyword       VARCHAR(100) NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await exec(`CREATE INDEX IF NOT EXISTS idx_species_keywords_slug ON species_keywords(species_slug)`)
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_species_keywords_unique ON species_keywords(species_slug, keyword)`)
}

/* ─── Query helpers ─────────────────────────────────────────────────────────── */

export async function getEnabledFeeds(speciesSlug) {
  if (speciesSlug) {
    return query(`SELECT * FROM feeds WHERE enabled = true AND species_slug = $1 ORDER BY species_slug, name`, [speciesSlug])
  }
  return query(`SELECT * FROM feeds WHERE enabled = true ORDER BY species_slug, name`, [])
}

export async function getFeedById(id) {
  const rows = await query(`SELECT * FROM feeds WHERE id = $1`, [id])
  return rows[0] || null
}

export async function upsertArticle(article) {
  const rows = await query(
    `INSERT INTO articles
       (feed_id, species_slug, source_url, original_title, title, summary, slug,
        image_url, image_credit, source_name, pub_date, content_hash, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (source_url, species_slug) DO NOTHING
     RETURNING id`,
    [
      article.feedId, article.speciesSlug, article.sourceUrl,
      article.originalTitle, article.title, article.summary, article.slug,
      article.imageUrl, article.imageCredit, article.sourceName,
      article.pubDate, article.contentHash, article.status || 'published',
    ]
  )
  return rows[0] || null
}

export async function articleExists(sourceUrl, speciesSlug) {
  if (speciesSlug) {
    const rows = await query(`SELECT id FROM articles WHERE source_url = $1 AND species_slug = $2 LIMIT 1`, [sourceUrl, speciesSlug])
    return rows.length > 0
  }
  const rows = await query(`SELECT id FROM articles WHERE source_url = $1 LIMIT 1`, [sourceUrl])
  return rows.length > 0
}

export async function imageExistsForSpecies(imageUrl, speciesSlug) {
  if (!imageUrl) return false
  const rows = await query(
    `SELECT id FROM articles WHERE image_url = $1 AND species_slug = $2 LIMIT 1`,
    [imageUrl, speciesSlug]
  )
  return rows.length > 0
}

export async function getArticles({ speciesSlug, status = 'published', limit = 20, offset = 0 }) {
  return query(
    `SELECT * FROM articles
     WHERE species_slug = $1 AND status = $2
     ORDER BY pub_date DESC NULLS LAST
     LIMIT $3 OFFSET $4`,
    [speciesSlug, status, limit, offset]
  )
}

export async function getArticleBySlug(slug) {
  const rows = await query(`SELECT * FROM articles WHERE slug = $1 LIMIT 1`, [slug])
  return rows[0] || null
}

/* ─── Admin CRUD ────────────────────────────────────────────────────────────── */

export async function createFeed({ speciesSlug, name, url }) {
  const rows = await query(
    `INSERT INTO feeds (species_slug, name, url) VALUES ($1, $2, $3) RETURNING *`,
    [speciesSlug, name, url]
  )
  return rows[0]
}

export async function updateFeed({ id, name, url, enabled }) {
  const rows = await query(
    `UPDATE feeds SET name = COALESCE($2, name), url = COALESCE($3, url),
     enabled = COALESCE($4, enabled) WHERE id = $1 RETURNING *`,
    [id, name, url, enabled]
  )
  return rows[0] || null
}

export async function deleteFeed(id) {
  await query(`DELETE FROM feeds WHERE id = $1`, [id])
}

export async function getAllFeeds(speciesSlug) {
  if (speciesSlug) {
    return query(`SELECT * FROM feeds WHERE species_slug = $1 ORDER BY species_slug, name`, [speciesSlug])
  }
  return query(`SELECT * FROM feeds ORDER BY species_slug, name`, [])
}

export async function updateArticleStatus(id, status) {
  const rows = await query(
    `UPDATE articles SET status = $2 WHERE id = $1 RETURNING *`,
    [id, status]
  )
  return rows[0] || null
}

export async function touchFeed(id) {
  await query(`UPDATE feeds SET last_fetched = NOW() WHERE id = $1`, [id])
}

/* ─── API Keys ──────────────────────────────────────────────────────────────── */

export async function validateApiKey(key) {
  if (!key) return false
  const rows = await query(`SELECT id, name FROM api_keys WHERE key = $1 AND enabled = true LIMIT 1`, [key])
  return rows.length > 0
}

export async function getAllApiKeys() {
  return query(`SELECT id, key, name, enabled, rate_limit, created_at FROM api_keys ORDER BY created_at DESC`, [])
}

export async function createApiKey({ name }) {
  const key = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  const rows = await query(
    `INSERT INTO api_keys (key, name) VALUES ($1, $2) RETURNING *`,
    [key, name]
  )
  return rows[0]
}

export async function updateApiKey({ id, name, enabled, rateLimit }) {
  const rows = await query(
    `UPDATE api_keys SET
       name = COALESCE($2, name),
       enabled = COALESCE($3, enabled),
       rate_limit = COALESCE($4, rate_limit)
     WHERE id = $1 RETURNING *`,
    [id, name, enabled, rateLimit]
  )
  return rows[0] || null
}

export async function deleteApiKey(id) {
  await query(`DELETE FROM api_keys WHERE id = $1`, [id])
}

/* ─── Species Keywords ─────────────────────────────────────────────────────── */

export async function getKeywordsForSpecies(speciesSlug) {
  return query(
    `SELECT * FROM species_keywords WHERE species_slug = $1 ORDER BY keyword`,
    [speciesSlug]
  )
}

export async function getAllKeywords() {
  return query(`SELECT * FROM species_keywords ORDER BY species_slug, keyword`, [])
}

export async function addKeyword({ speciesSlug, keyword }) {
  const rows = await query(
    `INSERT INTO species_keywords (species_slug, keyword) VALUES ($1, $2)
     ON CONFLICT (species_slug, keyword) DO NOTHING
     RETURNING *`,
    [speciesSlug, keyword.toLowerCase().trim()]
  )
  return rows[0] || null
}

export async function deleteKeyword(id) {
  await query(`DELETE FROM species_keywords WHERE id = $1`, [id])
}
