// /shoreline "How this is sourced" rollup (SourcesFooter). Credits are Salish Sea Explorer's (config/layers.ts sourceCredit).
import { createElement as h } from 'react'
import { FRIENDS_PAGE } from '../permits/habitat.js'

export const COUNTY_GIS = 'https://gis.sanjuancountywa.gov/arcgis/rest/services'
export const COUNTY_PARCELS_URL = `${COUNTY_GIS}/OpenData/Parcels/MapServer/1`
export const COUNTY_BUILDINGS_URL = `${COUNTY_GIS}/Polaris/Buildings/MapServer/3`
export const FISH_USE_URL = `${COUNTY_GIS}/Habitat/SRSC_ShorelineFishPresence/MapServer`
export const GUIDE_URL = '/friends/reports/living-with-the-shoreline.html'

const a = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text)
const FRIENDS = 'Friends of the San Juans data'
const COUNTY = 'San Juan County public data (no warranty)'

export const SHORELINE_SOURCES_INTRO = h('span', null,
  'San Juan County’s marine shoreline: fish habitat, shore types and shoreline structures mapped by ',
  a(FRIENDS_PAGE, 'Friends of the San Juans'), ' and its partners, over the County’s property and building data. ',
  a(GUIDE_URL, 'Living with the Shoreline'), ' explains what each layer means for shoreline owners.')

export const SHORELINE_SOURCES = [
  {
    heading: 'Habitat',
    sources: [
      { name: 'Bull kelp', href: FRIENDS_PAGE, publisher: 'Washington Department of Natural Resources and Friends of the San Juans', licence: FRIENDS, licenceHref: FRIENDS_PAGE,
        method: 'Canopy (floating) kelp beds, drawn as Friends draws them on its maps.' },
      { name: 'Deepwater/edge eelgrass', href: FRIENDS_PAGE, publisher: 'Friends of the San Juans, Washington DNR and Friday Harbor Labs (countywide eelgrass study)', licence: FRIENDS, licenceHref: FRIENDS_PAGE,
        method: 'The deepest (waterward) edge of eelgrass meadows.' },
      { name: 'Herring spawning grounds', href: FRIENDS_PAGE, publisher: 'Washington Department of Fish and Wildlife; compiled by Friends of the San Juans', licence: FRIENDS, licenceHref: FRIENDS_PAGE,
        method: 'Areas, present or historic, where Pacific herring spawn.' },
      { name: 'Surf smelt and sand lance spawning beaches', href: FRIENDS_PAGE, publisher: 'Friends of the San Juans forage fish egg surveys, with WDFW records', licence: FRIENDS, licenceHref: FRIENDS_PAGE,
        method: 'Documented beaches (eggs found) and potential habitat (beach substrate suitable for spawning).' },
      { name: 'Priority Shorelines for Fish', href: FISH_USE_URL, publisher: 'Beamer & Fresh 2012, Skagit River System Cooperative (juvenile salmon and forage fish shoreline surveys, 2008–2009)', licence: COUNTY, licenceHref: FISH_USE_URL,
        method: 'Each shoreline segment’s high-resolution model score for seven species, grouped into moderate, high and highest priority with the bins of the countywide salmon recovery prioritization.' },
    ],
  },
  {
    heading: 'Shoreline',
    sources: [
      { name: 'Shoreline geology: shoreforms', href: FRIENDS_PAGE, publisher: 'Friends of the San Juans geomorphic shoreform mapping', licence: FRIENDS, licenceHref: FRIENDS_PAGE,
        method: 'Each shoreline segment colored by its shoreform class group.' },
      { name: 'Shoreline modifications', href: FRIENDS_PAGE, publisher: 'Friends of the San Juans shoreline inventory (2009) and armor change survey (2019)', licence: FRIENDS, licenceHref: FRIENDS_PAGE,
        method: 'Armor, docks, mooring buoys and floats, boat ramps, marine railways, groins and pilings.' },
    ],
  },
  {
    heading: 'Property',
    sources: [
      { name: 'Tax parcels', href: COUNTY_PARCELS_URL, publisher: 'San Juan County GIS (Assessor parcel data)', licence: COUNTY, licenceHref: COUNTY_PARCELS_URL,
        method: 'Downloaded from the County’s map service and tiled by EarthAtlas (November 2026).' },
      { name: 'Building footprints', href: COUNTY_BUILDINGS_URL, publisher: 'San Juan County GIS', licence: COUNTY, licenceHref: COUNTY_BUILDINGS_URL,
        method: 'Downloaded from the County’s map service and tiled by EarthAtlas (November 2026).' },
    ],
  },
]
