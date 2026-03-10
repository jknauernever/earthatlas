/**
 * prebuild-species.js — Fetches species detail data from iNaturalist, Wikipedia,
 * and GBIF for all known species across subsites, and writes preloaded JSON files
 * to src/data/species/ so every user gets instant page loads.
 *
 * Run: node scripts/prebuild-species.js
 * Called automatically as part of `npm run build`.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..', 'src')
const OUT_DIR = join(SRC, 'data', 'species')

mkdirSync(OUT_DIR, { recursive: true })

const INAT_API = 'https://api.inaturalist.org/v1'
const GBIF_API = 'https://api.gbif.org/v1'

// ─── Extract scientific names from all subsite SPECIES_META objects ─────────

function extractScientificNames() {
  const serviceFiles = [
    join(SRC, 'sharks/services/sharks.js'),
    join(SRC, 'whales/services/whales.js'),
    join(SRC, 'butterflies/services/butterflies.js'),
  ]
  const names = new Set()
  for (const f of serviceFiles) {
    if (!existsSync(f)) continue
    const src = readFileSync(f, 'utf-8')
    const re = /scientific:\s*'([^']+)'/g
    let m
    while ((m = re.exec(src)) !== null) {
      const name = m[1].trim()
      // Skip generic/family-level names (single word)
      if (name.includes(' ')) names.add(name)
    }
  }
  return [...names]
}

// ─── iNaturalist: resolve scientific name → taxon ID ───────────────────────

async function resolveInatTaxon(scientificName) {
  const res = await fetch(`${INAT_API}/taxa/autocomplete?q=${encodeURIComponent(scientificName)}&per_page=1`)
  const data = await res.json()
  const t = data.results?.[0]
  if (!t) return null
  // Prefer exact match
  if (t.name === scientificName) return t.id
  return t.id // best guess
}

// ─── Fetch all data for one taxon ──────────────────────────────────────────

async function fetchTaxonData(taxonId) {
  const [taxonRes, seasonRes, recentRes] = await Promise.allSettled([
    fetch(`${INAT_API}/taxa/${taxonId}`).then(r => r.json()),
    fetch(`${INAT_API}/observations/histogram?taxon_id=${taxonId}&date_field=observed&interval=month_of_year`).then(r => r.json()),
    fetch(`${INAT_API}/observations?taxon_id=${taxonId}&per_page=8&order=desc&order_by=observed_on&photos=true&quality_grade=research`).then(r => r.json()),
  ])

  const taxon = taxonRes.status === 'fulfilled' ? taxonRes.value?.results?.[0] : null
  if (!taxon) return null

  // Seasonality
  const monthData = seasonRes.status === 'fulfilled' ? seasonRes.value?.results?.month_of_year : null
  const seasonality = monthData ? Array.from({ length: 12 }, (_, i) => monthData[i + 1] || 0) : null

  // Recent observations
  const recentObs = recentRes.status === 'fulfilled' ? (recentRes.value?.results || []).map(obs => ({
    id: obs.id,
    observed_on: obs.observed_on,
    place_guess: obs.place_guess,
    user_login: obs.user?.login,
    photo_url: obs.photos?.[0]?.url?.replace('square', 'medium') || obs.photos?.[0]?.medium_url || null,
  })) : []

  // Wikipedia
  let wiki = null
  if (taxon.wikipedia_url) {
    const match = taxon.wikipedia_url.match(/\/wiki\/(.+)$/)
    if (match) {
      try {
        const wikiRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(match[1])}`)
        if (wikiRes.ok) wiki = await wikiRes.json()
      } catch {}
    }
  }

  // GBIF points
  let gbifPoints = []
  try {
    const matchRes = await fetch(`${GBIF_API}/species/match?name=${encodeURIComponent(taxon.name)}&strict=true`)
    const matchData = await matchRes.json()
    if (matchData.usageKey) {
      const occRes = await fetch(`${GBIF_API}/occurrence/search?taxonKey=${matchData.usageKey}&hasCoordinate=true&limit=300&hasGeospatialIssue=false`)
      const occData = await occRes.json()
      gbifPoints = (occData.results || [])
        .filter(o => o.decimalLatitude && o.decimalLongitude)
        .map(o => ({ lat: o.decimalLatitude, lng: o.decimalLongitude }))
    }
  } catch {}

  // Slim down the taxon object — only keep what the detail page needs
  return {
    id: taxon.id,
    name: taxon.name,
    preferred_common_name: taxon.preferred_common_name,
    observations_count: taxon.observations_count,
    wikipedia_url: taxon.wikipedia_url,
    wikipedia_summary: taxon.wikipedia_summary,
    default_photo: taxon.default_photo ? {
      medium_url: taxon.default_photo.medium_url,
      original_url: taxon.default_photo.original_url,
      large_url: taxon.default_photo.large_url,
      attribution: taxon.default_photo.attribution,
    } : null,
    taxon_photos: (taxon.taxon_photos || []).slice(0, 12).map(tp => ({
      photo: {
        url: tp.photo?.url,
        medium_url: tp.photo?.medium_url,
        large_url: tp.photo?.large_url,
        original_url: tp.photo?.original_url,
        attribution: tp.photo?.attribution,
      },
    })),
    ancestors: (taxon.ancestors || [])
      .filter(a => ['kingdom','phylum','class','order','family','genus'].includes(a.rank))
      .map(a => ({ id: a.id, name: a.name, rank: a.rank, preferred_common_name: a.preferred_common_name })),
    conservation_statuses: taxon.conservation_statuses || [],
    // Supplementary data
    seasonality,
    recentObs,
    wiki: wiki ? { extract_html: wiki.extract_html, title: wiki.title } : null,
    gbifPoints,
    fetchedAt: new Date().toISOString(),
  }
}

// ─── Rate-limited sequential fetching ──────────────────────────────────────

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const scientificNames = extractScientificNames()
  console.log(`Prebuild species: found ${scientificNames.length} species across subsites`)

  // Resolve all scientific names to iNaturalist taxon IDs
  console.log('Resolving iNaturalist taxon IDs...')
  const taxonMap = [] // { name, inatId }
  for (const name of scientificNames) {
    const id = await resolveInatTaxon(name)
    if (id) taxonMap.push({ name, inatId: id })
    else console.warn(`  Could not resolve: ${name}`)
    await delay(200) // respect iNat rate limit
  }
  console.log(`Resolved ${taxonMap.length}/${scientificNames.length} species`)

  // Write the name→ID index (used by the detail page for fast lookup)
  const indexPath = join(OUT_DIR, '_index.json')
  const index = {}
  for (const { name, inatId } of taxonMap) index[name] = inatId
  writeFileSync(indexPath, JSON.stringify(index, null, 2))
  console.log(`Wrote species index → ${indexPath}`)

  // Fetch full data for each species
  let done = 0
  let failed = 0
  for (const { name, inatId } of taxonMap) {
    const outPath = join(OUT_DIR, `${inatId}.json`)

    // Skip if already fetched recently (within 24h) to speed up repeated builds
    if (existsSync(outPath)) {
      try {
        const existing = JSON.parse(readFileSync(outPath, 'utf-8'))
        const age = Date.now() - new Date(existing.fetchedAt).getTime()
        if (age < 24 * 60 * 60 * 1000) {
          done++
          continue
        }
      } catch {}
    }

    try {
      const data = await fetchTaxonData(inatId)
      if (data) {
        writeFileSync(outPath, JSON.stringify(data))
        done++
        process.stdout.write(`  [${done}/${taxonMap.length}] ${name}\n`)
      } else {
        failed++
        console.warn(`  Failed to fetch: ${name} (${inatId})`)
      }
    } catch (err) {
      failed++
      console.warn(`  Error fetching ${name}: ${err.message}`)
    }
    await delay(500) // pace API requests
  }

  console.log(`Prebuild species: done — ${done} fetched, ${failed} failed`)
}

main().catch(err => {
  console.error('Prebuild species failed:', err)
  // Don't fail the build — the detail page will fall back to live API
  process.exit(0)
})
