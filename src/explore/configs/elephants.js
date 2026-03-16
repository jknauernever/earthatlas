import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META } from '../species-data/elephants'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'elephants',
  name: 'Elephants',
  emoji: '🐘',
  taxonLabel: 'elephant',
  gbifTaxonKey: GBIF_TAXON_KEY,

  theme: {
    glow: '#5a6e3e',
    glowDim: 'rgba(90, 110, 62, 0.10)',
    glowMid: 'rgba(90, 110, 62, 0.25)',
  },

  hero: {
    bgColor: '#1a1a0e',
    image: '/elephant-hero.jpg',
    eyebrow: 'EarthAtlas · Elephant Sightings',
    title: ['Explore ', 'elephant sightings.'],
    subtitle: 'Across Africa and Asia.',
    description: "Discover where elephants have been sighted \u2014 from the savannas of East Africa to the forests of Sri Lanka and Borneo.",
    accentColor: '#a8c97e',
    navAccent: '#a8c97e',
  },

  seo: {
    title: 'Elephant Sightings \u2014 EarthAtlas',
    description: 'Explore elephant sightings and observations across Africa and Asia \u2014 seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',
    image: '/elephant-hero.jpg',
  },

  defaults: { radiusKm: 200, days: 90, maxSightings: 500, zoom: 6 },
  fallback: { commonName: 'Unknown elephant', color: '#5a6e3e', emoji: '🐘' },
  loading: { emoji: '🐘', message: 'Searching for elephants near {location}…', detail: 'Querying global biodiversity records for elephant sightings' },
  empty: { emoji: '🐘', text: 'No sightings found nearby', sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different region.' },
  localizable: false,
  hotspots: [
    { name: 'Amboseli, Kenya', lat: -2.65, lng: 37.26, emoji: '🇰🇪' },
    { name: 'Chobe, Botswana', lat: -18.58, lng: 25.15, emoji: '🇧🇼' },
    { name: 'Kruger, South Africa', lat: -23.99, lng: 31.55, emoji: '🇿🇦' },
    { name: 'Sri Lanka', lat: 7.87, lng: 80.77, emoji: '🇱🇰' },
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
