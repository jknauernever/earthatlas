/**
 * prebuild-stats.js — Fetches default dashboard stats from iNaturalist, eBird,
 * and GBIF APIs and writes them to src/data/preloaded-stats.json so components
 * can render instantly without waiting for API calls on first load.
 *
 * Run: node scripts/prebuild-stats.js
 * Called automatically before `vite build` via package.json build script.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'src', 'data')
const OUT_PATH = join(OUT_DIR, 'preloaded-stats.json')

// Ensure src/data/ directory exists (won't exist on fresh clone)
mkdirSync(OUT_DIR, { recursive: true })

const EBIRD_API_KEY = process.env.VITE_EBIRD_API_KEY || ''

// ─── iNaturalist ────────────────────────────────────────────────────────────

async function fetchINatGlobalCounts() {
  const d90 = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]
  const [obs, species, research, observers] = await Promise.all([
    fetch('https://api.inaturalist.org/v1/observations?per_page=0').then(r => r.json()),
    fetch('https://api.inaturalist.org/v1/observations/species_counts?per_page=0').then(r => r.json()),
    fetch('https://api.inaturalist.org/v1/observations?quality_grade=research&per_page=0').then(r => r.json()),
    fetch(`https://api.inaturalist.org/v1/observations/observers?d1=${d90}&per_page=0`).then(r => r.json()),
  ])
  return {
    totalObs: obs.total_results,
    totalSpecies: species.total_results,
    researchGrade: research.total_results,
    activeObservers: observers.total_results,
  }
}

async function fetchINatTopSpecies() {
  // Default view is 24h — fetch without date range for "all time" default,
  // but the component defaults to 24h. We'll fetch 24h.
  const now = new Date()
  const d2 = localDate(now)
  const d1 = localDate(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  const res = await fetch(
    `https://api.inaturalist.org/v1/observations/species_counts?per_page=8&d1=${d1}&d2=${d2}`
  ).then(r => r.json())
  return res.results || []
}

const INAT_COUNTRIES = [
  { placeId: 1, name: 'United States', flag: '🇺🇸' },
  { placeId: 6712, name: 'Canada', flag: '🇨🇦' },
  { placeId: 6744, name: 'Australia', flag: '🇦🇺' },
  { placeId: 6843, name: 'Russia', flag: '🇷🇺' },
  { placeId: 6793, name: 'Mexico', flag: '🇲🇽' },
  { placeId: 6857, name: 'United Kingdom', flag: '🇬🇧' },
  { placeId: 113055, name: 'South Africa', flag: '🇿🇦' },
  { placeId: 7207, name: 'Germany', flag: '🇩🇪' },
  { placeId: 6681, name: 'India', flag: '🇮🇳' },
  { placeId: 8057, name: 'Brazil', flag: '🇧🇷' },
  { placeId: 6803, name: 'New Zealand', flag: '🇳🇿' },
  { placeId: 6753, name: 'France', flag: '🇫🇷' },
  { placeId: 6860, name: 'Spain', flag: '🇪🇸' },
  { placeId: 7161, name: 'Italy', flag: '🇮🇹' },
  { placeId: 6737, name: 'Japan', flag: '🇯🇵' },
]

async function fetchINatTopCountries() {
  const now = new Date()
  const d2 = localDate(now)
  const d1 = localDate(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  const results = await Promise.all(
    INAT_COUNTRIES.map(async c => {
      const res = await fetch(
        `https://api.inaturalist.org/v1/observations?place_id=${c.placeId}&per_page=0&d1=${d1}&d2=${d2}`
      ).then(r => r.json())
      return { ...c, count: res.total_results || 0 }
    })
  )
  return results.sort((a, b) => b.count - a.count).slice(0, 10)
}

// ─── eBird ──────────────────────────────────────────────────────────────────

const EBIRD_REGIONS = [
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
  { code: 'CR', name: 'Costa Rica', flag: '🇨🇷' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
]

async function fetchEBirdStats() {
  // Default is "yesterday"
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const y = yesterday.getFullYear()
  const m = yesterday.getMonth() + 1
  const d = yesterday.getDate()

  const regions = await Promise.all(
    EBIRD_REGIONS.map(async r => {
      try {
        const res = await fetch(
          `https://api.ebird.org/v2/product/stats/${r.code}/${y}/${m}/${d}`,
          { headers: { 'x-ebirdapitoken': EBIRD_API_KEY } }
        ).then(res => res.json())
        return { ...r, numChecklists: res.numChecklists || 0, numSpecies: res.numSpecies || 0, numContributors: res.numContributors || 0 }
      } catch {
        return { ...r, numChecklists: 0, numSpecies: 0, numContributors: 0 }
      }
    })
  )

  const sorted = regions.sort((a, b) => b.numChecklists - a.numChecklists)
  return {
    regions: sorted,
    totalChecklists: sorted.reduce((s, r) => s + r.numChecklists, 0),
    totalContributors: sorted.reduce((s, r) => s + r.numContributors, 0),
    totalSpecies: sorted.reduce((s, r) => s + r.numSpecies, 0),
  }
}

// ─── GBIF ───────────────────────────────────────────────────────────────────

async function fetchGBIFGlobalStats() {
  const [totalOccurrences, speciesRes, datasetRes] = await Promise.all([
    fetch('https://api.gbif.org/v1/occurrence/count').then(r => r.text()).then(Number),
    fetch('https://api.gbif.org/v1/species/search?limit=0&rank=SPECIES&status=ACCEPTED').then(r => r.json()),
    fetch('https://api.gbif.org/v1/dataset/search?limit=0').then(r => r.json()),
  ])
  return {
    totalOccurrences,
    totalSpecies: speciesRes.count,
    totalDatasets: datasetRes.count,
  }
}

const COUNTRY_NAMES = {
  US: 'United States', GB: 'United Kingdom', AU: 'Australia', SE: 'Sweden',
  CA: 'Canada', FR: 'France', DE: 'Germany', NO: 'Norway', MX: 'Mexico',
  FI: 'Finland', ES: 'Spain', NL: 'Netherlands', BR: 'Brazil', IN: 'India',
  DK: 'Denmark', NZ: 'New Zealand', JP: 'Japan', ZA: 'South Africa',
  CO: 'Colombia', BE: 'Belgium', IT: 'Italy', PT: 'Portugal', AR: 'Argentina',
  CN: 'China', TW: 'Taiwan', CR: 'Costa Rica', CL: 'Chile', PE: 'Peru',
  AT: 'Austria', CH: 'Switzerland',
}

const COUNTRY_FLAGS = {
  US: '🇺🇸', GB: '🇬🇧', AU: '🇦🇺', SE: '🇸🇪', CA: '🇨🇦', FR: '🇫🇷', DE: '🇩🇪',
  NO: '🇳🇴', MX: '🇲🇽', FI: '🇫🇮', ES: '🇪🇸', NL: '🇳🇱', BR: '🇧🇷', IN: '🇮🇳',
  DK: '🇩🇰', NZ: '🇳🇿', JP: '🇯🇵', ZA: '🇿🇦', CO: '🇨🇴', BE: '🇧🇪', IT: '🇮🇹',
  PT: '🇵🇹', AR: '🇦🇷', CN: '🇨🇳', TW: '🇹🇼', CR: '🇨🇷', CL: '🇨🇱', PE: '🇵🇪',
  AT: '🇦🇹', CH: '🇨🇭',
}

async function fetchGBIFTopCountries() {
  const data = await fetch('https://api.gbif.org/v1/occurrence/counts/countries').then(r => r.json())
  return Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([code, count]) => ({
      code,
      name: COUNTRY_NAMES[code] || code,
      flag: COUNTRY_FLAGS[code] || '',
      count,
    }))
}

const KINGDOMS = [
  { key: 1, name: 'Animalia', emoji: '🐾' },
  { key: 6, name: 'Plantae', emoji: '🌿' },
  { key: 3, name: 'Bacteria', emoji: '🦠' },
  { key: 5, name: 'Fungi', emoji: '🍄' },
  { key: 4, name: 'Chromista', emoji: '🔬' },
]

async function fetchGBIFKingdomCounts() {
  const results = await Promise.all(
    KINGDOMS.map(async k => {
      const res = await fetch(
        `https://api.gbif.org/v1/occurrence/search?limit=0&taxonKey=${k.key}`
      ).then(r => r.json())
      return { ...k, count: res.count || 0 }
    })
  )
  return results.sort((a, b) => b.count - a.count)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function localDate(d) {
  return d.toISOString().split('T')[0]
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('Prebuild: fetching stats from iNaturalist, eBird, GBIF...')
  const start = Date.now()

  // Fetch all in parallel
  const [inatCounts, inatSpecies, inatCountries, ebirdStats, gbifStats, gbifCountries, gbifKingdoms] =
    await Promise.all([
      fetchINatGlobalCounts().catch(err => { console.warn('iNat counts failed:', err.message); return null }),
      fetchINatTopSpecies().catch(err => { console.warn('iNat species failed:', err.message); return null }),
      fetchINatTopCountries().catch(err => { console.warn('iNat countries failed:', err.message); return null }),
      fetchEBirdStats().catch(err => { console.warn('eBird stats failed:', err.message); return null }),
      fetchGBIFGlobalStats().catch(err => { console.warn('GBIF stats failed:', err.message); return null }),
      fetchGBIFTopCountries().catch(err => { console.warn('GBIF countries failed:', err.message); return null }),
      fetchGBIFKingdomCounts().catch(err => { console.warn('GBIF kingdoms failed:', err.message); return null }),
    ])

  // Aggregated "All" view counts — GBIF occurrences + iNat species/observers
  const allCounts = (gbifStats || inatCounts) ? {
    totalObs: gbifStats?.totalOccurrences || 0,
    totalSpecies: inatCounts?.totalSpecies || 0,
    activeObservers: inatCounts?.activeObservers || 0,
  } : null

  const output = {
    fetchedAt: new Date().toISOString(),
    allCounts,
    iNaturalist: {
      counts: inatCounts,
      topSpecies: inatSpecies,
      topCountries: inatCountries,
    },
    eBird: {
      dashStats: ebirdStats,
    },
    GBIF: {
      stats: gbifStats,
      countries: gbifCountries,
      kingdoms: gbifKingdoms,
    },
  }

  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2))
  console.log(`Prebuild: done in ${((Date.now() - start) / 1000).toFixed(1)}s → ${OUT_PATH}`)
}

main().catch(err => {
  console.error('Prebuild failed:', err)
  // Write empty fallback so build doesn't break
  writeFileSync(OUT_PATH, JSON.stringify({ fetchedAt: null, allCounts: null, iNaturalist: {}, eBird: {}, GBIF: {} }))
  process.exit(0) // don't fail the build
})
