// /risks data constants, shared by the page (src/risks/RisksApp.jsx), the tile endpoint (api/risks-tiles.js) and the
// bake (scripts/bake-risks/bake.mjs). Every number and phrase here is from San Juan County's ESA 2024 report
// (REPORT_URL); page numbers are the report's own.

export const REPORT_URL = 'https://www.sanjuancountywa.gov/DocumentCenter/View/30803/SJC-Sea-Level-Rise-Vulnerability-Assessment'
export const STORYMAP_URL = 'https://storymaps.arcgis.com/stories/0d1db5ad2d63476b83a14579c56be639'
export const SERVICES_BASE = 'https://services.arcgis.com/PNkCg7xWnaf90qde/arcgis/rest/services'
export const SLR_SERVICE_URL = `${SERVICES_BASE}/Sea_Level_Rise_WFL1/FeatureServer`
export const VA_SERVICE_URL = `${SERVICES_BASE}/Vulnerability_Assessment_Map/FeatureServer`
export const EROSION_SERVICE_URL = `${SERVICES_BASE}/Erosion_Vulnerability_Points/FeatureServer/8`
export const EROSION_ZONES_URL = `${SERVICES_BASE}/ESA_SLR_Road_Erosion_Boundaries/FeatureServer/0`
export const ATTRIBUTION = 'San Juan County / Environmental Science Associates, Sea-Level Rise Risk & Vulnerability Assessment, 2024.'
// The county's data notice on its StoryMap item, verbatim (first paragraph).
export const COUNTY_NOTICE = 'San Juan County does not warrant the accuracy, reliability or timeliness of any information provided. Any person or entity who relies on information obtained from this real property query does so at his or her own risk. The maps are for educational purposes only and are not a substitute for a recorded survey. These maps are not to be used for navigation!'

// The tiled scenarios: one vector layer each in PMTILES_FILE. Bump BOTH versions on every re-bake (browsers keep tiles
// an hour, the CDN 30 days). v2 (2026-10-30): polygon holes rebuilt; v1 drew island interiors as flooded.
// v3: 1-year band trimmed to land; building footprints (with the first scenario that floods each) added.
// v4: land trim redone (GDAL's county-wide clip had dropped most of the 1-year band's land, beaches included).
// v5: "hits" layer, one point per flooded building (glowing dots at county zoom).
// v6: ESA projected erosion zones (2060, 2100) added as layers erosion2060 / erosion2100.
export const PMTILES_FILE = 'risks-slr-esa2024-v6.pmtiles'
export const TILES_VERSION = 'v6'

// Report §4.3 (p. 17): 2 ft = the County's short-term scenario, "not expected to occur sooner than 2050"; 5 ft = the
// long-term one, "not expected to occur sooner than 2100" (RCP 8.5). "For each sea-level rise scenario, the County
// selected the 1-year and 100-year storm event to evaluate more frequent versus more extreme impacts."
// Table 6-1 (p. 24–25): exposed buildings and road miles per scenario.
export const SLR_LEVELS = [
  { id: '2ft', label: '2 ft', words: '2 feet of sea-level rise', when: 'not expected sooner than 2050', year: 'in 25+ years' },
  { id: '5ft', label: '5 ft', words: '5 feet of sea-level rise', when: 'not expected sooner than 2100', year: 'in 75+ years' },
]
export const STORMS = [
  { id: '1yr', label: '1-year storm', words: 'the 1-year storm', what: 'flooding about once a year', lead: 'a typical yearly storm would flood', plain: 'Yearly' },
  { id: '100yr', label: '100-year storm', words: 'the 100-year storm', what: '1% chance in any year', lead: 'a major storm would flood', plain: 'Major storm' },
]
export const SCENARIOS = [
  { id: 'slr2_1', slr: '2ft', storm: '1yr', raw: 'slr-2ft-1yr', layer: 6, clipToLand: true, buildings: 499, roadMiles: 4.3 },
  { id: 'slr2_100', slr: '2ft', storm: '100yr', raw: 'slr-2ft-100yr', layer: 5, buildings: 1276, roadMiles: 10.4 },
  { id: 'slr5_1', slr: '5ft', storm: '1yr', raw: 'slr-5ft-1yr', layer: 4, buildings: 1771, roadMiles: 11.9 },
  { id: 'slr5_100', slr: '5ft', storm: '100yr', raw: 'slr-5ft-100yr', layer: 3, buildings: 2637, roadMiles: 16.3 },
]
export const scenarioOf = (slr, storm) => SCENARIOS.find((s) => s.slr === slr && s.storm === storm)
// "All four" view: when ground first floods, deep → faint red (deep = floods soonest).
export const SCENARIO_COLORS = { slr2_1: '#b91c1c', slr2_100: '#ef4444', slr5_1: '#f87171', slr5_100: '#fecaca' }
