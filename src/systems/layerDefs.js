/**
 * /systems layer definitions — one entry per dataset, everything the app
 * needs to load, render, legend, and explain it. Pure data + formatters
 * (no React). Adding a layer = adding an entry here plus its bake in
 * api/_systems-datasets.js — see SYSTEMS-NOTES.md §3.
 *
 * Vector layers animate via windParticles.js (all three speed-shaping pieces
 * come from `vector` opts — retuned per dataset, currents are ~20× slower
 * than wind). Scalar layers paint via scalarOverlay.js. Scalar layers are
 * mutually exclusive (one "surface color" slot); vector layers stack.
 */

import { fetchQuakes, magColor, MAG_RAMP } from '../quakes/quakesService.js'
import { loadSystemsJson, systemsAssetBase } from './windField.js'
import { traceCardShell, traceCardBody, displayName } from './traceCard.js'
import { loadTraceIndex, peekTraceDetail, loadTraceDetail, traceMixHtml, traceMixFacts, measureInfo, MEASURE_SUFFIX, AIR_CAVEAT_SHORT, MonthTape, SECTOR_STYLE, sectorStyle, seriesChartSvg, subsectorWord, tonnesWord, monthWord, CONFIDENCE_WORDS, TRACE_URL, TRACE_RELEASE } from './traceData.js'
import { stageColor, stageWord, CAT_COLORS, TYPE_WORDS, WW_MEANING, windWord, whenLabel } from './stormsOverlay.js'
import { FUNGI_MEASURES, DEFAULT_FUNGI, FUNGI_COVERAGE, SPUN_URL, loadFungiField, fungiPopup } from './fungiData.js'

// Per-layer  +  (24×24 monoline, stroke=currentColor) come from
// the Claude Design handoff (EarthAtlas collapsed navigation proposals, #3a/#4a).

// ─── Shared formatters ──────────────────────────────────────────────────────

// "Aug 20, 12z UTC" — the standard way model runs are named.
export function fmtRun(ms) {
  const d = new Date(ms)
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${day}, ${String(d.getUTCHours()).padStart(2, '0')}z UTC`
}

export function fmtDay(ms) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// Provenance tail for a replay frame's popup: which archive frame is on
// screen (with its run/lead for model tapes, plain "daily frame" for daily
// satellite analyses), or "latest" when the tape is at NOW.
export function tapeStamp(meta, liveText) {
  if (!meta?.tape) return null
  const daily = (meta.step_ms || 0) >= 23 * 3.6e6
  if (meta.live) return liveText
  if (daily) return `daily frame ${fmtDay(meta.valid_ms)}`
  return `archive frame, ${fmtRun(meta.valid_ms)} · run ${fmtRun(meta.run_ms)} +${meta.lead_h} h`
}

export function agoWord(ms) {
  const h = (Date.now() - ms) / 3.6e6
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`
  if (h < 48) return `${Math.round(h)} h ago`
  return `${Math.round(h / 24)} days ago`
}

const COMPASS_8 = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
const bearingWord = (deg) => COMPASS_8[Math.round(((deg % 360) + 360) % 360 / 45) % 8]

// CSS gradient with stops at their true positions (not evenly spaced).
export function rampGradient(stops, min, max) {
  const span = max - min
  return `linear-gradient(to right, ${stops
    .filter(([v]) => v >= min && v <= max)
    .map(([v, c]) => `${c} ${(((v - min) / span) * 100).toFixed(0)}%`)
    .join(', ')})`
}

const wordFor = (words, value) => words.find((w) => value < w.max) || words[words.length - 1]

// ─── Color ramps ────────────────────────────────────────────────────────────

const WIND_STOPS = [
  [0, 'rgba(134,163,171,0.9)'],
  [3, 'rgba(110,143,208,0.95)'],
  [6, 'rgba(15,147,167,0.95)'],
  [9, 'rgba(57,163,57,0.95)'],
  [12, 'rgba(194,134,63,0.95)'],
  [15, 'rgba(200,66,13,0.95)'],
  [18, 'rgba(215,0,50,0.95)'],
  [24, 'rgba(175,80,136,0.95)'],
  [30, 'rgba(117,74,147,0.95)'],
  [36, 'rgba(194,251,119,0.95)'],
]

const CURRENT_STOPS = [
  [0, 'rgba(82,112,150,0.9)'],
  [0.1, 'rgba(70,140,195,0.95)'],
  [0.25, 'rgba(20,172,180,0.95)'],
  [0.5, 'rgba(64,200,120,0.95)'],
  [0.8, 'rgba(230,200,70,0.95)'],
  [1.2, 'rgba(240,130,50,0.95)'],
  [1.8, 'rgba(232,62,92,0.95)'],
  [2.5, 'rgba(205,70,205,0.95)'],
]

const SST_STOPS = [
  [-2, 'rgb(25,45,120)'],
  [5, 'rgb(35,95,180)'],
  [12, 'rgb(40,160,195)'],
  [18, 'rgb(65,200,125)'],
  [24, 'rgb(230,200,60)'],
  [28, 'rgb(240,125,45)'],
  [32, 'rgb(200,35,35)'],
]

const WAVE_STOPS = [
  [0, 'rgb(30,60,105)'],
  [1, 'rgb(40,120,180)'],
  [2.5, 'rgb(60,200,190)'],
  [4, 'rgb(150,230,120)'],
  [6, 'rgb(250,210,80)'],
  [8, 'rgb(250,125,50)'],
  [11, 'rgb(230,45,90)'],
]

async function loadHotspotVariant(dataset) {
  const j = await loadSystemsJson(dataset, 'firms-hotspots')
  const km = Math.round((j.binDeg || 0.5) * 111)
  const events = j.bins.map(([lat, lng, n, frp, frps]) => ({ lat, lng, n, frp, frps: frps || 0, km }))
  return { events, meta: j }
}

const AIRTEMP_STOPS = [
  [-40, 'rgb(150,95,205)'],
  [-25, 'rgb(75,65,185)'],
  [-10, 'rgb(50,115,205)'],
  [0, 'rgb(65,185,205)'],
  [10, 'rgb(75,205,125)'],
  [20, 'rgb(230,200,60)'],
  [30, 'rgb(240,125,45)'],
  [40, 'rgb(205,40,40)'],
  [45, 'rgb(145,20,60)'],
]

// Surface pH from LiveOcean. Open-ocean surface water sits near 8.05–8.1;
// upwelled and respiration-rich water in the Salish Sea dips far lower. Warm
// = acidified (the danger direction), cool = typical.
const ACIDITY_WORDS = [
  { label: 'Corrosive', range: 'under pH 7.6', max: 7.6 },
  { label: 'Very acidified', range: '7.6–7.8', max: 7.8 },
  { label: 'Acidified', range: '7.8–7.95', max: 7.95 },
  { label: 'Typical ocean', range: '7.95–8.15', max: 8.15 },
  { label: 'Bloom-raised', range: 'over 8.15', max: Infinity },
]

const PH_STOPS = [
  [7.4, 'rgb(150,15,55)'],
  [7.6, 'rgb(205,55,35)'],
  [7.7, 'rgb(240,110,45)'],
  [7.8, 'rgb(245,165,70)'],
  [7.9, 'rgb(235,210,110)'],
  [8.0, 'rgb(130,205,160)'],
  [8.1, 'rgb(60,170,200)'],
  [8.3, 'rgb(40,105,190)'],
]

const SSTANOM_STOPS = [
  [-5, 'rgb(20,60,200)'],
  [-2, 'rgb(70,130,220)'],
  [-1, 'rgb(125,180,230)'],
  [0, 'rgb(232,232,232)'],
  [1, 'rgb(240,180,120)'],
  [2, 'rgb(235,110,60)'],
  [5, 'rgb(180,30,40)'],
]

// Aerosol optical depth (unitless): clear air fades to transparent so only
// smoke, dust and haze paint — warm yellows through brown to deep purple.
// Dust: transparent → sand → ochre. (Wildfire smoke shares the Smoke & haze ramp.)
// Precipitation on a SQUARE-ROOT scale (the tape stores sqrt(mm/h)): the
// NASA GIBS GPM rain-rate colours at their own mm/h breaks, so the dust-style
// rain uses the same palette as the radar tiles. Transparent below 0.1 mm/h.
const RAIN_STOPS = [
  [0, 'rgba(0,118,78,0)'],
  [0.296, 'rgba(0,118,78,0)'],
  [0.316, 'rgb(0,118,78)'],     // 0.1 mm/h
  [0.447, 'rgb(0,151,31)'],     // 0.2
  [0.592, 'rgb(23,176,0)'],     // 0.35
  [0.707, 'rgb(69,192,0)'],     // 0.5
  [0.866, 'rgb(143,214,0)'],    // 0.75
  [1.0, 'rgb(195,228,0)'],      // 1
  [1.225, 'rgb(247,217,0)'],    // 1.5
  [1.414, 'rgb(255,176,6)'],    // 2
  [1.732, 'rgb(255,122,26)'],   // 3
  [2.0, 'rgb(255,89,39)'],      // 4
  [2.449, 'rgb(255,32,32)'],    // 6
  [2.828, 'rgb(255,1,1)'],      // 8
  [3.464, 'rgb(212,0,0)'],      // 12
  [4.0, 'rgb(181,0,0)'],        // 16
  [5.0, 'rgb(138,0,0)'],        // 25
  [6.325, 'rgb(82,0,0)'],       // 40
  [8.5, 'rgb(82,0,0)'],         // 72
]

const DUST_STOPS = [
  [0, 'rgba(240,215,150,0)'],
  [0.05, 'rgba(240,215,150,0.15)'],
  [0.15, 'rgba(235,195,110,0.55)'],
  [0.35, 'rgba(220,155,60,0.8)'],
  [0.7, 'rgba(190,105,30,0.92)'],
  [1.5, 'rgba(140,60,15,1)'],
  [3, 'rgba(80,30,5,1)'],
]
// Near-surface smoke concentration (µg/m³) — anchored loosely to the PM2.5
// health breakpoints people know from air-quality indexes.
// Low end is a COOL smoke gray, not pale yellow: faint haze has to read
// over tan desert and green forest alike, and yellow-on-desert vanishes.
// It warms through amber into deep red as the air gets bad.
// The low end must fade IN gradually — an opacity cliff near zero renders
// the "barely any smoke" zone as a solid gray shape with a hard border,
// which reads as a fake boundary (smoke concentration has no edges).
const US_SMOKE_STOPS = [
  [0, 'rgba(150,155,170,0)'],
  [2, 'rgba(150,155,170,0.15)'],
  [6, 'rgba(168,162,150,0.35)'],
  [15, 'rgba(220,175,100,0.6)'],
  [35, 'rgba(250,135,45,0.82)'],
  [100, 'rgba(205,75,30,0.95)'],
  [250, 'rgba(125,30,60,1)'],
  [600, 'rgba(60,10,60,1)'],
]

const AOD_STOPS = [
  [0, 'rgba(255,240,200,0)'],
  [0.08, 'rgba(255,235,170,0.12)'],
  [0.2, 'rgba(255,205,95,0.5)'],
  [0.4, 'rgba(250,145,45,0.78)'],
  [0.8, 'rgba(205,75,30,0.92)'],
  [1.5, 'rgba(125,30,60,1)'],
  [3, 'rgba(60,10,60,1)'],
]

// Column CO in g/m². Background is ~0.6–1 everywhere, so the ramp only starts
// speaking above that; teal → violet → magenta keeps it visually distinct from
// the warm smoke/dust ramps it will often be compared against.
const CO_STOPS = [
  [0.55, 'rgba(120,210,205,0)'],
  [0.8, 'rgba(120,210,205,0.15)'],
  [1.2, 'rgba(95,170,225,0.45)'],
  [1.8, 'rgba(110,120,235,0.68)'],
  [2.8, 'rgba(160,85,225,0.85)'],
  [4.5, 'rgba(220,60,170,0.95)'],
  [7, 'rgba(255,80,120,1)'],
]

// Global PM2.5 shares the US ground-smoke hues and health anchors, but its
// low end must be far fainter: unlike US smoke (≈0 when clean), global PM2.5
// has a real everywhere-baseline — sea salt over oceans runs 5–15 µg/m³ —
// and painting that at smoke-ramp opacity muddies the whole planet.
const PM25_STOPS = [
  [0, 'rgba(150,155,170,0)'],
  [5, 'rgba(150,155,170,0.05)'],
  [9, 'rgba(158,158,160,0.16)'],
  [15, 'rgba(180,168,140,0.34)'],
  [35, 'rgba(230,175,90,0.62)'],
  [100, 'rgba(230,110,40,0.88)'],
  [250, 'rgba(150,40,65,1)'],
  [600, 'rgba(60,10,60,1)'],
]

// Near-surface CO₂ in ppm, diverging around the ~425 global average: green =
// drawn down (photosynthesis), transparent = average, orange→red = pushed up
// (cities, fires, nighttime respiration).
const CO2_STOPS = [
  [395, 'rgba(70,200,140,0.75)'],
  [408, 'rgba(90,205,160,0.5)'],
  [418, 'rgba(120,190,170,0.2)'],
  [425, 'rgba(128,128,128,0)'],
  [433, 'rgba(245,160,70,0.45)'],
  [445, 'rgba(240,100,50,0.75)'],
  [470, 'rgba(200,40,60,0.95)'],
  [520, 'rgba(130,10,60,1)'],
]

// Near-surface methane in ppb; ~1,950 is today's well-mixed background.
// Swamp-gas palette: dull yellow-green souring into rot-brown — the
// universal shorthand for toxic/heavy air (Josh, 2026-08-31). Kept murky
// and desaturated on purpose: the vivid lime detection reticles must pop
// on top of it by brightness alone.
const CH4_STOPS = [
  [1880, 'rgba(196,205,80,0)'],
  [1950, 'rgba(202,210,82,0.12)'],
  [2000, 'rgba(214,216,58,0.35)'],
  [2060, 'rgba(224,202,40,0.58)'],
  [2130, 'rgba(212,160,30,0.78)'],
  [2250, 'rgba(168,112,25,0.92)'],
  [2450, 'rgba(108,72,20,1)'],
]

// Bird migration traffic rate. The grid/tape carry √(birds/km/h) (see
// api/_systems-datasets.js `birds`), so these stops are in √ units: 7 ≈ 50,
// 22 ≈ 500, 45 ≈ 2,000, 84 ≈ 7,000, 141 ≈ 20,000 birds/km/h. Violet → magenta
// → gold keeps a big flight night distinct from fire and smoke; quiet air is
// transparent.
const BIRD_STOPS = [
  [5, 'rgba(120,90,220,0)'],
  [10, 'rgba(125,95,225,0.22)'],
  [22, 'rgba(150,90,230,0.45)'],
  [45, 'rgba(215,85,190,0.66)'],
  [84, 'rgba(250,150,90,0.82)'],
  [141, 'rgba(255,238,160,0.95)'],
]
// Flight glyph tints: pale, so the birds read on top of the wash at any intensity.
const BIRD_FLIGHT_STOPS = [
  [0, 'rgba(225,215,255,0.55)'],
  [500, 'rgba(255,235,215,0.75)'],
  [2000, 'rgba(255,250,225,0.9)'],
  [7000, 'rgba(255,255,255,1)'],
]
const BIRDCAST_URL = 'https://birdcast.org/migration-tools/live-migration-maps'
// BirdCast's requested Live Maps citation (https://birdcast.org/how-to-cite/),
// filled in for the frame actually on screen.
const birdcastCite = (meta) =>
  `BirdCast, Live Migration Map; ${fmtRun(meta.valid_ms)}. Cornell Lab of Ornithology. ${BIRDCAST_URL}. Accessed ${fmtDay(meta.fetched_ms || Date.now())}.`

// ─── Layer definitions ──────────────────────────────────────────────────────

// Panel ontology — every layer declares one of these groups.
export const GROUPS = [
  { id: 'air', label: 'Air' },
  { id: 'water', label: 'Water' },
  { id: 'land', label: 'Land' },
  { id: 'life', label: 'Flora & Fauna' },
]

// ONE wind, everywhere. Layers that carry a companion wind (haze, smoke,
// dust, PM2.5, CO) point at this single def, so the particles under a wash
// are the Wind layer's particles — same speed colors, same density, same
// physics. They used to be a separate white, 60%-density, zoom-retiring
// variant, so wind looked like a different dataset depending on which
// button was pressed. The only remaining difference is ownership: the
// companion yields to the Wind layer when that is on (never two winds).
const WIND_FLOW = {
  dataset: 'gfs-wind',
  expectKind: 'gfs-wind-10m',
  stops: WIND_STOPS,
  vector: { speedFactor: 0.42, gammaPivot: 10, offsetDegPerMs: 0.02 },
}


/**
 * Resolution ladder: is a point inside one tier's real footprint?
 *
 * A `base` tier (the global one, and the replay one) always qualifies — it is
 * the thing every other tier falls back to, so it cannot be gated on a box.
 *
 * A ground-radar tier (MRMS) is just a box, because a radar network's edge is
 * where the radars are.
 */
export function tierSees(tier, lat, lng) {
  if (!tier) return false
  if (tier.base) return true
  if (lat > tier.north || lat < tier.south) return false
  if (lng < tier.west || lng > tier.east) return false
  return true
}


export const LAYERS = [
  {
    id: 'wind',
    hue: '#6ee7f0',
    iconSvg: '<path d="M9.6 4.6A2 2 0 1 1 11 8H3"></path><path d="M12.6 19.4A2 2 0 1 0 14 16H3"></path><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H3"></path>',
    group: 'air',
    kind: 'vector',
    param: 'w',
    defaultOn: true,
    dataset: 'gfs-wind',
    expectKind: 'gfs-wind-10m',
    name: 'Wind',
    sub: '10 m above surface',
    sourceName: 'NOAA GFS',
    sourceUrl: 'https://www.emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/gfs.php',
    stops: WIND_STOPS,
    vector: { speedFactor: 0.42, gammaPivot: 10, offsetDegPerMs: 0.02 },
    legend: { min: 0, max: 30, ticks: ['0', '10', '20', '30+ m/s'] },
    words: [
      { label: 'Calm', range: 'under 3 m/s', max: 3 },
      { label: 'Breeze', range: '3–10 m/s', max: 10 },
      { label: 'Strong', range: '10–20 m/s', max: 20 },
      { label: 'Gale', range: '20–30 m/s', max: 30 },
      { label: 'Storm', range: 'over 30 m/s', max: Infinity },
    ],
    stamp: (meta) => `model run ${fmtRun(meta.run_ms)}`,
    explain:
      'Each moving streak is air in motion right now — it points the way the wind blows, colored by strength. The tropics carry steady trade winds, the mid-latitudes the fast west-to-east jet streams; spiraling pinwheels are storm systems.',
    popup(sample, meta) {
      const word = wordFor(this.words, sample.speed).label
      const from = bearingWord((Math.atan2(sample.u, sample.v) * 180) / Math.PI + 180)
      return {
        head: `${word} wind — from the ${from}`,
        big: `${sample.speed.toFixed(1)} m/s`,
        alt: `${(sample.speed * 2.23694).toFixed(0)} mph`,
        meta: `10 m wind · model run ${fmtRun(meta.run_ms)}`,
      }
    },
  },
  {
    id: 'currents',
    hue: '#4fc3e8',
    iconSvg: '<path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v5h-5"></path>',
    group: 'water',
    kind: 'vector',
    param: 'c',
    defaultOn: false,
    dataset: 'hycom-currents',
    expectKind: 'hycom-currents-surface',
    name: 'Ocean currents',
    sub: 'sea surface',
    sourceName: 'HYCOM / Navy ESPC',
    sourceUrl: 'https://www.hycom.org/dataserver/espc-d-v02/global-analysis',
    stops: CURRENT_STOPS,
    // Currents run ~1/20th of wind speed; the probe offset is retuned so a
    // gentle drift stays visible. gamma 1.0 (linear) — wind's contrast boost
    // made moderate-and-up currents race; color already carries the contrast.
    vector: { speedFactor: 0.45, gammaPivot: 0.5, offsetDegPerMs: 0.15, gamma: 1.0, mask: 'water' },
    legend: { min: 0, max: 2.5, ticks: ['0', '0.5', '1', '2.5+ m/s'] },
    words: [
      { label: 'Drift', range: 'under 0.1 m/s', max: 0.1 },
      { label: 'Gentle', range: '0.1–0.25 m/s', max: 0.25 },
      { label: 'Moderate', range: '0.25–0.5 m/s', max: 0.5 },
      { label: 'Strong', range: '0.5–1 m/s', max: 1 },
      { label: 'Racing', range: 'over 1 m/s', max: Infinity },
    ],
    stamp: (meta) => `model run ${fmtRun(meta.run_ms)}`,
    explain:
      'Streaks in the ocean are surface currents — note they’re described by where they flow TOWARD (the opposite convention from wind). Look for the narrow, fast western boundary currents like the Gulf Stream and Kuroshio, and the great slow gyres between them.',
    popup(sample, meta) {
      const word = wordFor(this.words, sample.speed).label
      const toward = bearingWord((Math.atan2(sample.u, sample.v) * 180) / Math.PI)
      return {
        head: `${word} current — toward the ${toward}`,
        big: `${sample.speed.toFixed(2)} m/s`,
        alt: `${(sample.speed * 1.94384).toFixed(1)} kn`,
        meta: `Surface current · model run ${fmtRun(meta.run_ms)}`,
      }
    },
  },
  {
    id: 'quakes',
    hue: '#facc15',
    iconSvg: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>',
    group: 'land',
    kind: 'events',
    param: 'q',
    defaultOn: false,
    name: 'Earthquakes',
    sub: 'M3.0+, past 30 days',
    sourceName: 'USGS',
    sourceUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/',
    stops: MAG_RAMP,
    legend: { min: 3, max: 8, ticks: ['M3', 'M4', 'M5', 'M6', 'M7+'] },
    words: [
      { label: 'Minor', range: 'M3–4', max: 4 },
      { label: 'Light', range: 'M4–5', max: 5 },
      { label: 'Moderate', range: 'M5–6', max: 6 },
      { label: 'Strong', range: 'M6–7', max: 7 },
      { label: 'Major', range: 'M7+', max: Infinity },
    ],
    // Live USGS GeoJSON, fetched directly in the browser — the same feed and
    // service /quakes uses, no bake needed.
    load: async () => {
      // USGS publishes 2.5+; keep M3.0+ (Josh: the globe looked sad at 4.5+).
      const events = (await fetchQuakes('2.5')).filter((e) => e.mag >= 3)
      return { events, meta: { fetched_ms: Date.now(), count: events.length } }
    },
    stamp: (meta) => `${meta.count.toLocaleString()} quakes, live USGS feed`,
    // Replay: the feed's 30 days of timestamps drive a time cursor (no bake).
    // Playing: 3-h ticks, quakes appear and fade over ~9 h, ~3 s per day; the
    // bar shows only the date. Paused/stepped: the whole UTC day, steady.
    timeline: { stepH: 3, windowDays: 30, rateHoursPerSec: 8, dayLabel: true },
    // Size is the message: the layer starts at M3, and each whole magnitude
    // is ~32× the energy, so rings double per half-magnitude — an M5 is a
    // small blip, an M7 fills a region, an M8 dominates the hemisphere view.
    ping: {
      mode: 'ring',
      color: (e) => magColor(e.mag),
      dotR: (e) => 4 + Math.max(0, e.mag - 3) * 1.875,           // M3 = old M4.5 size … M7 = old M7 size
      maxR: (e) => Math.min(180, 18 * Math.pow(2, Math.max(0, e.mag - 3) * 0.625)),
      lineWidth: (e) => 1.2 + Math.max(0, e.mag - 3) * 0.69,
      halo: (e) => (e.mag >= 6 ? Math.min(0.35, 0.12 + (e.mag - 6) * 0.12) : 0),
      periodMs: (e) => Math.max(1600, 3400 - Math.max(0, e.mag - 3) * 220),
      // Fresh quakes ping bright; month-old ones fade back but stay visible.
      baseAlpha: (e) => Math.max(0.55, 1 - ((Date.now() - e.time) / 8.64e7 / 30) * 0.45),
    },
    explain:
      'Each pulsing ring is an earthquake — bigger, redder, slower pulses are stronger quakes, and brighter rings are more recent. Watch the rings trace the plate boundaries: the Pacific Ring of Fire, the mid-ocean ridges, the Himalayan collision zone.',
    popupEvent(e) {
      const word = this.words.find((w) => e.mag < w.max)?.label || 'Major'
      return {
        head: `${word} earthquake — ${agoWord(e.time)}`,
        big: `M${e.mag.toFixed(1)}`,
        alt: `${e.depth.toFixed(0)} km deep`,
        meta: `${e.place}`,
        link: { href: e.url, label: 'USGS event page ↗' },
      }
    },
  },
  {
    id: 'storms',
    hue: '#ff5a5f',
    // The standard tropical-cyclone symbol: an eye with two trailing bands.
    iconSvg: '<circle cx="12" cy="12" r="2"></circle><path d="M12 10c0-5 3-7 7-6-2.5 1.6-3 4-3 6"></path><path d="M12 14c0 5-3 7-7 6 2.5-1.6 3-4 3-6"></path>',
    group: 'air',
    kind: 'events',
    param: 'y',
    defaultOn: false,
    name: 'Storms',
    sub: 'tropical cyclones, live',
    sourceName: 'NOAA NHC',
    sourceUrl: 'https://www.nhc.noaa.gov/',
    // Two warning centres feed this layer, so both get their own link rather
    // than one label standing in for data it didn't produce. Each storm's
    // popup additionally links the exact advisory its numbers came from.
    sourceAlso: [{ name: 'US Navy JTWC', url: 'https://www.metoc.navy.mil/jtwc/jtwc.html' }],
    // Global, from two warning centres. Kept as an explicit coverage note
    // anyway: if one centre is unreachable the payload says so, and the
    // narrator must not describe a half-empty map as a calm planet.
    coverage:
      'every basin where tropical cyclones form — the National Hurricane Center warns on the Atlantic and the eastern and central Pacific, and the Joint Typhoon Warning Center on the western Pacific, the Indian Ocean and the Southern Hemisphere.',
    factsNote:
      'Official warning-centre positions, intensities and forecast tracks for every active tropical cyclone on Earth, from NHC (Atlantic, east/central Pacific) and JTWC (west Pacific, Indian Ocean, Southern Hemisphere). These are authoritative advisory values, not model estimates. JTWC warnings do not include a central pressure or a track-uncertainty cone, so storms it warns on legitimately have neither — that is missing data, never zero.',
    legendRows: [
      { label: 'Disturbance / tropical depression', glow: '#5ebaff' },
      { label: 'Tropical storm (39–73 mph)', glow: CAT_COLORS[0] },
      { label: 'Category 1 hurricane (74–95 mph)', glow: CAT_COLORS[1] },
      { label: 'Category 2 (96–110 mph)', glow: CAT_COLORS[2] },
      { label: 'Category 3 (111–129 mph)', glow: CAT_COLORS[3] },
      { label: 'Category 4 (130–156 mph)', glow: CAT_COLORS[4] },
      { label: 'Category 5 (157+ mph)', glow: CAT_COLORS[5] },
    ],
    legendNote:
      'The ringed mark is the storm now, wrapped in its real wind field. Each nested shell is how far one wind speed actually reaches — teal for tropical-storm force (39 mph), green for damaging winds (58 mph), yellow for hurricane force (74 mph), on the same color scale as the chips above. They are lopsided because storms are: the reported figure is four numbers, one per quadrant, not a radius. The solid trail behind it is where it has been, colored by how strong it was at each point; the dashed line ahead is the forecast track, and the shaded cone is the range the center could still wander into. Red and orange coastlines are warnings and watches. Storms are shown worldwide, from the National Hurricane Center in the Atlantic and eastern Pacific and the Joint Typhoon Warning Center everywhere else; JTWC does not publish a pressure or a cone, so its storms show neither. Drag the time bar to replay each storm\'s life from its first advisory — the track and the wind field rebuild themselves at every six-hour fix. Replay covers the past only: the cone and forecast describe what is expected from now, so they are hidden while you are looking backwards, and JTWC storms have no published history to replay.',
    // Replay over the storms' own advisory fixes — the same transport bar the
    // earthquake tape uses. PAST ONLY, deliberately: the cone and forecast
    // track describe what is expected from now, so replaying them into last
    // week would show a prediction that did not exist yet. 6-hourly because
    // that is the advisory cycle; 10 days covers a typical cyclone's life.
    // A function, not a constant, because the useful window is whatever the
    // storms on screen have actually lived. A fixed 10 days opened the bar
    // five days before any of them existed and played across an empty ocean.
    // Clamped so a brand-new storm still gets a scrubbable bar and a
    // month-old one doesn't produce hundreds of frames.
    timeline: (storms) => {
      let earliest = Infinity
      for (const s of storms || []) {
        for (const p of s.past || []) if (p.at_ms && p.at_ms < earliest) earliest = p.at_ms
      }
      const days = Number.isFinite(earliest)
        ? Math.min(21, Math.max(1.5, (Date.now() - earliest) / 8.64e7 + 0.25))
        : 3
      // ONE pass, not the usual three. A storm's life is a story with an
      // ending — it arrives at Now, which is the state that actually matters
      // — and re-telling it twice more talks over the reader. Pressing Play
      // resets the pass count, so the button always buys a fresh replay.
      return { stepH: 6, windowDays: days, rateHoursPerSec: 18, maxPasses: 1, frameKind: 'NHC advisory fixes', dayLabel: false }
    },
    load: async () => {
      const r = await fetch('/api/storms')
      if (!r.ok) throw new Error(`storms ${r.status}`)
      const j = await r.json()
      // The proxy returns storms:null on upstream failure rather than an
      // empty array, precisely so this throws into the layer's honest
      // "unavailable" state instead of drawing a calm, storm-free ocean.
      if (!Array.isArray(j.storms)) throw new Error(j._upstream_error || 'storms unavailable')
      return {
        events: j.storms,
        meta: {
          fetched_ms: j.fetched_ms,
          advisory_ms: j.advisory_ms,
          count: j.storms.length,
          coverage: j.coverage,
          agencies: j.agencies || [],
          partial: j.partial || null,
        },
      }
    },
    stamp: (meta) => {
      if (meta.partial) return `${meta.count} storm${meta.count === 1 ? '' : 's'} — ${meta.partial}`
      if (!meta.count) return 'no tropical cyclones active anywhere on Earth right now'
      const by = (meta.agencies || []).filter((a) => a.count).map((a) => `${a.count} from ${a.id}`).join(', ')
      return `${meta.count} active storm${meta.count === 1 ? '' : 's'}${by ? ` (${by})` : ''} · latest advisory ${fmtRun(meta.advisory_ms)}`
    },
    explain:
      'Every tropical cyclone on Earth that a warning centre is currently tracking — hurricanes in the Atlantic and eastern Pacific, typhoons in the western Pacific, cyclones in the Indian Ocean and the Southern Hemisphere. The nested shells around each storm are its real wind field, and they are lopsided because a storm\'s winds genuinely reach further on one side than the other. The trail behind is its life so far: watch the color climb as a harmless smudge of disturbed weather organizes into a depression, a named storm, and then a hurricane. The cone ahead is not the storm\'s size — it\'s the forecasters\' honest uncertainty about where the center will go, and roughly two times in three the storm stays inside it.',
    popupEvent(s, ctx = {}) {
      const cat = s.cat || 0
      const head = cat > 0 ? `${s.name} — ${stageWord(s.type_word, cat)}` : `${s.name} — ${s.type_word}`
      const big = s.mph != null ? `${s.mph} mph winds` : 'intensity not reported'
      const bits = []
      if (s.mb != null) bits.push(`${s.mb} mb`)
      if (s.basin_word) bits.push(`in ${s.basin_word}`)
      if (s.move_kt != null && s.move_dir != null) {
        bits.push(`moving ${bearingWord(s.move_dir)} at ${Math.round(s.move_kt * 1.15078)} mph`)
      }
      // Initial great-circle bearing between the first two forecast positions.
      // Used ONLY to let the narrator name a direction when the advisory
      // itself published no motion vector (see the ai block below).
      let fcstHeading = null
      {
        const a = s.forecast?.[0]
        const b = s.forecast?.[1]
        if (a && b && a.lat != null && b.lat != null) {
          const toRad = (d) => (d * Math.PI) / 180
          const dLon = toRad(b.lng - a.lng)
          const y = Math.sin(dLon) * Math.cos(toRad(b.lat))
          const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat))
            - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon)
          fcstHeading = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
        }
      }

      // Only NHC storms carry a past track (JTWC's product is current +
      // forecast only), so this whole paragraph is conditional on having one.
      const first = s.past?.[0]
      const now = s.past?.[s.past.length - 1]
      const story = []
      if (first && now && first.kt != null && now.kt != null && now.kt > first.kt) {
        const days = Math.max(1, Math.round((now.at_ms - first.at_ms) / 8.64e7))
        story.push(
          `It started as a ${first.type_word.toLowerCase()} of about ${Math.round(first.kt * 1.15078)} mph ${days === 1 ? 'yesterday' : `${days} days ago`} and has been strengthening since.`,
        )
      }
      if (s.peak_forecast?.kt != null && s.peak_forecast.kt > (s.kt ?? 0)) {
        story.push(
          `Forecast to peak near ${Math.round(s.peak_forecast.kt * 1.15078)} mph ${s.peak_forecast.when ? `around ${s.peak_forecast.when}` : 'in the next day or so'}.`,
        )
      } else if (s.peak_forecast?.kt != null) {
        story.push('Forecast to weaken from here.')
      }
      if (s.watches?.length) {
        const words = [...new Set(s.watches.map((w) => w.word.toLowerCase()))]
        story.push(`There ${words.length === 1 ? 'is a' : 'are a'} ${words.join(' and a ')} in effect on the coast.`)
      }
      // What the click actually landed on. A storm is several published
      // shapes stacked up, and answering "Polo, 178 mph" for a click 300 km
      // ahead of it inside the cone was technically true and practically
      // useless — it never said the thing the reader wanted to know, which is
      // "am I in its path?".
      const hit = s._hit
      // While the time bar is in the past, every number above describes that
      // moment, not this one. Say which moment, or the reader has no way to
      // tell a replayed frame from live.
      if (hit?.view?.historic) {
        story.unshift(
          `Replay — this is ${s.name} as of ${fmtRun(hit.view.at_ms)}, when it was a ${stageWord(hit.view.type_word, hit.view.cat).toLowerCase()}${hit.view.mph != null ? ` with winds near ${hit.view.mph} mph` : ''}. Drag the bar to Now for its current state and forecast.`,
        )
      }
      if (hit?.part === 'cone') {
        story.unshift(
          `You clicked inside the forecast cone${s.cone_days ? ` — the ${s.cone_days}-day track forecast` : ''}. The centre of the storm could pass anywhere through this area, though not necessarily here, and about two times in three it stays inside the cone.`,
        )
      } else if (hit?.part === 'forecast') {
        const f = hit.detail
        const mph = f.kt != null ? `${Math.round(f.kt * 1.15078)} mph` : 'intensity not given'
        const gust = f.gust_kt != null ? `, gusting ${Math.round(f.gust_kt * 1.15078)} mph` : ''
        story.unshift(
          `This is a forecast position: ${s.name} is expected here ${whenLabel(f, s) || `in ${f.tau} hours`}, as a ${stageWord(f.type_word || s.type_word, f.cat).toLowerCase()} with winds near ${mph}${gust}.`,
        )
      } else if (hit?.part === 'past') {
        const pp = hit.detail
        const mph = pp.kt != null ? `${Math.round(pp.kt * 1.15078)} mph` : 'intensity not given'
        story.unshift(
          `${s.name} was here${pp.at_ms ? ` on ${fmtRun(pp.at_ms)}` : ''}, as a ${stageWord(pp.type_word, pp.cat).toLowerCase()} with winds near ${mph}.`,
        )
      } else if (hit?.part === 'watch') {
        const m = WW_MEANING[hit.detail.code]
        story.unshift(
          m
            ? `This stretch of coast is under a ${m[0].toLowerCase()} from ${s.name}: ${m[1]}, ${m[2]}. A watch means conditions are possible and it is time to prepare; a warning means they are expected.`
            : `This stretch of coast is under a ${hit.detail.word} from ${s.name}.`,
        )
      } else if (hit?.part === 'fcstline') {
        const last = s.forecast?.[s.forecast.length - 1]
        story.unshift(
          `You clicked the forecast track — the line the centre of ${s.name} is expected to follow${last ? `, out to ${whenLabel(last, s) || `${last.tau} hours ahead`}` : ''}. The shaded cone around it is how far the real path could stray.`,
        )
      } else if (hit?.part === 'pastline') {
        const seg = hit.detail
        story.unshift(
          `${s.name} actually passed along here, as a ${stageWord(TYPE_WORDS[seg.type] || seg.type, seg.cat).toLowerCase()} on this stretch of its track.`,
        )
      } else if (hit?.part === 'wind') {
        const kt = hit.detail.kt
        story.unshift(
          `At this spot the advisory says ${windWord(kt)} — ${Math.round(kt * 1.15078)} mph or stronger — currently reach you.`,
        )
      }

      // JTWC publishes neither a central pressure nor a track-uncertainty
      // cone. Saying so plainly is the difference between "we don't have it"
      // and the reader assuming the storm simply doesn't have one.
      if (s.agency === 'JTWC') {
        story.push(
          'The Joint Typhoon Warning Center, which warns on this basin, publishes no central pressure and no track cone, so neither is shown here.',
        )
      }
      // Both layers report a wind speed at the same spot and they disagree —
      // 64 mph from the model against a 178 mph advisory, stacked in one
      // popup, looked like a contradiction. It isn't: the global model's
      // half-degree grid smooths a hurricane's core away. Say so, but only
      // when the Wind layer is actually on and the two numbers are visible
      // together.
      if (ctx.layerOn?.wind && cat >= 1) {
        story.push(
          'If the Wind layer is showing a lower speed here, that is the global weather model, whose grid is too coarse to resolve an eyewall — this advisory figure is the measured one.',
        )
      }
      const centre = s.agency_name || 'the National Hurricane Center'
      return {
        head,
        big,
        alt: bits.join(' · ') || null,
        meta: `${story.join(' ')} Advisory ${s.advisory_num || ''} from ${centre}${s.advisory_ms ? `, issued ${fmtRun(s.advisory_ms)}` : ''}.`.trim(),
        ai:
          `OFFICIAL ${s.agency || 'NHC'} ADVISORY (authoritative — not a model estimate): ${s.name}, ${stageWord(s.type_word, cat)}` +
          (s.basin_word
            ? `, in ${s.basin_word.toUpperCase()} — state this basin and NEVER any other; do not call it an Atlantic storm unless that is the basin named here`
            : '') +
          ', ' +
          `${s.kt ?? '?'} kt sustained (${s.mph ?? '?'} mph), ` +
          (s.mb != null
            ? `central pressure ${s.mb} mb, `
            : 'central pressure NOT PUBLISHED by this warning centre — do not state or estimate one, ') +
          `at ${s.lat}, ${s.lng}. ` +
          // A bare "movement not reported" left a vacuum the narrator filled:
          // on advisory 009, where NHC published no motion at all, it wrote
          // "moving northwestward at 90 knots" — a speed no cyclone has ever
          // travelled, assembled out of thin air. The pressure prohibition
          // right above never leaked like that because it is phrased as an
          // instruction, not a fact. So: forbid it explicitly, and hand over
          // the one honest substitute we can compute — the bearing between
          // the advisory's own forecast positions — clearly labelled as
          // derived, with no speed attached.
          (s.move_dir != null && s.move_kt != null
            ? `Moving ${bearingWord(s.move_dir)} at ${s.move_kt} kt. `
            : 'MOVEMENT NOT PUBLISHED in this advisory. Do NOT state any movement speed — not in knots, not in mph, not "slowly" or "rapidly". ' +
              (fcstHeading != null
                ? `You may say only that its forecast track runs to the ${bearingWord(fcstHeading)}, described as the forecast direction rather than a reported motion. `
                : 'Say nothing about which way it is moving. ')) +
          `Track history: ${(s.past || []).map((p) => `${p.kt}kt`).join(' → ') || 'none'}. ` +
          `Forecast: ${(s.forecast || []).map((f) => `+${f.tau}h ${f.kt}kt`).join(', ') || 'none'}. ` +
          (s.watches?.length ? `Coastal watches/warnings in effect: ${[...new Set(s.watches.map((w) => w.word))].join(', ')}. ` : '') +
          'The Wind layer, if on, is a 0.5° global model that cannot resolve a storm core: it reads far slower than the advisory above. The advisory values are the authoritative ones — never average them with the model, and never present the model number as the storm\'s strength.',
        link: s.advisory_url
          ? { href: s.advisory_url, label: `Source: ${s.agency || 'NHC'} advisory ${s.advisory_num || ''} ↗`.replace(/\s+/g, ' ') }
          : { href: 'https://www.nhc.noaa.gov/', label: 'Source: NOAA NHC ↗' },
      }
    },
  },
  {
    id: 'hotspots',
    hue: '#fb7185',
    iconSvg: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z"></path>',
    group: 'land',
    kind: 'events',
    param: 'f',
    defaultOn: false,
    name: 'Active fires',
    sub: 'last 24 h',
    sourceName: 'NASA FIRMS',
    sourceUrl: 'https://firms.modaps.eosdis.nasa.gov/',
    stops: null,
    legend: null,
    legendRows: [
      { flame: 'uncontained', label: 'Named fire — less than half contained' },
      { flame: 'partial', label: 'Half contained' },
      { flame: 'mostly', label: 'Mostly contained' },
      { flame: 'contained', label: 'Fully contained' },
      { glow: 'rgba(255,160,60,1)', label: 'Satellite heat — bigger + brighter = more fire' },
      { glow: 'rgba(255,235,185,1)', label: 'Extreme fire front' },
    ],
    legendNote: 'Zoom in to a fire: circles replay each satellite sighting on the time bar, dark spots are ground that already burned, and the orange outline is the official fire boundary.',
    words: null,
    load: async () => loadHotspotVariant('firms-hotspots'),
    // Resolution ladder — the client swaps to finer-binned bakes (same FIRMS
    // pull) as you zoom, so fires resolve from glows into their actual shape.
    variants: [
      { id: 'coarse', minZoom: 0, dataset: 'firms-hotspots', maxRender: 3500 },
      { id: 'fine', minZoom: 4.5, dataset: 'firms-hotspots-fine', maxRender: 8000 },
      { id: 'detail', minZoom: 6.5, dataset: 'firms-hotspots-detail', maxRender: 9000 },
    ],
    loadVariant: (ds) => loadHotspotVariant(ds),
    stamp: (meta) => `${meta.detections.toLocaleString()} detections in ${meta.bins.length.toLocaleString()} clusters, last 24 h`,
    ping: {
      mode: 'glow',
      glowColor: 'rgba(255,160,60,1)',
      // White-hot tint for extreme fronts (≥2,000 MW summed radiative power —
      // p99 of US-East bins is ~600 MW, big Western fires run 10,000+).
      glowColorHot: 'rgba(255,235,185,1)',
      hot: (e) => (e.frps || 0) >= 2000,
      maxRender: 3500,
      // Prominence encodes fire INTENSITY (summed radiative power, log10 MW),
      // not detection count: a median crop-burn bin is ~5 MW while a megafire
      // bin is ~10,000+, and count-scaling was collapsing that thousandfold
      // difference into near-equal glows (agricultural belts read as badly as
      // the destructive fires). Floor keeps lone detections visible.
      maxR: (e) => Math.min(26, Math.max(8, 3.5 + Math.log10((e.frps || e.frp || 0) + 1) * 4.5)),
      // Intense fires keep glowing past the geographic size cap (weak ones
      // stay footprint-bound, so agricultural belts still can't smear).
      sizeFloor: (e) => Math.min(1, Math.log10((e.frps || e.frp || 0) + 1) / 4.5),
      periodMs: () => 1700,
      baseAlpha: (e) => Math.min(0.95, 0.38 + Math.log10((e.frps || e.frp || 0) + 1) * 0.14),
    },
    explain:
      'Each glow is a cluster of satellite fire detections from the last day — wildfires, crop burning, and gas flares all show up. Named US fires wear a flame marker colored by containment, even when satellites can’t currently see them burning.',
    popupEvent(e) {
      return {
        head: e.n === 1 ? 'Active fire detection' : 'Active fire cluster',
        big: `${e.n.toLocaleString()} ${e.n === 1 ? 'detection' : 'detections'}`,
        alt: `within ~${e.km} km`,
        meta: `${(e.frps || e.frp).toLocaleString()} MW total radiative power (peak ${e.frp.toLocaleString()} MW) · VIIRS satellites, last 24 h`,
      }
    },
  },
  {
    id: 'sst',
    hue: '#fb923c',
    iconSvg: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"></path>',
    group: 'water',
    kind: 'scalar',
    param: 't',
    defaultOn: false,
    dataset: 'crw-sst',
    expectKind: 'crw-sst',
    name: 'Sea temperature',
    sub: 'surface, daily',
    sourceName: 'NOAA Coral Reef Watch',
    sourceUrl: 'https://coralreefwatch.noaa.gov/product/5km/index_5km_sst.php',
    stops: SST_STOPS,
    scalar: { opacity: 0.6, mask: 'water' },
    // History tape: one daily CoralTemp field (12:00Z), last 31 days.
    tape: { dataset: 'crw-sst', expectKind: 'crw-sst', year: { dataset: 'crw-sst-year' } },
    legend: { min: -2, max: 32, ticks: ['-2', '10', '20', '32 °C'] },
    words: [
      { label: 'Frigid', range: 'under 0 °C', max: 0 },
      { label: 'Cold', range: '0–10 °C', max: 10 },
      { label: 'Cool', range: '10–18 °C', max: 18 },
      { label: 'Mild', range: '18–24 °C', max: 24 },
      { label: 'Warm', range: '24–28 °C', max: 28 },
      { label: 'Hot', range: 'over 28 °C', max: Infinity },
    ],
    stamp: (meta) => `analysis for ${fmtDay(meta.valid_ms)}`,
    explain:
      'The ocean’s color shows sea-surface temperature. Warm tropical water (orange-red) fuels hurricanes and coral bleaching; the sharp color boundaries are fronts where currents meet, and cool coastal strips are upwelling zones rich in sea life.',
    popup(sample, meta) {
      const word = wordFor(this.words, sample.value).label
      return {
        head: `${word} water`,
        big: `${sample.value.toFixed(1)} °C`,
        alt: `${(sample.value * 1.8 + 32).toFixed(0)} °F`,
        meta: `Sea-surface temperature · ${tapeStamp(meta, `latest daily field, ${fmtDay(meta.valid_ms)}`) || fmtDay(meta.valid_ms)}`,
      }
    },
  },
  {
    id: 'waves',
    hue: '#38bdf8',
    iconSvg: '<path d="M1.5 9c2.3-2.4 4.6-2.4 6.9 0s4.6 2.4 6.9 0 4.6-2.4 6.9 0"></path><path d="M1.5 15.5c2.3-2.4 4.6-2.4 6.9 0s4.6 2.4 6.9 0 4.6-2.4 6.9 0"></path>',
    group: 'water',
    kind: 'scalar',
    param: 'h',
    defaultOn: false,
    dataset: 'ww3-waves',
    expectKind: 'ww3-waves-hs',
    name: 'Waves',
    sub: 'significant height',
    sourceName: 'WaveWatch III',
    sourceUrl: 'https://polar.ncep.noaa.gov/waves/',
    stops: WAVE_STOPS,
    scalar: { opacity: 0.6, mask: 'water' },
    // History tape: 3-hourly WaveWatch III hindcast steps, last 31 days.
    tape: { dataset: 'ww3-waves', expectKind: 'ww3-waves-hs' },
    legend: { min: 0, max: 11, ticks: ['0', '2.5', '6', '11+ m'] },
    words: [
      { label: 'Calm', range: 'under 0.5 m', max: 0.5 },
      { label: 'Small', range: '0.5–1.5 m', max: 1.5 },
      { label: 'Moderate', range: '1.5–3 m', max: 3 },
      { label: 'Large', range: '3–6 m', max: 6 },
      { label: 'Huge', range: 'over 6 m', max: Infinity },
    ],
    stamp: (meta) => `forecast step ${fmtRun(meta.valid_ms)}`,
    explain:
      'Ocean color shows significant wave height — roughly the average of the largest third of waves, what a sailor would report. Big storm seas radiate outward as swell that can cross entire oceans, which is why surf arrives on calm days.',
    popup(sample, meta) {
      const word = wordFor(this.words, sample.value).label
      return {
        head: `${word} seas`,
        big: `${sample.value.toFixed(1)} m`,
        alt: `${(sample.value * 3.28084).toFixed(0)} ft`,
        meta: `Significant wave height · ${tapeStamp(meta, `forecast step ${fmtRun(meta.valid_ms)}`) || fmtRun(meta.valid_ms)}`,
      }
    },
  },
  {
    id: 'airtemp',
    hue: '#fbbf24',
    iconSvg: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>',
    group: 'air',
    kind: 'scalar',
    param: 'a',
    defaultOn: false,
    dataset: 'gfs-airtemp',
    expectKind: 'gfs-airtemp-2m',
    name: 'Air temperature',
    sub: '2 m above surface',
    sourceName: 'NOAA GFS',
    sourceUrl: 'https://www.emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/gfs.php',
    stops: AIRTEMP_STOPS,
    scalar: { opacity: 0.55 },
    // History tape: 3-hourly GFS analyses/short leads (THREDDS keeps ~1 week).
    tape: { dataset: 'gfs-airtemp', expectKind: 'gfs-airtemp-2m' },
    legend: { min: -40, max: 45, ticks: ['-40', '0', '20', '45 °C'] },
    words: [
      { label: 'Frigid', range: 'under -20 °C', max: -20 },
      { label: 'Freezing', range: '-20–0 °C', max: 0 },
      { label: 'Cool', range: '0–15 °C', max: 15 },
      { label: 'Mild', range: '15–25 °C', max: 25 },
      { label: 'Hot', range: '25–35 °C', max: 35 },
      { label: 'Scorching', range: 'over 35 °C', max: Infinity },
    ],
    stamp: (meta) => `model run ${fmtRun(meta.run_ms)}`,
    explain:
      'Color is air temperature at head height, everywhere on Earth at once. Watch the deserts scorch by afternoon and swing cold at night, the poles hold their deep freeze, and the sharp temperature walls where air masses collide — those fronts are where storms are born.',
    popup(sample, meta) {
      const word = wordFor(this.words, sample.value).label
      return {
        head: `${word} air`,
        big: `${sample.value.toFixed(1)} °C`,
        alt: `${(sample.value * 1.8 + 32).toFixed(0)} °F`,
        meta: `2 m air temperature · ${tapeStamp(meta, `forecast valid now · run ${fmtRun(meta.run_ms)}`) || `model run ${fmtRun(meta.run_ms)}`}`,
      }
    },
  },
  {
    id: 'clouds',
    hue: '#cbd5e1',
    iconSvg: '<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97 6 6 0 0 0-11.6-1.4A4 4 0 0 0 6.5 19Z"></path>',
    group: 'air',
    kind: 'raster',
    param: 'k2',
    defaultOn: false,
    name: 'Clouds',
    sub: 'whole Earth, hourly',
    sourceName: 'NOAA GMGSI',
    sourceUrl: 'https://registry.opendata.aws/noaa-gmgsi/',
    stops: null,
    legend: null,
    words: null,
    // Always beneath the other layers — clouds are the backdrop that data is
    // read against, never something drawn over it.
    raster: { opacity: 0.92, fadeDuration: 300, underlay: true, followsTime: true },
    attribution: 'NOAA Global Mosaic of Geostationary Satellite Imagery',
    coverage:
      'the whole globe between about 72° north and 72° south. Geostationary satellites sit over the equator and see the far polar regions at too shallow an angle to be usable, so the very top and bottom of the map are blank rather than cloudless.',
    factsNote:
      'NOAA\'s global mosaic of every geostationary weather satellite, longwave infrared, hourly. It measures TEMPERATURE, not cloud: bright means cold, and cold usually means high cloud — but cold GROUND reads the same way, so winter continents, high mountains and ice sheets can appear cloud-like. It is an observation, not a model, and it does not measure rain.',
    legendNote:
      'Every geostationary weather satellite on Earth, merged by NOAA into one picture and refreshed every hour. White is cold — and cold, high up, means deep cloud, which is why storm tops glow brightest. It is infrared, so it works straight through the night side of the planet. One honest caveat: infrared reads temperature rather than cloud, so genuinely cold ground — ice sheets, winter continents, high mountains — can look like cloud too.',
    load: async () => {
      // One image for the whole planet. NOAA has already merged every
      // geostationary satellite, so there is nothing to stitch — which is the
      // entire reason this layer is built on GMGSI instead of assembling
      // GOES + Meteosat + Himawari by hand. That attempt is written up, with
      // the measurements that killed it, in docs/CLOUDS_API.md.
      const meta = await loadSystemsJson('gmgsi-clouds-meta', 'gmgsi-clouds')
      const base = await systemsAssetBase('gmgsi-clouds.webp')
      return {
        images: [{
          key: 'gmgsi',
          url: `${base}?v=${meta.fetched_ms || Date.now()}`,
          coordinates: [
            [-180, meta.lat_limit], [180, meta.lat_limit],
            [180, -meta.lat_limit], [-180, -meta.lat_limit],
          ],
          underlay: true,
        }],
        meta,
      }
    },
    stamp: (meta) => `satellite mosaic for ${fmtRun(meta.valid_ms)}`,
    explain:
      'Every cloud on Earth at once, as the ring of geostationary weather satellites sees them — NOAA merges GOES over the Americas, Meteosat over Europe, Africa and the Indian Ocean, and Himawari over Asia and the Pacific into a single picture every hour. It is infrared, so the night half of the planet is just as visible as the day half. The whitest cloud is the coldest and therefore the highest, which is why a hurricane\'s eyewall and the thunderstorms along the equator stand out hardest.',
  },
  {
    // Precipitation, played the way desert dust plays (Josh, 2026-09-23):
    // one half-hourly global grid per frame, preloaded, with the motion
    // between frames computed in the browser and drawn on the GPU (tape.js,
    // tapeWarpGL.js). The tiled replay it replaced was a slideshow with
    // loading pauses however the swap was tuned. ONE product for the whole
    // loop — JAXA GSMaP_NOW — so there is no seam and no six-hour hole.
    // Zoomed past z5 over the US the companion `rainRadar` (1 km NOAA MRMS
    // tiles) takes the map and this field steps aside.
    id: 'rain',
    hue: '#60a5fa',
    iconSvg: '<path d="M17.5 15a4.5 4.5 0 0 0 .5-8.97 6 6 0 0 0-11.6-1.4A4 4 0 0 0 6.5 15"></path><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"></path>',
    group: 'air',
    kind: 'scalar',
    param: 'k3',
    defaultOn: false,
    dataset: 'gsmap-rain',
    expectKind: 'gsmap-rain-sqrt',
    name: 'Precipitation',
    sub: 'satellite, and US radar zoomed in',
    sourceName: 'JAXA GSMaP_NOW',
    sourceUrl: 'https://sharaku.eorc.jaxa.jp/GSMaP_NOW/',
    sourceAlso: [
      { name: 'NOAA MRMS', url: 'https://www.nssl.noaa.gov/projects/mrms/' },
    ],
    stops: RAIN_STOPS,
    // Translucent so the basemap reads through; drawn under the labels.
    scalar: { opacity: 0.72 },
    tape: { dataset: 'gsmap-rain', expectKind: 'gsmap-rain-sqrt', noLive: true, windowDays: 2 },
    // Stored value → mm/h (the grid carries the square root).
    toValue: (raw) => raw * raw,
    unit: ' mm/h',
    legend: { min: 0, max: 8.5, ticks: ['0', '8', '32', '72+ mm/h'] },
    words: [
      { label: 'Light rain', range: 'under 2.5 mm/h', max: 2.5 },
      { label: 'Moderate rain', range: '2.5–10 mm/h', max: 10 },
      { label: 'Heavy rain', range: '10–50 mm/h', max: 50 },
      { label: 'Violent rain', range: 'over 50 mm/h', max: Infinity },
    ],
    attribution: '(c)JAXA, provided by JAXA, Courtesy of JAXA · NOAA MRMS',
    coverage:
      'rain and snow between about 60° north and 60° south, from JAXA\'s GSMaP_NOW, which merges the passive-microwave satellite constellation with geostationary infrared. Zoomed in over the continental United States (zoom 5 and closer, judged by the centre of the view) it switches to NOAA\'s 1 km ground-radar network. Only one of the two is ever drawn.',
    factsNote:
      'Two measured products, never both on screen. Everywhere: JAXA GSMaP_NOW, an hourly-average rain rate issued every 30 minutes and published about two minutes after its hour ends, on a 0.1° (~11 km) grid shown at 0.2° with each cell the HEAVIEST of the four beneath it (so rain AREA is overstated, never its presence or intensity). The two-day loop is GSMaP alone, right up to the present. Between half-hourly frames the rain is moved along motion COMPUTED from consecutive frames — the in-between positions are an estimate; the frames themselves are measurements. Over the continental US past zoom 5: NOAA MRMS, 1 km radar plus gauges, archived every 30 minutes over the same two days. Do not report the switch between them as rain starting or stopping. NOAA\'s GOES infrared rainfall rate was deliberately left out: it misses light and stratiform rain — against MRMS over New Mexico on 2026-09-23, in the same ten minutes, it flagged 17% of the area as raining against the radar\'s 49%.',
    legendNote:
      'Rain and snow actually falling, measured rather than forecast: greens light through to deep red for torrential, on a square-root scale. Frames are half-hourly; the motion between them is computed from consecutive frames. Each 0.2° cell shows the heaviest rain beneath it. Zoom into the US past z5 and the map switches to NOAA\'s 1 km radar.',
    stamp: (meta) => `JAXA GSMaP_NOW · hourly average to ${fmtRun(meta.window_end_ms || meta.valid_ms)}`,
    explain:
      'Where rain and snow are actually falling, measured from orbit rather than modelled — including over the oceans, where there is not a rain gauge for thousands of miles. The loop is two days of JAXA\'s global GSMaP, one frame every half hour, with the motion between frames computed from the frames themselves. Zoom in over the United States and it switches to NOAA\'s ground-radar network, 1 km and fine enough to pick out individual thunderstorms. Put it under the Storms layer and a hurricane\'s rain bands line up with its wind field.',
    popup(sample, meta) {
      const end = meta.window_end_ms || meta.valid_ms
      const credit = `(c)JAXA, provided by JAXA, Courtesy of JAXA · hourly average to ${fmtRun(end)}`
      const mm = this.toValue(sample.value)
      if (!(mm >= 0.1)) {
        return {
          head: 'No measurable rain',
          big: 'under 0.1 mm/h',
          alt: 'JAXA GSMaP_NOW hourly-average rain rate',
          meta: credit,
          link: { href: this.sourceUrl, label: 'Source: JAXA GSMaP_NOW ↗' },
          ai: `No measurable rain (under 0.1 mm/h) in JAXA GSMaP_NOW for the hour ending ${new Date(end).toISOString()}.`,
        }
      }
      const w = wordFor(this.words, mm)
      const v = mm >= 10 ? Math.round(mm) : mm.toFixed(1)
      return {
        head: w.label,
        big: `${v} mm/h`,
        alt: `${(mm / 25.4).toFixed(2)} in/h · heaviest in this 0.2° cell`,
        meta: credit,
        link: { href: this.sourceUrl, label: 'Source: JAXA GSMaP_NOW ↗' },
        ai: `Rain rate ${v} mm/h (heaviest of the 0.1° cells in this 0.2° cell), JAXA GSMaP_NOW satellite estimate, hourly average ending ${new Date(end).toISOString()}.`,
      }
    },
  },
  {
    // Companion of `rain`: no button, no URL key — on exactly when
    // Precipitation is (SystemsApp mirrors it). NOAA MRMS 1 km radar tiles,
    // shown only past z5 with the view centred over the US grid; while they
    // are on screen the global field steps aside (applyYield).
    id: 'rainRadar',
    companionOf: 'rain',
    hue: '#60a5fa',
    group: 'air',
    kind: 'raster',
    defaultOn: false,
    name: 'Precipitation — US radar',
    sourceName: 'NOAA MRMS',
    sourceUrl: 'https://www.nssl.noaa.gov/projects/mrms/',
    stops: null,
    legend: null,
    words: null,
    raster: { opacity: 0.72, fadeDuration: 0, followsTime: true, belowLabels: true },
    attribution: 'NOAA MRMS',
    load: async () => {
      const out = { sources: [], tiers: [], images: [], meta: { fetched_ms: Date.now() } }
      // `e` bumps when the endpoint's own output changes (e=2: the empty-tile
      // PNG was corrupt and browsers had cached it), so no stale copy survives.
      const tileUrl = (t, v) => `${location.origin}/api/rain-tiles?t=${t}&z={z}&x={x}&y={y}&v=${v || 0}&e=2`
      const r = await loadSystemsJson('mrms-conus-meta', 'mrms-conus')
      const mrms = { key: 'mrms', tiles: tileUrl('mrms', r.fetched_ms), maxzoom: r.maxzoom, attribution: 'NOAA MRMS' }
      // The rolling archive (48 h, every 30 min) lets a replay keep the 1 km
      // radar instead of dropping to the global field.
      try {
        const tp = await loadSystemsJson('mrms-conus-tape', 'mrms-conus')
        const fr = (tp.frames || []).map((f) => f.valid_ms).sort((a, b) => a - b)
        const tol = (tp.step_ms || 6e5) / 2
        if (fr.length) {
          mrms.at = (t) => {
            let best = null
            for (const ms of fr) if (best === null || Math.abs(ms - t) < Math.abs(best - t)) best = ms
            if (best === null || Math.abs(best - t) > tol) return null // outside the archive
            return `${tileUrl('mrms', r.fetched_ms)}&f=${best}`
          }
        }
      } catch { /* live-only radar */ }
      out.sources.push(mrms)
      // No base tier: when the radar does not qualify, nothing of this layer
      // is drawn and the parent's global field shows.
      out.tiers.push({ key: 'mrms', minzoom: 5, centre: true, west: r.west, east: r.east, north: r.north, south: r.south })
      out.meta.valid_ms = r.valid_ms
      return out
    },
  },
  {
    id: 'smoke',
    hue: '#b8a1e3',
    iconSvg: '<path d="M12 21a4 4 0 0 1-4-4c0-1.6.8-2.8 2-4 .4 1.2 1.2 1.8 2 1.8-.5-2.2.3-4 2-5-.1 1.6.6 2.7 1.6 3.8.9 1 1.4 2.1 1.4 3.4a4 4 0 0 1-4 4Z"></path><path d="M9 3.5c1.2.8 2.4-.8 3.6 0s2.4-.8 3.4 0"></path>',
    group: 'air',
    kind: 'scalar',
    param: 'k',
    defaultOn: false,
    dataset: 'cams-smoke',
    expectKind: 'cams-smoke-aod550',
    name: 'Wildfire smoke',
    sub: 'organic + black carbon · CAMS',
    sourceName: 'Copernicus CAMS',
    sourceUrl: 'https://atmosphere.copernicus.eu/global-forecast-plots',
    stops: AOD_STOPS,
    scalar: { opacity: 0.85 },
    // Companion animation: aerosol is a scalar, but what the eye wants is to
    // see it MOVE. Haze is carried by the wind, so the layer runs a neutral
    // Wind-carried: turning this layer on also lights the Wind layer (the
    // user can switch it off again), and the popup cites the wind run
    // alongside the CAMS run (WIND_FLOW names the grid to load for that).
    flow: WIND_FLOW,
    // History tape (SYSTEMS_TAPES.smoke).
    tape: { dataset: 'cams-smoke', expectKind: 'cams-smoke-aod550' },
    legendNote: 'Zoomed out: all smoke in the sky, worldwide (outlined veils over North America = smoke analysts saw in live imagery). Zoomed into the US: smoke at ground level — what people are breathing. The legend follows.',
    legend: { min: 0, max: 2, ticks: ['0', '0.5', '1', '2+ AOD'] },
    // Zoomed into the US, the same button hands off to NOAA HRRR-Smoke:
    // near-surface concentration (µg/m³ — what people breathe) at 3 km,
    // where CAMS shows the whole-sky column at ~44 km. Same ladder idiom as
    // the fire layer; the panel legend and popups swap with the mode.
    ground: {
      dataset: 'hrrr-smoke',
      expectKind: 'hrrr-smoke-massden',
      minZoom: 5,
      zoomNote: 'Showing smoke at ground level (near-surface µg/m³, NOAA HRRR 3 km) — zoom out for the whole-sky view.',
      toastIn: 'Now showing smoke at ground level — what you’d actually breathe. Zoom out for the whole-sky view.',
      toastOut: 'Now showing all smoke in the sky, at every altitude.',
      chip: 'Ground-level smoke',
      name: 'Wildfire smoke — at ground level',
      sub: 'US 3 km · NOAA HRRR-Smoke',
      sourceName: 'NOAA HRRR-Smoke',
      sourceUrl: 'https://rapidrefresh.noaa.gov/hrrr/',
      // Hourly ground-smoke history (0.1° tape frames baked from the HRRR
      // archive) — the ground view replays like everything else on the site.
      tape: { dataset: 'hrrr-smoke', expectKind: 'hrrr-smoke-massden', windowDays: 2, tapeKind: 'hrrr-smoke-massden-tape' },
      stops: US_SMOKE_STOPS,
      legend: { min: 0, max: 250, ticks: ['0', '35', '100', '250+ µg/m³'] },
      words: [
        { label: 'Clear', range: 'under 2', max: 2 },
        { label: 'Faint haze', range: '2–10', max: 10 },
        { label: 'Noticeable', range: '10–35', max: 35 },
        { label: 'Unhealthy', range: '35–100', max: 100 },
        { label: 'Thick', range: '100–250', max: 250 },
        { label: 'Hazardous', range: 'over 250', max: Infinity },
      ],
      stamp: (meta) => `model run ${fmtRun(meta.run_ms)} · US coverage only`,
      popup(sample, meta) {
        const word = wordFor(this.words, sample.value).label
        const breathe = sample.value < 2 ? 'clean air'
          : sample.value < 10 ? 'a faint smell of smoke at most'
          : sample.value < 35 ? 'hazy skies; sensitive groups may notice it'
          : sample.value < 100 ? 'unhealthy air — comparable to a bad air-quality day'
          : sample.value < 250 ? 'thick smoke — unhealthy for everyone'
          : 'hazardous, stay-indoors smoke'
        return {
          head: `${word} ground-level smoke`,
          big: `${sample.value < 10 ? sample.value.toFixed(1) : Math.round(sample.value)} µg/m³`,
          alt: breathe,
          meta: `Smoke in the air near the ground — what you'd breathe — from NOAA's 3 km smoke-transport model · run ${fmtRun(meta.run_ms)}`,
        }
      },
    },
    words: [
      { label: 'Clear', range: 'under 0.1', max: 0.1 },
      { label: 'Thin', range: '0.1–0.3', max: 0.3 },
      { label: 'Smoky', range: '0.3–0.7', max: 0.7 },
      { label: 'Thick', range: '0.7–1.5', max: 1.5 },
      { label: 'Extreme', range: 'over 1.5', max: Infinity },
    ],
    stamp: (meta) => `model run ${fmtRun(meta.run_ms)}`,
    explain:
      'Just the fire part of the haze: smoke streaming downwind of active burns, sometimes for days and across oceans. Turn on Active fires to see the sources. Over big cities a little urban haze sneaks in too.',
    popup(sample, meta) {
      const word = wordFor(this.words, sample.value).label
      return {
        head: `${word} smoke`,
        big: `AOD ${sample.value.toFixed(2)}`,
        alt: sample.value < 0.1 ? 'clean of smoke' : sample.value < 0.3 ? 'thin smoke' : sample.value < 0.7 ? 'visible smoke plume' : 'dense smoke',
        meta: `Smoke optical depth (organic matter + black carbon at 550 nm) · ${tapeStamp(meta, `forecast valid now · run ${fmtRun(meta.run_ms)} +${meta.lead_h} h`) || `model run ${fmtRun(meta.run_ms)}`}`,
      }
    },
  },
  {
    id: 'dust',
    hue: '#e0b46c',
    iconSvg: '<path d="M3 9c3-2.5 6 2.5 9 0s4.5-2 7-.5"></path><g fill="currentColor" stroke="none"><circle cx="6" cy="14" r="1"></circle><circle cx="11" cy="15.5" r="1"></circle><circle cx="16" cy="13.5" r="1"></circle><circle cx="8.5" cy="18.5" r="1"></circle><circle cx="14" cy="19.5" r="1"></circle><circle cx="19" cy="17.5" r="1"></circle></g>',
    group: 'air',
    kind: 'scalar',
    param: 'u',
    defaultOn: false,
    dataset: 'cams-dust',
    expectKind: 'cams-dust-aod550',
    name: 'Desert dust',
    sub: 'mineral dust · CAMS',
    sourceName: 'Copernicus CAMS',
    sourceUrl: 'https://atmosphere.copernicus.eu/global-forecast-plots',
    stops: DUST_STOPS,
    scalar: { opacity: 0.85 },
    // Companion animation: aerosol is a scalar, but what the eye wants is to
    // see it MOVE. Haze is carried by the wind, so the layer runs a neutral
    // Wind-carried: turning this layer on also lights the Wind layer (the
    // user can switch it off again), and the popup cites the wind run
    // alongside the CAMS run (WIND_FLOW names the grid to load for that).
    flow: WIND_FLOW,
    // History tape (SYSTEMS_TAPES.dust).
    tape: { dataset: 'cams-dust', expectKind: 'cams-dust-aod550' },
    legend: { min: 0, max: 2, ticks: ['0', '0.5', '1', '2+ AOD'] },
    words: [
      { label: 'Clear', range: 'under 0.1', max: 0.1 },
      { label: 'Light', range: '0.1–0.3', max: 0.3 },
      { label: 'Dusty', range: '0.3–0.7', max: 0.7 },
      { label: 'Thick', range: '0.7–1.5', max: 1.5 },
      { label: 'Extreme', range: 'over 1.5', max: Infinity },
    ],
    stamp: (meta) => `model run ${fmtRun(meta.run_ms)}`,
    explain:
      'Only mineral dust — lofted from the Sahara, Arabia, the Gobi and other deserts by strong surface winds. Saharan dust rides the trade winds across the Atlantic every summer, feeding the Amazon with phosphorus and suppressing hurricanes with dry air; Asian dust reaches the Pacific. Nothing here comes from fires or pollution.',
    popup(sample, meta) {
      const word = wordFor(this.words, sample.value).label
      return {
        head: `${word} dust`,
        big: `AOD ${sample.value.toFixed(2)}`,
        alt: sample.value < 0.1 ? 'clear of dust' : sample.value < 0.3 ? 'light dust' : sample.value < 0.7 ? 'dust plume' : 'dense dust storm',
        meta: `Dust optical depth (mineral dust at 550 nm) · ${tapeStamp(meta, `forecast valid now · run ${fmtRun(meta.run_ms)} +${meta.lead_h} h`) || `model run ${fmtRun(meta.run_ms)}`}`,
      }
    },
  },
  {
    id: 'pm25',
    hue: '#fda45c',
    iconSvg: '<g fill="currentColor" stroke="none"><circle cx="6" cy="8" r="1.6"></circle><circle cx="12" cy="5.5" r="1.1"></circle><circle cx="17" cy="9" r="1.9"></circle><circle cx="8.5" cy="14" r="1.2"></circle><circle cx="14.5" cy="15.5" r="1.5"></circle><circle cx="19" cy="17" r="1"></circle><circle cx="5" cy="18.5" r="1"></circle><circle cx="11" cy="19.5" r="1.8"></circle></g>',
    group: 'air',
    kind: 'scalar',
    param: 'p',
    defaultOn: false,
    dataset: 'cams-pm25',
    expectKind: 'cams-pm25',
    name: 'Air quality (PM2.5)',
    sub: 'fine particles · CAMS',
    sourceName: 'Copernicus CAMS',
    sourceUrl: 'https://atmosphere.copernicus.eu/global-forecast-plots',
    stops: PM25_STOPS,
    scalar: { opacity: 0.85 },
    flow: WIND_FLOW,
    tape: { dataset: 'cams-pm25', expectKind: 'cams-pm25' },
    legend: { min: 0, max: 250, ticks: ['0', '35', '150', '250+ µg/m³'] },
    words: [
      { label: 'Good', range: 'under 9 µg/m³', max: 9 },
      { label: 'Moderate', range: '9–35', max: 35 },
      { label: 'Unhealthy for sensitive groups', range: '35–55', max: 55 },
      { label: 'Unhealthy', range: '55–150', max: 150 },
      { label: 'Hazardous', range: 'over 150', max: Infinity },
    ],
    stamp: (meta) => `model run ${fmtRun(meta.run_ms)}`,
    explain:
      'The fine particles small enough to reach deep into your lungs — the number behind air-quality alerts. Smoke, pollution haze, and desert dust all count, and the colors follow the same health thresholds as the US Air Quality Index.',
    popup(sample, meta) {
      const w = wordFor(this.words, sample.value)
      const breathe = sample.value < 9 ? 'clean air' : sample.value < 35 ? 'fine for most people'
        : sample.value < 55 ? 'sensitive groups should take it easy outside'
        : sample.value < 150 ? 'unhealthy to breathe for long' : 'stay indoors if you can'
      return {
        head: `${w.label} air`,
        big: `${sample.value.toFixed(sample.value < 10 ? 1 : 0)} µg/m³`,
        alt: breathe,
        meta: `Fine particulate matter (PM2.5) at ground level · ${tapeStamp(meta, `forecast valid now · run ${fmtRun(meta.run_ms)} +${meta.lead_h} h`) || `model run ${fmtRun(meta.run_ms)}`}`,
      }
    },
  },
  {
    id: 'co',
    hue: '#a78bfa',
    iconSvg: '<circle cx="8.5" cy="12" r="3"></circle><circle cx="16" cy="12" r="2.3"></circle><path d="M3 5.5c4 1.6 14-1.6 18 0"></path><path d="M3 18.5c4 1.6 14-1.6 18 0"></path>',
    group: 'air',
    kind: 'scalar',
    param: 'o',
    defaultOn: false,
    dataset: 'cams-co',
    expectKind: 'cams-co-column',
    name: 'Carbon monoxide',
    sub: 'fire & city tracer · CAMS',
    sourceName: 'Copernicus CAMS',
    sourceUrl: 'https://atmosphere.copernicus.eu/global-forecast-plots',
    stops: CO_STOPS,
    scalar: { opacity: 0.85 },
    flow: WIND_FLOW,
    tape: { dataset: 'cams-co', expectKind: 'cams-co-column' },
    legend: { min: 0.55, max: 7, ticks: ['bkgd', '2', '7+ g/m²'] },
    words: [
      { label: 'Background', range: 'under 0.9 g/m²', max: 0.9 },
      { label: 'Slightly elevated', range: '0.9–1.2', max: 1.2 },
      { label: 'Elevated', range: '1.2–2', max: 2 },
      { label: 'High', range: '2–3.5', max: 3.5 },
      { label: 'Extreme', range: 'over 3.5', max: Infinity },
    ],
    stamp: (meta) => `model run ${fmtRun(meta.run_ms)}`,
    explain:
      'Carbon monoxide is fire’s chemical fingerprint — wildfires, crop burning, and traffic all release it, and it lingers in the air for weeks. That makes it a tracer: any plume you see here started at a fire or a city, often thousands of kilometers upwind.',
    popup(sample, meta) {
      const w = wordFor(this.words, sample.value)
      return {
        head: `${w.label} carbon monoxide`,
        big: `${sample.value.toFixed(1)} g/m²`,
        alt: sample.value < 0.9 ? 'normal clean-air levels' : sample.value < 2 ? 'a plume passing overhead' : 'a strong fire or pollution plume',
        meta: `All the CO in the air column above this spot · ${tapeStamp(meta, `forecast valid now · run ${fmtRun(meta.run_ms)} +${meta.lead_h} h`) || `model run ${fmtRun(meta.run_ms)}`}`,
      }
    },
  },
  {
    id: 'co2',
    hue: '#f4736e',
    iconSvg: '<circle cx="5.5" cy="12" r="2.2"></circle><circle cx="12" cy="12" r="3"></circle><circle cx="18.5" cy="12" r="2.2"></circle><path d="M7.7 12h1.3"></path><path d="M15 12h1.3"></path>',
    group: 'air',
    kind: 'scalar',
    param: 'x',
    defaultOn: false,
    dataset: 'cams-co2',
    expectKind: 'cams-co2-surface',
    name: 'Carbon dioxide',
    sub: 'near-surface ppm · CAMS',
    legendNote: 'Green rings: CO₂ emission sources observed by Carbon Mapper — mostly power plants, with measured rates and names. Bright + pulsing = seen emitting in the last ~45 days; dimmer = within a year; faint hollow = older archive (back to 2016). Compact dots world-wide, full reticles from mid zoom; empty means unsurveyed, never clean.',
    sourceName: 'Copernicus CAMS',
    sourceUrl: 'https://atmosphere.copernicus.eu/ghg-services',
    stops: CO2_STOPS,
    scalar: { opacity: 0.7 },
    // History tape: same once-daily GHG runs as methane, 8 leads/day (see
    // SYSTEMS_TAPES.co2). Until the first bake lands, the layer is Now-only.
    tape: { dataset: 'cams-co2', expectKind: 'cams-co2-surface', windowDays: 14 },
    legend: { min: 395, max: 470, ticks: ['395', '~425 avg', '470+ ppm'] },
    words: [
      { label: 'Drawn down', range: 'under 415 ppm', max: 415 },
      { label: 'Below average', range: '415–421', max: 421 },
      { label: 'Global average', range: '421–429', max: 429 },
      { label: 'Elevated', range: '429–445', max: 445 },
      { label: 'Plume', range: 'over 445', max: Infinity },
    ],
    stamp: (meta) => `model run ${fmtRun(meta.run_ms)}`,
    explain:
      'Near-surface CO₂ — the planet breathing. Green patches are forests and crops drawing carbon down in the growing season; orange and red are cities, fires, and nighttime respiration pushing it up. The swings look small around the ~425 ppm global average, but this is the number driving long-term warming.',
    popup(sample, meta) {
      const w = wordFor(this.words, sample.value)
      const d = sample.value - 425
      return {
        head: w.label === 'Global average' ? 'Around the global average' : `${w.label}`,
        big: `${sample.value.toFixed(0)} ppm`,
        alt: `${d >= 0 ? '+' : ''}${d.toFixed(0)} vs the ~425 ppm global average`,
        meta: `CO₂ in the air near the ground · ${`model run ${fmtRun(meta.run_ms)}`}`,
      }
    },
  },
  {
    id: 'methane',
    hue: '#d3d94f',
    iconSvg: '<circle cx="12" cy="12" r="2.8"></circle><circle cx="12" cy="5" r="1.6"></circle><circle cx="5" cy="16" r="1.6"></circle><circle cx="19" cy="16" r="1.6"></circle><circle cx="12" cy="19.5" r="1.6"></circle><path d="M12 8.8V6.9"></path><path d="M9.6 13.4l-2.8 1.7"></path><path d="M14.4 13.4l2.8 1.7"></path>',
    group: 'air',
    kind: 'scalar',
    param: 'm',
    defaultOn: false,
    dataset: 'cams-ch4',
    expectKind: 'cams-ch4-surface',
    name: 'Methane',
    sub: 'near-surface ppb · CAMS',
    sourceName: 'Copernicus CAMS',
    sourceUrl: 'https://atmosphere.copernicus.eu/ghg-services',
    stops: CH4_STOPS,
    scalar: { opacity: 0.75 },
    // History tape: 3-hourly frames from the daily GHG run — the nocturnal
    // boundary layer breathing; observed plume markers follow the cursor.
    tape: { dataset: 'cams-ch4', expectKind: 'cams-ch4-surface', windowDays: 14 },
    legend: { min: 1880, max: 2450, ticks: ['bkgd', '2100', '2450+ ppb'] },
    words: [
      { label: 'Below background', range: 'under 1,920 ppb', max: 1920 },
      { label: 'Background', range: '1,920–2,000', max: 2000 },
      { label: 'Elevated', range: '2,000–2,100', max: 2100 },
      { label: 'High', range: '2,100–2,300', max: 2300 },
      { label: 'Hotspot', range: 'over 2,300', max: Infinity },
    ],
    stamp: (meta) => `model run ${fmtRun(meta.run_ms)}`,
    legendNote: 'Green rings: persistent emission sources observed by Carbon Mapper (~30–60 m) — measured kg/hour, how often each site was seen leaking, and facility names via Climate TRACE. Cyan rings: sources detected by the UN\'s Methane Alert and Response System (MARS, 10 satellites, all sectors; public feed lags ~1 month). Bright + pulsing = seen emitting in the last ~45 days; dimmer = within a year; faint hollow = older archive (back to 2016). Compact dots world-wide, full reticles from mid zoom. Targeted snapshots: empty means unsurveyed, never clean.',
    explain:
      'Two views in one: the wash is modeled near-surface methane — wetlands, rice paddies, livestock, and leaky oil & gas fields lifting it above the ~1,950 ppb background. Zoom in and dots appear: real plumes from specific facilities, imaged by Carbon Mapper with measured leak rates. Methane is over 80× stronger than CO₂ in its first 20 years, so those dots are some of the cheapest climate fixes on Earth.',
    popup(sample, meta) {
      const w = wordFor(this.words, sample.value)
      return {
        head: `${w.label} methane`,
        big: `${Math.round(sample.value).toLocaleString()} ppb`,
        alt: sample.value < 2000 ? 'normal background air' : 'a source region or plume upwind',
        meta: `Methane in the air near the ground · ${`model run ${fmtRun(meta.run_ms)}`}`,
      }
    },
  },
  {
    // Climate TRACE facility inventory: every facility-level source in the
    // release, month by month (scripts/bake-climatetrace; docs/CLIMATETRACE_API.md).
    // Its own canvas renderer (traceFacilitiesOverlay.js) over our PMTiles,
    // and a MONTHLY transport tape. The tape yields the bar to fire and to
    // other timeline layers (their cursors are days, not months) and follows
    // a scalar replay's cursor, clamped to the latest published month.
    id: 'emissions',
    hue: '#fb923c',
    iconSvg: '<path d="M3 21h18"></path><path d="M5 21V11l4 2.5V11l4 2.5V8l4 2.5V21"></path><path d="M17 8V4h2v6"></path>',
    group: 'air',
    kind: 'events',
    param: 'e',
    defaultOn: false,
    name: 'Emission sources',
    sub: 'facilities, monthly · Climate TRACE',
    sourceName: 'Climate TRACE',
    sourceUrl: TRACE_URL,
    load: async () => {
      const index = await loadTraceIndex()
      return { events: [], index, meta: { fetched_ms: index.generated_ms, count: index.count, release: index.release, last: index.months[index.months.length - 1] } }
    },
    stamp: (meta) => `${meta.count.toLocaleString()} facilities, monthly estimates through ${monthWord(meta.last)} (release ${meta.release})`,
    timeline: {
      yieldsTo: ['hotspots'],
      makeTape: (field) => new MonthTape(field.index.months),
      // Whole record, three months a second (~22 s a pass).
      windowDays: 2200,
      rateHoursPerSec: 3 * 730.5,
    },
    legendRows: Object.values(SECTOR_STYLE).map((s) => ({ label: s.label, glow: s.color })),
    legendNote: 'Each disc is one facility; its area shows what it emitted in the month on the time bar, for the measure picked at the top of the map (all greenhouse gases as CO₂e by default, or one gas or air pollutant). World view shows the biggest emitters of that measure — smaller sites appear as you zoom in. Dashed rings are whole oil & gas basins, not single sites. These are Climate TRACE model estimates from satellite and activity data, not direct measurements; each popup shows its confidence rating.',
    explain:
      'Every disc is a real facility — power plants, steel mills, refineries, mines, airports, ports, landfills, cattle operations — sized by the greenhouse gases it put out that month. Press play to watch four and a half years of industry breathe: plants ramping up in winter, airports recovering after 2021, coal units going quiet.',
    // The facility card (traceCard.js). `ctx` is passed only by the click
    // path — the hover tooltip calls this too (head/big/alt only), and must
    // not trigger the card's neighbour fetches on every mouse move.
    popupEvent(ev, ctx) {
      const g = ev.measure || 'co2e_100yr'
      const mi = measureInfo(g)
      const unit = MEASURE_SUFFIX[g] || 'CO₂e'
      const what = subsectorWord(ev.sub)
      const d = peekTraceDetail(ev.id, ev.shards)
      const bodyId = `trace-card-${ev.id}-${Date.now()}`
      if (ctx && typeof document !== 'undefined') {
        traceCardBody(ev).then((res) => {
          const el = document.getElementById(bodyId)
          if (!el) return
          if (!res) { el.innerHTML = ''; return }
          el.innerHTML = res.body
          const rest = el.closest('[data-trace-card]')?.querySelector('[data-trace-rest]')
          if (rest) rest.innerHTML = res.rest
          const ident = el.closest('[data-trace-card]')?.querySelector('[data-trace-ident]')
          if (ident) ident.innerHTML = res.ident
          window.dispatchEvent(new CustomEvent('systems-popup-grew'))
        }).catch(() => { const el = document.getElementById(bodyId); if (el) el.innerHTML = '' })
      }
      const facts = d ? traceMixFacts(d, ev.month) : null
      return {
        head: `${displayName(ev.n)} — ${what}`,
        big: ev.value > 0 ? `${tonnesWord(ev.value)} ${unit}` : 'no estimate',
        alt: `in ${monthWord(ev.month)}`,
        wide: true,
        cardHtml: traceCardShell(ev, bodyId),
        // Narrator facts. The card already shows the numbers, the health
        // notes and the neighbours; the narrator adds local context only.
        ai: `Climate TRACE ${TRACE_RELEASE} facility card for ${displayName(ev.n)} (${ev.sub}, ${ev.country || ev.c}), month ${ev.month}. ` +
          (facts ? `Every gas Climate TRACE reports here that month, tonnes (a gas NOT listed is not in the estimate — never attribute any of the figure to it): ${JSON.stringify(facts)}. ` : '') +
          (ev.nearby?.length ? `Other sources within 4 km: ${ev.nearby.slice(0, 4).map((x) => `${displayName(x.n)} (${x.sub}, ${x.km.toFixed(1)} km)`).join('; ')}. ` : '') +
          `Estimate confidence: ${ev.q || 'n/a'}.${ev.b ? ' Basin-level aggregate, not a single facility.' : ''}${/shipping$/.test(ev.sub) ? ' Port figure = ship voyage emissions split half to departure and half to arrival port, not port operations.' : ''}${/aviation$/.test(ev.sub) ? ' Airport figure = flight fuel, excludes ground operations.' : ''} ` +
          'The card ALREADY shows the tonnages, the car comparison, the gas shares, health effects of each pollutant, and the neighbour list — do not repeat any of them. Add only what the card cannot: what this place is and who lives or works around it, in plain words, using only these facts and well-known geography. No statistics that are not in these facts.',
        links: [],
      }
    },
  },
  {
    id: 'sstanom',
    hue: '#f87171',
    iconSvg: '<path d="M4 14l4.5-4.5 3 3L17 7"></path><path d="M13.5 7H17v3.5"></path><path d="M3 20c2-1.7 4-1.7 6 0s4 1.7 6 0 4-1.7 6 0"></path>',
    group: 'water',
    kind: 'scalar',
    param: 'n',
    defaultOn: false,
    dataset: 'crw-sstanom',
    expectKind: 'crw-sst-anomaly',
    name: 'Ocean heat anomaly',
    sub: 'vs. normal',
    sourceName: 'NOAA Coral Reef Watch',
    sourceUrl: 'https://coralreefwatch.noaa.gov/product/5km/index_5km_ssta.php',
    stops: SSTANOM_STOPS,
    scalar: { opacity: 0.6, mask: 'water' },
    // History tape: one daily anomaly field (12:00Z), last 31 days.
    tape: { dataset: 'crw-sst-anomaly', expectKind: 'crw-sst-anomaly', year: { dataset: 'crw-sst-anomaly-year' } },
    legend: { min: -5, max: 5, ticks: ['-5', '0', '+5 °C'] },
    words: [
      { label: 'Much cooler', range: 'below -2 °C', max: -2 },
      { label: 'Cooler', range: '-2 to -1 °C', max: -1 },
      { label: 'Near normal', range: '±1 °C', max: 1 },
      { label: 'Warmer', range: '+1 to +2 °C', max: 2 },
      { label: 'Heatwave-hot', range: 'over +2 °C', max: Infinity },
    ],
    stamp: (meta) => `analysis for ${fmtDay(meta.valid_ms)}`,
    explain:
      'This is the ocean’s fever chart: not how warm the water is, but how it compares to normal for this place and season. Deep red patches are marine heatwaves — the conditions that bleach corals and supercharge storms. The Pacific’s equatorial stripe reveals El Niño (red) or La Niña (blue) at a glance.',
    popup(sample, meta) {
      const word = wordFor(this.words, sample.value).label
      const signed = `${sample.value >= 0 ? '+' : ''}${sample.value.toFixed(1)}`
      return {
        head: `${word} than usual`,
        big: `${signed} °C`,
        alt: `${sample.value >= 0 ? '+' : ''}${(sample.value * 1.8).toFixed(1)} °F`,
        meta: `Sea-surface temperature anomaly · ${tapeStamp(meta, `latest daily field, ${fmtDay(meta.valid_ms)}`) || fmtDay(meta.valid_ms)}`,
      }
    },
  },
  {
    id: 'acidity',
    hue: '#f59e6b',
    iconSvg: '<path d="M12 3.5c3.5 4.4 6 7.6 6 10.6a6 6 0 1 1-12 0c0-3 2.5-6.2 6-10.6Z"></path><path d="M12 9.5v5.5"></path><path d="M9.6 12.8 12 15.2l2.4-2.4"></path>',
    group: 'water',
    kind: 'scalar',
    // Was 'd' until 2026-09-21 — the same key the particle-density setting
    // writes (d=low|high), so with acidity on and density changed, the layer
    // flag was overwritten and acidity was lost on reload. Old shared links
    // (d=1 / d=0 can only ever have meant this layer) still work via legacyParam.
    param: 'ph',
    legacyParam: 'd',
    defaultOn: false,
    dataset: 'cmems-ph',
    expectKind: 'cmems-ph-surface',
    name: 'Ocean acidity',
    sub: 'surface pH · Copernicus + UW LiveOcean',
    sourceName: 'Copernicus Marine',
    sourceUrl: 'https://data.marine.copernicus.eu/product/GLOBAL_ANALYSISFORECAST_BGC_001_028/description',
    stops: PH_STOPS,
    scalar: { opacity: 0.8, mask: 'water' },
    // Second field, sampled for popups only: LiveOcean aragonite saturation
    // (Ω) — the number shellfish larvae live or die by. Regional; the popup
    // simply omits it where the LiveOcean domain doesn't reach.
    extraGrid: { dataset: 'liveocean-arag', expectKind: 'liveocean-arag-surface' },
    // History tape: one global field per day, last 31 days.
    tape: { dataset: 'cmems-ph', expectKind: 'cmems-ph-surface', windowDays: 31 },
    // Zoom into the Pacific Northwest and the global 25 km model hands off
    // to UW LiveOcean's ~500 m forecast (same handoff smoke does to HRRR).
    ground: {
      dataset: 'liveocean-ph',
      expectKind: 'liveocean-ph-surface',
      minZoom: 5,
      zoomNote: 'Showing UW LiveOcean’s ~500 m Salish Sea & NW-coast forecast — zoom out for the global (25 km) view.',
      toastIn: 'Now showing UW LiveOcean’s detailed Salish Sea forecast.',
      toastOut: 'Now showing the global ocean model.',
      chip: 'Salish Sea detail',
      name: 'Ocean acidity — Salish Sea detail',
      sub: 'Salish Sea & NW coast · UW LiveOcean',
      sourceName: 'UW LiveOcean',
      sourceUrl: 'https://faculty.washington.edu/pmacc/LO/LiveOcean.html',
      stops: PH_STOPS,
      // Tidal tape: 4-hourly steps — pH swinging with tides and day/night
      // photosynthesis, the Sound literally breathing.
      tape: { dataset: 'liveocean-ph', expectKind: 'liveocean-ph-surface', windowDays: 14, tapeKind: 'liveocean-ph-surface-tape' },
      legend: { min: 7.4, max: 8.3, ticks: ['7.4 acidic', '7.9', '8.3 pH'] },
      explain:
        'You’re seeing UW’s LiveOcean forecast — the ~500 m model built after acidified water wiped out Northwest oyster hatcheries. Deep water that upwells along this coast arrives extra-corrosive, and the Salish Sea’s own respiration pushes pH lower still. Click anywhere for pH plus the aragonite number shellfish live or die by.',
      popup(sample, meta, arag) {
        const w = wordFor(ACIDITY_WORDS, sample.value)
        const omega = arag ? arag.value : null
        const shell = omega == null ? 'typical for the open ocean is pH 8.0–8.1'
          : omega < 1 ? `Ω ${omega.toFixed(1)} — corrosive to shellfish larvae`
          : omega < 1.7 ? `Ω ${omega.toFixed(1)} — marginal for shell-building`
          : `Ω ${omega.toFixed(1)} — shell-friendly water`
        return {
          head: `${w.label} water`,
          big: `pH ${sample.value.toFixed(2)}`,
          alt: shell,
          meta: `Sea-surface pH · UW LiveOcean forecast (~500 m grid), valid ${fmtRun(meta.valid_ms)}`,
          ai: `SEA-SURFACE pH ${sample.value.toFixed(2)}${omega != null ? ` and aragonite saturation state Omega ${omega.toFixed(2)}` : ''} from the UW LiveOcean ROMS forecast. IMPORTANT: this is a SURFACE value; "~500 m" is the model's HORIZONTAL grid spacing, not a depth. Aragonite Omega below 1 is corrosive to shellfish larvae; 1-1.7 is marginal; above 1.7 supports shell-building. Open-ocean surface pH is typically 8.0-8.1; Salish Sea water runs lower from upwelled deep water plus respiration.`,
        }
      },
    },
    legend: { min: 7.4, max: 8.3, ticks: ['7.4 acidic', '7.9', '8.3 pH'] },
    words: ACIDITY_WORDS,
    stamp: (meta) => `forecast valid ${fmtRun(meta.valid_ms)}`,
    explain:
      'How acidic the sea surface is. The ocean has absorbed about a quarter of the CO₂ we’ve emitted, dropping its pH ~0.1 since preindustrial times — a 30% rise in acidity that makes shell-building harder for corals, oysters, and plankton. Zoom into the Pacific Northwest and the view sharpens to UW LiveOcean’s ~500 m Salish Sea forecast, with the aragonite number shellfish care about in every click.',
    popup(sample, meta, arag) {
      const w = wordFor(this.words, sample.value)
      const omega = arag ? arag.value : null
      const shell = omega == null ? 'typical for the open ocean is pH 8.0–8.1'
        : omega < 1 ? `Ω ${omega.toFixed(1)} — corrosive to shellfish larvae`
        : omega < 1.7 ? `Ω ${omega.toFixed(1)} — marginal for shell-building`
        : `Ω ${omega.toFixed(1)} — shell-friendly water`
      return {
        head: `${w.label} water`,
        big: `pH ${sample.value.toFixed(2)}`,
        alt: shell,
        meta: `Sea-surface pH · Copernicus Marine global forecast (~25 km grid) · model run ${fmtRun(meta.run_ms)}`,
        ai: `SEA-SURFACE pH ${sample.value.toFixed(2)} from the Copernicus Marine global biogeochemistry forecast (0.25 degree, ~25 km). SURFACE value. Open-ocean surface pH is typically 8.0-8.1; preindustrial was ~8.2 — the drop is ocean acidification from absorbed CO2. Aragonite Omega below 1 is corrosive to shellfish larvae.`,
      }
    },
  },
  {
    id: 'veg',
    hue: '#4ade80',
    iconSvg: '<path d="M9 4l4.5 6.5h-2.7L14.5 16h-11l3.7-5.5H4.5L9 4Z"></path><path d="M9 16v4"></path><path d="M19 9v7"></path><path d="M16.8 13.8 19 16l2.2-2.2"></path>',
    group: 'land',
    kind: 'raster',
    param: 'v',
    defaultOn: false,
    name: 'Vegetation loss',
    sub: 'past 30 days',
    sourceName: 'NASA OPERA DIST-ALERT',
    sourceUrl: 'https://www.jpl.nasa.gov/go/opera/products/dist-product-suite/',
    stops: null,
    legend: null,
    legendNote: 'Colored pixels are satellite alerts of recent vegetation loss or damage — fire scars, logging, storms, drought stress. Redder = more recent. Alerts are 30 m pixels; zoom in for detail, or open Forest Monitor for the full tool.',
    words: null,
    raster: { opacity: 0.85 },
    attribution: 'NASA OPERA L3 DIST-ALERT · GLAD',
    // Same cloud function /forestmonitor uses; it returns a short-lived Google
    // Earth Engine tile URL for the requested window.
    load: async () => {
      const base = (
        import.meta.env.VITE_FOREST_TILES_API_BASE
        || 'https://us-west1-earthatlas.cloudfunctions.net/opera-dist-alert-global'
      ).trim()
      const iso = (ms) => new Date(ms).toISOString().slice(0, 10)
      const r = await fetch(`${base}?mode=recency&start=${iso(Date.now() - 30 * 8.64e7)}&end=${iso(Date.now())}`)
      if (!r.ok) throw new Error(`tiles ${r.status}`)
      const j = await r.json()
      if (!j.tileUrl) throw new Error('empty tileUrl')
      return { tileUrl: j.tileUrl, meta: { fetched_ms: Date.now() } }
    },
    stamp: () => 'alerts from the past 30 days, rendered live from satellite',
    explain:
      'Colored patches are places where plants were recently lost or damaged — burn scars spreading behind the fire glows, clear-cuts, storm tracks, drought die-off. It’s the land-surface memory of everything the other layers do.',
  },
  {
    id: 'birds',
    hue: '#c4a5ff',
    iconSvg: '<path d="M2 17c2.4-4 6.2-4 8.5 0 2.3-4 6.1-4 8.5 0"></path><path d="M12 9.5c1.4-2.3 3.4-2.3 4.7 0 1.3-2.3 3.3-2.3 4.7 0"></path><path d="M4.5 7c.9-1.5 2.2-1.5 3 0 .8-1.5 2.1-1.5 3 0"></path>',
    group: 'life',
    kind: 'scalar',
    param: 'b',
    defaultOn: false,
    dataset: 'birdcast-mtr',
    expectKind: 'birdcast-mtr-sqrt',
    name: 'Bird migration',
    sub: 'radar-observed · contiguous U.S.',
    sourceName: 'BirdCast, Cornell Lab of Ornithology',
    sourceUrl: BIRDCAST_URL,
    stops: BIRD_STOPS,
    // feather: the coverage mask ends in 0.25° steps — dissolve the edge (display only).
    scalar: { opacity: 0.9, feather: true },
    // Observations end at the newest radar frame — there is no separate
    // "forecast valid now" grid to append, and the flight tapes must stay in
    // step with the traffic tape frame for frame.
    tape: { dataset: 'birdcast-mtr', expectKind: 'birdcast-mtr-sqrt', noLive: true },
    // Flight direction/speed: u and v (m/s) ride in the same tape frames as
    // G and B; a particle layer follows the replay cursor through them.
    // Streaks only draw where at least `minMtr` birds/km/h are crossing —
    // below that the radar's direction estimate is mostly noise.
    flight: {
      minMtr: 50,
      stops: BIRD_FLIGHT_STOPS,
      // Drawn as flapping bird silhouettes, not streaks (Josh, 2026-09-21):
      // 18 px wingspan, one wingbeat every two seconds, half the streaks'
      // travel speed (still proportional to the radar-measured ground speed),
      // and a bird budget ~1/7 of the streak budget — they are objects, not texture.
      glyph: { wingspanPx: 18, beatsPerSec: 0.5 },
      coverageBoost: 0.3,
      vector: { speedFactor: 0.21, gammaPivot: 10, offsetDegPerMs: 0.02, gamma: 1 },
    },
    // Where the numbers apply, in words — handed to the Explain narrator so it
    // never describes this layer outside its radar coverage (viewFacts.js).
    coverage: 'the contiguous United States (lower 48) and up to about 100 miles beyond its borders and coasts — U.S. weather-radar coverage only; nothing over the open ocean, Canada, Mexico or any other continent',
    factsNote: 'migration traffic rate: birds per hour crossing a 1 km line on the ground, as observed by the U.S. weather-radar network (BirdCast, Cornell Lab of Ornithology). It is a RATE of passage, not a count: never state or imply how many birds were in the air or in the view (no "millions of birds"). Migration is mostly nocturnal songbirds. Radar cannot identify species.',
    nocturnal: true,
    // Stored value → birds/km/h (the grid carries the square root).
    toValue: (raw) => raw * raw,
    unit: ' birds/km/h',
    legend: { min: 0, max: 141.4, ticks: ['0', '5,000', '20,000+ birds/km/h'] },
    legendNote: 'Square-root scale. The birds fly the direction and relative speed the radar measured, drawn only where at least 50 birds/km/h are crossing. Birds migrate mostly at night, so daytime hours run quiet. Radar coverage is thin over mountains and ends at the U.S. border — blank is "not observed", not "no birds".',
    words: [
      { label: 'Minimal', range: 'under 50 birds/km/h', max: 50 },
      { label: 'Light', range: '50–500', max: 500 },
      { label: 'Moderate', range: '500–2,000', max: 2000 },
      { label: 'Heavy', range: '2,000–7,000', max: 7000 },
      { label: 'Very heavy', range: 'over 7,000', max: Infinity },
    ],
    stamp: (meta) => `radar frame ${fmtRun(meta.valid_ms)}`,
    explain:
      'Every spring and fall, billions of birds cross the continent — mostly at night, a few hundred meters up, invisible from the ground. Weather radar sees them. The glow is how many birds are crossing each kilometer every hour; the birds on the map fly the way the real ones were heading.',
    popup(sample, meta, flight) {
      const mtr = this.toValue(sample.value)
      const w = wordFor(this.words, mtr)
      const dir = flight && mtr >= this.flight.minMtr
        ? ` · flying ${bearingWord((Math.atan2(flight.u, flight.v) * 180) / Math.PI)} at ${Math.round(flight.speed * 3.6)} km/h (${Math.round(flight.speed * 2.237)} mph)`
        : ''
      return {
        head: `${w.label} bird migration`,
        big: `${Math.round(mtr).toLocaleString('en-US')} birds/km/h`,
        alt: 'birds crossing a 1 km line each hour',
        meta: `Observed by U.S. weather radar${dir} · ${birdcastCite(meta)}`,
        link: { href: BIRDCAST_URL, label: 'Source: BirdCast live migration maps ↗' },
        ai: `Migration traffic rate ${Math.round(mtr)} birds/km/hour (birds per hour crossing a 1 km line perpendicular to their heading), from BirdCast (Cornell Lab of Ornithology) NEXRAD weather-radar mosaic, frame ${fmtRun(meta.valid_ms)}. Nocturnal migration; contiguous U.S. only; mountain radars under-report.${dir}`,
      }
    },
  },
  {
    // SPUN's underground-fungi research maps: ONE layer, several measures,
    // picked from the top-center pill (FungiPicker.jsx, same shape as the
    // Emission sources picker). `measure` is set by SystemsApp; everything
    // measure-specific (ramp, legend, words, notes, popup) reads through the
    // getters below, so the panel, the map, the popup and Explain always
    // describe the same grid. Measures + wording: fungiData.js.
    id: 'fungi',
    hue: '#e0409a',
    iconSvg: '<path d="M4.5 10.5a7.5 6 0 0 1 15 0Z"></path><path d="M10 10.5V14h4v-3.5"></path><path d="M3 14h18"></path><path d="M12 14v3l-3.5 3.5M12 17l3.5 3.5M12 17v4"></path>',
    group: 'life',
    kind: 'scalar',
    param: 'fg',
    defaultOn: false,
    name: 'Underground fungi',
    sub: 'mycorrhizal networks · research maps',
    sourceName: 'SPUN',
    sourceUrl: SPUN_URL,
    // The paper behind the measure on screen, linked beside SPUN.
    get sourceAlso() { const m = FUNGI_MEASURES[this.measure]; return [{ name: m.cite, url: m.url }] },
    measure: DEFAULT_FUNGI,
    measures: FUNGI_MEASURES,
    load() { return loadFungiField(this.measure) },
    get stops() { return FUNGI_MEASURES[this.measure].stops },
    get legend() { return FUNGI_MEASURES[this.measure].legend },
    get words() { return FUNGI_MEASURES[this.measure].words },
    get unit() { return FUNGI_MEASURES[this.measure].unit },
    get legendNote() { return FUNGI_MEASURES[this.measure].note },
    get factsNote() { return FUNGI_MEASURES[this.measure].factsNote },
    scalar: { opacity: 0.85 },
    attribution: 'SPUN (Society for the Protection of Underground Networks) · CC BY 4.0',
    coverage: FUNGI_COVERAGE,
    stamp: () => 'published model predictions (~1 km, shown at 0.1°)',
    explain:
      'Under almost every plant is a web of fungi trading minerals and water for sugar from the roots. These maps, from the Society for the Protection of Underground Networks, predict how dense those networks are and how many different kinds of fungi live in the soil, from DNA in tens of thousands of soil samples. Most of the richest places have no protection at all.',
    popup(sample) {
      return fungiPopup(this.measure, sample)
    },
  },
]
