import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META, isSloth } from '../species-data/sloths'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'sloths',
  name: 'Sloths',
  emoji: '🦥',
  taxonLabel: 'sloth',
  gbifTaxonKey: GBIF_TAXON_KEY,

  theme: {
    glow: '#8B7355',
    glowDim: 'rgba(139, 115, 85, 0.10)',
    glowMid: 'rgba(139, 115, 85, 0.25)',
  },

  hero: {
    bgColor: '#1a1c10',
    image: '/sloth-hero.jpg',
    eyebrow: 'EarthAtlas \u00b7 Sloth Sightings',
    title: ['Explore ', 'sloth sightings.'],
    subtitle: 'Across Central & South America.',
    description: "Discover where sloths have been spotted in the wild \u2014 from the cloud forests of Costa Rica to the Amazon basin. Six species, two families, one impossibly slow lifestyle.",
    accentColor: '#a8c686',
    navAccent: '#a8c686',
  },

  seo: {
    title: 'Sloth Sightings \u2014 EarthAtlas',
    description: 'Explore sloth sightings across Central and South America \u2014 seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',
    image: '/sloth-hero.jpg',
  },

  defaults: {
    radiusKm: 100,
    days: 90,
    maxSightings: 500,
    zoom: 7,
  },

  fallback: {
    commonName: 'Unknown sloth',
    color: '#8B7355',
    emoji: '🦥',
  },

  loading: {
    emoji: '🦥',
    message: 'Searching for sloths near {location}\u2026',
    detail: 'Querying global biodiversity records for sloth sightings',
  },

  empty: {
    emoji: '🦥',
    text: 'No sightings found nearby',
    sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different region.',
  },

  localizable: false,
  hotspots: [
    { name: 'Manuel Antonio, Costa Rica', lat: 9.39, lng: -84.14, emoji: '🇨🇷' },
    { name: 'Bocas del Toro, Panama', lat: 9.34, lng: -82.24, emoji: '🇵🇦' },
    { name: 'Manaus, Brazil', lat: -3.12, lng: -60.02, emoji: '🇧🇷' },
    { name: 'Suriname', lat: 5.85, lng: -55.20, emoji: '🇸🇷' },
    { name: 'Iquitos, Peru', lat: -3.75, lng: -73.25, emoji: '🇵🇪' },
  ],
  heatmapLayers: null,
  postFilter: isSloth,
}

config.service = createExploreService({
  gbifTaxonKey: GBIF_TAXON_KEY,
  inatTaxonId: INAT_TAXON_ID,
  speciesMeta: SPECIES_META,
  fallback: config.fallback,
  postFilter: isSloth,
})

export default config
