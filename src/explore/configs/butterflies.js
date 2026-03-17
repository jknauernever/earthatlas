import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META } from '../species-data/butterflies'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'butterflies',
  name: 'Butterflies',
  emoji: '🦋',
  taxonLabel: 'lepidoptera',
  gbifTaxonKey: GBIF_TAXON_KEY,

  theme: {
    glow: '#c47d0e',
    glowDim: 'rgba(196, 125, 14, 0.10)',
    glowMid: 'rgba(196, 125, 14, 0.25)',
  },

  hero: {
    bgColor: '#1a2b0e',
    image: '/butterfly-hero.jpg',
    eyebrow: 'EarthAtlas \u00b7 Lepidoptera Sightings',
    title: ['Find ', 'butterflies.'],
    subtitle: 'Near you, or wherever you\u2019re going.',
    description: "Discover which butterflies and moths have been seen near any location \u2014 and when you\u2019re most likely to see them.",
    accentColor: '#ffd166',
    navAccent: '#f5d06a',
    imageStyle: { backgroundSize: '140%', backgroundPosition: 'center 40%' },
  },

  seo: {
    title: 'Butterfly Sightings Near You',
    description: 'Explore butterfly and moth sightings near any location \u2014 seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',
    image: '/butterfly-hero.jpg',
  },

  defaults: {
    radiusKm: 8.05,
    days: 30,
    maxSightings: 700,
    zoom: 12,
  },

  fallback: {
    commonName: 'Unknown lepidoptera',
    color: '#5a3e28',
    emoji: '🦋',
  },

  loading: {
    emoji: '🦋',
    message: 'Looking for butterflies near {location}\u2026',
    detail: 'Querying global biodiversity records for lepidoptera sightings',
  },

  empty: {
    emoji: '🦋',
    text: 'No sightings found nearby',
    sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different area.',
  },

  inatTaxonId: INAT_TAXON_ID,
  newsQuery: 'butterflies moths pollinators',
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
