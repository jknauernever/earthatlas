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
    title: ['Explore ', 'hippo sightings.'],
    subtitle: 'Across sub-Saharan Africa.',
    description: "Discover where hippos have been sighted \u2014 from river giants in East Africa\u2019s waterways to the elusive pygmy hippo of West Africa.",
    accentColor: '#c4a888',
    navAccent: '#c4a888',
  },

  seo: {
    title: 'Hippo Sightings \u2014 EarthAtlas',
    description: 'Explore hippopotamus sightings and observations across Africa \u2014 seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',
    image: '/hippo-hero.jpg',
  },

  defaults: { radiusKm: 200, days: 90, maxSightings: 500, zoom: 6 },
  fallback: { commonName: 'Unknown hippo', color: '#6a5a4a', emoji: '🦛' },
  loading: { emoji: '🦛', message: 'Searching for hippos near {location}…', detail: 'Querying global biodiversity records for hippo sightings' },
  empty: { emoji: '🦛', text: 'No sightings found nearby', sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different region.' },
  localizable: false,
  hotspots: [
    { name: 'Kruger, South Africa', lat: -23.99, lng: 31.55, emoji: '🇿🇦' },
    { name: 'Okavango Delta, Botswana', lat: -19.50, lng: 22.95, emoji: '🇧🇼' },
    { name: 'Serengeti, Tanzania', lat: -2.33, lng: 34.83, emoji: '🇹🇿' },
    { name: 'Queen Elizabeth NP, Uganda', lat: -0.20, lng: 30.00, emoji: '🇺🇬' },
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
