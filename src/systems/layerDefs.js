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
import { loadSystemsJson } from './windField.js'

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

// ─── Layer definitions ──────────────────────────────────────────────────────

// Panel ontology — every layer declares one of these groups.
export const GROUPS = [
  { id: 'air', label: 'Air' },
  { id: 'water', label: 'Water' },
  { id: 'land', label: 'Land' },
]

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
    id: 'aerosol',
    hue: '#d9a441',
    iconSvg: '<path d="M5.2 6.2l1.4 1.4M2 13h2M20 13h2M17.4 7.6l1.4-1.4M22 17H2M22 21H2M16 13a4 4 0 0 0-8 0"></path>',
    group: 'air',
    kind: 'scalar',
    param: 's',
    defaultOn: false,
    dataset: 'cams-aod',
    expectKind: 'cams-aod550',
    name: 'Smoke & haze',
    sub: 'aerosols · CAMS forecast',
    sourceName: 'Copernicus CAMS',
    sourceUrl: 'https://atmosphere.copernicus.eu/global-forecast-plots',
    stops: AOD_STOPS,
    scalar: { opacity: 0.85 },
    // Companion animation: aerosol is a scalar, but what the eye wants is to
    // see it MOVE. Haze is carried by the wind, so the layer runs a neutral
    // (white) particle flow from the same GFS wind grid the Wind layer uses,
    // on its own canvas, whenever it's on. Same run stamp rules apply (the
    // popup cites the wind run alongside the CAMS run).
    flow: {
      dataset: 'gfs-wind',
      expectKind: 'gfs-wind-10m',
      stops: [[0, 'rgba(255,255,255,0.28)'], [6, 'rgba(255,255,255,0.5)'], [14, 'rgba(255,255,255,0.75)']],
      vector: { speedFactor: 0.42, gammaPivot: 10, offsetDegPerMs: 0.02 },
      countScale: 0.6,
    },
    // History tape (SYSTEMS_TAPES.aerosol): 3-hourly analysis frames, last 31 days.
    tape: { dataset: 'cams-aod', expectKind: 'cams-aod550' },
    legend: { min: 0, max: 2, ticks: ['0', '0.5', '1', '2+ AOD'] },
    words: [
      { label: 'Clear', range: 'under 0.1', max: 0.1 },
      { label: 'Hazy', range: '0.1–0.3', max: 0.3 },
      { label: 'Smoky', range: '0.3–0.7', max: 0.7 },
      { label: 'Thick', range: '0.7–1.5', max: 1.5 },
      { label: 'Extreme', range: 'over 1.5', max: Infinity },
    ],
    stamp: (meta) => `model run ${fmtRun(meta.run_ms)}`,
    explain:
      'The haze is everything floating in the air — wildfire smoke, desert dust, pollution, sea salt — shown by how much sunlight it blocks. Watch plumes stream downwind of the fire belts and dust cross oceans on the trade winds.',
    popup(sample, meta) {
      const word = wordFor(this.words, sample.value).label
      return {
        head: `${word} air`,
        big: `AOD ${sample.value.toFixed(2)}`,
        alt: sample.value < 0.1 ? 'clean sky' : sample.value < 0.3 ? 'slight haze' : sample.value < 0.7 ? 'visibly smoky' : 'dense smoke or dust',
        meta: `Aerosol optical depth at 550 nm · ${tapeStamp(meta, `forecast valid now · run ${fmtRun(meta.run_ms)} +${meta.lead_h} h`) || `model run ${fmtRun(meta.run_ms)}`}`,
      }
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
    // (white) particle flow from the same GFS wind grid the Wind layer uses,
    // on its own canvas, whenever it's on. Same run stamp rules apply (the
    // popup cites the wind run alongside the CAMS run).
    flow: {
      dataset: 'gfs-wind',
      expectKind: 'gfs-wind-10m',
      stops: [[0, 'rgba(255,255,255,0.28)'], [6, 'rgba(255,255,255,0.5)'], [14, 'rgba(255,255,255,0.75)']],
      vector: { speedFactor: 0.42, gammaPivot: 10, offsetDegPerMs: 0.02 },
      countScale: 0.6,
    },
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
    // (white) particle flow from the same GFS wind grid the Wind layer uses,
    // on its own canvas, whenever it's on. Same run stamp rules apply (the
    // popup cites the wind run alongside the CAMS run).
    flow: {
      dataset: 'gfs-wind',
      expectKind: 'gfs-wind-10m',
      stops: [[0, 'rgba(255,255,255,0.28)'], [6, 'rgba(255,255,255,0.5)'], [14, 'rgba(255,255,255,0.75)']],
      vector: { speedFactor: 0.42, gammaPivot: 10, offsetDegPerMs: 0.02 },
      countScale: 0.6,
    },
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
    flow: {
      dataset: 'gfs-wind',
      expectKind: 'gfs-wind-10m',
      stops: [[0, 'rgba(255,255,255,0.28)'], [6, 'rgba(255,255,255,0.5)'], [14, 'rgba(255,255,255,0.75)']],
      vector: { speedFactor: 0.42, gammaPivot: 10, offsetDegPerMs: 0.02 },
      countScale: 0.6,
    },
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
    flow: {
      dataset: 'gfs-wind',
      expectKind: 'gfs-wind-10m',
      stops: [[0, 'rgba(255,255,255,0.28)'], [6, 'rgba(255,255,255,0.5)'], [14, 'rgba(255,255,255,0.75)']],
      vector: { speedFactor: 0.42, gammaPivot: 10, offsetDegPerMs: 0.02 },
      countScale: 0.6,
    },
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
    legendNote: 'Pulsing green rings: CO₂ emission sources observed by Carbon Mapper — mostly power plants, with measured rates and names. Appear from mid zoom; empty means unsurveyed, never clean.',
    sourceName: 'Copernicus CAMS',
    sourceUrl: 'https://atmosphere.copernicus.eu/ghg-services',
    stops: CO2_STOPS,
    scalar: { opacity: 0.7 },
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
    legendNote: 'Pulsing green rings: persistent emission sources observed by Carbon Mapper (~30–60 m) — measured kg/hour, how often each site was seen leaking, and facility names via Climate TRACE. Appear from mid zoom. Targeted snapshots: empty means unsurveyed, never clean.',
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
    param: 'd',
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
]
