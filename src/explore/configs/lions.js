import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META } from '../species-data/lions'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'lions',
  name: 'Lions',
  emoji: '🦁',
  taxonLabel: 'lion',
  gbifTaxonKey: GBIF_TAXON_KEY,

  theme: {
    glow: '#c9a33c',
    glowDim: 'rgba(201, 163, 60, 0.10)',
    glowMid: 'rgba(201, 163, 60, 0.25)',
  },

  hero: {
    bgColor: '#1a1200',
    image: '/lion-hero.jpg',
    eyebrow: 'EarthAtlas · Lion Sightings',
    title: ['Find ', 'lions.'],
    subtitle: 'Near you, or wherever you\'re going.',
    description: "Discover where lions have been sighted across Africa and Asia — and when you're most likely to see them.",
    accentColor: '#f0d56e',
    navAccent: '#f0d56e',
  },

  seo: {
    title: 'Lion Sightings Near You',
    description: 'Find lion sightings and observations — seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',
    image: '/lion-hero.jpg',
  },

  defaults: { radiusKm: 300, days: 90, maxSightings: 500, zoom: 6 },
  fallback: { commonName: 'Unknown lion', color: '#c9a33c', emoji: '🦁' },
  loading: { emoji: '🦁', message: 'Searching for lions near {location}…', detail: 'Querying global biodiversity records for lion sightings' },
  empty: { emoji: '🦁', text: 'No sightings found nearby', sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different region.' },
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
