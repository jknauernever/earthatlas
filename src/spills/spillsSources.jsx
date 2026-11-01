// "How this is sourced" rollup for /spills (SourcesFooter). Every value in the report card also links to its own source;
// this is the summary.
import { NRC_HOME, ESI_HOME, ESI_GDB, ESI_GUIDE, CENSUS_GEOCODER, CENSUS_GAZ, WBD } from './spillsShared.js'

const USC105 = 'https://www.law.cornell.edu/uscode/text/17/105'
const PD = 'U.S. Government work, public domain (17 U.S.C. § 105)'

export const SPILLS_SOURCES_INTRO =
  'Oil and petroleum releases reported to the National Response Center in and around Lake Michigan, placed on NOAA’s Environmental Sensitivity Index for the lake. These are initial reports as callers gave them, not verified by the NRC or any agency. What the map shows is exposure: the shoreline types and mapped species near where a release was reported, not measured harm.'

export const SPILLS_SOURCES = [
  {
    heading: 'Spill reports',
    sources: [
      { name: 'National Response Center incident reports, calendar years 2015–2024 (FOIA files CY15–CY24)', href: NRC_HOME,
        publisher: 'U.S. Coast Guard, National Response Center', licence: PD, licenceHref: USC105,
        method: 'Reports with an oil or petroleum material (diesel, gasoline, lube, hydraulic and other oils, unknown sheens) that name Lake Michigan or one of its bays, harbors or connected waters, or that reached water inside the Lake Michigan basin. Repeat calls about the same release (same date, place, materials and amount) are shown once, with the other report numbers listed.' },
    ],
  },
  {
    heading: 'Locations',
    sources: [
      { name: 'Census Geocoder, batch address matching (benchmark Public_AR_Current)', href: CENSUS_GEOCODER,
        publisher: 'U.S. Census Bureau', licence: PD, licenceHref: USC105,
        method: 'Street addresses in reports that have no coordinates.' },
      { name: '2024 Gazetteer Files, places', href: CENSUS_GAZ, publisher: 'U.S. Census Bureau', licence: PD, licenceHref: USC105,
        method: 'The internal point of the report’s nearest city, used alone or as the start of a distance and direction.' },
      { name: 'Watershed Boundary Dataset, 4-digit hydrologic units 0403–0406 (Lake Michigan basin)', href: WBD,
        publisher: 'U.S. Geological Survey', licence: PD, licenceHref: USC105,
        method: 'With the ESI’s mapped water, the area a report must fall in to be matched to Lake Michigan by location.' },
    ],
  },
  {
    heading: 'Shoreline and species',
    sources: [
      { name: 'Environmental Sensitivity Index (ESI) Atlas: Lake Michigan, 2025', href: ESI_HOME,
        publisher: 'NOAA Office of Response and Restoration', licence: PD, licenceHref: USC105,
        method: 'Shoreline classes (ESIL), biological resources (birds, fish, reptiles and amphibians, invertebrates, mammals, plants and habitats) with their state and federal listing status, and named sites (marinas, access points, navigation features). Shoreline colors are the atlas’s own. Where the ESI gives a generic name such as “Endangered plant” in place of a species, that name is shown as given.' },
    ],
  },
]

export const SPILLS_SOURCES_NOTES = [
  { heading: 'Initial reports', body: 'An NRC report records what a caller said at the time of the call: the material, amount, place and cause can be estimates, unknown or later found to be wrong, and the NRC does not investigate or confirm them. Some reports describe a potential release.' },
  { heading: 'Exposure', body: 'For each report the card lists the most sensitive ESI shoreline class and every ESI biological resource within a set distance of its map location: 1 km for coordinates, 2 km for a street address or named site, 3 km for a distance from a city, 5 km for a nearest city.' },
  { heading: 'ESI shoreline classes', body: <>Classes run from 1 (exposed, least sensitive to oil) to 10 (sheltered wetlands, most sensitive), as defined in NOAA’s <a href={ESI_GUIDE} target="_blank" rel="noopener noreferrer">ESI Guidelines</a>. Data: <a href={ESI_GDB} target="_blank" rel="noopener noreferrer">Lake_Michigan_ESI_2025_GDB.zip</a>.</> },
]
