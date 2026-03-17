import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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

export default defineConfig({
  plugins: [react(), newsProxyPlugin()],
  server: {
    port: 5173,
    open: true,
  },
})
