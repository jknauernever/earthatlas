import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META, isCondor } from '../species-data/condors'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'condors',
  name: 'Condors',
  emoji: '🦅',
  taxonLabel: 'condor',
  gbifTaxonKey: GBIF_TAXON_KEY,

  theme: {
    glow: '#2c3e50',
    glowDim: 'rgba(44, 62, 80, 0.10)',
    glowMid: 'rgba(44, 62, 80, 0.25)',
  },

  hero: {
    bgColor: '#0d1117',
    image: '/condor-hero.jpg',
    eyebrow: 'EarthAtlas \u00b7 Condor Sightings',
    title: ['Explore ', 'condor sightings.'],
    subtitle: 'Across the Americas.',
    description: "Track California and Andean Condor sightings \u2014 from the Grand Canyon to the peaks of Patagonia. Two of the world\u2019s largest flying birds, both fighting back from the brink.",
    accentColor: '#e74c3c',
    navAccent: '#e74c3c',
  },

  seo: {
    title: 'Condor Sightings \u2014 EarthAtlas',
    description: 'Explore California Condor and Andean Condor sightings across the Americas \u2014 seasonal patterns, conservation data, and real-time observations from GBIF and iNaturalist.',
    image: '/condor-hero.jpg',
  },

  defaults: {
    radiusKm: 200,
    days: 90,
    maxSightings: 500,
    zoom: 6,
  },

  fallback: {
    commonName: 'Unknown condor',
    color: '#2c3e50',
    emoji: '🦅',
  },

  loading: {
    emoji: '🦅',
    message: 'Searching for condors near {location}\u2026',
    detail: 'Querying global biodiversity records for condor sightings',
  },

  empty: {
    emoji: '🦅',
    text: 'No sightings found nearby',
    sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different region.',
  },

  localizable: false,
  hotspots: [
    { name: 'Grand Canyon, AZ', lat: 36.10, lng: -112.09, emoji: '🇺🇸' },
    { name: 'Big Sur, CA', lat: 36.27, lng: -121.81, emoji: '🇺🇸' },
    { name: 'Pinnacles, CA', lat: 36.49, lng: -121.16, emoji: '🇺🇸' },
    { name: 'Colca Canyon, Peru', lat: -15.61, lng: -71.88, emoji: '🇵🇪' },
    { name: 'Torres del Paine, Chile', lat: -51.00, lng: -73.00, emoji: '🇨🇱' },
  ],
  inatTaxonId: INAT_TAXON_ID,
  newsQuery: 'condor conservation endangered',
  postFilter: isCondor,
}

config.service = createExploreService({
  gbifTaxonKey: GBIF_TAXON_KEY,
  inatTaxonId: INAT_TAXON_ID,
  speciesMeta: SPECIES_META,
  fallback: config.fallback,
  postFilter: isCondor,
})

export default config
