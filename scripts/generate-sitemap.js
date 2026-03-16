/**
 * Generate sitemap.xml from explore configs and species data.
 * Run as part of the build process to keep the sitemap in sync.
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SITE = 'https://earthatlas.org'
const today = new Date().toISOString().split('T')[0]

// ─── Collect subsite slugs from config files ──────────────────────────────────
const configDir = join(ROOT, 'src/explore/configs')
const slugs = []
for (const file of readdirSync(configDir).filter(f => f.endsWith('.js'))) {
  const content = readFileSync(join(configDir, file), 'utf-8')
  const match = content.match(/slug:\s*['"]([^'"]+)['"]/)
  if (match) slugs.push(match[1])
}
slugs.sort()

// ─── Collect species keys from species-data files ─────────────────────────────
const speciesDir = join(ROOT, 'src/explore/species-data')
const speciesKeys = new Set()
for (const file of readdirSync(speciesDir).filter(f => f.endsWith('.js'))) {
  const content = readFileSync(join(speciesDir, file), 'utf-8')
  // Match numeric keys in SPECIES_META object: e.g. 2440735: {
  const matches = content.matchAll(/^\s*(\d{4,}):\s*\{/gm)
  for (const m of matches) speciesKeys.add(m[1])
}
const sortedKeys = [...speciesKeys].sort((a, b) => Number(a) - Number(b))

// ─── Build sitemap XML ────────────────────────────────────────────────────────
const urls = []

function addUrl(path, priority, changefreq = 'weekly') {
  urls.push(`  <url>
    <loc>${SITE}${path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`)
}

// Homepage
addUrl('/', 1.0, 'daily')

// Explore subsites
for (const slug of slugs) {
  addUrl(`/${slug}`, 0.9)
}

// Species pages
for (const key of sortedKeys) {
  addUrl(`/species/${key}`, 0.7)
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`

writeFileSync(join(ROOT, 'public/sitemap.xml'), xml)
console.log(`✓ Sitemap generated: 1 homepage + ${slugs.length} subsites + ${sortedKeys.length} species pages = ${urls.length} URLs`)
