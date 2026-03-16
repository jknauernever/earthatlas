import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META } from '../species-data/bears'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'bears',
  name: 'Bears',
  emoji: '🐻',
  taxonLabel: 'bear',
  gbifTaxonKey: GBIF_TAXON_KEY,

  theme: {
    glow: '#6b4226',
    glowDim: 'rgba(107, 66, 38, 0.10)',
    glowMid: 'rgba(107, 66, 38, 0.25)',
  },

  hero: {
    bgColor: '#1a1008',
    image: '/bear-hero.jpg',
    eyebrow: 'EarthAtlas · Bear Sightings',
    title: ['Find ', 'bears.'],
    subtitle: 'Near you, or wherever you\'re going.',
    description: "Discover where bears have been sighted around the world — from grizzlies to polar bears to pandas.",
    accentColor: '#d4a76a',
    navAccent: '#d4a76a',
  },

  seo: {
    title: 'Bear Sightings Near You',
    description: 'Find bear sightings and observations — seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',
    image: '/bear-hero.jpg',
  },

  defaults: { radiusKm: 200, days: 90, maxSightings: 500, zoom: 6 },
  fallback: { commonName: 'Unknown bear', color: '#6b4226', emoji: '🐻' },
  loading: { emoji: '🐻', message: 'Searching for bears near {location}…', detail: 'Querying global biodiversity records for bear sightings' },
  empty: { emoji: '🐻', text: 'No sightings found nearby', sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different region.' },
  postFilter: null,
}

config.service = createExploreService({
  gbifTaxonKey: GBIF_TAXON_KEY,
  inatTaxonId: INAT_TAXON_ID,
  speciesMeta: SPECIES_META,
  fallback: config.fallback,
  postFilter: null,
})

export default config
