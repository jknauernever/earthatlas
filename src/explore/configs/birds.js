import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META } from '../species-data/birds'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'birds',
  name: 'Birds',
  emoji: '🐦',
  taxonLabel: 'bird',
  gbifTaxonKey: null,  // birds are too ubiquitous — density heatmap covers entire map

  theme: {
    glow: '#2e86c1',
    glowDim: 'rgba(46, 134, 193, 0.10)',
    glowMid: 'rgba(46, 134, 193, 0.25)',
  },

  hero: {
    bgColor: '#0c1e2e',
    image: '/bird-hero.jpg',
    eyebrow: 'EarthAtlas · Bird Sightings',
    title: ['Explore ', 'birds.'],
    subtitle: 'Wings across every continent.',
    description: "Discover wild bird sightings from majestic eagles to tiny hummingbirds — over 10,000 species span every habitat on Earth. Birds are the most visible barometer of our planet's health.",
    accentColor: '#5dade2',
    navAccent: '#5dade2',
  },

  seo: {
    title: 'Bird Sightings — EarthAtlas',
    description: 'Explore bird sightings worldwide — seasonal migration patterns, species data, and real-time observations from GBIF and iNaturalist.',
    image: '/bird-hero.jpg',
  },

  defaults: {
    radiusKm: 100,
    days: 90,
    maxSightings: 1500,
    zoom: 9.5,
  },

  fallback: {
    commonName: 'Unknown bird',
    color: '#2e86c1',
    emoji: '🐦',
  },

  loading: {
    emoji: '🐦',
    message: 'Searching for birds near {location}…',
    detail: 'Querying global biodiversity records for bird observations',
  },

  empty: {
    emoji: '🐦',
    text: 'No sightings found nearby',
    sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different region.',
  },

  localizable: true,
  hotspots: [
    { name: 'Central Park, New York', lat: 40.78, lng: -73.97, emoji: '🇺🇸' },
    { name: 'Costa Rica', lat: 10.00, lng: -84.00, emoji: '🇨🇷' },
    { name: 'Kruger National Park, South Africa', lat: -24.00, lng: 31.50, emoji: '🇿🇦' },
    { name: 'Cairns, Australia', lat: -16.92, lng: 145.77, emoji: '🇦🇺' },
    { name: 'Bharatpur, India', lat: 27.19, lng: 77.52, emoji: '🇮🇳' },
  ],
  inatTaxonId: INAT_TAXON_ID,
  newsQuery: 'birds wildlife birding',
  postFilter: null,
}

config.service = createExploreService({
  gbifTaxonKey: GBIF_TAXON_KEY,
  inatTaxonId: INAT_TAXON_ID,
  speciesMeta: SPECIES_META,
  fallback: config.fallback,
  postFilter: null,
  useEBird: true,
})

export default config
