/**
 * Story Lab's plain-language view of the /inmotion layers.
 *
 * Every layer here is a real /inmotion layer (src/systems/layerDefs.js); this
 * file only adds what the lab shows differently: the four plain headings, a
 * short name, the legend card's title / measure / low and high ends in US
 * units, and a two-sentence description. Colors, data, sources and the long
 * explanations still come from layerDefs.
 *
 * Low/high ends are the layerDefs legend ends converted to US units
 * (m/s → mph, °C → °F, m → ft, mm/h → in/h); nothing is invented.
 */

import { LAYERS, rampGradient } from '../systems/layerDefs.js'

export const GROUPS = [
  { id: 'moves', label: 'How Earth moves', ids: ['wind', 'currents', 'storms', 'clouds', 'rain', 'waves', 'airtemp', 'quakes'] },
  { id: 'air', label: 'What is in the air', ids: ['smoke', 'pm25', 'dust', 'co', 'co2', 'methane'] },
  { id: 'changing', label: 'What we are changing', ids: ['sst', 'sstanom', 'acidity', 'hotspots', 'emissions', 'veg'] },
  { id: 'life', label: 'Life on the move', ids: ['birds', 'fungi'] },
]

export const COPY = {
  wind: {
    name: 'Wind', title: 'Wind at 10 m', measure: 'Speed', lo: '0 mph', hi: '67+ mph',
    about: 'Wind is the air moving from high pressure to low. These streaks follow it about ten meters above the ground, roughly the height of a two-story house.',
  },
  currents: {
    name: 'Ocean currents', title: 'Surface currents', measure: 'Speed', lo: '0 mph', hi: '5.6+ mph',
    about: 'Ocean currents carry heat, nutrients and larvae across whole basins. The fastest rivers in the sea glow brightest here.',
  },
  storms: {
    name: 'Storms', title: 'Tropical cyclones', measure: 'Category', lo: 'Tropical storm', hi: 'Category 5',
    about: 'Hurricanes, typhoons and cyclones are the same kind of storm. Their tracks and forecast cones update as advisories are issued.',
  },
  clouds: {
    name: 'Clouds', title: 'Cloud cover', measure: 'Cover', lo: 'Clear', hi: 'Thick cloud',
    bar: 'linear-gradient(90deg,#0E1A28,#5B6B80,#E8ECF2)',
    about: 'A whole-Earth view of cloud, stitched together from weather satellites every hour. Brighter means colder, higher cloud tops.',
  },
  rain: {
    name: 'Rain', title: 'Rain and snow', measure: 'Rate', lo: '0 in/h', hi: '2.8+ in/h',
    about: 'Where rain and snow are falling right now, measured from space. Zoom in over the U.S. and weather radar takes over for sharper detail.',
  },
  waves: {
    name: 'Waves', title: 'Wave height', measure: 'Typical height', lo: '0 ft', hi: '36+ ft',
    about: 'How tall the waves are out at sea. Big swells start under distant storms and can cross a whole ocean before they reach a beach.',
  },
  airtemp: {
    name: 'Air temperature', title: 'Air temperature', measure: 'Near the ground', lo: '−40 °F', hi: '113 °F',
    about: 'How warm or cold the air is about two meters up, where people live. Watch cold air spill south and warm air push north as weather moves.',
  },
  quakes: {
    name: 'Earthquakes', title: 'Earthquakes', measure: 'M3.0+, past 30 days', lo: 'M3', hi: 'M7+',
    about: 'Every earthquake magnitude 3 or larger in the past month. Bigger circles mean stronger shaking.',
  },
  smoke: {
    name: 'Wildfire smoke', title: 'Wildfire smoke', measure: 'How hazy (organic + black carbon)', lo: 'Clear', hi: 'Extreme',
    about: 'Smoke from large fires travels thousands of miles. This shows where it is drifting now and where it is forecast to go.',
  },
  pm25: {
    name: 'Fine particles (PM2.5)', title: 'Air quality', measure: 'PM2.5', lo: 'Good', hi: 'Hazardous (250+ µg/m³)',
    about: 'Particles small enough to reach deep into the lungs. Dust, smoke and traffic all contribute.',
  },
  dust: {
    name: 'Desert dust', title: 'Desert dust', measure: 'How hazy', lo: 'Clear', hi: 'Extreme',
    about: 'Wind lifts dust from deserts and carries it across oceans. Saharan dust reaches the Americas and helps feed the Amazon.',
  },
  co: {
    name: 'Carbon monoxide', title: 'Carbon monoxide', measure: 'In the air column', lo: 'Background', hi: '7+ g/m²',
    about: 'A gas given off by fires and engines that burn fuel incompletely. Plumes show where burning is happening and where the wind takes it.',
  },
  co2: {
    name: 'Carbon dioxide', title: 'Carbon dioxide', measure: 'Near-surface ppm', lo: '395 ppm', hi: '470+ ppm',
    about: 'The main gas warming the planet, shown as it pools near cities and industry and spreads on the wind.',
  },
  methane: {
    name: 'Methane', title: 'Methane', measure: 'Near-surface ppb', lo: '1,880 ppb', hi: '2,450+ ppb',
    about: 'A powerful warming gas from wetlands, farms, landfills and oil and gas. Green and cyan markers are leaks seen directly by satellites.',
  },
  sst: {
    name: 'Sea temperature', title: 'Sea surface temperature', measure: 'Daily', lo: '28 °F', hi: '90 °F',
    about: 'How warm the top of the ocean is today. Warm water fuels storms and stresses corals and kelp.',
  },
  sstanom: {
    name: 'Ocean heat anomaly', title: 'Ocean heat vs. normal', measure: 'Difference from normal', lo: '9 °F cooler', hi: '9 °F warmer',
    about: 'Not how warm the sea is, but how much warmer or cooler than usual for this date.',
  },
  acidity: {
    name: 'Ocean acidity', title: 'Ocean acidity', measure: 'Surface pH', lo: 'pH 7.4 (more acidic)', hi: 'pH 8.3',
    about: 'The ocean absorbs carbon dioxide and slowly turns more acidic. Lower pH makes it harder for shellfish and corals to build their shells.',
  },
  hotspots: {
    name: 'Active fires', title: 'Active fires', measure: 'Hot spots, last 24 h', lo: '', hi: '',
    bar: 'linear-gradient(90deg,#F2A33A,#D6463F)',
    about: 'Each glow is a hot spot a satellite saw in the past day. Most are wildfires; some are farm burns or industrial heat.',
  },
  emissions: {
    name: 'Emission sources', title: 'Emission sources', measure: 'Estimated emissions per site', lo: 'Smaller', hi: 'Larger',
    about: 'Power plants, mines, ports and other big sites, sized by how much they emit. The numbers are model estimates from Climate TRACE.',
  },
  veg: {
    name: 'Vegetation loss', title: 'Vegetation loss', measure: 'Satellite alerts, past 30 days', lo: 'Older', hi: 'Recent',
    bar: 'linear-gradient(90deg,#7A5A3A,#F2A33A,#D6463F)',
    about: 'Places where plants were recently lost or damaged: burn scars, clear-cuts, storm tracks and drought. It is the land remembering what the other layers did.',
  },
  birds: {
    name: 'Bird migration', title: 'Bird migration', measure: 'Birds in flight, radar', lo: 'Few', hi: 'Many',
    about: 'Weather radar sees millions of birds aloft on migration nights. This shows how many are flying and where they are headed.',
  },
  fungi: {
    name: 'Underground fungi', title: 'Underground fungi', measure: 'Predicted underground networks', lo: 'Less', hi: 'More',
    about: 'Fungal networks under the soil link plant roots and store carbon. These maps predict where the richest networks are.',
  },
}

const DEFS = Object.fromEntries(LAYERS.map((d) => [d.id, d]))
export const defFor = (id) => DEFS[id]

/** The legend card's color bar for a layer, from its own ramp where it has one. */
export function legendBar(id) {
  const def = DEFS[id]
  const c = COPY[id]
  if (c?.bar) return c.bar
  if (def?.stops && def.legend) return rampGradient(def.stops, def.legend.min, def.legend.max)
  if (def?.legendRows?.length) {
    const glows = def.legendRows.map((r) => r.glow).filter(Boolean)
    if (glows.length > 1) return `linear-gradient(90deg,${glows.join(',')})`
  }
  const hue = def?.hue || '#7FD3EC'
  return `linear-gradient(90deg, ${hue}22, ${hue})`
}

/** One-line source for the legend: who, and how fresh. */
export function sourceLine(id, meta) {
  const def = DEFS[id]
  if (!def) return ''
  const who = [def.sourceName, ...(def.sourceAlso || []).map((x) => x.name)].join(' & ')
  let when = ''
  try { when = meta && def.stamp ? def.stamp(meta) : '' } catch { when = '' }
  return when ? `${who} · ${when}` : who
}
