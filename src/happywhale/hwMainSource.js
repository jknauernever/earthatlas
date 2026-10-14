/**
 * HappyWhale as a source on the main EarthAtlas search (src/App.jsx), next to iNaturalist, eBird and GBIF.
 *
 * Same live API and edge-cached proxy as /happywhale (fetchEncounters). HappyWhale has no species filter and its own
 * speciesKeys, so the visitor's iNaturalist taxon is matched through hwTaxa.json (baked by
 * scripts/happywhale/bake-taxa.mjs: speciesKey → iNat id + ancestors). Rows come back in the iNaturalist-like shape
 * the main search already merges (geojson, taxon, observed_on, photos, source), plus `hw` for the identified whale.
 */
import { fetchEncounters } from './happywhaleService.js'
import HW_TAXA from './hwTaxa.json'

// HappyWhale's own copies on GBIF (via OBIS-SEAMAP) carry this institution code and the HappyWhale encounter id as
// occurrenceID — drop them whenever the live source is loaded so nothing is counted twice.
export const HW_GBIF_INSTITUTION = 'Happywhale.com'

/** Display names for the whale card (HappyWhale speciesKey → common / scientific name). */
export const hwSpeciesName = (key) => HW_TAXA[key]?.name || 'Whale'
export const hwScientificName = (key) => HW_TAXA[key]?.scientific || null

/** HappyWhale speciesKeys under an iNaturalist taxon (the taxon itself, or any of its descendants). */
export function hwSpeciesUnder(inatTaxonId) {
  const id = Number(inatTaxonId)
  if (!Number.isFinite(id)) return new Set()
  const keys = Object.entries(HW_TAXA)
    .filter(([, t]) => t.inatId === id || t.ancestors.includes(id))
    .map(([k]) => k)
  return new Set(keys)
}

// iNaturalist iconic taxa by id (HappyWhale also tracks penguins, sea turtles and sharks, not only mammals).
const ICONIC = [[40151, 'Mammalia'], [3, 'Aves'], [26036, 'Reptilia'], [47178, 'Actinopterygii']]
const iconicFor = (t) => (ICONIC.find(([id]) => t.ancestors.includes(id)) || [0, 'Animalia'])[1]

const havKm = (lat1, lng1, lat2, lng2) => {
  const r = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}

/**
 * HappyWhale encounters for an iNaturalist taxon, in the main search's row shape.
 *   taxonId  iNaturalist taxon the visitor picked (e.g. 152871 Cetaceans)
 *   bounds   {minLat,maxLat,minLng,maxLng} or null for worldwide
 *   d1, d2   'YYYY-MM-DD' (d1 null = all time)
 * Returns { results, total_results, limitExceeded }. Empty when no HappyWhale species falls under the taxon.
 */
export async function fetchHappyWhaleObservations({ taxonId, bounds = null, d1 = null, d2 = null, signal } = {}) {
  const keys = hwSpeciesUnder(taxonId)
  if (!keys.size) return { results: [], total_results: 0, limitExceeded: false }
  // The API searches a circle: the one around the box, then rows are cut back to the box.
  let circle = null
  if (bounds) {
    const lat = (bounds.minLat + bounds.maxLat) / 2
    const lng = (bounds.minLng + bounds.maxLng) / 2
    const radiusKm = Math.max(havKm(lat, lng, bounds.maxLat, bounds.maxLng), havKm(lat, lng, bounds.minLat, bounds.minLng))
    circle = { lat, lng, radiusMeters: Math.ceil(radiusKm * 1000) }
  }
  const from = Date.parse(`${d1 || '1970-01-01'}T00:00:00Z`)
  const to = d2 ? Date.parse(`${d2}T00:00:00Z`) : null
  const { encounters, limitExceeded } = await fetchEncounters({ circle, from, to, signal })
  const inBox = (e) => !bounds || (e.lat >= bounds.minLat && e.lat <= bounds.maxLat && e.lng >= bounds.minLng && e.lng <= bounds.maxLng)
  const results = encounters
    .filter((e) => keys.has(e.speciesKey) && inBox(e))
    .map((e) => {
      const t = HW_TAXA[e.speciesKey]
      const photo = e.media?.url || e.media?.thumbUrl || null
      return {
        id: `hw-${e.id}`,
        source: 'HappyWhale',
        geojson: { coordinates: [e.lng, e.lat] },
        observed_on: e.date,
        place_guess: [e.location, e.region].filter(Boolean).join(', ') || e.region || null,
        taxon: { id: t.inatId, name: t.scientific, preferred_common_name: t.name, iconic_taxon_name: iconicFor(t) },
        photos: photo ? [{ url: photo }] : [],
        hw: {
          encounterId: e.id,
          speciesKey: e.speciesKey,
          individual: e.individual
            ? { id: e.individual.id, nickname: e.individual.nickname, primaryId: e.individual.primaryId }
            : null,
        },
      }
    })
  return { results, total_results: results.length, limitExceeded }
}
