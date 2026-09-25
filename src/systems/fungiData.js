/**
 * Underground fungi (SPUN) — the measures behind the one "Underground fungi"
 * layer on /inmotion, and the field that serves them.
 *
 * Seven baked grids (scripts/bake-spun/bake.py), shown ONE at a time and
 * picked from the top-center pill (FungiPicker.jsx):
 *   hyphae        AM fungal network density, m of hyphae per cm³ of topsoil
 *                 (Stewart, Bisot et al. 2026, Science)
 *   am-rich/ecm-rich   predicted richness (Van Nuland et al. 2025, Nature)
 *   am-rare/ecm-rare   rarity-weighted richness, even-sampling scenario — the
 *                 version the paper maps and ranks hotspots on
 *   *-rare-emp    the same under today's real sampling effort (the pill's
 *                 "as sampled today" checkbox)
 *
 * Every figure, unit and cut-off below is quoted from those papers; the
 * "typical" bands are the quartiles of the baked 0.1° land grid (printed by
 * the bake). Each reading carries its own model spread and — for the Nature
 * maps — whether the model is extrapolating there (SPUN's "Extrapolation"
 * layer: share of environmental space covered by training data; the paper
 * cross-hatches cells under 0.95).
 */

import { loadGridField } from './windField.js'

export const NATURE_URL = 'https://www.nature.com/articles/s41586-025-09277-4'
export const SCIENCE_URL = 'https://www.science.org/doi/10.1126/science.adu4373'
export const SPUN_URL = 'https://www.spun.earth/'
export const NATURE_CITE = 'Van Nuland et al. 2025, Nature 645:414–422'
export const SCIENCE_CITE = 'Stewart, Bisot et al. 2026, Science 392:1171–1176'

// Where the maps exist. SPUN masks sparsely vegetated land and dense cities.
const COVERAGE = 'vegetated land worldwide. Oceans, ice sheets, deserts and other sparsely vegetated ground, and dense urban areas have no prediction (they are masked, not zero)'

const RICH_STOPS = [
  [0, 'rgba(58,40,110,0.55)'],
  [0.25, 'rgba(49,104,142,0.66)'],
  [0.5, 'rgba(33,145,140,0.74)'],
  [0.75, 'rgba(94,201,98,0.82)'],
  [1, 'rgba(253,231,37,0.92)'],
]
const RARE_STOPS = [
  [0, 'rgba(40,20,70,0.55)'],
  [0.25, 'rgba(110,40,130,0.66)'],
  [0.5, 'rgba(190,60,120,0.76)'],
  [0.75, 'rgba(245,125,80,0.84)'],
  [1, 'rgba(252,236,170,0.94)'],
]
// Fungal networks (Josh, 2026-09-24): clear and faint where networks are
// sparse, deepening to rich, opaque magenta where they are dense. NOT green or
// blue: the satellite basemap is green over every forest, so a green fill
// became one blob over the Amazon. Magenta has the most contrast with both
// forest and ocean, and leaves the gold living threads room to glow. Below the
// median (4.1 m/cm³) land barely tints; the dense top ~5% (≥ 5.66) is the
// deepest magenta. Stops at the data's own quantiles (bake: p1 2.7, p25 3.67,
// p50 4.09, p75 4.61, p95 5.66, p99 6.5 m/cm³). In m/cm³, NOT stretched; the
// legend draws them at true positions.
const HYPHAE_STOPS = [
  [2.5, 'rgba(255,190,222,0.03)'],
  [3.7, 'rgba(250,168,210,0.1)'],
  [4.1, 'rgba(242,128,192,0.28)'],
  [4.6, 'rgba(228,78,170,0.52)'],
  [5.1, 'rgba(208,40,152,0.72)'],
  [5.66, 'rgba(178,18,130,0.86)'],
  [6.5, 'rgba(132,6,98,0.95)'],
]
// Stops are authored on 0..1 and stretched onto each measure's legend span.
const stretch = (stops, min, max) => stops.map(([t, c]) => [min + t * (max - min), c])

function bands(p25, p50, p75, top, topLabel, fmt) {
  return [
    { label: 'Low', range: `under ${fmt(p25)}`, max: p25 },
    { label: 'Below middle', range: `${fmt(p25)}–${fmt(p50)}`, max: p50 },
    { label: 'Above middle', range: `${fmt(p50)}–${fmt(p75)}`, max: p75 },
    { label: 'High', range: `${fmt(p75)}–${fmt(top)}`, max: top },
    { label: topLabel, range: `${fmt(top)}+`, max: Infinity },
  ]
}

const RICH_NOTE = 'Predicted by SPUN’s machine-learning model from DNA in thousands of soil samples; the map is a model, not a survey of every square kilometre. Bands are quartiles of mapped land; “Hotspot” is the paper’s own cut-off, the richest 5% of land worldwide.'
const RARE_NOTE = 'Rarity-weighted richness: how many of the fungi found here are found in few other places, a measure of how irreplaceable a site is. It has no units. SPUN ranks rarity under an even-sampling scenario so that heavily studied regions do not look rarer just because more soil was sequenced there.'

export const FUNGI_MEASURES = {
  hyphae: {
    group: 'networks',
    label: 'Fungal networks',
    hint: 'metres of fungal threads in each cm³ of topsoil',
    unit: ' m/cm³',
    // 1st–99th percentile of mapped land is 2.7–6.5 (bake output).
    legend: { min: 2.5, max: 6.5, ticks: ['2.5', '3.5', '4.5', '5.5', '6.5+ m/cm³'] },
    stops: HYPHAE_STOPS,
    absStops: true,
    words: bands(3.67, 4.09, 4.61, 5.66, 'Top 5%', (v) => v.toFixed(1)),
    cite: SCIENCE_CITE,
    url: SCIENCE_URL,
    note: 'How much arbuscular mycorrhizal fungal network is threaded through the topsoil: metres of hyphae (living fungal threads) in every cubic centimetre. The global total is about 1.1 × 10¹⁷ km of hyphae, weighing roughly 300 million tonnes, about 4 to 6 times the weight of every human. Predicted by machine learning from 16,000+ soil cores in 322 studies. Bands are quartiles of mapped land. The moving golden threads are an ILLUSTRATION: they start and spread only in proportion to the measured density, but their paths and pulses are drawn, not measured.',
    factsNote: 'Arbuscular mycorrhizal (AM) fungal hyphal density in topsoil, metres of hyphae per cubic centimetre of soil, as PREDICTED by SPUN machine-learning models (Stewart, Bisot et al. 2026, Science) from 16,000+ soil cores. It is a model estimate, not a measurement at this spot. AM fungi partner with about 70% of plant species and move about 1 billion tonnes of carbon a year into soils; global topsoils hold an estimated 1.1 × 10^17 km of these hyphae (~300 megatonnes). The animated golden threads on screen are an ILLUSTRATION (their density follows the data; their paths and pulses are not measured) — never describe them as observed flows.',
  },
  'am-rich': {
    group: 'rich',
    label: 'AM fungi · richness',
    hint: 'kinds of fungi partnered with most plants, crops and grasses',
    unit: ' taxa',
    legend: { min: 5, max: 45, ticks: ['5', '15', '25', '35', '45+ taxa'] },
    stops: RICH_STOPS,
    words: bands(10.6, 16.6, 26.1, 39.9, 'Hotspot', (v) => v.toFixed(0)),
    hotspot: 39.9,
    cite: NATURE_CITE,
    url: NATURE_URL,
    taxaWord: 'virtual taxa (DNA-defined kinds) of arbuscular mycorrhizal fungi per 100 m²',
    note: `Arbuscular mycorrhizal (AM) fungi live inside the roots of most plants, including grasses and most crops. ${RICH_NOTE} AM richness peaks near the equator and falls toward the poles.`,
    factsNote: 'Predicted RICHNESS of arbuscular mycorrhizal (AM) fungi: number of virtual taxa (DNA-defined kinds) expected per 100 m², from SPUN random-forest models (Van Nuland et al. 2025, Nature), ~1 km resolution. MODEL PREDICTION, not a survey. Hotspot = top 5% of land globally (≥ 39.9 taxa); only 5.1% of AM richness hotspots are in protected areas. AM richness is highest near the equator.',
  },
  'ecm-rich': {
    group: 'rich',
    label: 'EcM fungi · richness',
    hint: 'kinds of fungi that sheathe tree roots: pines, oaks, birches',
    unit: ' taxa',
    legend: { min: 0, max: 70, ticks: ['0', '20', '40', '60', '70+ taxa'] },
    stops: RICH_STOPS,
    words: bands(10.2, 20.3, 34.8, 60.0, 'Hotspot', (v) => v.toFixed(0)),
    hotspot: 60.0,
    cite: NATURE_CITE,
    url: NATURE_URL,
    taxaWord: 'OTUs (DNA-defined kinds) of ectomycorrhizal fungi per 100 m²',
    note: `Ectomycorrhizal (EcM) fungi wrap the roots of many trees: pines, oaks, beeches, birches, eucalypts. Many of the mushrooms people know are their fruiting bodies. ${RICH_NOTE} Unlike most life, EcM richness is lowest near the equator and highest in northern forests.`,
    factsNote: 'Predicted RICHNESS of ectomycorrhizal (EcM) fungi: number of OTUs (DNA-defined kinds) expected per 100 m², from SPUN random-forest models (Van Nuland et al. 2025, Nature), ~1 km. MODEL PREDICTION. Hotspot = top 5% of land globally (≥ 60 OTUs); 13.9% of EcM richness hotspots are in protected areas. EcM richness runs opposite to most life: lowest at the equator, highest across northern latitudes and southern South America/Australia.',
  },
  'am-rare': {
    group: 'rare',
    label: 'AM fungi · rarity',
    hint: 'where the fungi are found few other places',
    unit: ' (rarity index, no units)', // never '' — Explain falls back to °C on an empty unit
    legend: { min: 0.05, max: 0.26, ticks: ['0.05', '0.12', '0.19', '0.26+'] },
    stops: RARE_STOPS,
    words: bands(0.083, 0.119, 0.186, 0.24, 'Hotspot', (v) => v.toFixed(2)),
    hotspot: 0.24,
    cite: NATURE_CITE,
    url: NATURE_URL,
    emp: 'am-rare-emp',
    note: `${RARE_NOTE} Arbuscular mycorrhizal fungi. “Hotspot” is the rarest 5% of land (≥ 0.24).`,
    factsNote: 'Rarity-weighted richness (unitless endemism index) of arbuscular mycorrhizal fungi, high-sampling scenario (SPUN, Van Nuland et al. 2025, Nature). Higher = more of the local fungi are found in few other places. MODEL PREDICTION. Hotspot = top 5% (≥ 0.24); 22.6% of AM rarity hotspots are protected.',
  },
  'ecm-rare': {
    group: 'rare',
    label: 'EcM fungi · rarity',
    hint: 'where the fungi are found few other places',
    unit: ' (rarity index, no units)', // never '' — Explain falls back to °C on an empty unit
    legend: { min: 0, max: 1.5, ticks: ['0', '0.5', '1.0', '1.5+'] },
    stops: RARE_STOPS,
    words: bands(0.54, 0.71, 0.98, 1.27, 'Hotspot', (v) => v.toFixed(2)),
    hotspot: 1.27,
    cite: NATURE_CITE,
    url: NATURE_URL,
    emp: 'ecm-rare-emp',
    note: `${RARE_NOTE} Ectomycorrhizal fungi. “Hotspot” is the rarest 5% of land (≥ 1.27).`,
    factsNote: 'Rarity-weighted richness (unitless endemism index) of ectomycorrhizal fungi, high-sampling scenario (SPUN, Van Nuland et al. 2025, Nature). MODEL PREDICTION. Hotspot = top 5% (≥ 1.27); 23.2% of EcM rarity hotspots are protected. Empirical vs even-sampling predictions diverge strongly in tundra and tropical forest, where more sampling will likely reveal new rarity hotspots.',
  },
}
// "As sampled today": same scale, words and hotspot line as the even-sampling
// map it replaces, so flipping the checkbox shows only the data changing.
for (const base of ['am-rare', 'ecm-rare']) {
  const b = FUNGI_MEASURES[base]
  FUNGI_MEASURES[b.emp] = {
    ...b,
    emp: null,
    empOf: base,
    label: `${b.label} · as sampled today`,
    note: `${b.note} This view uses today’s uneven sampling effort instead of the even-sampling scenario, so it shows where rarity has actually been observed so far.`,
    factsNote: `${b.factsNote} THIS VIEW is the EMPIRICAL prediction (current, uneven sampling intensity), not the even-sampling scenario the paper ranks hotspots on.`,
  }
}
for (const m of Object.values(FUNGI_MEASURES)) if (!m.absStops) m.stops = stretch(m.stops, m.legend.min, m.legend.max)

// Hotspots, the paper's Figs. 4 (AM) and 5 (EcM): richness hotspots green,
// rarity hotspots purple, both yellow, everything else dark. Hotspot = at or
// above the 95th percentile of the global predictions, the paper's own cut-offs.
// The bake classifies every ~1 km pixel first; a 0.1° cell counts as a
// hotspot of a kind when at least half its predicted pixels are.
// Value = class code 0–3, read by nearest cell (never blended: halfway
// between "richness" and "both" is not "rarity").
const HOT_COLORS = ['rgba(8,8,12,0.62)', 'rgba(64,200,96,0.9)', 'rgba(176,96,236,0.92)', 'rgba(250,222,48,0.95)']
const HOT_STOPS = HOT_COLORS.flatMap((c, i) => [[i - 0.49, c], [i + 0.49, c]])
const HOT_WORDS = [
  { label: 'Not a hotspot', range: 'dark', max: 0.5 },
  { label: 'Richness hotspot', range: 'green', max: 1.5 },
  { label: 'Rarity hotspot', range: 'purple', max: 2.5 },
  { label: 'Both', range: 'yellow', max: Infinity },
]
const HOT_BASE = {
  group: 'hot',
  hot: true,
  unit: ' (hotspot class: 0 none, 1 richness, 2 rarity, 3 both)',
  legend: { min: -0.5, max: 3.5, ticks: [] },
  stops: HOT_STOPS,
  words: HOT_WORDS,
  cite: NATURE_CITE,
  url: NATURE_URL,
}
FUNGI_MEASURES['am-hot'] = {
  ...HOT_BASE,
  label: 'AM fungi · hotspots',
  hint: 'the richest and rarest 5% of land (the paper’s Fig. 4)',
  cuts: { rich: '39.9 taxa', rare: '0.24' },
  protectedPct: { rich: 5.1, rare: 22.6 },
  note: 'Hotspots of arbuscular mycorrhizal fungi, as mapped in the paper’s Fig. 4: places in the top 5% worldwide for richness (≥ 39.9 taxa, green), for rarity (≥ 0.24, purple), or both (yellow). Only 5.1% of AM richness hotspots and 22.6% of AM rarity hotspots are in protected areas. Classified at SPUN’s ~1 km resolution; each 0.1° cell here shows a kind when at least half its land is that kind of hotspot.',
  factsNote: 'HOTSPOT CLASS map for arbuscular mycorrhizal (AM) fungi (SPUN, Van Nuland et al. 2025, Nature, Fig. 4). Each cell is a category, NOT a quantity — ignore mean/min/max and use area_breakdown: richness hotspot = top 5% of predicted richness worldwide (≥ 39.9 virtual taxa per 100 m²); rarity hotspot = top 5% of rarity-weighted richness (≥ 0.24, even-sampling scenario). Only 5.1% of AM richness hotspots (~280,000 km²) and 22.6% of AM rarity hotspots (~1.2 million km²) are protected. AM hotspots: Brazilian Cerrado, Southeast Asian tropical forest, West African Guinean forests (richness); Congo basin and eastern Amazon (rarity). MODEL PREDICTIONS.',
}
FUNGI_MEASURES['ecm-hot'] = {
  ...HOT_BASE,
  label: 'EcM fungi · hotspots',
  hint: 'the richest and rarest 5% of land (the paper’s Fig. 5)',
  cuts: { rich: '60 taxa', rare: '1.27' },
  protectedPct: { rich: 13.9, rare: 23.2 },
  note: 'Hotspots of ectomycorrhizal fungi, as mapped in the paper’s Fig. 5: places in the top 5% worldwide for richness (≥ 60 taxa, green), for rarity (≥ 1.27, purple), or both (yellow). Richness hotspots run through northern forests; rarity hotspots sit mostly in tundra and a few tropical areas, so the two rarely overlap. Only 13.9% of EcM richness hotspots and 23.2% of EcM rarity hotspots are protected. Classified at SPUN’s ~1 km resolution; each 0.1° cell here shows a kind when at least half its land is that kind of hotspot.',
  factsNote: 'HOTSPOT CLASS map for ectomycorrhizal (EcM) fungi (SPUN, Van Nuland et al. 2025, Nature, Fig. 5). Each cell is a category, NOT a quantity — ignore mean/min/max and use area_breakdown: richness hotspot = top 5% of predicted richness worldwide (≥ 60 OTUs per 100 m²); rarity hotspot = top 5% of rarity-weighted richness (≥ 1.27, even-sampling scenario). Only 13.9% of EcM richness hotspots (~756,000 km²) and 23.2% of EcM rarity hotspots (~1.3 million km²) are protected. Richness hotspots: Siberian and Canadian boreal forest, western North American conifer forest, Central Europe, Great Lakes; rarity hotspots mostly tundra. MODEL PREDICTIONS.',
}

export const DEFAULT_FUNGI = 'hyphae'
export const fungiMeasure = (id) => (FUNGI_MEASURES[id] ? id : DEFAULT_FUNGI)

/**
 * One measure's display grid + popup companions, behind the GridField
 * interface the scalar overlay and Explain already use. sampleScalar adds
 * the model spread (cv, or sd for hyphae) and training-data coverage.
 */
/** Hotspot grid: two planes of 0.1° shares (richness, rarity) → class code. */
class HotspotField {
  constructor(grid) {
    this.grid = grid
    this.meta = grid.meta
  }
  // Nearest cell, not bilinear: the value is a category.
  _share(plane, r, c) {
    const raw = this.grid._raw(plane, r, c)
    return raw === this.meta.missing ? null : raw / this.meta.scale
  }
  sampleScalar(lng, lat) {
    const loc = this.grid._locate(lng, lat)
    if (!loc) return null
    const m = this.meta
    const r = Math.min(m.nLat - 1, Math.max(0, Math.round(loc.rf)))
    const c = ((Math.round(loc.cf) % m.nLon) + m.nLon) % m.nLon
    const rich = this._share(0, r, c)
    const rare = this._share(1, r, c)
    if (rich == null && rare == null) return null
    const value = ((rich ?? 0) >= 0.5 ? 1 : 0) + ((rare ?? 0) >= 0.5 ? 2 : 0)
    return { value, rich, rare }
  }
}

class FungiField {
  constructor(main, cv, cover) {
    this.main = main
    this.cv = cv
    this.cover = cover
    this.meta = main.meta
  }
  sampleScalar(lng, lat) {
    const s = this.main.sampleScalar(lng, lat)
    if (!s) return null
    return {
      value: s.value,
      spread: this.cv?.sampleScalar(lng, lat)?.value ?? null,
      cover: this.cover?.sampleScalar(lng, lat)?.value ?? null,
    }
  }
}

const cache = new Map()
export function loadFungiField(id) {
  if (!cache.has(id)) {
    const p = FUNGI_MEASURES[id]?.hot ? loadGridField(`spun-${id}`, `spun-${id}`).then((g) => new HotspotField(g)) : Promise.all([
      loadGridField(`spun-${id}`, `spun-${id}`),
      // Companions are popup-only: a missing one drops that line, never the map.
      loadGridField(`spun-${id}-cv`, `spun-${id}-cv`).catch(() => null),
      id === 'hyphae' ? null : loadGridField(`spun-${id}-cover`, `spun-${id}-cover`).catch(() => null),
    ]).then(([main, cv, cover]) => new FungiField(main, cv, cover))
    p.catch(() => cache.delete(id)) // a failed load may be retried
    cache.set(id, p)
  }
  return cache.get(id)
}

const wordFor = (words, v) => words.find((w) => v < w.max) || words[words.length - 1]

/** Popup for the measure on screen — value, plain word, spread, coverage, source. */
export function fungiPopup(id, sample) {
  const m = FUNGI_MEASURES[id]
  if (m.hot) return hotspotPopup(m, sample)
  const v = sample.value
  const w = wordFor(m.words, v)
  const hot = m.hotspot != null && v >= m.hotspot
  const lines = []
  if (id === 'hyphae') {
    if (sample.spread != null) lines.push(`± ${sample.spread.toFixed(2)} m/cm³ (the model’s standard deviation)`)
  } else if (sample.spread != null) {
    lines.push(`model spread ±${Math.round(sample.spread * 100)}% across 100 bootstrapped model runs`)
  }
  let coverWord = ''
  if (sample.cover != null) {
    coverWord = sample.cover < 0.95
      ? 'Few soil samples resemble this place, so the model is extrapolating here (SPUN flags this). Treat with caution.'
      : 'Well covered by the soil samples the model learned from.'
  }
  const big = id === 'hyphae'
    ? `${v.toFixed(1)} m of hyphae per cm³`
    : m.group === 'rich' ? `${Math.round(v)} taxa` : `${v.toFixed(2)} rarity index`
  const alt = id === 'hyphae'
    // m per cm³ × 1,000 cm³ per litre = the same number in km per litre.
    ? `about ${v.toFixed(1)} km of living fungal thread in every litre of topsoil`
    : m.group === 'rich' ? m.taxaWord : 'rarity-weighted richness (no units): higher means more of these fungi live nowhere else'
  return {
    head: hot ? `${m.label}: a global hotspot (top 5%)` : `${w.label} · ${m.label}`,
    big,
    alt,
    meta: [`Model prediction, ~1 km resolution, averaged to 0.1° here`, ...lines, coverWord, `SPUN · ${m.cite} · CC BY 4.0`].filter(Boolean).join(' · '),
    link: { href: m.url, label: `Source: ${m.cite} ↗` },
    ai: `${m.factsNote} VALUE HERE: ${big}${hot ? ' (global hotspot, top 5%)' : ` (${w.label.toLowerCase()} relative to all mapped land)`}.${lines.length ? ` Uncertainty: ${lines.join('; ')}.` : ''}${sample.cover != null ? ` Training-data coverage ${Math.round(sample.cover * 100)}%${sample.cover < 0.95 ? ' — EXTRAPOLATED, say the estimate is uncertain' : ''}.` : ''}`,
  }
}

const pct = (share) => (share == null ? 'no prediction' : `${Math.round(share * 100)}%`)
function hotspotPopup(m, s) {
  const kind = m.label.split(' · ')[0]
  // “an”: AM and EcM both read with a vowel sound.
  const head = [`Not an ${kind} hotspot`, `${kind} richness hotspot`, `${kind} rarity hotspot`, `${kind} richness and rarity hotspot`][s.value]
  const why = [
    'Neither richness nor rarity here is in the top 5% worldwide.',
    `Among the richest 5% of land on Earth for these fungi (≥ ${m.cuts.rich}). Only ${m.protectedPct.rich}% of these hotspots are protected.`,
    `Among the 5% of land where these fungi are rarest (≥ ${m.cuts.rare}). Only ${m.protectedPct.rare}% of these hotspots are protected.`,
    `In the top 5% worldwide for both richness and rarity, the rarest kind of hotspot.`,
  ][s.value]
  const share = `Share of this ~11 km cell that is a hotspot: richness ${pct(s.rich)}, rarity ${pct(s.rare)}`
  return {
    head,
    big: ['Not a hotspot', 'Richness hotspot', 'Rarity hotspot', 'Both kinds'][s.value],
    alt: why,
    meta: [share, 'hotspot = top 5% of SPUN’s ~1 km model predictions, the paper’s cut-off', `SPUN · ${m.cite} · CC BY 4.0`].join(' · '),
    link: { href: m.url, label: `Source: ${m.cite} ↗` },
    ai: `${m.factsNote} AT THIS SPOT: ${head}. ${share}.`,
  }
}

export const FUNGI_COVERAGE = COVERAGE
