// Generates per-route HTML files in dist/ so Vercel can serve unique OG/SEO
// tags for specific routes (and crawlers — which don't run JS — see them).
// Currently handles /forestmonitor; trivially extensible to other routes.
//
// Runs after `vite build`. Reads dist/index.html, patches title + meta
// tags + structured data, writes dist/<route>.html. A matching rewrite in
// vercel.json maps the route path → the route HTML file.

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DIST = path.resolve(__dirname, '..', 'dist')
const INDEX = path.join(DIST, 'index.html')

const ROUTES = [
  {
    out: 'forestmonitor.html',
    url: 'https://earthatlas.org/forestmonitor',
    title: 'Forest Monitor — Near-real-time global forest disturbance · EarthAtlas',
    description:
      'Track forest loss anywhere on Earth, updated every 12 hours. 30-meter NASA OPERA DIST-ALERT data with crop-aware cause inference, named-fire context, and per-pixel diagnostics.',
    image: 'https://earthatlas.org/forestmonitor-social.png',
    imageAlt: 'EarthAtlas Forest Monitor — near-real-time forest disturbance mapped globally',
    keywords:
      'forest disturbance, deforestation map, NASA OPERA, DIST-ALERT, near-real-time forest monitoring, satellite forest loss, MTBS, NIFC fire perimeters, USDA Cropland Data Layer, MapBiomas',
  },
  {
    out: 'fire.html',
    url: 'https://earthatlas.org/fire',
    title: 'FireApp — Wildfire risk & fuels · EarthAtlas',
    description:
      'Explore wildfire hazard potential, vegetation fuel state, and land cover across the United States and beyond. An EarthAtlas tool.',
    // TODO: replace with a dedicated fire-social.png once designed; the generic
    // EarthAtlas card is the stopgap so the OG tags aren't broken at launch.
    image: 'https://earthatlas.org/earthatlas-social.jpg',
    imageAlt: 'EarthAtlas FireApp — wildfire hazard potential, fuels, and land cover',
    keywords:
      'wildfire risk map, wildfire hazard potential, WHP, fire fuels, NAIP NDVI vegetation, land cover, wildland urban interface, USDA Forest Service, fire risk United States',
  },
]

function patchHead(html, r) {
  // Title
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${r.title}</title>`)
  // Canonical
  html = html.replace(
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/,
    `<link rel="canonical" href="${r.url}" />`,
  )
  // Meta description
  html = html.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${r.description}" />`,
  )

  // OG block — replace each tag individually so other meta tags survive.
  html = html.replace(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${r.url}" />`)
  html = html.replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${r.title}" />`)
  html = html.replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${r.description}" />`)
  html = html.replace(/<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/, `<meta property="og:image" content="${r.image}" />`)
  html = html.replace(/<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/?>/, `<meta property="og:image:alt" content="${r.imageAlt}" />`)

  // Twitter card
  html = html.replace(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${r.title}" />`)
  html = html.replace(/<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${r.description}" />`)
  html = html.replace(/<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/, `<meta name="twitter:image" content="${r.image}" />`)

  // Add keywords meta if not present, else replace
  if (/<meta\s+name="keywords"/.test(html)) {
    html = html.replace(
      /<meta\s+name="keywords"\s+content="[^"]*"\s*\/?>/,
      `<meta name="keywords" content="${r.keywords}" />`,
    )
  } else {
    html = html.replace(
      /<meta\s+name="description"/,
      `<meta name="keywords" content="${r.keywords}" />\n    <meta name="description"`,
    )
  }

  return html
}

async function main() {
  let template
  try {
    template = await fs.readFile(INDEX, 'utf8')
  } catch (e) {
    console.error(`[generate-route-html] dist/index.html not found — run after vite build. ${e.message}`)
    process.exit(0) // don't break the build if dist/ doesn't exist yet
  }

  for (const r of ROUTES) {
    const html = patchHead(template, r)
    const outPath = path.join(DIST, r.out)
    await fs.writeFile(outPath, html, 'utf8')
    const size = (await fs.stat(outPath)).size
    console.log(`[generate-route-html] wrote dist/${r.out} (${(size / 1024).toFixed(1)} KB)`)
  }
}

main().catch((e) => {
  console.error('[generate-route-html] failed:', e)
  process.exit(1)
})
