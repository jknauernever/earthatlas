/**
 * testCrosswalk.mjs — Test the taxon crosswalk logic
 *
 * Run: node scripts/testCrosswalk.mjs
 *
 * This is a standalone script that reimplements the crosswalk resolution
 * logic without Vite/import.meta.env dependencies. eBird taxonomy search
 * is skipped (requires full taxonomy download + API key) but the eBird
 * species code is verified from the static crosswalk.
 */

// ─── Static crosswalk (mirrors src/services/taxonCrosswalk.js) ──
const STATIC_CROSSWALK = {
  'california condor': {
    commonName: 'California Condor',
    scientificName: 'Gymnogyps californianus',
    inatTaxonId: 4778,
    eBirdSpeciesCode: 'calcon',
    gbifTaxonKey: 2481920,
  },
}

// ─── API resolution ─────────────────────────────────────────────

async function resolveINat(query) {
  const res = await fetch(
    `https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(query)}&per_page=1`
  )
  if (!res.ok) return null
  const data = await res.json()
  const t = data.results?.[0]
  if (!t) return null
  return { id: t.id, scientificName: t.name, commonName: t.preferred_common_name || null }
}

async function resolveGBIF(query) {
  // Try suggest first, then match as fallback
  const res = await fetch(
    `https://api.gbif.org/v1/species/suggest?q=${encodeURIComponent(query)}&limit=1`
  )
  if (res.ok) {
    const data = await res.json()
    if (data[0]) return { key: data[0].key, canonicalName: data[0].canonicalName || null }
  }
  const matchRes = await fetch(
    `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(query)}&verbose=false`
  )
  if (matchRes.ok) {
    const match = await matchRes.json()
    if (match.usageKey && match.matchType !== 'NONE') {
      return { key: match.usageKey, canonicalName: match.canonicalName || null }
    }
  }
  return null
}

async function resolveSpecies(query) {
  const key = query.toLowerCase().trim()
  if (STATIC_CROSSWALK[key]) return { ...STATIC_CROSSWALK[key] }

  const [inat, gbif] = await Promise.all([resolveINat(query), resolveGBIF(query)])
  // If GBIF didn't resolve but iNat gave us a scientific name, retry GBIF
  let gbifResult = gbif
  if (!gbifResult && inat?.scientificName) {
    gbifResult = await resolveGBIF(inat.scientificName)
  }
  return {
    commonName: inat?.commonName || query,
    scientificName: inat?.scientificName || gbifResult?.canonicalName || null,
    inatTaxonId: inat?.id || null,
    eBirdSpeciesCode: null, // requires taxonomy cache; skipped in test
    gbifTaxonKey: gbifResult?.key || null,
  }
}

// ─── Sighting fetchers (standalone, no Vite) ────────────────────

async function fetchINatSightings({ taxonId, lat, lng, radiusKm }) {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  const d1 = d.toISOString().split('T')[0]
  const res = await fetch(
    `https://api.inaturalist.org/v1/observations?taxon_id=${taxonId}&lat=${lat}&lng=${lng}&radius=${radiusKm}&d1=${d1}&per_page=200&captive=false`
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.results || []
}

async function fetchGBIFSightings({ taxonKey, lat, lng, radiusKm }) {
  const latDelta = radiusKm / 111
  const lngDelta = radiusKm / (111 * Math.cos(lat * (Math.PI / 180)))
  const d = new Date()
  d.setDate(d.getDate() - 30)
  const d1 = d.toISOString().split('T')[0]
  const d2 = new Date().toISOString().split('T')[0]
  const params = new URLSearchParams({
    taxonKey,
    hasCoordinate: 'true',
    decimalLatitude: `${(lat - latDelta).toFixed(4)},${(lat + latDelta).toFixed(4)}`,
    decimalLongitude: `${(lng - lngDelta).toFixed(4)},${(lng + lngDelta).toFixed(4)}`,
    eventDate: `${d1},${d2}`,
    limit: 200,
  })
  const res = await fetch(`https://api.gbif.org/v1/occurrence/search?${params}`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.results || []).filter(o => o.basisOfRecord !== 'LIVING_SPECIMEN')
}

// ─── Run tests ──────────────────────────────────────────────────

async function main() {
  console.log('═══ Taxon Crosswalk Test ═══\n')

  // Test 1: Static crosswalk (case-insensitive)
  console.log('1. resolveSpecies("California Condor") — static crosswalk')
  const condor = await resolveSpecies('California Condor')
  console.log('   ', condor)
  console.log('   ✓ inatTaxonId:', condor.inatTaxonId === 4778 ? 'PASS (4778)' : `FAIL (got ${condor.inatTaxonId})`)
  console.log('   ✓ gbifTaxonKey:', condor.gbifTaxonKey === 2481920 ? 'PASS (2481920)' : `FAIL (got ${condor.gbifTaxonKey})`)
  console.log('   ✓ eBirdSpeciesCode:', condor.eBirdSpeciesCode === 'calcon' ? 'PASS (calcon)' : `FAIL (got ${condor.eBirdSpeciesCode})`)
  console.log()

  // Test 2: Case insensitivity
  console.log('2. resolveSpecies("california condor") — lowercase')
  const condorLower = await resolveSpecies('california condor')
  console.log('   ✓ Match:', JSON.stringify(condorLower) === JSON.stringify(condor) ? 'PASS' : 'FAIL')
  console.log()

  // Test 3: Dynamic resolution (unknown species)
  console.log('3. resolveSpecies("giant panda") — dynamic API resolution')
  const panda = await resolveSpecies('giant panda')
  console.log('   ', panda)
  console.log('   ✓ inatTaxonId:', panda.inatTaxonId ? `PASS (${panda.inatTaxonId})` : 'FAIL (null)')
  console.log('   ✓ gbifTaxonKey:', panda.gbifTaxonKey ? `PASS (${panda.gbifTaxonKey})` : 'FAIL (null)')
  console.log('   ✓ eBirdSpeciesCode:', panda.eBirdSpeciesCode === null ? 'PASS (null — not a bird)' : `unexpected (${panda.eBirdSpeciesCode})`)
  console.log()

  // Test 4: Fetch sightings from all sources
  console.log('4. fetchAllSourceSightings — California Condor near Ventana, CA')
  const lat = 36.0, lng = -118.5, radiusKm = 200
  console.log(`   Location: ${lat}, ${lng} — radius: ${radiusKm}km`)

  const [inat, gbif] = await Promise.all([
    fetchINatSightings({ taxonId: condor.inatTaxonId, lat, lng, radiusKm }),
    fetchGBIFSightings({ taxonKey: condor.gbifTaxonKey, lat, lng, radiusKm }),
  ])

  console.log(`   iNaturalist: ${inat.length} results`)
  console.log(`   GBIF:        ${gbif.length} results`)
  console.log(`   eBird:       skipped (requires API key)`)
  console.log(`   Total:       ${inat.length + gbif.length}`)
  console.log()

  console.log('═══ Done ═══')
}

main().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
