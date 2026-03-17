# Earth Atlas News Aggregator

A serverless news aggregation system that fetches species-related articles from curated RSS feeds, rewrites them with AI, resolves images, and serves them through the Earth Atlas frontend — with hosted article pages for SEO.

---

## Architecture Overview

```
RSS Feeds (per species)
    │
    ▼
┌──────────────────────────────────┐
│  Vercel Cron (every 2 hours)     │
│  POST /api/news/process          │
│                                  │
│  1. Fetch RSS feeds              │
│  2. Deduplicate by source URL    │
│  3. AI rewrite via Claude API    │
│  4. Resolve images (cascade)     │
│  5. Store in Neon Postgres       │
└──────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────┐
│  Neon Postgres (3 tables)        │
│  • feeds                         │
│  • articles                      │
│  • api_keys                      │
└──────────────────────────────────┘
    │
    ├──▶ GET /api/news/feed?species=sharks
    │    (FeedPanel consumes this)
    │
    ├──▶ GET /api/news/article?slug=...
    │    (Article page consumes this)
    │
    └──▶ /news/sharks/bull-sharks-make-friends
         (Hosted article page — SEO-indexed)
```

---

## File Structure

### Core Libraries — `lib/`

| File | Purpose |
|------|---------|
| `db.js` | Neon Postgres connection, schema migration, CRUD for feeds/articles/api_keys |
| `rss.js` | RSS feed fetching and parsing with image extraction from media tags, enclosures, and embedded `<img>` |
| `ai.js` | Anthropic Claude API integration — rewrites articles for EarthAtlas audience, returns title/summary/image keywords |
| `images.js` | Image resolution cascade: RSS image → og:image scraping → Pexels API fallback |
| `slugify.js` | URL-safe slug generation from article titles |

### API Endpoints — `api/`

#### Public (same-origin allowed without key; third parties need API key)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/news/feed?species=sharks&limit=10` | GET | Returns published articles for a species as JSON. Cached 10 min at edge. |
| `/api/news/article?slug=bull-sharks-make-friends` | GET | Returns full article data for a single article. Cached 1 hour. |

Third-party callers must provide a key via `?key=abc123` query param or `x-api-key` header.

#### Pipeline

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/news/process` | POST | `CRON_SECRET` or `ADMIN_SECRET` | Runs the full pipeline: fetch feeds → dedupe → AI rewrite → images → store. Triggered by Vercel Cron every 2 hours, or manually via admin. Optional `?species=sharks` to process only one species. |

#### Admin (all require `Authorization: Bearer <ADMIN_SECRET>`)

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/admin/feeds` | GET, POST, PUT, DELETE | CRUD for RSS feed sources. Filter by `?species=`. |
| `/api/admin/articles` | GET, PATCH | List articles by species/status, update status (published/draft/rejected). |
| `/api/admin/keys` | GET, POST, PUT, DELETE | Manage API keys for third-party access. |

### Frontend Changes

| File | Change |
|------|--------|
| `src/services/feedService.js` | `fetchNews()` now tries the new `/api/news/feed?species=X` endpoint first, falls back to legacy Google News proxy if empty |
| `src/components/FeedPanel.jsx` | Accepts new `speciesSlug` prop, passes it to `fetchNews()`. Expanded mode: articles in masonry left, sightings strip on right. Darker sighting badge color. |
| `src/components/FeedPanel.module.css` | New styles for masonry article layout, sighting strip sidebar, article cards |
| `src/explore/ExploreApp.jsx` | Passes `speciesSlug={config.slug}` to FeedPanel |
| `src/sharks/SharksApp.jsx` | Passes `speciesSlug="sharks"` to FeedPanel |
| `src/whales/WhalesApp.jsx` | Passes `speciesSlug="whales"` to FeedPanel |
| `src/butterflies/ButterfliesApp.jsx` | Passes `speciesSlug="butterflies"` to FeedPanel |

### Article Page — `src/news/`

| File | Purpose |
|------|---------|
| `NewsArticlePage.jsx` | Hosted article page — fetches article by slug, renders headline/image/summary/source link, uses `useSEO` hook, injects JSON-LD structured data |
| `NewsArticlePage.module.css` | Editorial page layout — breadcrumb, card-style article, responsive to 640px |

### Admin UI — `src/admin/`

| File | Purpose |
|------|---------|
| `AdminApp.jsx` | Full admin interface — 4 tabs (Feeds, Articles, Keys, Pipeline), session-based auth, CRUD forms |
| `AdminApp.module.css` | Admin styles — tables, forms, badges, status toggles, pipeline result display |

### SEO Middleware

| File | Purpose |
|------|---------|
| `middleware.js` (project root) | Vercel Edge Middleware — serves bot-optimized HTML with full meta tags for `/news/:species/:slug` routes |

### Configuration

| File | Change |
|------|--------|
| `vercel.json` | Added cron schedule (every 2h), `/news/:species/:slug` rewrite, `/admin` rewrite |
| `package.json` | Added `@neondatabase/serverless` dependency |
| `src/main.jsx` | Added routes for `/news/:species/:slug` and `/admin` |

---

## Database Schema

Three tables in Neon Postgres:

### `feeds` — RSS feed sources, per species

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL PK | |
| species_slug | VARCHAR(50) | e.g. `sharks`, `whales`, `birds` |
| name | VARCHAR(200) | Display name, e.g. "Mongabay Marine" |
| url | TEXT | RSS feed URL |
| enabled | BOOLEAN | Active or paused |
| last_fetched | TIMESTAMPTZ | Last successful fetch |
| created_at | TIMESTAMPTZ | |

### `articles` — Processed, AI-rewritten articles

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL PK | |
| feed_id | INTEGER FK → feeds | Source feed |
| species_slug | VARCHAR(50) | Species this article belongs to |
| source_url | TEXT UNIQUE | Original article URL (dedup key) |
| original_title | TEXT | Pre-rewrite headline |
| title | TEXT | AI-rewritten headline |
| summary | TEXT | AI-rewritten 2-4 paragraph summary |
| slug | VARCHAR(300) | URL slug for hosted page |
| image_url | TEXT | Resolved image URL |
| image_credit | TEXT | Attribution if stock photo (e.g. "Photo by X on Pexels") |
| source_name | VARCHAR(200) | Publisher name |
| pub_date | TIMESTAMPTZ | Original publication date |
| content_hash | VARCHAR(64) | MD5 of original content for change detection |
| status | VARCHAR(20) | `published`, `draft`, or `rejected` |
| created_at | TIMESTAMPTZ | |

### `api_keys` — Third-party API access keys

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL PK | |
| key | VARCHAR(64) UNIQUE | 32-char hex key (auto-generated) |
| name | VARCHAR(200) | Description, e.g. "Partner App" |
| enabled | BOOLEAN | Can be revoked without deleting |
| rate_limit | INTEGER | Requests per hour (default 100, not yet enforced) |
| created_at | TIMESTAMPTZ | |

---

## Processing Pipeline Detail

When `/api/news/process` runs (cron or manual):

1. **Fetch enabled feeds** — optionally filtered by species
2. **For each feed**, fetch RSS (max 10 items per run)
3. **For each item**:
   - Normalize the source URL (strip `utm_*` params, trailing slashes)
   - Skip if source URL already exists in the `articles` table
   - Skip if content is too short (<50 chars)
   - Hash the content (title + body) with MD5
   - **AI rewrite** via Claude `claude-sonnet-4-20250514` — returns new title, summary, and image search keywords
   - **Resolve image** using cascade:
     1. Image already extracted from RSS (media:content, media:thumbnail, enclosure, `<img>` in content/description)
     2. Scrape `og:image` or `twitter:image` from the article page (reads only first 50KB)
     3. Search Pexels API using AI-generated keywords (filters out political/military content)
   - **Store** in Postgres with `ON CONFLICT (source_url) DO NOTHING`
4. **Touch feed** — update `last_fetched` timestamp

---

## API Access Control

The system has three tiers of access:

1. **Same-origin (no key needed)** — Requests from earthatlas.org or localhost are allowed freely. Detected via `Referer` and `Origin` headers.

2. **Third-party (API key required)** — Cross-origin or external callers must provide a valid API key. Keys can be passed as:
   - Query param: `?key=abc123def456...`
   - Header: `x-api-key: abc123def456...`

3. **Admin (ADMIN_SECRET required)** — All `/api/admin/*` endpoints require `Authorization: Bearer <ADMIN_SECRET>` header. The `ADMIN_SECRET` is an environment variable set in Vercel.

API keys are managed via `/api/admin/keys` (create, list, enable/disable, delete). Each key is a 32-char hex string auto-generated by the server.

---

## Environment Variables Required

| Variable | Where | Description |
|----------|-------|-------------|
| `DATABASE_URL` | Vercel + local | Neon Postgres connection string |
| `ANTHROPIC_API_KEY` | Vercel | Claude API key for article rewriting |
| `PEXELS_API_KEY` | Vercel | Pexels stock photo API key (free tier) |
| `ADMIN_SECRET` | Vercel | Bearer token for admin API auth |
| `CRON_SECRET` | Vercel (auto-set) | Vercel auto-injects this for cron endpoint auth |

---

## FeedPanel UI Changes

The expanded "Latest" feed view was redesigned:

- **Articles** display in a CSS masonry layout (2-column `columns`) on the left — each article is a card with image, source badge, headline, description snippet, and timestamp
- **Sightings** display in a compact strip on the right (260px) — 40px thumbnails with location/time as the title, capped at 10 items
- **"Sighting" badge** now uses dark `#111a24` color for strong contrast against white background (previously used the species accent color which was too light)
- **Responsive**: collapses to single column below 900px
- Compact mode (right panel) is unchanged

---

## What Is Done

### Phase 1–2: Core Libraries + Pipeline + APIs
- [x] **lib/db.js** — Neon Postgres connection, schema migration, CRUD for feeds/articles/api_keys
- [x] **lib/rss.js** — RSS fetch + parse with full image extraction cascade
- [x] **lib/ai.js** — Claude API article rewriting, adapted from EnviroLink prompt
- [x] **lib/images.js** — og:image scraping + Pexels fallback
- [x] **lib/slugify.js** — URL slug utility
- [x] **api/news/process.js** — Cron pipeline endpoint
- [x] **api/news/feed.js** — Public feed JSON API with API key gate
- [x] **api/news/article.js** — Single article JSON API with API key gate
- [x] **api/admin/feeds.js** — Feed CRUD
- [x] **api/admin/articles.js** — Article review/status
- [x] **api/admin/keys.js** — API key management
- [x] **vercel.json** — Cron schedule (every 2h) + `/news/` rewrite rules
- [x] **@neondatabase/serverless** — Installed

### Phase 3: FeedPanel Integration
- [x] **FeedPanel.jsx** — New masonry + sighting strip layout, `speciesSlug` prop
- [x] **FeedPanel.module.css** — Expanded layout styles (articles masonry left, sightings strip right)
- [x] **feedService.js** — `fetchNews()` tries new `/api/news/feed` first, falls back to legacy Google News proxy
- [x] **ExploreApp.jsx** — Passes `speciesSlug={config.slug}` to FeedPanel
- [x] **SharksApp.jsx** — Passes `speciesSlug="sharks"`
- [x] **WhalesApp.jsx** — Passes `speciesSlug="whales"`
- [x] **ButterfliesApp.jsx** — Passes `speciesSlug="butterflies"`

### Phase 4: Hosted Article Pages + SEO
- [x] **src/news/NewsArticlePage.jsx** — Full article page with breadcrumb, species-themed badge, headline, hero image with credit, AI summary body, "Read full article at [source]" link, back-to-species footer
- [x] **src/news/NewsArticlePage.module.css** — Clean editorial layout, responsive down to 640px
- [x] **useSEO hook** — Article page sets og:title, og:description, og:image, canonical URL via existing hook
- [x] **JSON-LD** — NewsArticle structured data injected into `<head>` dynamically
- [x] **middleware.js** (Vercel Edge Middleware) — Detects bot/crawler User-Agents on `/news/:species/:slug`, returns a full HTML page with SEO meta tags (og:*, twitter:*, JSON-LD) so crawlers index articles without needing JS. Normal browsers get the SPA.
- [x] **React Router** — `/news/:species/:slug` route added in main.jsx
- [ ] **Sitemap integration** — Update `scripts/generate-sitemap.js` to include `/news/` article URLs (requires DB query, deferred until DB is provisioned)

### Phase 5: Admin UI
- [x] **src/admin/AdminApp.jsx** — Full admin interface with 4 tabs:
  - **Feeds**: table of all RSS feeds, filter by species, add/enable/disable/delete feeds
  - **Articles**: browse articles by species and status, change status (publish/draft/reject), thumbnail preview, link to article page
  - **API Keys**: create keys (auto-generated 32-char hex), enable/revoke/delete, shows key code
  - **Pipeline**: manual trigger with species filter, shows JSON result
- [x] **src/admin/AdminApp.module.css** — Clean admin styles (tables, forms, badges, status toggles)
- [x] **Auth gate** — Login form prompts for ADMIN_SECRET, stores in sessionStorage, validates against `/api/admin/feeds` on load
- [x] **React Router** — `/admin` route added in main.jsx

---

## What Still Needs To Be Done

### Phase 6: Provision + Deploy + Seed

- [ ] **Create Neon database** — Via Vercel dashboard (Add Integration → Neon) or neon.tech directly
- [ ] **Set environment variables** in Vercel:
  - `DATABASE_URL` (from Neon)
  - `ANTHROPIC_API_KEY`
  - `PEXELS_API_KEY`
  - `ADMIN_SECRET` (choose a strong token)
- [ ] **Run initial migration** — The first API call will auto-run `migrate()`, or trigger manually via admin
- [ ] **Seed initial RSS feeds** — Use the admin API to add feeds for each species. Suggested starter feeds:
  - **Sharks**: Oceana blog, Shark Research Institute, Mongabay oceans
  - **Whales**: WDC (Whale and Dolphin Conservation), IWC news, Mongabay oceans
  - **Birds**: BirdLife International, Audubon, eBird news
  - **Butterflies**: Xerces Society, Monarch Watch, Butterfly Conservation
  - **Elephants**: Save the Elephants, WWF elephants, Mongabay
  - (etc. for each species)
- [ ] **Test full pipeline** — Trigger `/api/news/process` and verify articles appear in FeedPanel
- [ ] **Verify SEO** — Check `/news/sharks/some-slug` returns proper meta tags and is indexable
- [ ] **Deploy to production**

### Future Enhancements (Not Blocking)

- [ ] Rate limiting enforcement for API keys (currently stored but not enforced)
- [ ] Article view count tracking
- [ ] Related articles sidebar on article pages
- [ ] Email digest of new articles (weekly)
- [ ] RSS output feed (so others can subscribe to EarthAtlas news)

---

## Reference

This system is modeled after the **EnviroLink AI News Aggregator** WordPress plugin at `/Users/jknauer/Projects/envirolink-news/envirolink-ai-aggregator.php`. Key patterns ported:

- AI rewrite prompt structure (TITLE/CONTENT/IMAGE_KEYWORDS format)
- Image extraction cascade (media:content → enclosure → content img → og:image → Pexels)
- Pexels content filtering (excluded political/military terms in alt text)
- Duplicate detection by source URL
- Content hashing for change detection

The main differences: this system is serverless on Vercel (not WordPress), uses Neon Postgres (not wp_posts/wp_postmeta), and is purpose-built for species/wildlife content rather than broad environmental news.
