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
    title: ['Explore ', 'lion sightings.'],
    subtitle: 'Across Africa and India.',
    description: "Discover where lions have been sighted — from the Serengeti and Kruger to the last Asiatic lions in India\u2019s Gir Forest.",
    accentColor: '#f0d56e',
    navAccent: '#f0d56e',
  },

  seo: {
    title: 'Lion Sightings \u2014 EarthAtlas',
    description: 'Explore lion sightings and observations across Africa and India \u2014 seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',
    image: '/lion-hero.jpg',
  },

  defaults: { radiusKm: 300, days: 90, maxSightings: 500, zoom: 6 },
  fallback: { commonName: 'Unknown lion', color: '#c9a33c', emoji: '🦁' },
  loading: { emoji: '🦁', message: 'Searching for lions near {location}…', detail: 'Querying global biodiversity records for lion sightings' },
  empty: { emoji: '🦁', text: 'No sightings found nearby', sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different region.' },
  localizable: false,
  hotspots: [
    { name: 'Serengeti, Tanzania', lat: -2.33, lng: 34.83, emoji: '🇹🇿' },
    { name: 'Kruger, South Africa', lat: -23.99, lng: 31.55, emoji: '🇿🇦' },
    { name: 'Masai Mara, Kenya', lat: -1.50, lng: 35.14, emoji: '🇰🇪' },
    { name: 'Gir Forest, India', lat: 21.12, lng: 70.79, emoji: '🇮🇳' },
  ],
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
