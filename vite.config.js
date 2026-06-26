import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { GRAPHQL_URL, resolveBirdweatherQuery } from './api/_birdweather-core.js'
import { EBIRD_BASE, resolveEbirdRequest } from './api/_ebird-core.js'
import { resolveFirmsRequest, firmsCsvToGeoJSON } from './api/_firms-core.js'
import { resolveNifcRequest, normalizeNifc } from './api/_nifc-core.js'
import { resolveFireHistoryRequest, normalizeFireHistory } from './api/_fire-history-core.js'

// Dev middleware: serve /api/news locally by fetching Google News RSS server-side
function newsProxyPlugin() {
  return {
    name: 'news-proxy',
    configureServer(server) {
      server.middlewares.use('/api/news-legacy', async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const query = url.searchParams.get('q') || ''
        const count = Math.min(parseInt(url.searchParams.get('n') || '10', 10), 20)

        if (!query) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ articles: [] }))
          return
        }

        try {
          const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
          const rssRes = await fetch(rssUrl, {
            headers: { 'User-Agent': 'EarthAtlas/1.0 (https://earthatlas.org)' },
          })
          const xml = await rssRes.text()

          const articles = []
          const itemRegex = /<item>([\s\S]*?)<\/item>/g
          let match
          while ((match = itemRegex.exec(xml)) !== null && articles.length < count) {
            const itemXml = match[1]
            const title = extractTag(itemXml, 'title')
            const link = extractTag(itemXml, 'link')
            const pubDate = extractTag(itemXml, 'pubDate')
            const source = extractTag(itemXml, 'source')
            const description = extractTag(itemXml, 'description')
            const rssImage = extractImageFromHtml(description)

            if (title && link) {
              articles.push({
                title: decodeEntities(title),
                link,
                pubDate: pubDate || null,
                source: source ? decodeEntities(source) : null,
                description: description ? stripHtml(decodeEntities(description)) : null,
                image: null,
                _rssImage: rssImage,
              })
            }
          }

          // Decode Google News URLs → real article URLs, then fetch og:image
          await Promise.allSettled(
            articles.map(async (article) => {
              const realUrl = await decodeGoogleNewsUrl(article.link)
              if (realUrl && realUrl !== article.link) {
                article.realLink = realUrl
              }
              const target = article.realLink || article.link
              const ogImage = await fetchOgImage(target, 4000)
              article.image = ogImage || article._rssImage || null
              delete article._rssImage
            })
          )

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ articles }))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ articles: [], error: err.message }))
        }
      })
    },
  }
}

function extractTag(xml, tag) {
  const cdataMatch = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`))
  if (cdataMatch) return cdataMatch[1]
  const plainMatch = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
  return plainMatch ? plainMatch[1] : null
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
}

function extractImageFromHtml(html) {
  if (!html) return null
  const decoded = decodeEntities(html)
  const imgMatch = decoded.match(/<img[^>]+src=["']([^"']+)["']/)
  return imgMatch ? imgMatch[1] : null
}

function stripHtml(html) {
  if (!html) return null
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300) || null
}

/**
 * Decode a Google News encoded article URL to the real publisher URL.
 * Uses Google's batchexecute API for the newer AU_yqL-prefixed tokens.
 */
async function decodeGoogleNewsUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl)
    const path = url.pathname.split('/')
    if (url.hostname !== 'news.google.com' || !path.includes('articles')) return sourceUrl

    const base64Part = path[path.length - 1]

    // Decode the base64 to check if it's a direct URL or needs batchexecute
    const raw = Buffer.from(base64Part, 'base64').toString('binary')
    // Strip protobuf header bytes (0x08 0x13 0x22)
    let str = raw
    const prefix = '\x08\x13\x22'
    if (str.startsWith(prefix)) str = str.substring(prefix.length)

    // Read length-prefixed string
    const len = str.charCodeAt(0)
    if (len >= 0x80) {
      str = str.substring(2, 2 + (len & 0x7f))
    } else {
      str = str.substring(1, 1 + len)
    }

    // If the extracted string is already a URL, return it
    if (str.startsWith('http')) return str

    // Otherwise, use Google's batchexecute API to decode
    return await fetchDecodedBatchExecute(base64Part)
  } catch {
    return sourceUrl
  }
}

async function fetchDecodedBatchExecute(articleId) {
  try {
    const reqPayload = [[['Fbv4je', `["garturlreq",[["${articleId}",null,null,null],null,"en","US",null,[1],null,null,null,null,null,null,null,null,null,null,null,0]]`, null, 'generic']]]
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: 'f.req=' + encodeURIComponent(JSON.stringify(reqPayload)),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null

    const text = await res.text()
    // Response contains nested JSON; look for the decoded URL
    const match = text.match(/\["garturlres","(https?:\/\/[^"]+)"/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

async function fetchOgImage(url, timeoutMs = 4000) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'EarthAtlas/1.0 (https://earthatlas.org)' },
      redirect: 'follow',
    })
    clearTimeout(timer)
    if (!res.ok) return null

    // Read only first ~50KB to find meta tags
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let html = ''
    while (html.length < 50_000) {
      const { done, value } = await reader.read()
      if (done) break
      html += decoder.decode(value, { stream: true })
      if (html.includes('</head>')) break
    }
    reader.cancel()

    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/)
    if (ogMatch) return ogMatch[1]

    const twMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/)
    if (twMatch) return twMatch[1]

    return null
  } catch {
    return null
  }
}

// Dev middleware: serve /api/inat-proxy by forwarding to iNaturalist server-side.
// Mirrors the production Edge function at api/inat-proxy.js so /live works the
// same in `npm run dev` as in `vercel dev` and prod.
function inatProxyPlugin() {
  const ALLOWED = new Set([
    'per_page', 'page', 'order', 'order_by', 'captive', 'photos', 'quality_grade',
    'swlat', 'nelat', 'swlng', 'nelng', 'lat', 'lng', 'radius',
    'taxon_id', 'iconic_taxa', 'd1', 'd2',
  ])
  return {
    name: 'inat-proxy',
    configureServer(server) {
      server.middlewares.use('/api/inat-proxy', async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const upstream = new URLSearchParams()
        for (const [k, v] of url.searchParams) {
          if (ALLOWED.has(k)) upstream.set(k, v)
        }
        // Always reply 200 so Chrome doesn't auto-log failed sub-requests for
        // every throttled point — signal upstream failures via the body.
        try {
          const r = await fetch(`https://api.inaturalist.org/v1/observations?${upstream}`, {
            headers: { accept: 'application/json' },
          })
          if (r.ok) {
            const body = await r.text()
            res.statusCode = 200
            res.setHeader('content-type', r.headers.get('content-type') || 'application/json')
            res.setHeader('cache-control', 'public, max-age=60')
            res.end(body)
            return
          }
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ results: [], total_results: 0, _upstream_status: r.status }))
        } catch (err) {
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ results: [], total_results: 0, _upstream_status: 0, _upstream_error: String(err) }))
        }
      })
    },
  }
}

// Dev middleware: serve /api/birdweather by building the same locked-down
// GraphQL queries the production Edge function does (shared core) and
// forwarding to BirdWeather server-side. Keeps /birdsong working the same under
// `npm run dev` as under `vercel dev` and prod.
function birdweatherProxyPlugin() {
  return {
    name: 'birdweather-proxy',
    configureServer(server) {
      server.middlewares.use('/api/birdweather', async (req, res) => {
        const { searchParams } = new URL(req.url, 'http://localhost')
        const resolved = resolveBirdweatherQuery(searchParams)
        res.setHeader('content-type', 'application/json')
        if (resolved.error) {
          res.statusCode = resolved.status
          res.end(JSON.stringify({ error: resolved.error }))
          return
        }
        const { query, variables, empty } = resolved
        try {
          const r = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ query, variables }),
          })
          res.statusCode = 200
          if (!r.ok) {
            res.end(JSON.stringify({ data: empty, _upstream_status: r.status }))
            return
          }
          const payload = await r.json()
          if (payload.errors) {
            res.end(JSON.stringify({ data: empty, _upstream_errors: payload.errors }))
            return
          }
          res.end(JSON.stringify({ data: payload.data || empty }))
        } catch (err) {
          res.statusCode = 200
          res.end(JSON.stringify({ data: empty, _upstream_status: 0, _upstream_error: String(err) }))
        }
      })
    },
  }
}

// Dev middleware: serve /api/ebird by building the same locked-down requests
// the production Edge function does (shared core) and forwarding to eBird with
// the server-side token. Keeps every eBird-backed tool working the same under
// `npm run dev` as under `vercel dev` and prod. Needs EBIRD_API_KEY in the
// environment (.env / .env.local); without it the proxy returns empty bodies,
// same as a missing-key prod deploy.
function ebirdProxyPlugin(apiKey) {
  return {
    name: 'ebird-proxy',
    configureServer(server) {
      server.middlewares.use('/api/ebird', async (req, res) => {
        const { searchParams } = new URL(req.url, 'http://localhost')
        const resolved = resolveEbirdRequest(searchParams)
        res.setHeader('content-type', 'application/json')
        if (resolved.error) {
          res.statusCode = resolved.status
          res.end(JSON.stringify({ error: resolved.error }))
          return
        }
        const { path, empty } = resolved
        if (!apiKey) {
          res.statusCode = 200
          res.setHeader('x-ebird-upstream', 'nokey')
          res.end(JSON.stringify(empty))
          return
        }
        try {
          const r = await fetch(`${EBIRD_BASE}${path}`, {
            headers: { 'x-ebirdapitoken': apiKey, accept: 'application/json' },
          })
          res.statusCode = 200
          if (!r.ok) {
            res.setHeader('x-ebird-upstream', String(r.status))
            res.end(JSON.stringify(empty))
            return
          }
          res.end(await r.text())
        } catch (err) {
          res.statusCode = 200
          res.setHeader('x-ebird-upstream', '0')
          res.end(JSON.stringify(empty))
        }
      })
    },
  }
}

// Dev middleware: serve /api/firms by mirroring the production Edge function
// (api/firms.js) — same FIRMS core, same CSV→GeoJSON shape — so the active-fire
// layer works identically under `npm run dev`. Needs FIRMS_MAP_KEY in the
// environment; without it, returns an empty FeatureCollection like a no-key prod
// deploy (the map just shows no detections).
function firmsProxyPlugin(mapKey) {
  return {
    name: 'firms-proxy',
    configureServer(server) {
      server.middlewares.use('/api/firms', async (req, res) => {
        const { searchParams } = new URL(req.url, 'http://localhost')
        res.setHeader('content-type', 'application/json')
        const empty = { type: 'FeatureCollection', features: [], _count: 0 }
        const resolved = resolveFirmsRequest(searchParams, mapKey)
        if (resolved.error) {
          if (resolved.status === 500) {
            res.statusCode = 200
            res.setHeader('x-firms-upstream', 'nokey')
            res.end(JSON.stringify({ ...empty, _error: resolved.error }))
          } else {
            res.statusCode = resolved.status
            res.end(JSON.stringify({ error: resolved.error }))
          }
          return
        }
        try {
          const texts = await Promise.all(
            resolved.urls.map(({ src, url }) =>
              fetch(url, { headers: { accept: 'text/csv' } })
                .then((r) => (r.ok ? r.text() : ''))
                .then((text) => ({ src, text }))
                .catch(() => ({ src, text: '' }))
            )
          )
          res.statusCode = 200
          res.end(JSON.stringify(firmsCsvToGeoJSON(texts, Date.now())))
        } catch (err) {
          res.statusCode = 200
          res.setHeader('x-firms-upstream', '0')
          res.end(JSON.stringify({ ...empty, _error: String(err).slice(0, 120) }))
        }
      })
    },
  }
}

// Dev middleware: serve /api/nifc by mirroring the production Edge function
// (api/nifc.js) — same NIFC core, same normalized GeoJSON — so the US active-
// wildfire layer works identically under `npm run dev`. No key needed.
function nifcProxyPlugin() {
  return {
    name: 'nifc-proxy',
    configureServer(server) {
      server.middlewares.use('/api/nifc', async (req, res) => {
        const { searchParams } = new URL(req.url, 'http://localhost')
        res.setHeader('content-type', 'application/json')
        const empty = { type: 'FeatureCollection', features: [], _count: 0 }
        const resolved = resolveNifcRequest(searchParams)
        if (resolved.error) {
          res.statusCode = resolved.status
          res.end(JSON.stringify({ error: resolved.error }))
          return
        }
        try {
          const r = await fetch(resolved.url, { headers: { accept: 'application/json' } })
          res.statusCode = 200
          if (!r.ok) { res.end(JSON.stringify({ ...empty, _upstream: r.status })); return }
          const raw = await r.json()
          res.end(JSON.stringify(normalizeNifc(raw, resolved.layer)))
        } catch (err) {
          res.statusCode = 200
          res.end(JSON.stringify({ ...empty, _error: String(err).slice(0, 120) }))
        }
      })
    },
  }
}

// Dev middleware: serve /api/fire-history by mirroring the production Edge
// function (api/fire-history.js) — same IFPH core — so the US historical-
// perimeter layer works identically under `npm run dev`. No key needed.
function fireHistoryProxyPlugin() {
  return {
    name: 'fire-history-proxy',
    configureServer(server) {
      server.middlewares.use('/api/fire-history', async (req, res) => {
        const { searchParams } = new URL(req.url, 'http://localhost')
        res.setHeader('content-type', 'application/json')
        const empty = { type: 'FeatureCollection', features: [], _count: 0 }
        const resolved = resolveFireHistoryRequest(searchParams)
        if (resolved.error) { res.statusCode = resolved.status; res.end(JSON.stringify({ error: resolved.error })); return }
        try {
          const r = await fetch(resolved.url, { headers: { accept: 'application/json' } })
          res.statusCode = 200
          if (!r.ok) { res.end(JSON.stringify({ ...empty, _upstream: r.status })); return }
          const raw = await r.json()
          res.end(JSON.stringify(normalizeFireHistory(raw, resolved.max)))
        } catch (err) {
          res.statusCode = 200
          res.end(JSON.stringify({ ...empty, _error: String(err).slice(0, 120) }))
        }
      })
    },
  }
}

// Dev middleware: serve /api/geo/{suggest,retrieve} by forwarding to Mapbox
// Search Box with the server-side token, mirroring the production Edge
// functions in api/geo/. Keeps GeoSearch autocomplete (subsites, forestmonitor)
// working the same under `npm run dev` as in prod.
function geoProxyPlugin(mapboxToken) {
  const SUGGEST_PARAMS = new Set(['q', 'session_token', 'limit', 'types', 'proximity', 'language'])
  return {
    name: 'geo-proxy',
    configureServer(server) {
      server.middlewares.use('/api/geo', async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const op = url.pathname.replace(/\/+$/, '')
        res.setHeader('content-type', 'application/json')
        if (!mapboxToken) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'MAPBOX_TOKEN not configured' }))
          return
        }
        let upstreamUrl
        if (op === '/suggest') {
          const upstream = new URLSearchParams({ access_token: mapboxToken })
          for (const [k, v] of url.searchParams) {
            if (SUGGEST_PARAMS.has(k)) upstream.set(k, v)
          }
          upstreamUrl = `https://api.mapbox.com/search/searchbox/v1/suggest?${upstream}`
        } else if (op === '/retrieve') {
          const id = url.searchParams.get('id') || ''
          const upstream = new URLSearchParams({
            access_token: mapboxToken,
            session_token: url.searchParams.get('session_token') || '',
          })
          const language = url.searchParams.get('language')
          if (language) upstream.set('language', language)
          upstreamUrl = `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(id)}?${upstream}`
        } else {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'unknown geo op; expected /suggest or /retrieve' }))
          return
        }
        try {
          const r = await fetch(upstreamUrl)
          res.statusCode = r.status
          res.end(await r.text())
        } catch (err) {
          res.statusCode = 502
          res.end(JSON.stringify({ error: 'upstream fetch failed', detail: String(err) }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Load all env (incl. non-VITE_ vars) so the eBird dev proxy can read the
  // server-side token under `npm run dev`. Never bundled into the client.
  const env = loadEnv(mode, process.cwd(), '')
  // Prefer the clean name; fall back to the legacy VITE_ name so existing local
  // .env.local files keep working. Server-side only — never bundled.
  const ebirdKey = env.EBIRD_API_KEY || env.VITE_EBIRD_API_KEY ||
    process.env.EBIRD_API_KEY || process.env.VITE_EBIRD_API_KEY || ''
  const mapboxToken = env.MAPBOX_TOKEN || env.VITE_MAPBOX_TOKEN ||
    process.env.MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN || ''
  // Server-side only — never bundled. Powers the /fire active-fire dev proxy.
  const firmsKey = env.FIRMS_MAP_KEY || process.env.FIRMS_MAP_KEY || ''
  return {
  plugins: [
    react(),
    newsProxyPlugin(),
    inatProxyPlugin(),
    birdweatherProxyPlugin(),
    ebirdProxyPlugin(ebirdKey),
    firmsProxyPlugin(firmsKey),
    nifcProxyPlugin(),
    fireHistoryProxyPlugin(),
    geoProxyPlugin(mapboxToken),
    // Upload source maps to Sentry during production builds so stack traces
    // show real function names instead of minified gibberish. No-ops in dev
    // and when SENTRY_AUTH_TOKEN isn't set, so safe by default. The token is
    // server-only (never bundled into the client).
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
      sourcemaps: {
        // After upload, delete the .map files so they're never served to
        // users — Sentry has them, no one else needs them.
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
    }),
  ],
  build: {
    // Required for source-map upload. Vite generates .map files alongside
    // bundles; the Sentry plugin uploads then deletes them per above.
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: true,
  },
  }
})
