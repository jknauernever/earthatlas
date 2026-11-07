// /spillrisk "How this is sourced" rollup (SourcesFooter) and the source links each value uses inline.
import { createElement as h } from 'react'
import { FRIENDS_PAGE } from '../permits/habitat.js'

export const PYGNOME_URL = 'https://github.com/NOAA-ORR-ERD/PyGNOME'
export const SSCOFS_URL = 'https://tidesandcurrents.noaa.gov/ofs/sscofs/sscofs.html'
export const SSCOFS_ARCHIVE_URL = 'https://registry.opendata.aws/noaa-ofs/'
export const MARINECADASTRE_URL = 'https://hub.marinecadastre.gov/pages/vesseltraffic'
export const OSM_URL = 'https://www.openstreetmap.org/copyright'
export const PADUS_URL = 'https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview'
export const NMFS_CH_URL = 'https://www.fisheries.noaa.gov/resource/map/national-esa-critical-habitat-mapper'
export const FWS_CH_URL = 'https://ecos.fws.gov/ecp/report/table/critical-habitat.html'
export const NDBC_46088 = 'https://www.ndbc.noaa.gov/station_page.php?station=46088'

const a = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text)

export const SPILLRISK_SOURCES_INTRO = h('span', null,
  'Ten places along the Salish Sea tanker routes, each with an oil spill modeled under the real winds and currents of two ',
  'past 72-hour periods. Every scenario is ten runs of NOAA’s ', a(PYGNOME_URL, 'PyGNOME'), ' oil spill model driven by NOAA’s ',
  a(SSCOFS_URL, 'Salish Sea and Columbia River Operational Forecast System (SSCOFS)'), '. The map shows where oil was in how many of the ten runs, hour by hour, ',
  'and the panel lists the habitats and protected areas it reaches.')

export const SPILLRISK_SOURCES = [
  {
    heading: 'Model and forcing',
    sources: [
      { name: 'PyGNOME 1.1.23', href: PYGNOME_URL, publisher: 'NOAA Office of Response and Restoration', licence: 'Public domain (U.S. Government work)', licenceHref: PYGNOME_URL,
        method: 'Run by EarthAtlas: 1,000 particles per run, 15-minute steps, a one-hour release, random-walk diffusion 10,000 cm²/s; evaporation, natural dispersion and emulsification. NOAA has not reviewed or endorsed these runs.' },
      { name: 'SSCOFS nowcast currents and wind', href: SSCOFS_ARCHIVE_URL, publisher: 'NOAA National Ocean Service (NOAA Open Data Dissemination, AWS)', licence: 'Public domain (U.S. Government work)', licenceHref: SSCOFS_ARCHIVE_URL,
        method: 'Surface-layer currents and the model’s 10 m wind, hour by hour, stitched from the archived nowcasts for each 72-hour period.' },
      { name: 'Buoy 46088 (New Dungeness)', href: NDBC_46088, publisher: 'NOAA National Data Buoy Center', licence: 'Public domain (U.S. Government work)', licenceHref: NDBC_46088,
        method: 'Its 2025 hourly wind picked the two periods (the windiest 72 hours of winter, a median summer 72 hours); its water temperature is the model’s water temperature for each period.' },
      { name: 'Alaska North Slope crude (ADIOS AD00020)', href: 'https://adios.orr.noaa.gov/oils/AD00020', publisher: 'NOAA ADIOS Oil Database', licence: 'NOAA ADIOS Oil Database terms', licenceHref: 'https://adios.orr.noaa.gov/',
        method: 'The oil’s measured properties drive the weathering.' },
      { name: 'Spill volumes', href: 'https://www.law.cornell.edu/cfr/text/33/155.1020', publisher: 'U.S. Code of Federal Regulations; Exxon Valdez Oil Spill Trustee Council', licence: 'Public domain (U.S. Government and State of Alaska works)', licenceHref: 'https://evostc.state.ak.us/oil-spill-facts/q-and-a/',
        method: h('span', null, 'Odd-numbered places: 2,500 barrels, the “maximum most probable discharge” a large tanker’s federal response plan must cover (', a('https://www.law.cornell.edu/cfr/text/33/155.1020', '33 CFR 155.1020'), '). Even-numbered places: 257,000 barrels, the Exxon Valdez spill (', a('https://evostc.state.ak.us/oil-spill-facts/q-and-a/', 'Trustee Council'), '). The model moves the oil the same way at either size; the amount changes how many barrels float, evaporate and come ashore.') },
      { name: 'Shoreline', href: OSM_URL, publisher: '© OpenStreetMap contributors', licence: 'ODbL 1.0', licenceHref: OSM_URL,
        method: 'The coastline EarthAtlas /ships uses (OSM land minus inland water); oil that reaches it is counted as ashore.' },
      { name: 'Tanker traffic (where the ten places are)', href: MARINECADASTRE_URL, publisher: 'MarineCadastre.gov (NOAA and BOEM)', licence: 'Public domain (U.S. Government work)', licenceHref: MARINECADASTRE_URL,
        method: '2025 AIS positions of tankers 150 m and longer, moving faster than 4 knots; each place is the busiest ~2 km cell of its stretch of route.' },
    ],
  },
  {
    heading: 'What the oil reaches',
    sources: [
      { name: 'Friends of the San Juans habitat', href: FRIENDS_PAGE, publisher: 'Friends of the San Juans, with Washington DNR and WDFW', licence: 'Friends of the San Juans data', licenceHref: FRIENDS_PAGE,
        method: 'Bull kelp, deepwater eelgrass edge, herring spawning grounds, and surf smelt and sand lance spawning beaches. San Juan County only.' },
      { name: 'ESA critical habitat (NOAA Fisheries)', href: NMFS_CH_URL, publisher: 'NOAA Fisheries', licence: 'Public domain (U.S. Government work)', licenceHref: NMFS_CH_URL,
        method: 'Final designations. U.S. waters only.' },
      { name: 'ESA critical habitat (U.S. Fish and Wildlife Service)', href: FWS_CH_URL, publisher: 'U.S. Fish and Wildlife Service', licence: 'Public domain (U.S. Government work)', licenceHref: FWS_CH_URL,
        method: 'Final designations. U.S. only.' },
      { name: 'Protected areas (PAD-US 4.1)', href: PADUS_URL, publisher: 'U.S. Geological Survey Gap Analysis Project', licence: 'Public domain (U.S. Government work)', licenceHref: PADUS_URL,
        method: 'Every protected area except outer-continental-shelf lease blocks. U.S. only.' },
    ],
  },
]

export const SPILLRISK_SOURCES_NOTES = [
  { heading: 'How “reached” is counted',
    body: 'The map is divided into cells about 550 m across. A habitat or protected area counts as reached at the first hour any run has oil, floating or ashore, in a cell it touches. “Likely” means at least 7 of the 10 runs.' },
  { heading: 'The ten runs',
    body: 'Run 1 uses the winds and currents as recorded. Runs 2–10 vary the wind speed (about ±20%), wind direction (about ±15°) and current speed (±15%), so the spread shows how sensitive the outcome is. These variations are EarthAtlas’s choice, not a published NOAA scheme.' },
  { heading: 'Not covered',
    body: 'British Columbia habitats and protected areas are not assessed yet. Oil that sinks, mixes deep or is cleaned up is not modeled; no response is simulated. PyGNOME moves the oil particles the same way whatever the volume, so the mapped footprint is the same at 2,500 and 257,000 barrels; the volume changes the barrels floating, evaporating and ashore.' },
]
