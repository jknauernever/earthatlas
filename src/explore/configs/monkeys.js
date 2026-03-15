import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META } from '../species-data/monkeys'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'monkeys',
  name: 'Monkeys & Primates',
  emoji: '🐒',
  taxonLabel: 'primate',
  gbifTaxonKey: GBIF_TAXON_KEY,

  theme: {
    glow: '#5a4a2a',
    glowDim: 'rgba(90, 74, 42, 0.10)',
    glowMid: 'rgba(90, 74, 42, 0.25)',
  },

  hero: {
    bgColor: '#1a1508',
    image: '/monkey-hero.jpg',
    eyebrow: 'EarthAtlas · Primate Sightings',
    title: ['Find ', 'primates.'],
    subtitle: 'Near you, or wherever you\'re going.',
    description: "Discover which monkeys, apes, and lemurs have been spotted near any location — and when you're most likely to see them.",
    accentColor: '#c4a86a',
    navAccent: '#c4a86a',
  },

  seo: {
    title: 'Monkey & Primate Sightings Near You',
    description: 'Find primate sightings and observations — from chimpanzees to macaques. Seasonal patterns and real-time data from GBIF and iNaturalist.',
    image: '/monkey-hero.jpg',
  },

  defaults: { radiusKm: 200, days: 90, maxSightings: 500, zoom: 6 },
  fallback: { commonName: 'Unknown primate', color: '#5a4a2a', emoji: '🐒' },
  loading: { emoji: '🐒', message: 'Searching for primates near {location}…', detail: 'Querying global biodiversity records for primate sightings' },
  empty: { emoji: '🐒', text: 'No sightings found nearby', sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different region.' },
  heatmapLayers: null,
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
