// One-time import of the static /shoreline files from Salish Sea Explorer (~/Projects/salish-sea-propmapper),
// which is being retired. Copies, unchanged:
//   - the 14 Friends of the San Juans layers + Beamer & Fresh fish use → public/shoreline-data/
//     (friends-projects feeds the inland parcel popup card only; it is not a map layer on /shoreline)
//   - the two Friends handouts popups link to, with their photos → public/friends/reports/
// The handouts' own site header carried SSE's Resources menu; it becomes the Friends logo + a link to /shoreline.
//
//   node scripts/shoreline/import-sse-static.mjs [path-to-salish-sea-propmapper]

import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SSE = resolve(process.argv[2] || join(process.env.HOME, 'Projects/salish-sea-propmapper'))
const OUT_DATA = 'public/shoreline-data'
const OUT_REPORTS = 'public/friends/reports'

const LAYERS = [
  'fish-use.geojson',
  'friends-herring-spawning.json',
  'friends-documented-forage-spawning.json',
  'friends-potential-forage-spawning.json',
  'friends-bull-kelp-patches.geojson',
  'friends-deepwater-eelgrass.geojson',
  'friends-shoreline-geology.json',
  'friends-armor.json',
  'friends-docks.geojson',
  'friends-mooring-buoys.json',
  'friends-boat-ramps.json',
  'friends-marine-railway.json',
  'friends-groins.json',
  'friends-pilings.json',
  'friends-projects.geojson',
]
const REPORTS = ['living-with-the-shoreline.html', 'kelp-habitat-value-and-threats.html']

mkdirSync(OUT_DATA, { recursive: true })
for (const f of LAYERS) copyFileSync(join(SSE, 'public/data', f), join(OUT_DATA, f))

mkdirSync(join(OUT_REPORTS, 'shoreline-images'), { recursive: true })
for (const f of readdirSync(join(SSE, 'public/reports/shoreline-images'))) {
  copyFileSync(join(SSE, 'public/reports/shoreline-images', f), join(OUT_REPORTS, 'shoreline-images', f))
}
copyFileSync(join(SSE, 'public/friends-logo-white.webp'), 'public/friends/friends-logo-white.webp')

const HEADER = `<div class="site-header">
  <a href="/shoreline" class="site-header-brand">
    <div class="site-header-titles">
      <div class="site-header-title">Shoreline Explorer</div>
      <div class="site-header-tagline">Friends of the San Juans</div>
    </div>
  </a>
  <div class="site-header-right">
    <a href="https://sanjuans.org" target="_blank" rel="noopener noreferrer"><img src="/friends/friends-logo-white.webp" alt="Friends of the San Juans" class="site-header-logo"></a>
  </div>
</div>`

for (const f of REPORTS) {
  let html = readFileSync(join(SSE, 'public/reports', f), 'utf8')
  const start = html.indexOf('<div class="site-header">')
  // The header ends with the logo <img>, then the closing </div> of site-header-right and of site-header.
  const logo = html.indexOf('class="site-header-logo">', start)
  const end = html.indexOf('</div>', html.indexOf('</div>', logo) + 6) + 6
  if (start < 0 || logo < 0) throw new Error(`${f}: site header not found`)
  html = html.slice(0, start) + HEADER + html.slice(end)
  html = html.replaceAll('src="/friends-logo-white.webp"', 'src="/friends/friends-logo-white.webp"')
    .replace(/<script src="\/reports\/header-menu\.js"><\/script>\s*/g, '')
  if (/salishsea\.knauernever\.com|site-header-dropdown"|header-menu\.js/.test(html.slice(start, start + HEADER.length + 200))) {
    throw new Error(`${f}: leftover SSE header`)
  }
  writeFileSync(join(OUT_REPORTS, f), html)
}
console.log(`copied ${LAYERS.length} layers → ${OUT_DATA}, ${REPORTS.length} handouts → ${OUT_REPORTS}`)
