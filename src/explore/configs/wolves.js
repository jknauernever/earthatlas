import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META } from '../species-data/wolves'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'wolves',
  name: 'Wolves',
  emoji: '🐺',
  taxonLabel: 'wolf',
  gbifTaxonKey: GBIF_TAXON_KEY,

  theme: {
    glow: '#5a5a6a',
    glowDim: 'rgba(90, 90, 106, 0.10)',
    glowMid: 'rgba(90, 90, 106, 0.25)',
  },

  hero: {
    bgColor: '#101018',
    image: '/wolf-hero.jpg',
    eyebrow: 'EarthAtlas · Wolf Sightings',
    title: ['Find ', 'wolves.'],
    subtitle: 'Near you, or wherever you\'re going.',
    description: "Discover where wolves and wild canids have been sighted — from gray wolves to African wild dogs.",
    accentColor: '#a0a0b8',
    navAccent: '#a0a0b8',
  },

  seo: {
    title: 'Wolf Sightings Near You',
    description: 'Find wolf sightings and observations — seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',
    image: '/wolf-hero.jpg',
  },

  defaults: { radiusKm: 300, days: 90, maxSightings: 500, zoom: 6 },
  fallback: { commonName: 'Unknown canid', color: '#5a5a6a', emoji: '🐺' },
  loading: { emoji: '🐺', message: 'Searching for wolves near {location}…', detail: 'Querying global biodiversity records for wolf and wild canid sightings' },
  empty: { emoji: '🐺', text: 'No sightings found nearby', sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different region.' },
  inatTaxonId: INAT_TAXON_ID,
  newsQuery: 'wolves wildlife conservation',
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
