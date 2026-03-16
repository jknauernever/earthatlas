import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META } from '../species-data/fungi'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'fungi',
  name: 'Fungi',
  emoji: '🍄',
  taxonLabel: 'fungus',
  gbifTaxonKey: GBIF_TAXON_KEY,

  theme: {
    glow: '#8b4513',
    glowDim: 'rgba(139, 69, 19, 0.10)',
    glowMid: 'rgba(139, 69, 19, 0.25)',
  },

  hero: {
    bgColor: '#1a0e08',
    image: '/fungi-hero.jpg',
    eyebrow: 'EarthAtlas \u00b7 Fungi Sightings',
    title: ['Explore ', 'fungi.'],
    subtitle: 'The hidden kingdom beneath your feet.',
    description: "Discover mushrooms, bracket fungi, and other fruiting bodies spotted in the wild \u2014 from iconic fly agarics to prized chanterelles. The fungal kingdom connects every forest on Earth.",
    accentColor: '#e0a050',
    navAccent: '#e0a050',
  },

  seo: {
    title: 'Fungi Sightings \u2014 EarthAtlas',
    description: 'Explore fungi and mushroom sightings worldwide \u2014 seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',
    image: '/fungi-hero.jpg',
  },

  defaults: {
    radiusKm: 100,
    days: 90,
    maxSightings: 500,
    zoom: 9.5,
  },

  fallback: {
    commonName: 'Unknown fungus',
    color: '#8b4513',
    emoji: '🍄',
  },

  loading: {
    emoji: '🍄',
    message: 'Searching for fungi near {location}\u2026',
    detail: 'Querying global biodiversity records for fungal observations',
  },

  empty: {
    emoji: '🍄',
    text: 'No sightings found nearby',
    sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different region.',
  },

  localizable: true,
  hotspots: [
    { name: 'Olympic National Park, USA', lat: 47.80, lng: -123.60, emoji: '🇺🇸' },
    { name: 'Black Forest, Germany', lat: 48.30, lng: 8.15, emoji: '🇩🇪' },
    { name: 'Yunnan, China', lat: 25.05, lng: 102.70, emoji: '🇨🇳' },
    { name: 'Hokkaido, Japan', lat: 43.06, lng: 141.35, emoji: '🇯🇵' },
    { name: 'Tasmania, Australia', lat: -42.00, lng: 146.50, emoji: '🇦🇺' },
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
