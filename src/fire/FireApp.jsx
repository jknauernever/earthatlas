import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import GeoSearch from '../components/GeoSearch.jsx'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
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
    label: 'Risk to homes',
    group: 'Risk to communities',
    // Risk to Potential Structures — WRC's headline layer: if a home stood
    // here, its relative wildfire risk vs. the rest of the US (percentiles).
    baseUrl: 'https://imagery.geoplatform.gov/iipp/rest/services/Fire_Aviation/USFS_EDW_RMRS_WRC_RiskToPotentialStructures/ImageServer',
    renderingRule: JSON.stringify({ rasterFunction: 'RPS' }),
    point: 'colormatch',
    colormatch: [
      { label: 'None', hex: '#ffffff', skip: true },
      { label: 'Low',       hex: '#f1f2a0', pct: 'in the lower 40% of the US', risk: 'low' },
      { label: 'Moderate',  hex: '#f2c13c', pct: 'in the middle of the pack for the US (40–70th percentile)', risk: 'moderate' },
      { label: 'High',      hex: '#f28017', pct: 'in the top 30% of US wildfire risk to homes', risk: 'high' },
      { label: 'Very high', hex: '#f21900', pct: 'in the top 10% of US wildfire risk to homes', risk: 'high' },
      { label: 'Extreme',   hex: '#c4001a', pct: 'in the top 5% of US wildfire risk to homes', risk: 'high' },
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
    blurb: 'If a home stood on this spot, how at-risk would it be — likelihood and intensity combined, ranked against the whole US. The headline layer of the USFS Wildfire Risk to Communities project.',
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
      { label: 'Indirect exposure zone', hex: '#f5c766', zone: 'homes here face embers and home-to-home spread rather than direct flames — hardening homes matters most' },
      { label: 'Direct exposure zone', hex: '#ff3b54', zone: 'flames can reach homes directly from surrounding wildland — defensible space and fuel breaks matter most' },
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
    blurb: 'Where wildfire mitigation matters, and what kind: zones where homes face direct flames, ember/indirect exposure, or the wildland areas that transmit fire toward communities.',
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
const LAYER_BY_ID = Object.fromEntries(FIRE_LAYERS.map((l) => [l.id, l]))

// ─── Per-attribute provenance (credibility & traceability — a prime directive
// across earthatlas.org) ─────────────────────────────────────────────────────
// Every value shown in the popup carries its own visible, clickable source, so
// a reader never has to guess where a number came from. `short` is the label
// shown inline; `url` links to the authoritative public page ("more info"); the
// precise per-dataset citation (layer.source) rides along as the hover title.
const CITE_WRC = { short: 'USDA Forest Service · Wildfire Risk to Communities', url: 'https://wildfirerisk.org' }
const SOURCE_CITATION = {
  whp: CITE_WRC, bp: CITE_WRC, cfl: CITE_WRC, rps: CITE_WRC, rrz: CITE_WRC, exposure: CITE_WRC,
  ndvi: { short: 'Sentinel-2 (Copernicus) via Google Earth Engine', url: 'https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED' },
  lulc: { short: 'Esri / Impact Observatory · Sentinel-2 Land Cover', url: 'https://livingatlas.arcgis.com/landcoverexplorer/' },
}

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
function interpretLayer(id, value) {
  if (value == null) return null
  // Color-matched WRC layers: value is the matched colormatch entry
  // { label, hex, ...extras } from readRenderedClass; `skip:true` entries are
  // NA/empty classes that shouldn't render a row.
  if (value.skip) return null
  if (id === 'whp') {
    if (!value.label) return null
    return { popupLabel: 'Wildfire hazard', value: value.label, swatch: value.hex, risk: value.risk, word: value.label }
  }
  if (id === 'cfl') {
    if (!value.label) return null
    return { popupLabel: 'Flame length', value: `${value.label} — ${value.fire}`, swatch: value.hex, feet: value.label, fire: value.fire }
  }
  if (id === 'rps') {
    if (!value.label) return null
    return { popupLabel: 'Risk to homes', value: `${value.label} — ${value.pct}`, swatch: value.hex, risk: value.risk, word: value.label, pct: value.pct }
  }
  if (id === 'rrz') {
    if (!value.label) return null
    return { popupLabel: 'Risk zone', value: value.label, swatch: value.hex, zone: value.zone, word: value.label }
  }
  if (id === 'exposure') {
    if (!value.label) return null
    return { popupLabel: 'Exposure', value: value.label, swatch: value.hex, how: value.how, word: value.label }
  }
  if (id === 'bp') {
    const n = Number(value)
    if (!Number.isFinite(n)) return null
    if (n <= 0) return { popupLabel: 'Burn probability', value: 'Negligible', swatch: '#fff0cf', risk: 'low', oneIn: null }
    const prob = n / 1e4 // WRC service stores annual probability × 10,000
    const oneIn = Math.max(1, Math.round(1 / prob))
    const b = burnBand(oneIn)
    return { popupLabel: 'Burn probability', value: `${b.word} — about a 1-in-${oneIn.toLocaleString()} chance per year`, swatch: b.color, risk: b.risk, word: b.word, oneIn }
  }
  if (id === 'ndvi') {
    // Cloud function returns the NDVI value directly (Sentinel-2 median).
    const ndvi = Number(value)
    if (!Number.isFinite(ndvi)) return null
    return { popupLabel: 'Vegetation (NDVI)', value: `${ndviCondition(ndvi)} (NDVI ${ndvi.toFixed(2)})`, swatch: ndviColor(ndvi), ndvi }
  }
  if (id === 'lulc') {
    const n = Math.round(Number(value))
    const label = LULC_CLASSES[n]
    if (!label) return null
    return { popupLabel: 'Land cover', value: label, swatch: LULC_COLORS[n] || null, cover: label }
  }
  return null
}

// Land-cover class → a natural noun phrase for the summary sentence.
const COVER_PHRASE = {
  Water: 'open water', Trees: 'forested land', 'Flooded vegetation': 'wetland / flooded vegetation',
  Crops: 'cropland', 'Built area': 'developed, built-up land', 'Bare ground': 'bare ground',
  'Snow / ice': 'snow or ice', Clouds: 'cloud-obscured ground', Rangeland: 'rangeland (grass and shrub)',
}

// Build the plain-English cross-layer summary from whatever resolved.
// r is keyed by layer id → interpretation (or null/absent).
function buildSummary(r) {
  const out = []

  // 1. What's on the ground.
  if (r.lulc) out.push(`You've clicked on ${COVER_PHRASE[r.lulc.cover] || r.lulc.cover.toLowerCase()}.`)
  else if (r.ndvi) out.push(`The ground here reads as ${ndviCondition(r.ndvi.ndvi).toLowerCase()}.`)

  // 2. Vegetation / fuel state (skip when we already led with NDVI, or over water).
  if (r.ndvi && r.lulc && r.ndvi.ndvi >= 0) {
    const n = r.ndvi.ndvi
    if (n >= 0.6) out.push('The vegetation is dense and green.')
    else if (n >= 0.4) out.push('The vegetation is moderately green.')
    else if (n >= 0.2) out.push('The vegetation is sparse or drying — drier fuel.')
    else out.push('There’s little green vegetation — bare or very dry.')
  }

  // 3. Wildfire risk — prefer the composite hazard, fall back to burn probability.
  if (r.whp && r.bp && r.bp.oneIn) {
    out.push(`Wildfire hazard is ${r.whp.value.toLowerCase()}, with a modeled burn likelihood of roughly 1-in-${r.bp.oneIn.toLocaleString()} per year.`)
  } else if (r.whp) {
    out.push(`Overall wildfire hazard here is ${r.whp.value.toLowerCase()}.`)
  } else if (r.bp && r.bp.oneIn) {
    out.push(`Modeled wildfire likelihood is ${r.bp.word.toLowerCase()} — about a 1-in-${r.bp.oneIn.toLocaleString()} chance of burning in a typical year.`)
  } else if (r.bp) {
    out.push('Modeled wildfire likelihood here is negligible.')
  } else {
    out.push('Wildfire-risk data isn’t available here (those layers cover the US only).')
  }

  // 4. Intensity — what a fire here would look like (Conditional Flame Length).
  if (r.cfl) {
    out.push(`If one starts, expect flames of ${r.cfl.feet} — ${r.cfl.fire}.`)
  }

  // 5. What it means for homes/communities — prefer the headline Risk to Homes
  // percentile; the risk-reduction zone adds the "what kind of exposure" angle.
  if (r.rps) {
    out.push(`For a home on this spot, wildfire risk would be ${r.rps.word.toLowerCase()} — ${r.rps.pct}.`)
  }
  if (r.rrz && r.rrz.zone) {
    out.push(`This is a ${r.rrz.word.toLowerCase()}: ${r.rrz.zone}.`)
  } else if (r.exposure && r.exposure.how && !r.rps) {
    out.push(`It is ${r.exposure.word.toLowerCase()} — ${r.exposure.how}.`)
  }

  // 6. A light interpretive nudge for the classic fire-prone combination.
  const fireRisk = (r.whp && r.whp.risk) || (r.bp && r.bp.risk)
  if (r.lulc && r.lulc.cover === 'Trees' && fireRisk === 'high' && !r.rrz) {
    out.push('Forested, fire-prone terrain — the kind of place to watch in fire season.')
  }

  return out.join(' ')
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Build the popup body. `results` is keyed by layer id; a key is present once
// that layer's identify has settled (interpretation object, or null = no data
// here). Rendered progressively: rows stream in, then the summary lands once
// every layer has reported.
function renderPopupHTML({ results, lat, lng }) {
  const settled = FIRE_LAYERS.filter((l) => l.id in results).length
  const pending = settled < FIRE_LAYERS.length

  let rowsHtml = ''
  for (const l of FIRE_LAYERS) {
    const it = results[l.id]
    if (!it) continue
    const dot = it.swatch
      ? `<span class="${styles.popupDot}" style="background:${it.swatch}"></span>`
      : `<span class="${styles.popupDot}"></span>`
    // Inline, clickable provenance for THIS attribute. The link opens the
    // authoritative source; the hover title carries the exact dataset citation.
    const cite = SOURCE_CITATION[l.id]
    const full = escapeHtml(l.source || (cite && cite.short) || '')
    const srcHtml = cite
      ? `<a class="${styles.popupRowSrc}" href="${cite.url}" target="_blank" rel="noopener noreferrer" title="${full}">${escapeHtml(cite.short)} ↗</a>`
      : (l.source ? `<span class="${styles.popupRowSrc}" title="${full}">${escapeHtml(l.source)}</span>` : '')
    rowsHtml +=
      `<div class="${styles.popupRow}">${dot}` +
      `<div class="${styles.popupRowMain}">` +
      `<span class="${styles.popupRowLabel}">${escapeHtml(it.popupLabel)}</span>` +
      `<span class="${styles.popupRowValue}">${escapeHtml(it.value)}</span>` +
      srcHtml +
      `</div></div>`
  }

  const summary = !pending && rowsHtml ? buildSummary(results) : ''
  return (
    `<div class="${styles.popup}">` +
    `<div class="${styles.popupHeader}">Point check</div>` +
    `<div class="${styles.popupCoords}">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>` +
    (rowsHtml || (!pending ? `<div class="${styles.popupNoData}">No layer data at this point.</div>` : '')) +
    (pending ? `<div class="${styles.popupLoading}"><span class="${styles.popupSpinner}"></span>Checking layers…</div>` : '') +
    (summary ? `<div class="${styles.popupSummary}"><div class="${styles.popupSummaryLabel}">In plain terms</div>${escapeHtml(summary)}</div>` : '') +
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
    basemap: sp.get('bm'),
    lat: num('lat'),
    lng: num('lng'),
    zoom: num('z'),
  }
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
    } catch { /* style swap raced us; harmless */ }
  }, [])

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
      if (layer.kind === 'ee') addEeLayer(map, layer)
      else addRaster(map, layer, tileTemplate(layer))
    }
  }, [addRaster, addEeLayer])

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
    if (basemap !== DEFAULT_BASEMAP_ID) sp.set('bm', basemap)
    if (mapView) {
      sp.set('lat', mapView.lat.toFixed(3))
      sp.set('lng', mapView.lng.toFixed(3))
      sp.set('z', mapView.zoom.toFixed(1))
    }
    writeUrlQuery(sp.toString())
  }, [visible, opacity, basemap, mapView])

  // ─── React layer visibility → Mapbox ──────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    for (const layer of FIRE_LAYERS) {
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
      if (popupRef.current) popupRef.current.remove()

      const results = {} // layer id → interpretation | null (key present = settled)
      const popup = new mapboxgl.Popup({ closeButton: true, maxWidth: '340px', offset: 14 })
        .setLngLat([lng, lat])
        .setHTML(renderPopupHTML({ results, lat, lng }))
        .addTo(map)
      popupRef.current = popup
      const stillCurrent = () => popupRef.current === popup

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
        Promise.resolve()
          .then(() => readRaw(layer))
          .then((raw) => { results[layer.id] = interpretLayer(layer.id, raw) })
          .catch(() => { results[layer.id] = null })
          .finally(() => { if (stillCurrent()) popup.setHTML(renderPopupHTML({ results, lat, lng })) })
      })
    }
    map.on('click', handler)
    return () => map.off('click', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleLayer = (id) => {
    setLoadError((e) => (e[id] ? { ...e, [id]: false } : e)) // clear → retry on next show
    setVisible((v) => ({ ...v, [id]: !v[id] }))
  }
  const toggleExpanded = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))
  const setLayerOpacity = (id, val) => setOpacity((o) => ({ ...o, [id]: val }))

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
        <div className={styles.layerPanelTitle}>Fire layers</div>
        {FIRE_LAYERS.map((layer, i) => {
          const isOn = visible[layer.id]
          const isOpen = expanded[layer.id]
          const belowMinZoom = isOn && zoom < layer.minZoom
          // Section header whenever the group changes (catalog is ordered by group).
          const newGroup = layer.group && (i === 0 || FIRE_LAYERS[i - 1].group !== layer.group)
          return (
            <div className={styles.layerRow} key={layer.id}>
              {newGroup && <div className={styles.layerGroup}>{layer.group}</div>}
              <div className={styles.layerHeader}>
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

      <div className={styles.tip}>
        Click anywhere to inspect a point · the wildfire-risk layers cover the US only · more layers coming
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
            Each layer is a raster overlay served live from the agency that publishes it — there's no
            EarthAtlas database in between. The wildfire-risk layers model the long-term landscape, not
            active fire: they answer "if a fire started here, how bad could it get, and how likely is it,"
            not "is something burning right now."
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>The layers</h3>
          <ul>
            <li>
              <strong>Wildfire hazard &amp; risk to communities</strong> — Wildfire Hazard Potential, Burn
              Probability, Conditional Flame Length, Risk to Homes, Risk Reduction Zones, and Exposure Type
              are all modeled long-term wildfire risk for the United States from the USDA Forest Service,
              Rocky Mountain Research Station's{' '}
              <a href="https://wildfirerisk.org" target="_blank" rel="noopener noreferrer">Wildfire Risk to Communities</a>{' '}
              program (2024 data), streamed live from their public ArcGIS image services.
            </li>
            <li>
              <strong>Vegetation greenness (NDVI)</strong> — recent cloud-masked{' '}
              <strong>Sentinel-2</strong> (Copernicus) imagery, last 12 months, computed in Google Earth
              Engine via the same EarthAtlas cloud function that powers the Forest Monitor. A proxy for fuel
              state — browned vegetation is drier, more flammable. Global.
            </li>
            <li>
              <strong>Land cover</strong> — Esri / Impact Observatory 10 m Sentinel-2 land cover. Global.
            </li>
          </ul>
        </section>

        <section className={styles.modalSection}>
          <h3>When you click a point</h3>
          <p>
            We query each layer at that exact location (ArcGIS identify for the agency rasters, the Earth
            Engine function for NDVI) and translate the raw values into plain language. Place search uses
            Mapbox geocoding; basemaps are Mapbox.
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
