import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import GeoSearch from '../components/GeoSearch.jsx'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import { reverseGeocode } from '../explore/utils.js'
import {
  buildParcelsLayer, addParcelLayers, applyParcelVisibility, applyParcelOpacity,
  restackParcels, raiseParcelSelection, queryParcelAt, setParcelSelection,
  clearParcelSelection, renderParcelCard, PARCEL_SOURCE_CITATION,
} from './parcels.js'
import styles from './FireApp.module.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

// EarthAtlas cloud function (Earth Engine backend) — same one /forestmonitor
// uses. Serves the Sentinel-2 NDVI tile (?layer=ndvi) and point NDVI
// (?lat=&lng=&greenonly=1). .trim() guards trailing newlines from vercel env pull.
const TILES_API_BASE = (
  import.meta.env.VITE_FOREST_TILES_API_BASE
  || 'https://us-west1-earthatlas.cloudfunctions.net/opera-dist-alert-global'
).trim()

// ─── Layer catalog ──────────────────────────────────────────────────────────
// Phase 1 ships three raster overlays, all served straight from public ArcGIS
// ImageServers (no EarthAtlas backend needed — unlike /forestmonitor, which
// proxies Earth Engine through a cloud function). They're rendered on Mapbox as
// raster sources using the WMS-style `{bbox-epsg-3857}` tile template (Mapbox
// substitutes each tile's Web-Mercator bbox), which lets ArcGIS `exportImage`
// behave like an XYZ tile source.
//
// Layers originate from the firegoat project (js/overlays.js). The catalog is
// intentionally data-driven so adding the planned NASA FIRMS active-fire layer
// (phase 2) is just another entry — see the `// FIRMS (phase 2)` note below.
//
// Fields:
//   id            stable key (URL state, Mapbox source/layer ids)
//   label         panel row title
//   baseUrl       ArcGIS ImageServer root (exportImage / identify hang off it)
//   renderingRule JSON string for the ?renderingRule= param, or null
//   defaultOpacity starting raster opacity (0–1)
//   minZoom       Mapbox layer minzoom — below it the server returns nothing
//                 useful, so we don't request tiles below it
//   coverage      short human note shown as a hint ('US only', 'Global', …)
//   legend        { kind:'swatches', items:[{c,l}] } | { kind:'gradient', css, left, right }
//   source        attribution line
const FIRE_LAYERS = [
  {
    id: 'whp',
    label: 'Wildfire Hazard Potential',
    group: 'Wildfire hazard',
    // Current WRC service (the old apps.fs.usda.gov host was retired). All WRC
    // products colorize a raw index server-side, so the popup reads the
    // rendered pixel color and matches it to `colormatch` (the exact legend
    // colors) — identify's raw value is the un-classed number, not the class.
    baseUrl: 'https://imagery.geoplatform.gov/iipp/rest/services/Fire_Aviation/USFS_EDW_RMRS_WRC_WildfireHazardPotential/ImageServer',
    renderingRule: JSON.stringify({ rasterFunction: 'WHP' }),
    point: 'colormatch',
    colormatch: [
      { label: 'Very low',  hex: '#38a800', risk: 'low' },
      { label: 'Low',       hex: '#d1ff73', risk: 'low' },
      { label: 'Moderate',  hex: '#ffff00', risk: 'moderate' },
      { label: 'High',      hex: '#ffaa00', risk: 'high' },
      { label: 'Very high', hex: '#ff0000', risk: 'high' },
    ],
    defaultOpacity: 0.55,
    minZoom: 0,
    coverage: 'US incl. Alaska & Hawaii',
    legend: {
      kind: 'swatches',
      items: [
        { c: '#38a800', l: 'Very Low' },
        { c: '#d1ff73', l: 'Low' },
        { c: '#ffff00', l: 'Moderate' },
        { c: '#ffaa00', l: 'High' },
        { c: '#ff0000', l: 'Very High' },
      ],
    },
    blurb: 'Relative potential for a wildfire that would be difficult to contain — a long-term landscape risk index, not active fire. Higher classes flag where, if a fire starts, it is more likely to be large and intense.',
    source: 'USDA Forest Service · RMRS Wildfire Risk to Communities (WHP 2024)',
  },
  {
    id: 'bp',
    label: 'Burn probability',
    group: 'Wildfire hazard',
    // Canonical WRC Annual Burn Probability service. The 'BurnProbability2024'
    // function colorizes; identify returns the raw U16 value = annual
    // probability × 10,000 (so value/10000 → probability → 1-in-N).
    baseUrl: 'https://imagery.geoplatform.gov/iipp/rest/services/Fire_Aviation/USFS_EDW_RMRS_WRC_BurnProbability/ImageServer',
    renderingRule: JSON.stringify({ rasterFunction: 'BurnProbability2024' }),
    defaultOpacity: 0.6,
    minZoom: 0,
    coverage: 'US incl. Alaska & Hawaii',
    legend: {
      // Matches the service's own YlOrRd ramp (decoded from its /legend
      // swatches): near-zero burn probability → pale cream, grading to dark red
      // at the highest class (~1-in-8 / year).
      kind: 'gradient',
      css: 'linear-gradient(to right, #fff0cf, #fdca94, #fc8d59, #e1452f, #a90000, #7f0000)',
      left: 'very low',
      right: 'high (annual)',
    },
    blurb: 'Modeled annual likelihood that a given pixel burns in a wildfire — the probability component behind hazard (companion to Wildfire Hazard Potential). A long-term modeled estimate, not a forecast.',
    source: 'USDA Forest Service · RMRS Wildfire Risk to Communities (Annual Burn Probability 2024)',
  },
  {
    id: 'cfl',
    label: 'Flame length (if a fire burns)',
    group: 'Wildfire hazard',
    // Conditional Flame Length — the INTENSITY half of hazard (BP is the
    // likelihood half): expected flame length if a fire does occur. The raw
    // identify band is not the displayed classification (it reads 0 even in
    // dense forest), so the popup uses colormatch like the other WRC layers.
    baseUrl: 'https://imagery.geoplatform.gov/iipp/rest/services/Fire_Aviation/USFS_EDW_RMRS_WRC_ConditionalFlameLength/ImageServer',
    renderingRule: JSON.stringify({ rasterFunction: 'CFL' }),
    point: 'colormatch',
    // `feet` is the plain bucket text; `fire` is the standard fire-behavior
    // read of that flame length (hand-crew limits ≈4 ft, equipment ≈8 ft).
    colormatch: [
      { label: 'NA', hex: '#ffffff', skip: true },
      { label: '0–2 ft',  hex: '#248391', fire: 'low intensity, within hand-crew control limits' },
      { label: '2–4 ft',  hex: '#71aba2', fire: 'low intensity, within hand-crew control limits' },
      { label: '4–6 ft',  hex: '#b7d4b2', fire: 'beyond hand crews, needs engines and dozers' },
      { label: '6–8 ft',  hex: '#ffffbf', fire: 'beyond hand crews, needs engines and dozers' },
      { label: '8–12 ft', hex: '#e0c080', fire: 'too intense for direct attack on the fire front' },
      { label: '12–20 ft', hex: '#bf874b', fire: 'extreme fire behavior' },
      { label: 'over 20 ft', hex: '#9c551f', fire: 'extreme fire behavior' },
    ],
    defaultOpacity: 0.6,
    minZoom: 0,
    coverage: 'US incl. Alaska & Hawaii',
    legend: {
      // The service's own teal→tan→brown class ramp (short → very long flames).
      kind: 'gradient',
      css: 'linear-gradient(to right, #248391, #71aba2, #b7d4b2, #ffffbf, #e0c080, #bf874b, #9c551f)',
      left: 'under 2 ft',
      right: 'over 20 ft',
    },
    blurb: 'If a fire does burn here, how intense it would likely be — expected flame length in feet. Rule of thumb: under 4 ft can be worked by hand crews, 4–8 ft needs engines and dozers, above 8 ft direct attack generally fails.',
    source: 'USDA Forest Service · RMRS Wildfire Risk to Communities (Conditional Flame Length 2024)',
  },
  {
    id: 'rps',
    label: 'Risk to structures',
    group: 'Risk to communities',
    // Risk to Potential Structures — WRC's headline layer: if a structure stood
    // here, its relative wildfire risk vs. the rest of the US (percentiles).
    baseUrl: 'https://imagery.geoplatform.gov/iipp/rest/services/Fire_Aviation/USFS_EDW_RMRS_WRC_RiskToPotentialStructures/ImageServer',
    renderingRule: JSON.stringify({ rasterFunction: 'RPS' }),
    point: 'colormatch',
    colormatch: [
      { label: 'None', hex: '#ffffff', skip: true },
      { label: 'Low',       hex: '#f1f2a0', pct: 'in the lower 40% of the US', risk: 'low' },
      { label: 'Moderate',  hex: '#f2c13c', pct: 'in the middle of the pack for the US (40–70th percentile)', risk: 'moderate' },
      { label: 'High',      hex: '#f28017', pct: 'in the top 30% of US wildfire risk to structures', risk: 'high' },
      { label: 'Very high', hex: '#f21900', pct: 'in the top 10% of US wildfire risk to structures', risk: 'high' },
      { label: 'Extreme',   hex: '#c4001a', pct: 'in the top 5% of US wildfire risk to structures', risk: 'high' },
    ],
    defaultOpacity: 0.6,
    minZoom: 0,
    coverage: 'US incl. Alaska & Hawaii',
    legend: {
      kind: 'swatches',
      items: [
        { c: '#f1f2a0', l: 'Low (lower 40%)' },
        { c: '#f2c13c', l: 'Moderate (40–70th pctile)' },
        { c: '#f28017', l: 'High (70–90th)' },
        { c: '#f21900', l: 'Very high (90–95th)' },
        { c: '#c4001a', l: 'Extreme (top 5%)' },
      ],
    },
    blurb: 'If a structure stood on this spot, how at-risk would it be — likelihood and intensity combined, ranked against the whole US. The headline layer of the USFS Wildfire Risk to Communities project.',
    source: 'USDA Forest Service · RMRS Wildfire Risk to Communities (Risk to Potential Structures 2024)',
  },
  {
    id: 'rrz',
    label: 'Risk reduction zones',
    group: 'Risk to communities',
    baseUrl: 'https://imagery.geoplatform.gov/iipp/rest/services/Fire_Aviation/USFS_EDW_RMRS_WRC_CommunityWildfireRiskReductionZones4/ImageServer',
    renderingRule: JSON.stringify({ rasterFunction: 'CWiRRZ4Value' }),
    point: 'colormatch',
    colormatch: [
      { label: 'NA', hex: '#ffffff', skip: true },
      { label: 'Minimal exposure zone', hex: '#b9bbc2', zone: 'wildfire exposure here is minimal' },
      { label: 'Indirect exposure zone', hex: '#f5c766', zone: 'structures here face embers and structure-to-structure spread rather than direct flames — hardening buildings matters most' },
      { label: 'Direct exposure zone', hex: '#ff3b54', zone: 'flames can reach structures directly from surrounding wildland — defensible space and fuel breaks matter most' },
      { label: 'Wildfire transmission zone', hex: '#d5e3d5', zone: 'wildland where fires start and spread toward communities — landscape fuel treatment territory' },
    ],
    defaultOpacity: 0.6,
    minZoom: 0,
    coverage: 'US incl. Alaska & Hawaii',
    legend: {
      kind: 'swatches',
      items: [
        { c: '#b9bbc2', l: 'Minimal exposure' },
        { c: '#f5c766', l: 'Indirect exposure (embers)' },
        { c: '#ff3b54', l: 'Direct exposure (flames)' },
        { c: '#d5e3d5', l: 'Wildfire transmission zone' },
      ],
    },
    blurb: 'Where wildfire mitigation matters, and what kind: zones where structures face direct flames, ember/indirect exposure, or the wildland areas that transmit fire toward communities.',
    source: 'USDA Forest Service · RMRS Wildfire Risk to Communities (Risk Reduction Zones 2024)',
  },
  {
    id: 'exposure',
    label: 'Exposure type',
    group: 'Risk to communities',
    baseUrl: 'https://imagery.geoplatform.gov/iipp/rest/services/Fire_Aviation/USFS_EDW_RMRS_WRC_ExposureType/ImageServer',
    renderingRule: JSON.stringify({ rasterFunction: 'Exposure' }),
    point: 'colormatch',
    colormatch: [
      { label: 'Not exposed', hex: '#d6d6d6', how: 'not directly reachable by wildfire' },
      { label: 'Indirectly exposed', hex: '#ff8f50', how: 'reachable by embers or radiant heat from nearby burnable vegetation' },
      { label: 'Directly exposed', hex: '#ff3b54', how: 'in or beside burnable vegetation — direct flame contact possible' },
    ],
    defaultOpacity: 0.6,
    minZoom: 0,
    coverage: 'US incl. Alaska & Hawaii',
    legend: {
      kind: 'swatches',
      items: [
        { c: '#d6d6d6', l: 'Not exposed' },
        { c: '#ff8f50', l: 'Indirectly exposed (embers)' },
        { c: '#ff3b54', l: 'Directly exposed (flames)' },
      ],
    },
    blurb: 'How wildfire could reach this spot: directly (it sits in or beside burnable vegetation) or indirectly (embers and radiant heat from fire nearby). Complements the risk-reduction zones.',
    source: 'USDA Forest Service · RMRS Wildfire Risk to Communities (Exposure Type 2024)',
  },
  {
    id: 'ndvi',
    label: 'Vegetation greenness (NDVI)',
    group: 'Landscape',
    // Cloud-function (Earth Engine) tile layer, not an ArcGIS ImageServer:
    // fetched via ?layer=ndvi, point value via ?greenonly=1. Same Sentinel-2
    // NDVI source /forestmonitor uses — global and current.
    kind: 'ee',
    eeParam: 'ndvi',
    defaultOpacity: 0.7,
    minZoom: 3,
    coverage: 'Global · Sentinel-2, last 12 months',
    legend: {
      // Matches NDVI_VIS in the cloud function: dry/tan → lush/deep-green.
      kind: 'gradient',
      css: 'linear-gradient(to right, #d9bf8f, #e8e08a, #b6d957, #5cb85c, #15803d)',
      left: 'dry / sparse',
      right: 'lush / green',
    },
    blurb: 'Recent vegetation vigor from cloud-masked Sentinel-2 imagery (NDVI, last 12 months). A proxy for fuel state — browned, low-NDVI vegetation is drier, more flammable fuel; deep green is moist and less ignitable. Global, and the same greenness source as the EarthAtlas Forest Monitor.',
    source: 'Sentinel-2 (Copernicus) · cloud-masked NDVI median',
  },
  {
    id: 'lulc',
    label: 'Land cover (Sentinel-2)',
    group: 'Landscape',
    baseUrl: 'https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer',
    renderingRule: null,
    defaultOpacity: 0.7,
    minZoom: 5,
    coverage: 'Global · 10 m',
    legend: {
      kind: 'swatches',
      items: [
        { c: '#419bdf', l: 'Water' },
        { c: '#397d49', l: 'Trees' },
        { c: '#7a87c6', l: 'Flooded vegetation' },
        { c: '#e49635', l: 'Crops' },
        { c: '#c4281b', l: 'Built area' },
        { c: '#a59b8f', l: 'Bare ground' },
        { c: '#a8ebff', l: 'Snow / ice' },
        { c: '#e3e2c3', l: 'Rangeland' },
      ],
    },
    blurb: 'What is on the ground — forest, rangeland, crops, built-up, water. Context for what a fire would burn and where the wildland–urban interface sits. The one globally available layer here.',
    source: 'Esri / Impact Observatory · Sentinel-2 10 m Land Cover',
  },
  // FIRMS (phase 2): NASA near-real-time active fire. A different shape — point
  // detections with timestamps, not a static raster — so it'll likely be a
  // GeoJSON/circle layer rather than an ImageServer entry, but it slots into the
  // same panel/legend machinery. See memory project_fire_app for the full stack.
]

// ArcGIS ImageServer → Mapbox bridge.
//
// Mapbox GL JS only understands `{z}/{x}/{y}` XYZ tile templates — it does NOT
// support MapLibre's `{bbox-epsg-3857}` WMS token (a source using it loads
// silently with zero tile requests). So we give each layer a sentinel XYZ
// template pointing at a fake host, and a single `transformRequest` on the map
// rewrites every such tile to the real ArcGIS `exportImage` call, computing
// that tile's Web-Mercator bbox from its z/x/y. This is the standard way to
// drive an Esri ImageServer from Mapbox GL JS.
const SENTINEL_HOST = 'ea-imageserver-tile.invalid'

// Append the vector "Property parcels" layer when at least one region is baked
// + uploaded (parcelSources.json). It rides the same catalog so the panel row,
// legend, opacity, drag-reorder and URL state all work for free; the map
// effects branch on `kind:'parcels'` to take the vector (not raster) path. When
// no region is live this is a no-op and the app is byte-for-byte the same.
const PARCELS_LAYER = buildParcelsLayer()
if (PARCELS_LAYER) FIRE_LAYERS.push(PARCELS_LAYER)

const LAYER_BY_ID = Object.fromEntries(FIRE_LAYERS.map((l) => [l.id, l]))

// ─── Per-attribute provenance (credibility & traceability — a prime directive
// across earthatlas.org) ─────────────────────────────────────────────────────
// Every value shown in the popup carries its own visible, clickable source, so
// a reader never has to guess where a number came from. `short` is the label
// shown inline; `url` links to the authoritative public page ("more info"); the
// precise per-dataset citation (layer.source) rides along as the hover title.
// `short` = full citation (hover title); `tag` = compact name for the
// consolidated sources footer.
const CITE_WRC = { short: 'USDA Forest Service · Wildfire Risk to Communities', tag: 'USFS Wildfire Risk to Communities', url: 'https://wildfirerisk.org' }
const SOURCE_CITATION = {
  whp: CITE_WRC, bp: CITE_WRC, cfl: CITE_WRC, rps: CITE_WRC, rrz: CITE_WRC, exposure: CITE_WRC,
  ndvi: { short: 'Sentinel-2 (Copernicus) via Google Earth Engine', tag: 'Sentinel-2', url: 'https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED' },
  lulc: { short: 'Esri / Impact Observatory · Sentinel-2 Land Cover', tag: 'Esri / Impact Observatory', url: 'https://livingatlas.arcgis.com/landcoverexplorer/' },
}
// Parcels carries its own per-region citation (added only when a region is live).
if (PARCEL_SOURCE_CITATION) SOURCE_CITATION.parcels = PARCEL_SOURCE_CITATION

// The raster identify layers (everything except the vector parcels layer). The
// popup's wildfire rows/summary/sources iterate these; parcels render as their
// own Property card.
const RASTER_LAYERS = FIRE_LAYERS.filter((l) => l.kind !== 'parcels')

// Distinct layer groups in catalog order — drives the grouped "The layers"
// list in the sourcing modal (so it always reflects the live catalog).
const LAYER_GROUPS = [...new Set(FIRE_LAYERS.map((l) => l.group).filter(Boolean))]

const sourceId = (id) => `fire-${id}-src`
const layerId = (id) => `fire-${id}-layer`

// Sentinel XYZ template; the real URL is produced in transformRequest below.
const tileTemplate = (layer) => `https://${SENTINEL_HOST}/${layer.id}/{z}/{x}/{y}`

// Web-Mercator world half-extent (meters). EPSG:3857 spans ±20037508.342789244.
const MERC_MAX = 20037508.342789244

// XYZ tile (z,x,y) → [minX, minY, maxX, maxY] in EPSG:3857 meters.
function tileToMercatorBbox(z, x, y) {
  const tileSpan = (2 * MERC_MAX) / Math.pow(2, z)
  const minX = -MERC_MAX + x * tileSpan
  const maxX = -MERC_MAX + (x + 1) * tileSpan
  const maxY = MERC_MAX - y * tileSpan
  const minY = MERC_MAX - (y + 1) * tileSpan
  return [minX, minY, maxX, maxY]
}

// Map a sentinel tile URL to the real ArcGIS exportImage URL. Returns null for
// anything that isn't one of our sentinel tiles (caller leaves it untouched).
function resolveArcgisTile(url) {
  if (!url.includes(SENTINEL_HOST)) return null
  const m = url.match(/\/([a-z0-9]+)\/(\d+)\/(\d+)\/(\d+)(?:\?.*)?$/)
  if (!m) return null
  const [, id, zS, xS, yS] = m
  const layer = LAYER_BY_ID[id]
  if (!layer) return null
  const [minX, minY, maxX, maxY] = tileToMercatorBbox(+zS, +xS, +yS)
  const p = new URLSearchParams({
    bbox: `${minX},${minY},${maxX},${maxY}`,
    bboxSR: '3857',
    imageSR: '3857',
    size: '256,256',
    format: 'png32',
    transparent: 'true',
    f: 'image',
  })
  let real = `${layer.baseUrl}/exportImage?${p.toString()}`
  if (layer.renderingRule) real += `&renderingRule=${encodeURIComponent(layer.renderingRule)}`
  return real
}

// ─── Point identify → plain language ────────────────────────────────────────
// The click popup asks each ImageServer for its pixel value at the point (via
// the /api/arcgis-identify proxy — several services block client-side CORS on
// identify) and translates the raw value into a plain-English reading.
const IDENTIFY_API = '/api/arcgis-identify'

// Read a WRC layer's displayed class at a point: render a tiny exportImage with
// the layer's rule (CORS-clean on geoplatform), read the centre pixel, match to
// the nearest color in layer.colormatch (the exact legend colors). Returns the
// matched entry ({ label, hex, ...extras }) or null (off-coverage/transparent).
// Used because WRC identify returns the raw un-classed index, not the class.
function readRenderedClass(layer, lat, lng) {
  const x = (lng * 20037508.34) / 180
  const y = (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 20037508.34) / Math.PI
  const d = 120
  const url = `${layer.baseUrl}/exportImage?bbox=${x - d},${y - d},${x + d},${y + d}`
    + `&bboxSR=3857&imageSR=3857&size=3,3&format=png32&transparent=true&f=image`
    + `&renderingRule=${encodeURIComponent(layer.renderingRule)}`
  return new Promise((resolve) => {
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 3; c.height = 3
        const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0)
        const p = ctx.getImageData(1, 1, 1, 1).data
        if (p[3] < 128) return resolve(null) // transparent = no data here
        let best = null, bestD = Infinity
        for (const cl of layer.colormatch) {
          const r = parseInt(cl.hex.slice(1, 3), 16), g = parseInt(cl.hex.slice(3, 5), 16), b = parseInt(cl.hex.slice(5, 7), 16)
          const dd = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2
          if (dd < bestD) { bestD = dd; best = cl }
        }
        resolve(best)
      } catch { resolve(null) }
    }
    im.onerror = () => resolve(null)
    im.src = url
  })
}

// Sentinel-2 land-cover class → label / color (Esri scheme; note no class 3/6).
const LULC_CLASSES = { 1: 'Water', 2: 'Trees', 4: 'Flooded vegetation', 5: 'Crops', 7: 'Built area', 8: 'Bare ground', 9: 'Snow / ice', 10: 'Clouds', 11: 'Rangeland' }
const LULC_COLORS = { 1: '#419bdf', 2: '#397d49', 4: '#7a87c6', 5: '#e49635', 7: '#c4281b', 8: '#a59b8f', 9: '#a8ebff', 10: '#616161', 11: '#e3e2c3' }

// Annual burn likelihood as "1-in-N" → qualitative band (+ ramp color, + a
// coarse risk token the summary uses to pick wording).
function burnBand(oneIn) {
  if (oneIn >= 5000) return { word: 'Very low', risk: 'low', color: '#ffffcc' }
  if (oneIn >= 1000) return { word: 'Low', risk: 'low', color: '#fed976' }
  if (oneIn >= 250)  return { word: 'Moderate', risk: 'moderate', color: '#fd8d3c' }
  if (oneIn >= 100)  return { word: 'High', risk: 'high', color: '#fc4e2a' }
  return { word: 'Very high', risk: 'high', color: '#bd0026' }
}

function ndviCondition(n) {
  if (n < 0) return 'Water / non-vegetation'
  if (n < 0.1) return 'Bare soil or rock'
  if (n < 0.2) return 'Sparse, dry vegetation'
  if (n < 0.4) return 'Low / drying vegetation'
  if (n < 0.6) return 'Moderate vegetation'
  return 'Dense, green vegetation'
}
function ndviColor(n) {
  if (n < 0) return '#3b5bdb'
  if (n < 0.2) return '#d7191c'
  if (n < 0.4) return '#fdae61'
  if (n < 0.6) return '#a6d96a'
  return '#1a9641'
}

// Translate one layer's raw identify value into { popupLabel, value (plain
// text), swatch, ...extras }. Returns null when there's no usable data here.
// Compact zone/exposure labels for the one-line popup rows (full phrasing lives
// in the summary).
const RRZ_SHORT = {
  'Minimal exposure zone': 'Minimal', 'Indirect exposure zone': 'Indirect',
  'Direct exposure zone': 'Direct', 'Wildfire transmission zone': 'Transmission',
}
const EXPOSURE_SHORT = { 'Directly exposed': 'Directly', 'Indirectly exposed': 'Indirectly', 'Not exposed': 'Not exposed' }
const ndviWord = (n) => (n < 0 ? 'water' : n < 0.2 ? 'bare/dry' : n < 0.4 ? 'sparse' : n < 0.6 ? 'moderate' : 'green')

// Each row carries: popupLabel, `short` (the compact value shown in the row),
// `value` (full text, used as the row's hover title), swatch, + semantic fields
// the summary reads. Returns null when there's no usable data at the point.
function interpretLayer(id, value) {
  if (value == null) return null
  // Color-matched WRC layers: value is the matched colormatch entry
  // { label, hex, ...extras }; `skip:true` entries are NA/empty classes.
  if (value.skip) return null
  if (id === 'whp') {
    if (!value.label) return null
    return { popupLabel: 'Wildfire hazard', short: value.label, value: value.label, swatch: value.hex, risk: value.risk, word: value.label }
  }
  if (id === 'cfl') {
    if (!value.label) return null
    return { popupLabel: 'Flame length', short: value.label, value: `${value.label} — ${value.fire}`, swatch: value.hex, feet: value.label, fire: value.fire }
  }
  if (id === 'rps') {
    if (!value.label) return null
    return { popupLabel: 'Risk to structures', short: value.label, value: `${value.label} — ${value.pct}`, swatch: value.hex, risk: value.risk, word: value.label, pct: value.pct }
  }
  if (id === 'rrz') {
    if (!value.label) return null
    return { popupLabel: 'Risk zone', short: RRZ_SHORT[value.label] || value.label, value: value.label, swatch: value.hex, zone: value.zone, word: value.label }
  }
  if (id === 'exposure') {
    if (!value.label) return null
    return { popupLabel: 'Exposure', short: EXPOSURE_SHORT[value.label] || value.label, value: value.label, swatch: value.hex, how: value.how, word: value.label }
  }
  if (id === 'bp') {
    const n = Number(value)
    if (!Number.isFinite(n)) return null
    if (n <= 0) return { popupLabel: 'Burn probability', short: 'Negligible', value: 'Negligible', swatch: '#fff0cf', risk: 'low', oneIn: null }
    const prob = n / 1e4 // WRC service stores annual probability × 10,000
    const oneIn = Math.max(1, Math.round(1 / prob))
    const b = burnBand(oneIn)
    return { popupLabel: 'Burn probability', short: `~1-in-${oneIn.toLocaleString()}/yr`, value: `${b.word} — about a 1-in-${oneIn.toLocaleString()} chance per year`, swatch: b.color, risk: b.risk, word: b.word, oneIn }
  }
  if (id === 'ndvi') {
    // Cloud function returns the NDVI value directly (Sentinel-2 median).
    const ndvi = Number(value)
    if (!Number.isFinite(ndvi)) return null
    return { popupLabel: 'Vegetation (NDVI)', short: `${ndvi.toFixed(2)} · ${ndviWord(ndvi)}`, value: `${ndviCondition(ndvi)} (NDVI ${ndvi.toFixed(2)})`, swatch: ndviColor(ndvi), ndvi }
  }
  if (id === 'lulc') {
    const n = Math.round(Number(value))
    const label = LULC_CLASSES[n]
    if (!label) return null
    return { popupLabel: 'Land cover', short: label, value: label, swatch: LULC_COLORS[n] || null, cover: label }
  }
  return null
}

// One-line verdict headline for the summary hero, from the strongest available
// signal (risk-to-structures → hazard → burn probability). Returns { text, sev }
// where sev ∈ low|moderate|high tints the hero card; null off-coverage.
function buildVerdict(r) {
  if (r.rps && r.rps.word) return { text: `${r.rps.word} wildfire risk to structures`, sev: r.rps.risk }
  if (r.whp && r.whp.word) return { text: `${r.whp.word} wildfire hazard`, sev: r.whp.risk }
  if (r.bp && r.bp.word) return { text: `${r.bp.word} burn likelihood`, sev: r.bp.risk }
  return null
}

// Land-cover class → a natural noun phrase for the summary sentence.
const COVER_PHRASE = {
  Water: 'open water', Trees: 'forested land', 'Flooded vegetation': 'wetland / flooded vegetation',
  Crops: 'cropland', 'Built area': 'developed, built-up land', 'Bare ground': 'bare ground',
  'Snow / ice': 'snow or ice', Clouds: 'cloud-obscured ground', Rangeland: 'rangeland (grass and shrub)',
}

// ── Plain-language helpers for the narrative summary ────────────────────────
// A parcel's land_use → a natural noun for the reader. Handles NM's coarse
// "Residential"/"Non-residential" and San Juan's specific descriptions
// ("HOUSEHOLD, SINGLE FAMILY UNITS", "UNDEVELOPED LAND", …).
const RESIDENTIAL_RE = /RESIDENT|HOUSEHOLD|SINGLE FAMILY|\bSFR\b|DWELLING|CABIN|VACATION|MOBILE|MANUFACT|CONDO|APARTMENT/
function propertyPhrase(landUse) {
  const u = (landUse || '').toUpperCase()
  if (RESIDENTIAL_RE.test(u)) return 'home'
  if (/UNDEVELOPED|VACANT|OPEN SPACE|FOREST LAND|\bFARM\b|\bAG\b|RANGELAND|TIMBER/.test(u)) return 'undeveloped parcel'
  if (/COMMERCIAL|RETAIL|OFFICE|INDUSTRIAL|SERVICE|BUSINESS/.test(u)) return 'commercial property'
  if (u === 'NON-RESIDENTIAL') return 'non-residential property'
  return 'property'
}
const isResidential = (landUse) => RESIDENTIAL_RE.test((landUse || '').toUpperCase())
// Vegetation as fuel.
function fuelPhrase(ndvi) {
  if (ndvi < 0) return null
  if (ndvi >= 0.6) return 'blanketed in dense, green vegetation — plenty of fuel'
  if (ndvi >= 0.4) return 'with moderately green vegetation'
  if (ndvi >= 0.2) return 'with sparse, drying vegetation — drier, more flammable fuel'
  return 'with little vegetation — mostly bare or very dry ground'
}
// How often fire occurs, from the 1-in-N annual chance.
function likelihoodWord(oneIn) {
  if (oneIn >= 5000) return 'very rare'
  if (oneIn >= 1000) return 'rare'
  if (oneIn >= 250) return 'occasional'
  if (oneIn >= 100) return 'fairly common'
  return 'common'
}

// Build the plain-English cross-layer summary — written to read like a person
// explaining it: lead with the property, then reconcile the three fire metrics
// (hazard = how bad if it burns, likelihood = how often, risk = the bottom line
// for a structure), which often diverge. r is keyed by layer id → interpretation,
// plus r.parcels (the clicked parcel) when available.
function buildSummary(r) {
  const out = []
  const parcel = r.parcels && r.parcels.props
  const subject = parcel ? `This ${propertyPhrase(parcel.land_use)}` : null
  const target = parcel ? (isResidential(parcel.land_use) ? 'this home' : 'this property') : 'a building on this spot'

  // 1) Setting + fuel — what's here and how flammable.
  const ground = r.lulc ? (COVER_PHRASE[r.lulc.cover] || r.lulc.cover.toLowerCase()) : null
  const fuel = r.ndvi ? fuelPhrase(r.ndvi.ndvi) : null
  if (subject) {
    let s = subject
    if (ground) s += ` sits on ${ground}`
    if (fuel) s += `${ground ? ', ' : ' is '}${fuel}`
    out.push(s + '.')
  } else if (ground || fuel) {
    let s = ground ? `You've clicked on ${ground}` : 'This spot is'
    if (fuel) s += `${ground ? ', ' : ' '}${fuel}`
    out.push(s + '.')
  }

  // 2) The fire read — hazard, likelihood, and the bottom-line risk, reconciled.
  const hazWord = r.whp && r.whp.word ? r.whp.word.toLowerCase() : null
  const hazHigh = r.whp && r.whp.risk === 'high'
  const oneIn = r.bp && r.bp.oneIn
  const likely = oneIn ? likelihoodWord(oneIn) : null
  const chance = oneIn ? `about a 1-in-${oneIn.toLocaleString()} chance in any given year` : null
  const rpsWord = r.rps && r.rps.word ? r.rps.word.toLowerCase() : null

  if (hazWord && oneIn && rpsWord) {
    if (hazHigh && oneIn >= 1000) {
      // The reads-as-a-contradiction case: high hazard but low likelihood.
      out.push(`If a fire reached here it could burn intensely — the landscape rates ${hazWord} wildfire hazard — but fires are ${likely} in this area (${chance}). So the real-world risk to ${target} is ${rpsWord}: ${r.rps.pct}.`)
    } else {
      out.push(`Wildfire is ${likely} here (${chance}) and the landscape rates ${hazWord} hazard, putting the risk to ${target} at ${rpsWord} — ${r.rps.pct}.`)
    }
  } else if (rpsWord) {
    out.push(`The wildfire risk to ${target} is ${rpsWord}${r.rps.pct ? ` — ${r.rps.pct}` : ''}.`)
  } else if (hazWord && oneIn) {
    out.push(`Wildfire hazard here is ${hazWord}, with ${chance} of a fire.`)
  } else if (hazWord) {
    out.push(`Wildfire hazard here is ${hazWord}.`)
  } else if (oneIn) {
    out.push(`A wildfire here is ${likely} — ${chance}.`)
  } else {
    out.push(`Detailed wildfire-risk data isn't available here (those layers cover the US only).`)
  }

  // 3) How fire could reach it — the actionable angle (risk-reduction zone, else exposure).
  const where = subject ? 'This property' : 'This area'
  if (r.rrz && r.rrz.zone) out.push(`${where} sits in a ${r.rrz.word.toLowerCase()} — ${r.rrz.zone}.`)
  else if (r.exposure && r.exposure.how) out.push(`${where} is ${r.exposure.word.toLowerCase()} — ${r.exposure.how}.`)

  return out.join(' ')
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Build the popup body. `results` is keyed by layer id; a key is present once
// that layer's identify has settled (interpretation object, or null = no data
// here). Rendered progressively: rows stream in, then the summary lands once
// every layer has reported.
// Severity → hero card tint (background / left-border / headline text).
const HERO_SEV = {
  high:     { bg: '#fef2f2', bd: '#dc2626', tx: '#991b1b' },
  moderate: { bg: '#fff7ed', bd: '#f59e0b', tx: '#b45309' },
  low:      { bg: '#f0fdf4', bd: '#16a34a', tx: '#15803d' },
}
const HERO_NEUTRAL = { bg: '#f9fafb', bd: '#9ca3af', tx: '#6b7280' }

// Option A layout: header (place + coords) → severity-tinted hero (one-line
// verdict + plain-language summary) → compact one-line rows → consolidated
// sources footer. `place` arrives async from reverseGeocode.
function renderPopupHTML({ results, lat, lng, place, maxH }) {
  const settled = RASTER_LAYERS.filter((l) => l.id in results).length
  const pending = settled < RASTER_LAYERS.length
  // Cross-layer wildfire verdict, computed once: tints the hero AND becomes the
  // "risk to this parcel" line in the Property card.
  const verdict = pending ? null : buildVerdict(results)

  // Compact one-line rows (short value; full text on hover).
  let rowsHtml = ''
  for (const l of RASTER_LAYERS) {
    const it = results[l.id]
    if (!it) continue
    const dot = `<span class="${styles.popupDot}" style="background:${it.swatch || 'transparent'}"></span>`
    rowsHtml +=
      `<div class="${styles.popupRow}" title="${escapeHtml(it.value)}">${dot}` +
      `<span class="${styles.popupRowLabel}">${escapeHtml(it.popupLabel)}</span>` +
      `<span class="${styles.popupRowValue}">${escapeHtml(it.short)}</span></div>`
  }

  // Consolidated sources footer — one link per distinct source (deduped).
  let footerHtml = ''
  if (rowsHtml) {
    const seen = new Set()
    const links = []
    for (const l of RASTER_LAYERS) {
      const c = results[l.id] && SOURCE_CITATION[l.id]
      if (!c || seen.has(c.url)) continue
      seen.add(c.url)
      links.push(`<a href="${c.url}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(c.short)}">${escapeHtml(c.tag)}</a>`)
    }
    if (links.length) footerHtml = `<div class="${styles.popupSources}">Sources: ${links.join(' · ')} <i style="font-style:normal">↗</i></div>`
  }

  // Hero: verdict headline + plain-language summary, tinted by severity.
  let heroHtml = ''
  if (pending) {
    heroHtml = `<div class="${styles.popupHero}" style="background:${HERO_NEUTRAL.bg};border-left-color:${HERO_NEUTRAL.bd}"><div class="${styles.popupLoading}"><span class="${styles.popupSpinner}"></span>Reading wildfire data…</div></div>`
  } else if (rowsHtml) {
    const sev = verdict ? (HERO_SEV[verdict.sev] || HERO_SEV.moderate) : HERO_NEUTRAL
    const summary = buildSummary(results)
    heroHtml =
      `<div class="${styles.popupHero}" style="background:${sev.bg};border-left-color:${sev.bd}">` +
      (verdict ? `<div class="${styles.popupVerdict}" style="color:${sev.tx}">${escapeHtml(verdict.text)}</div>` : '') +
      `<div class="${styles.popupSummaryText}">${escapeHtml(summary)}</div></div>`
  } else {
    heroHtml = `<div class="${styles.popupNoData}">No wildfire-layer data at this point.</div>`
  }

  const placeLine = place
    ? `<div class="${styles.popupPlace}">${escapeHtml(place)}</div>`
    : `<div class="${styles.popupPlace}">Point check</div>`

  // Opens the same "How this is sourced" modal as the left panel. The popup is
  // a setHTML string (no React handlers), so it's wired via the data attribute
  // + document-level click delegation in the component.
  const methodologyHtml = !pending
    ? `<button type="button" class="${styles.popupMethodology}" data-fire-methodology>How this analysis &amp; data is derived</button>`
    : ''

  // Property card — present whenever the click landed on a parcel, even with
  // the layer toggled off. Carries the wildfire verdict as its risk-to-this-
  // -property line, and its own inline assessor-source citation.
  const parcelHtml = ('parcels' in results)
    ? renderParcelCard(results.parcels, verdict ? verdict.text : null)
    : ''

  const capStyle = maxH ? ` style="max-height:${maxH}px"` : ''
  // Fixed header (place + coords) + a separately-scrolling body. This guarantees
  // the header is never clipped no matter how tall the content or which way the
  // popup is anchored — only the body scrolls.
  return (
    `<div class="${styles.popup}"${capStyle}>` +
    `<div class="${styles.popupHeader}">${placeLine}` +
    `<div class="${styles.popupCoords}">${lat.toFixed(4)}, ${lng.toFixed(4)}</div></div>` +
    `<div class="${styles.popupBody}">` +
    heroHtml +
    parcelHtml +
    rowsHtml +
    footerHtml +
    methodologyHtml +
    `</div>` +
    `</div>`
  )
}

// ─── Basemaps (mirrors /forestmonitor) ───────────────────────────────────────
const BASEMAPS = [
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'dark',      label: 'Dark',      style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light',     label: 'Light',     style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'outdoors',  label: 'Terrain',   style: 'mapbox://styles/mapbox/outdoors-v12' },
  { id: 'streets',   label: 'Streets',   style: 'mapbox://styles/mapbox/streets-v12' },
]
const DEFAULT_BASEMAP_ID = 'satellite'
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style

// Default view: the fire-prone Western US (CA / Great Basin / Southwest), where
// the US-only fire-risk layers carry the headline story.
const DEFAULT_VIEW = { lng: -114, lat: 39.5, zoom: 4.3 }

// ─── URL state ────────────────────────────────────────────────────────────
// Same shareable-link philosophy as /forestmonitor, kept compact:
//   on=whp,lulc            (layers that are ON; omitted when none)
//   op=whp:60,lulc:50      (per-layer opacity %, only non-default)
//   bm=dark                (basemap; omitted when satellite)
//   lat / lng / z          (map view; omitted when at default)
function readUrlState() {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => {
    const v = sp.get(k)
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    on: sp.get('on'),
    op: sp.get('op'),
    ord: sp.get('ord'),
    basemap: sp.get('bm'),
    lat: num('lat'),
    lng: num('lng'),
    zoom: num('z'),
  }
}

// Default layer order (top of panel = top of map), and a sanitizer that keeps
// a URL-supplied order valid: only known ids, no dupes, any missing ids
// appended in default order so a stale link never drops a layer.
const DEFAULT_ORDER = FIRE_LAYERS.map((l) => l.id)
function sanitizeOrder(raw) {
  if (!raw) return DEFAULT_ORDER.slice()
  const wanted = raw.split(',').map((s) => s.trim())
  const seen = new Set()
  const out = []
  for (const id of wanted) {
    if (LAYER_BY_ID[id] && !seen.has(id)) { seen.add(id); out.push(id) }
  }
  for (const id of DEFAULT_ORDER) if (!seen.has(id)) out.push(id)
  return out
}

function parseOpacities(s) {
  const out = {}
  if (!s) return out
  for (const pair of s.split(',')) {
    const [id, pct] = pair.split(':')
    const n = Number(pct)
    if (id && Number.isFinite(n)) out[id.trim()] = Math.max(0, Math.min(1, n / 100))
  }
  return out
}

function writeUrlQuery(qs) {
  if (typeof window === 'undefined') return
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}

export default function FireApp() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)

  // Hydrate from the URL once on mount so shared links recreate the view.
  const initial = (typeof window !== 'undefined') ? readUrlState() : {}
  const initialOn = initial.on != null
    ? new Set(initial.on.split(',').map((s) => s.trim()).filter(Boolean))
    : null
  const initialOp = parseOpacities(initial.op)

  // Per-layer on/off. Default: everything off (a clean satellite map of the West),
  // so the user opts into each dataset — matches the layers+legend-only phase-1 scope.
  const [visible, setVisible] = useState(
    () => Object.fromEntries(FIRE_LAYERS.map((l) => [l.id, initialOn ? initialOn.has(l.id) : false]))
  )
  const [expanded, setExpanded] = useState(
    () => Object.fromEntries(FIRE_LAYERS.map((l) => [l.id, false]))
  )
  // User-controllable layer order (top of panel = top of map). Drag to reorder.
  const [order, setOrder] = useState(() => sanitizeOrder(initial.ord))
  const orderRef = useRef(order)
  useEffect(() => { orderRef.current = order }, [order])
  // Drag-and-drop transient state: id being dragged, and the row + edge it's over.
  const [dragId, setDragId] = useState(null)
  const [dragOver, setDragOver] = useState(null) // { id, after }
  const [opacity, setOpacity] = useState(
    () => Object.fromEntries(FIRE_LAYERS.map((l) => [l.id, initialOp[l.id] != null ? initialOp[l.id] : l.defaultOpacity]))
  )

  // Per-layer tile-load failure flag (set on a Mapbox source 'error', cleared
  // when the layer is toggled so flipping it off/on retries).
  const [loadError, setLoadError] = useState({})

  const [basemap, setBasemap] = useState(
    BASEMAPS.some((b) => b.id === initial.basemap) ? initial.basemap : DEFAULT_BASEMAP_ID
  )
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false)
  const basemapMenuRef = useRef(null)
  const [showMethodology, setShowMethodology] = useState(false)
  // First-click nudge: a transient "click the map" hint, dismissed on the first
  // map click. Session-only (no persistence) — reappears on a fresh load.
  const [showNudge, setShowNudge] = useState(true)

  const [mapView, setMapView] = useState(() => {
    const { lat, lng, zoom } = initial
    return (lat != null && lng != null && zoom != null) ? { lat, lng, zoom } : null
  })
  // Live zoom, used to show "zoom in" hints for high-minzoom layers.
  const [zoom, setZoom] = useState(mapView ? mapView.zoom : DEFAULT_VIEW.zoom)

  // Refs mirror state so the (stable) reconcile fn and style.load handler read
  // the latest values without being torn down and recreated.
  const visibleRef = useRef(visible)
  const opacityRef = useRef(opacity)
  useEffect(() => { visibleRef.current = visible }, [visible])
  useEffect(() => { opacityRef.current = opacity }, [opacity])
  // Cache of fetched cloud-function tile URLs (EE layers), keyed by layer id —
  // these don't change, so fetch once and reuse across basemap swaps.
  const eeTileUrlRef = useRef({})

  // Restack map layers to match the panel order (orderRef): top of panel = top
  // of map. Mapbox draws the last-added layer on top, so we move each layer to
  // the top from the bottom of the desired order upward. Idempotent and cheap;
  // safe to call after any add or reorder. Layers not yet added are skipped.
  const restack = useCallback((map) => {
    if (!map) return
    const ord = orderRef.current
    for (let i = ord.length - 1; i >= 0; i--) {
      if (ord[i] === 'parcels') { restackParcels(map); continue } // vector layer = multiple sublayers
      const lId = layerId(ord[i])
      try { if (map.getLayer(lId)) map.moveLayer(lId) } catch { /* mid style swap */ }
    }
    raiseParcelSelection(map) // clicked-parcel highlight always sits on top
  }, [])

  // Add one raster layer to the map with a resolved XYZ tiles template.
  const addRaster = useCallback((map, layer, tiles) => {
    const sId = sourceId(layer.id)
    const lId = layerId(layer.id)
    if (map.getSource(sId)) return
    try {
      map.addSource(sId, { type: 'raster', tiles: [tiles], tileSize: 256, minzoom: layer.minZoom, attribution: layer.source })
      map.addLayer({
        id: lId,
        type: 'raster',
        source: sId,
        minzoom: layer.minZoom,
        layout: { visibility: visibleRef.current[layer.id] ? 'visible' : 'none' },
        paint: { 'raster-opacity': opacityRef.current[layer.id] ?? layer.defaultOpacity },
      })
      restack(map) // keep z-order in sync as layers (incl. async EE) land
    } catch { /* style swap raced us; harmless */ }
  }, [restack])

  // Cloud-function (EE) tile layers must fetch their tile URL once before the
  // source can be added; ArcGIS layers use the sentinel template directly.
  // The fetch is async, so by the time it resolves the map may have been torn
  // down (StrictMode) or be mid-style-reload — so we always target the LIVE map
  // (mapRef.current) and defer the add until its style is ready.
  const addEeLayer = useCallback(async (map, layer) => {
    if (map.getSource(sourceId(layer.id))) return
    let url = eeTileUrlRef.current[layer.id]
    if (!url) {
      try {
        const r = await fetch(`${TILES_API_BASE}?layer=${layer.eeParam}`)
        const d = await r.json()
        url = d.tileUrl
        if (url) eeTileUrlRef.current[layer.id] = url
      } catch { /* surfaced via the map 'error' path / load hint */ }
    }
    if (!url) { setLoadError((p) => (p[layer.id] ? p : { ...p, [layer.id]: true })); return }
    // Add to the LIVE map (mapRef.current) — the async fetch may have outlived
    // the map this call was started on (StrictMode). addSource/addLayer work
    // even when isStyleLoaded() is transiently false (Mapbox queues them), so
    // no readiness gate — gating on 'idle' here deadlocked (idle already past).
    const live = mapRef.current
    if (live && !live._removed) addRaster(live, layer, url)
  }, [addRaster])

  // ─── (Re)add every layer's source + raster layer to the current style ────
  // Called on first load and again after each basemap switch (setStyle wipes
  // custom sources/layers). Idempotent: skips sources/layers already present.
  const addAllLayers = useCallback((map) => {
    for (const layer of FIRE_LAYERS) {
      if (layer.kind === 'parcels') addParcelLayers(map, visibleRef.current[layer.id], opacityRef.current[layer.id])
      else if (layer.kind === 'ee') addEeLayer(map, layer)
      else addRaster(map, layer, tileTemplate(layer))
    }
    restack(map) // position parcel sublayers + raise selection after (re)adding
  }, [addRaster, addEeLayer, restack])

  // ─── Init map once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN

    const v = mapView || DEFAULT_VIEW
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: basemapStyleFor(basemap),
      center: [v.lng, v.lat],
      zoom: v.zoom,
      projection: 'mercator',
      attributionControl: false,
      // Rewrite our sentinel ArcGIS tiles to real exportImage calls (see
      // resolveArcgisTile). Every other request passes through untouched.
      transformRequest: (url, resourceType) => {
        if (resourceType === 'Tile') {
          const real = resolveArcgisTile(url)
          if (real) return { url: real }
        }
        return { url }
      },
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: false },
        trackUserLocation: false,
        showUserLocation: false,
      }),
      'top-right'
    )

    // Crosshair cursor signals "click a point to inspect" (Mapbox flips to a
    // grab cursor mid-drag, so panning still reads correctly).
    const setCrosshair = () => { const c = map.getCanvas(); if (c) c.style.cursor = 'crosshair' }
    map.on('load', setCrosshair)
    map.on('mouseup', setCrosshair)

    // Force a resize once the container has a real bounding rect — guards the
    // zero-viewport-no-tiles race Mapbox can hit when fonts/CSS load late.
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)

    // Add our raster layers on EVERY style load — this covers the initial load
    // and every basemap switch (setStyle wipes custom sources/layers, then
    // re-fires style.load). A single persistent handler is StrictMode-safe and
    // race-free; addAllLayers is idempotent.
    const onStyleLoad = () => {
      addAllLayers(map)
      setMapReady(true)
    }
    map.on('style.load', onStyleLoad)
    if (map.isStyleLoaded()) onStyleLoad()

    const onMoveEnd = () => {
      const c = map.getCenter()
      setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })
      setZoom(map.getZoom())
    }
    map.on('moveend', onMoveEnd)

    // Surface tile-load failures (e.g. an ArcGIS service that's down or blocked)
    // so a toggled-on layer that can't load shows a clear hint instead of just
    // appearing empty. Map a failing sourceId back to its layer id.
    const onError = (e) => {
      const sid = e && e.sourceId
      if (!sid || !sid.startsWith('fire-')) return
      const id = sid.replace(/^fire-/, '').replace(/-src$/, '')
      if (LAYER_BY_ID[id]) setLoadError((prev) => (prev[id] ? prev : { ...prev, [id]: true }))
    }
    map.on('error', onError)

    mapRef.current = map
    return () => {
      ro.disconnect()
      map.off('error', onError)
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null }
      map.off('moveend', onMoveEnd)
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Per-route document title & meta (covers client-side navigation) ─────
  // The pre-built /fire.html (Vercel rewrite) sets these for crawlers on a cold
  // load; this covers users who land on / first and React-Router to /fire.
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'FireApp — Wildfire risk & fuels · EarthAtlas'
    const setMeta = (selector, value) => {
      const el = document.head.querySelector(selector)
      if (!el) return null
      const prev = el.getAttribute('content')
      el.setAttribute('content', value)
      return prev
    }
    const desc = 'Explore wildfire hazard potential, vegetation fuel state, and land cover across the United States and beyond. An EarthAtlas tool.'
    const prevDesc = setMeta('meta[name="description"]', desc)
    const prevOgTitle = setMeta('meta[property="og:title"]', document.title)
    const prevOgDesc = setMeta('meta[property="og:description"]', desc)
    const prevOgUrl = setMeta('meta[property="og:url"]', 'https://earthatlas.org/fire')
    return () => {
      document.title = prevTitle
      if (prevDesc != null) setMeta('meta[name="description"]', prevDesc)
      if (prevOgTitle != null) setMeta('meta[property="og:title"]', prevOgTitle)
      if (prevOgDesc != null) setMeta('meta[property="og:description"]', prevOgDesc)
      if (prevOgUrl != null) setMeta('meta[property="og:url"]', prevOgUrl)
    }
  }, [])

  // ─── Persist view state to the URL (shareable links) ──────────────────────
  useEffect(() => {
    const sp = new URLSearchParams()
    const on = FIRE_LAYERS.filter((l) => visible[l.id]).map((l) => l.id)
    if (on.length) sp.set('on', on.join(','))
    const op = []
    for (const l of FIRE_LAYERS) {
      const o = opacity[l.id]
      if (visible[l.id] && o != null && Math.abs(o - l.defaultOpacity) > 0.005) {
        op.push(`${l.id}:${Math.round(o * 100)}`)
      }
    }
    if (op.length) sp.set('op', op.join(','))
    if (order.join(',') !== DEFAULT_ORDER.join(',')) sp.set('ord', order.join(','))
    if (basemap !== DEFAULT_BASEMAP_ID) sp.set('bm', basemap)
    if (mapView) {
      sp.set('lat', mapView.lat.toFixed(3))
      sp.set('lng', mapView.lng.toFixed(3))
      sp.set('z', mapView.zoom.toFixed(1))
    }
    writeUrlQuery(sp.toString())
  }, [visible, opacity, order, basemap, mapView])

  // ─── React layer order → Mapbox z-order ───────────────────────────────────
  useEffect(() => {
    if (mapReady) restack(mapRef.current)
  }, [order, mapReady, restack])

  // ─── React layer visibility → Mapbox ──────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    for (const layer of FIRE_LAYERS) {
      if (layer.kind === 'parcels') { applyParcelVisibility(map, visible[layer.id], opacityRef.current[layer.id]); continue }
      const lId = layerId(layer.id)
      if (map.getLayer(lId)) {
        map.setLayoutProperty(lId, 'visibility', visible[layer.id] ? 'visible' : 'none')
      }
    }
  }, [visible, mapReady])

  // ─── React opacity → Mapbox (live, no layer teardown) ─────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    for (const layer of FIRE_LAYERS) {
      if (layer.kind === 'parcels') { applyParcelOpacity(map, opacity[layer.id], visibleRef.current[layer.id]); continue }
      const lId = layerId(layer.id)
      if (map.getLayer(lId)) {
        try { map.setPaintProperty(lId, 'raster-opacity', opacity[layer.id]) } catch {}
      }
    }
  }, [opacity, mapReady])

  // ─── Basemap change ───────────────────────────────────────────────────────
  // Only call setStyle when the basemap actually changes from what's applied
  // (tracked in a ref, seeded with the initial value). This is StrictMode-safe
  // — a double-invoked effect sees the ref already matching and no-ops — and
  // avoids a needless setStyle on mount. The persistent style.load handler in
  // the init effect re-adds our layers after the new style loads.
  const appliedBasemapRef = useRef(basemap)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (appliedBasemapRef.current === basemap) return
    appliedBasemapRef.current = basemap
    map.setStyle(basemapStyleFor(basemap))
  }, [basemap, mapReady])

  // ─── Close basemap menu on outside click ──────────────────────────────────
  useEffect(() => {
    if (!basemapMenuOpen) return
    const onDoc = (e) => {
      if (basemapMenuRef.current && !basemapMenuRef.current.contains(e.target)) {
        setBasemapMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [basemapMenuOpen])

  // ─── Click → identify every layer, draw a plain-language popup ────────────
  // Queries all panel layers (not just visible ones — the point reading is
  // useful regardless of what's drawn) via the identify proxy, in parallel,
  // and streams rows into the popup as each resolves; the cross-layer summary
  // lands once all have reported. Stable effect: reads mapRef/popupRef.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handler = (e) => {
      const { lng, lat } = e.lngLat
      setShowNudge(false) // first interaction → retire the hint
      if (popupRef.current) popupRef.current.remove()

      // Position the popup deterministically from the click pixel so it always
      // fits the window: anchor toward whichever side has more room, and cap the
      // body's max-height to that space (it then scrolls internally if the
      // content is taller). Mapbox's own auto-anchor uses the popup's initial
      // (tiny, still-loading) height, so a popup that grows after open can
      // overflow — this avoids that entirely.
      const cont = map.getContainer()
      const mapW = cont.clientWidth, mapH = cont.clientHeight
      const px = e.point.x, py = e.point.y
      const vMargin = 24
      const vert = (mapH - py) >= py ? 'top' : 'bottom' // 'top' anchor = popup below the point
      const availV = (vert === 'top' ? mapH - py : py) - vMargin
      const maxH = Math.max(180, Math.min(Math.round(mapH * 0.82), availV))
      const horiz = px < mapW / 3 ? 'left' : px > (mapW * 2) / 3 ? 'right' : ''
      const anchor = horiz ? `${vert}-${horiz}` : vert

      const results = {} // layer id → interpretation | null (key present = settled)
      let place = null   // reverse-geocoded "City, ST" — fills in async

      // Parcel lookup is synchronous (baked into the vector tile) and runs on
      // EVERY click regardless of whether the Parcels layer is toggled on — so
      // the property card is ambient context, and the wildfire rows below tie
      // risk to this specific parcel. Highlights the clicked parcel.
      try {
        const hit = queryParcelAt(map, e.point)
        results.parcels = hit || null
        if (hit) setParcelSelection(map, hit.geometry)
        else clearParcelSelection(map)
      } catch { results.parcels = null }
      // maxWidth 'none' so our CSS clamp() controls width responsively; anchor
      // fixed so the popup never re-flips into the off-screen direction as it grows.
      const popup = new mapboxgl.Popup({ closeButton: true, maxWidth: 'none', offset: 14, anchor })
        .setLngLat([lng, lat])
        .setHTML(renderPopupHTML({ results, lat, lng, place, maxH }))
        .addTo(map)
      popupRef.current = popup
      popup.on('close', () => { try { clearParcelSelection(map) } catch {} })
      const stillCurrent = () => popupRef.current === popup
      const rerender = () => {
        if (!stillCurrent()) return
        popup.setHTML(renderPopupHTML({ results, lat, lng, place, maxH }))
        // Keep the body pinned to the top so the verdict shows first (the
        // streaming re-renders can otherwise leave it scrolled mid-content).
        const el = popup.getElement()
        const body = el && el.querySelector(`.${styles.popupBody}`)
        if (body) body.scrollTop = 0
      }

      // Place name for the header (Mapbox reverse geocode; falls back to coords).
      reverseGeocode(lat, lng).then((name) => { if (name) { place = name; rerender() } }).catch(() => {})

      // Per-layer point reader → the raw value interpretLayer expects:
      //   ee         → cloud function ?greenonly (NDVI number)
      //   colormatch → rendered-pixel class match (WHP — see readWhpClass)
      //   default    → ArcGIS identify via the proxy (raw pixel value)
      const readRaw = (layer) => {
        if (layer.kind === 'ee') {
          return fetch(`${TILES_API_BASE}?lat=${lat}&lng=${lng}&greenonly=1`).then((r) => r.json()).then((d) => d.ndvi)
        }
        if (layer.point === 'colormatch') {
          return readRenderedClass(layer, lat, lng)
        }
        return fetch(`${IDENTIFY_API}?base=${encodeURIComponent(layer.baseUrl)}&lat=${lat}&lng=${lng}`).then((r) => r.json()).then((d) => d.value)
      }

      FIRE_LAYERS.forEach((layer) => {
        if (layer.kind === 'parcels') return // not a raster identify — handled above
        Promise.resolve()
          .then(() => readRaw(layer))
          .then((raw) => { results[layer.id] = interpretLayer(layer.id, raw) })
          .catch(() => { results[layer.id] = null })
          .finally(rerender)
      })
    }
    map.on('click', handler)
    return () => map.off('click', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The popup's "How this analysis & data is derived" link lives in a setHTML
  // string, so catch its click via delegation and open the same modal the left
  // panel uses.
  useEffect(() => {
    const onDocClick = (e) => {
      if (e.target.closest && e.target.closest('[data-fire-methodology]')) {
        setShowMethodology(true)
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleLayer = (id) => {
    setLoadError((e) => (e[id] ? { ...e, [id]: false } : e)) // clear → retry on next show
    setVisible((v) => ({ ...v, [id]: !v[id] }))
  }
  const toggleExpanded = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))
  const setLayerOpacity = (id, val) => setOpacity((o) => ({ ...o, [id]: val }))

  // ─── Drag-to-reorder (HTML5 DnD; only the grip handle is draggable so the
  // toggle/opacity controls keep working) ───────────────────────────────────
  const onDragStart = (e, id) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', id) } catch { /* some browsers are picky */ }
  }
  const onRowDragOver = (e, id) => {
    if (!dragId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    const after = (e.clientY - r.top) > r.height / 2
    if (!dragOver || dragOver.id !== id || dragOver.after !== after) setDragOver({ id, after })
  }
  const onRowDrop = (e, id) => {
    e.preventDefault()
    const from = dragId || (() => { try { return e.dataTransfer.getData('text/plain') } catch { return null } })()
    const after = dragOver && dragOver.id === id ? dragOver.after : false
    setDragId(null); setDragOver(null)
    if (!from || from === id) return
    setOrder((cur) => {
      const arr = cur.filter((x) => x !== from)
      let idx = arr.indexOf(id)
      if (idx < 0) return cur
      if (after) idx += 1
      arr.splice(idx, 0, from)
      return arr
    })
  }
  const onDragEnd = () => { setDragId(null); setDragOver(null) }

  return (
    <div className={styles.container}>
      <div className={styles.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}

      {/* Branding */}
      <div className={styles.branding}>
        <a className={styles.brandingLink} href="/" aria-label="EarthAtlas home">
          <span className={styles.wordmark}>Earth<em>Atlas</em></span>
        </a>
        <span className={styles.subBadge}>FireApp</span>
      </div>

      {/* Search (same proxy + fly-to behavior as /forestmonitor) */}
      <div className={styles.searchBox}>
        <GeoSearch
          placeholder="Search any location…"
          proximity={() => {
            const m = mapRef.current
            if (!m) return undefined
            try { const c = m.getCenter(); return { lng: c.lng, lat: c.lat } } catch { return undefined }
          }}
          onSelect={(r) => {
            const m = mapRef.current
            if (!m) return
            if (r.bbox && r.bbox.length === 4) {
              m.fitBounds(
                [[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]],
                { padding: 80, duration: 1400, maxZoom: 14 },
              )
            } else if (Number.isFinite(r.lng) && Number.isFinite(r.lat)) {
              m.flyTo({ center: [r.lng, r.lat], zoom: r.zoom, duration: 1400, essential: true })
            }
          }}
        />
      </div>

      {/* Basemap picker */}
      <div className={styles.basemapMenu} ref={basemapMenuRef}>
        <button
          className={basemapMenuOpen ? styles.basemapToggleActive : styles.basemapToggle}
          onClick={() => setBasemapMenuOpen((o) => !o)}
          aria-label="Choose basemap"
          title="Basemap"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        </button>
        {basemapMenuOpen && (
          <div className={styles.basemapMenuPanel}>
            <div className={styles.basemapMenuTitle}>Basemap</div>
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                className={b.id === basemap ? styles.basemapMenuItemActive : styles.basemapMenuItem}
                onClick={() => { setBasemap(b.id); setBasemapMenuOpen(false) }}
              >
                <span className={`${styles.basemapSwatch} ${styles[`basemapSwatch_${b.id}`]}`} />
                <span className={styles.basemapMenuItemLabel}>{b.label}</span>
                {b.id === basemap && <span className={styles.basemapMenuCheck}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Layer panel */}
      <div className={styles.layerPanel}>
        <p className={styles.layerIntro}>
          Click any point on Earth to assess its wildfire risk. Or jump to a place with the search bar above.
        </p>
        <div className={styles.layerPanelTitle}>Fire layers</div>
        {order.map((id) => {
          const layer = LAYER_BY_ID[id]
          if (!layer) return null
          const isOn = visible[layer.id]
          const isOpen = expanded[layer.id]
          const belowMinZoom = isOn && zoom < layer.minZoom
          const isDragging = dragId === layer.id
          const isOverBefore = dragOver && dragOver.id === layer.id && !dragOver.after && dragId !== layer.id
          const isOverAfter = dragOver && dragOver.id === layer.id && dragOver.after && dragId !== layer.id
          const rowClass = [
            styles.layerRow,
            isDragging ? styles.layerRowDragging : '',
            isOverBefore ? styles.dropBefore : '',
            isOverAfter ? styles.dropAfter : '',
          ].filter(Boolean).join(' ')
          return (
            <div
              className={rowClass}
              key={layer.id}
              onDragOver={(e) => onRowDragOver(e, layer.id)}
              onDrop={(e) => onRowDrop(e, layer.id)}
            >
              <div className={styles.layerHeader}>
                <span
                  className={styles.dragHandle}
                  draggable
                  onDragStart={(e) => onDragStart(e, layer.id)}
                  onDragEnd={onDragEnd}
                  role="button"
                  aria-label={`Drag to reorder ${layer.label}`}
                  title="Drag to reorder"
                >
                  <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
                    <circle cx="2.5" cy="3" r="1.3" /><circle cx="7.5" cy="3" r="1.3" />
                    <circle cx="2.5" cy="8" r="1.3" /><circle cx="7.5" cy="8" r="1.3" />
                    <circle cx="2.5" cy="13" r="1.3" /><circle cx="7.5" cy="13" r="1.3" />
                  </svg>
                </span>
                <button
                  className={styles.layerCaret}
                  onClick={() => toggleExpanded(layer.id)}
                  aria-label={isOpen ? 'Collapse' : 'Expand'}
                  aria-expanded={isOpen}
                >
                  <span className={isOpen ? styles.caretOpen : styles.caretClosed}>▶</span>
                </button>
                <span className={styles.layerName}>{layer.label}</span>
                <button
                  className={isOn ? styles.switchOn : styles.switchOff}
                  onClick={() => toggleLayer(layer.id)}
                  role="switch"
                  aria-checked={isOn}
                  aria-label={`Toggle ${layer.label}`}
                >
                  <span className={styles.switchKnob} />
                </button>
              </div>

              {/* Load-failure hint takes precedence; else coverage / zoom hint. */}
              {isOn && loadError[layer.id] ? (
                <div className={styles.layerError}>
                  Couldn’t load this layer — the data service may be temporarily unavailable. Toggle off and on to retry.
                </div>
              ) : isOn ? (
                <div className={styles.layerHint}>
                  {belowMinZoom
                    ? `Zoom in to about z${layer.minZoom} to load this layer — ${layer.coverage}`
                    : layer.coverage}
                </div>
              ) : null}

              {isOpen && (
                <div className={`${styles.layerBody} ${isOn ? '' : styles.layerBodyMuted}`}>
                  <div className={styles.opacityControl}>
                    <div className={styles.opacityHeader}>
                      <span className={styles.opacityLabel}>Opacity</span>
                      <span className={styles.opacityValue}>{Math.round(opacity[layer.id] * 100)}%</span>
                    </div>
                    <input
                      className={styles.opacitySlider}
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(opacity[layer.id] * 100)}
                      onChange={(e) => setLayerOpacity(layer.id, Number(e.target.value) / 100)}
                      disabled={!isOn}
                    />
                  </div>

                  {/* Legend */}
                  {layer.legend.kind === 'gradient' ? (
                    <>
                      <div className={styles.legendGradient} style={{ background: layer.legend.css }} />
                      <div className={styles.legendScale}>
                        <span>{layer.legend.left}</span>
                        <span>{layer.legend.right}</span>
                      </div>
                    </>
                  ) : (
                    <ul className={styles.legendList}>
                      {layer.legend.items.map((it) => (
                        <li key={it.l}>
                          <span className={styles.swatch} style={{ background: it.c }} />
                          {it.l}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className={styles.legendBlurb}>
                    {layer.blurb}
                    <span className={styles.legendSource}>Source: {layer.source}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        <button type="button" className={styles.methodology} onClick={() => setShowMethodology(true)}>
          ⓘ How this is sourced
        </button>

        <div className={styles.builtBy}>
          EarthAtlas is built by{' '}
          <a href="https://knauernever.com" target="_blank" rel="noopener noreferrer" className={styles.builtByLink}>
            KnauerNever.com
          </a>
        </div>
      </div>

      {showNudge && mapReady && (
        <div className={styles.nudge} aria-hidden="true">
          <span className={styles.nudgeDot} />
          Click anywhere to inspect a point
        </div>
      )}

      <div className={styles.tip}>
        Wildfire-risk layers cover the US; vegetation &amp; land cover are global · more layers coming
      </div>

      {showMethodology && <MethodologyModal onClose={() => setShowMethodology(false)} />}
    </div>
  )
}

// ─── "How this is sourced" modal ────────────────────────────────────────────
function MethodologyModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">×</button>
        <h2 className={styles.modalTitle}>How this is sourced</h2>

        <section className={styles.modalSection}>
          <h3>What you're looking at</h3>
          <p>
            Most layers are raster overlays served live from the agency that publishes them — there's no
            EarthAtlas database in between. The wildfire-risk layers model the long-term landscape, not
            active fire: they answer "if a fire started here, how bad could it get, and how likely is it,"
            not "is something burning right now." Property parcels are public county-assessor boundaries,
            pre-packaged as map tiles so they load fast without hammering the source.
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>The layers</h3>
          <p>
            Every layer in the panel, with what it shows and where it comes from. The six wildfire-risk
            layers are modeled long-term risk for the United States from the USDA Forest Service, Rocky
            Mountain Research Station's{' '}
            <a href="https://wildfirerisk.org" target="_blank" rel="noopener noreferrer">Wildfire Risk to Communities</a>{' '}
            program (2024), streamed live from their public ArcGIS image services.
          </p>
          {LAYER_GROUPS.map((group) => (
            <div key={group}>
              <p className={styles.modalGroupLabel}>{group}</p>
              <ul>
                {FIRE_LAYERS.filter((l) => l.group === group).map((l) => {
                  const cite = SOURCE_CITATION[l.id]
                  return (
                    <li key={l.id}>
                      <strong>{l.label}</strong> — {l.blurb}{cite && (
                        <>
                          {' '}
                          <a href={cite.url} target="_blank" rel="noopener noreferrer" title={l.source}>{cite.tag} ↗</a>
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>

        <section className={styles.modalSection}>
          <h3>When you click a point</h3>
          <p>
            We query each layer at that exact location (ArcGIS identify for the agency rasters, the Earth
            Engine function for NDVI) and translate the raw values into plain language. If you click inside
            a mapped parcel, its assessor details are read straight from the tile and the wildfire reading
            is tied to that specific property — whether or not the parcels layer is switched on. Place
            search uses Mapbox geocoding; basemaps are Mapbox.
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>Caveats</h3>
          <p>
            The wildfire-risk layers are <strong>United States only</strong> and are long-term modeled
            estimates, <strong>not forecasts</strong> of current conditions. NDVI and land cover are global.
            For active fire, defer to official sources such as NASA FIRMS and local agencies.
          </p>
        </section>
      </div>
    </div>
  )
}
