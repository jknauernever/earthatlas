// /risks "How this is sourced" rollup (SourcesFooter). Every value on the page also carries its own inline link.
import { createElement as h } from 'react'
import { ATTRIBUTION, COUNTY_NOTICE, REPORT_URL, STORYMAP_URL, SLR_SERVICE_URL, VA_SERVICE_URL, ROAD_CENTERLINES_URL, EROSION_SERVICE_URL, EROSION_ZONES_URL } from './risksLayers.js'

export const reportPage = (page) => `${REPORT_URL}#page=${page}`
const a = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text)

export const RISKS_SOURCES_INTRO = h('span', null,
  'Coastal flooding and erosion risk in San Juan County, Washington, from the County’s 2024 sea-level-rise assessment by Environmental Science Associates (ESA). The County’s ',
  a(STORYMAP_URL, 'StoryMap'), ' and the ', a(REPORT_URL, 'full report'), ' explain the study.')

const LICENCE = 'San Juan County public data (educational use; no warranty)'

export const RISKS_SOURCES = [
  {
    heading: 'Flooding',
    sources: [
      { name: 'Sea Level Rise Scenarios 2024', href: SLR_SERVICE_URL, publisher: 'San Juan County / ESA', licence: LICENCE, licenceHref: STORYMAP_URL,
        method: 'The four flood layers (2 or 5 ft of sea-level rise with the 1-year or 100-year storm), downloaded from the County’s public map service and tiled by EarthAtlas. The County publishes each scenario as only the ground it adds to the milder ones, so EarthAtlas shows a scenario as its own ground plus every milder scenario’s. The 1-year layer’s open water is trimmed to the County’s shoreline (NOAA shoreline layer) so every scenario shows land that floods. Shapes are otherwise unchanged apart from simplification at low zoom.',
        citation: ATTRIBUTION },
      { name: 'Totals in this map view', href: '/risks/reports/land-value#how', publisher: 'EarthAtlas, from the County’s flood layers, building footprints and Assessor values', licence: LICENCE,
        method: 'Buildings: footprints the scenario’s flood extent touches, inside the view. Lots: tax parcels (center inside the view) with at least 10 m² and 1% of the lot in the flood extent. Land + buildings: each lot’s Assessor land value × the share of the lot flooded, plus its building value × the share of its building footprint area flooded. The land-value report counts the same way.' },
    ],
  },
  {
    heading: 'Buildings and property lines',
    sources: [
      { name: 'Building Footprints', href: `${SLR_SERVICE_URL}/0`, publisher: 'San Juan County GIS, via Salish Sea Explorer', licence: LICENCE, licenceHref: STORYMAP_URL,
        method: 'EarthAtlas marks each footprint with the first scenario whose flood extent touches it (exact polygon intersection), and draws each flooded one as a dot at low zoom. “Most flooded on this map” counts those buildings within 700 m of each other, grouped around the densest clusters; place names are the nearest Mapbox map label (a settlement or bay).' },
      { name: 'Tax parcels', href: 'https://www.sanjuanco.com/167/Assessor', publisher: 'San Juan County Assessor',
        licence: 'San Juan County public data', method: 'Parcel boundaries, the same tiles EarthAtlas’s /fire map uses.' },
    ],
  },
  {
    heading: 'Assessment results',
    sources: [
      { name: 'Vulnerability Assessment Map', href: VA_SERVICE_URL, publisher: 'San Juan County / ESA', licence: LICENCE, licenceHref: STORYMAP_URL,
        method: 'Roads flooding (layers 214–220): whole road segments, drawn faint.',
        citation: ATTRIBUTION },
      { name: 'Road centerlines', href: ROAD_CENTERLINES_URL, publisher: 'San Juan County / ESA', licence: LICENCE, licenceHref: STORYMAP_URL,
        method: 'Every County road centerline, public and private (2,183 segments), clipped by EarthAtlas to each scenario’s flood extent and drawn bold; the stretches add up to 4.1, 10.2, 11.8 and 16.3 miles, as the report’s Table 6-1 counts road miles (4.3, 10.4, 11.9, 16.3). “Road miles” in the map view counts each stretch whose middle is in view.',
        citation: ATTRIBUTION },
      { name: 'Projected erosion zones (2060, 2100)', href: EROSION_ZONES_URL, publisher: 'San Juan County / ESA', licence: LICENCE, licenceHref: STORYMAP_URL,
        method: 'ESA’s erosion projection: a multi-ring buffer inland from the shoreline (NOAA high tide, or the bluff toe on feeder bluffs and transport zones), its width from each stretch’s shore type and increased historic erosion rate. The county layer holds the two years as rings that don’t overlap (2060: from the shoreline; 2100: beyond that), so EarthAtlas shows the 2060 ring with 2 ft of rise and both rings with 5 ft, as the report pairs the years with the scenarios; holes the county’s GeoJSON export drops are rebuilt. EarthAtlas measures each building footprint’s shortest distance to the projected line for each year (in UTM zone 10N) and marks the buildings within 100 ft.', citation: 'ESA 2023' },
      { name: 'Erosion Vulnerability Points', href: EROSION_SERVICE_URL, publisher: 'San Juan County / ESA', licence: LICENCE, licenceHref: STORYMAP_URL,
        method: 'The six places the report names as at higher risk of erosion (report p. 25).', citation: ATTRIBUTION },
    ],
  },
]

export const RISKS_SOURCES_NOTES = [
  { heading: 'When and how often', body: h('span', null, '2 ft of rise is not expected sooner than 2050 and 5 ft not sooner than 2100 (', a(reportPage(22), 'report, p. 17'), '). The 1-year storm floods about once a year (', a(reportPage(30), 'p. 25'), '); the 100-year storm has a 1% chance in any year (', a(reportPage(9), 'p. 4'), ').') },
  { heading: 'San Juan County’s notice', body: COUNTY_NOTICE },
]
