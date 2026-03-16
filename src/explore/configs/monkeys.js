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
    title: ['Explore ', 'primate sightings.'],
    subtitle: 'Across the tropics and beyond.',
    description: "Discover which monkeys, apes, and lemurs have been spotted \u2014 from Borneo\u2019s orangutans to Madagascar\u2019s lemurs and the howler monkeys of Central America.",
    accentColor: '#c4a86a',
    navAccent: '#c4a86a',
  },

  seo: {
    title: 'Primate Sightings \u2014 EarthAtlas',
    description: 'Explore primate sightings and observations \u2014 from chimpanzees to macaques. Seasonal patterns and real-time data from GBIF and iNaturalist.',
    image: '/monkey-hero.jpg',
  },

  defaults: { radiusKm: 200, days: 90, maxSightings: 500, zoom: 6 },
  fallback: { commonName: 'Unknown primate', color: '#5a4a2a', emoji: '🐒' },
  loading: { emoji: '🐒', message: 'Searching for primates near {location}…', detail: 'Querying global biodiversity records for primate sightings' },
  empty: { emoji: '🐒', text: 'No sightings found nearby', sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different region.' },
  localizable: false,
  hotspots: [
    { name: 'Borneo, Malaysia', lat: 1.55, lng: 110.35, emoji: '🇲🇾' },
    { name: 'Madagascar', lat: -18.77, lng: 46.87, emoji: '🇲🇬' },
    { name: 'Costa Rica', lat: 10.28, lng: -84.09, emoji: '🇨🇷' },
    { name: 'Kibale, Uganda', lat: 0.49, lng: 30.36, emoji: '🇺🇬' },
  ],
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
