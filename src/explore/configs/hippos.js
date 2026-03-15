import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META } from '../species-data/hippos'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'hippos',
  name: 'Hippos',
  emoji: '🦛',
  taxonLabel: 'hippo',
  gbifTaxonKey: GBIF_TAXON_KEY,

  theme: {
    glow: '#6a5a4a',
    glowDim: 'rgba(106, 90, 74, 0.10)',
    glowMid: 'rgba(106, 90, 74, 0.25)',
  },

  hero: {
    bgColor: '#1a1510',
    image: '/hippo-hero.jpg',
    eyebrow: 'EarthAtlas · Hippo Sightings',
    title: ['Find ', 'hippos.'],
    subtitle: 'Near you, or wherever you\'re going.',
    description: "Discover where hippos have been sighted across Africa — from river giants to the elusive pygmy hippo.",
    accentColor: '#c4a888',
    navAccent: '#c4a888',
  },

  seo: {
    title: 'Hippo Sightings Near You',
    description: 'Find hippopotamus sightings and observations — seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',
    image: '/hippo-hero.jpg',
  },

  defaults: { radiusKm: 200, days: 90, maxSightings: 500, zoom: 6 },
  fallback: { commonName: 'Unknown hippo', color: '#6a5a4a', emoji: '🦛' },
  loading: { emoji: '🦛', message: 'Searching for hippos near {location}…', detail: 'Querying global biodiversity records for hippo sightings' },
  empty: { emoji: '🦛', text: 'No sightings found nearby', sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different region.' },
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
