/**
 * Popups for the five Friends of the San Juans habitat layers, built exactly as Salish Sea Explorer builds them
 * (salish-sea-propmapper: buildFeaturePopupHtml in src/components/Map/FeaturePopup.tsx, POPUP_SPECS / ACTIONS /
 * LAYER_PHOTOS / PHOTO_SUBJECTS in src/config/popups.ts, the layer configs in src/config/layers.ts, the details
 * table from extractAllFeatureProperties in src/utils/geojson.ts). Josh's rule: same frame, same content, same look
 * as SSE, so every string here is SSE's (Friends' own words) — change it there first, then copy.
 *
 * Differences from SSE, all forced by hosting: SSE's site-relative report links point at salishsea.knauernever.com,
 * and the shoreline-handout photos are served from /friends/shoreline-images.
 *
 * Usage (Mapbox):
 *   import '../friends/ssx.css'
 *   installPopupFrameHandlers(); preloadFriendsContent()
 *   const popup = new mapboxgl.Popup({ className: 'ssx-host', maxWidth: '380px', closeButton: false })
 *     .setLngLat(lngLat).setHTML(buildFriendsHabitatPopup(f.properties.h, f.properties)).addTo(map)
 *   window.addEventListener(POPUP_CLOSE_EVENT, () => popup.remove())
 */

import { buildPopupFrame, escapeHtml as escHtml, installPopupFrameHandlers, POPUP_CLOSE_EVENT } from './popupFrame.js'
import { getFriendsContentSync, preloadFriendsContent, articlesForFeature, photosForSubject, articleDate } from './friendsContent.js'

export { installPopupFrameHandlers, POPUP_CLOSE_EVENT, preloadFriendsContent }

const SSE = 'https://salishsea.knauernever.com'

// ─── Formatting (SSE popups.ts) ───
const str = (v) => (v == null ? '' : String(v).trim())
const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(str(v))
  return Number.isFinite(n) ? n : null
}
const fmtInt = (n) => Math.round(n).toLocaleString('en-US')

// Feet as "1,240 ft" or "2.3 mi" when over a mile
function fmtFeet(ft) {
  if (ft >= 5280) return { value: (ft / 5280).toFixed(ft >= 52800 ? 0 : 1), unit: 'mi', label: '' }
  return { value: fmtInt(ft), unit: 'ft', label: '' }
}
function sqftToAcres(sqft) {
  const ac = sqft / 43560
  if (ac >= 100) return fmtInt(ac)
  if (ac >= 10) return ac.toFixed(1)
  return ac.toFixed(2)
}
function fmtAcresValue(ac) {
  if (ac >= 100) return fmtInt(ac)
  if (ac >= 10) return ac.toFixed(1)
  return ac.toFixed(2)
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// "8/8/2001", "2019-05-02T17:09:56Z", or epoch ms → "Aug 2001"
function fmtMonthYear(v) {
  const s = str(v)
  if (!s) return ''
  const d = typeof v === 'number' ? new Date(v) : new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
const island = (p) => {
  const i = str(p.ISLAND ?? p.Island ?? p.island)
  return i ? `${i} Island` : ''
}
const join = (...parts) => parts.filter(Boolean).join(' · ')
const shapeLengthStat = (p, label) => {
  const ft = num(p.Shape_Length ?? p.SHAPE_Leng ?? p.LENGTH)
  return ft && ft > 0 ? [{ ...fmtFeet(ft), label }] : []
}

// ─── Photos: the shoreline handout's images stand in until features have their own ───
const IMG = '/friends/shoreline-images'
const FRIENDS = 'Friends of the San Juans'

const LAYER_PHOTOS = {
  'friends-bull-kelp': { url: `${IMG}/kelp.jpg`, caption: 'Bull kelp canopy at the surface', credit: FRIENDS },
  'friends-deepwater-eelgrass': { url: `${IMG}/eelgrass.jpg`, caption: 'Eelgrass meadow at low tide', credit: FRIENDS },
  'friends-herring-spawning': { url: `${IMG}/eelgrass.jpg`, caption: 'Eelgrass, where herring lay their eggs', credit: FRIENDS },
  'friends-documented-forage-spawning': { url: `${IMG}/forage-fish.jpg`, caption: 'Forage fish spawning beach', credit: FRIENDS },
  'friends-potential-forage-spawning': { url: `${IMG}/forage-fish.jpg`, caption: 'Sand and pea-gravel beach, the substrate forage fish need', credit: FRIENDS },
}
// SSE's LAYER_PHOTOS_MORE has no entries for these five layers.

// What a photo's caption must mention to illustrate a layer (see photosForSubject)
const PHOTO_SUBJECTS = {
  'friends-deepwater-eelgrass': /eelgrass|seagrass/i,
  'friends-bull-kelp': /\bkelp\b/i,
  'friends-herring-spawning': /herring/i,
  'friends-documented-forage-spawning': /forage fish|sand lance|smelt|spawn/i,
  'friends-potential-forage-spawning': /forage fish|sand lance|smelt|spawn/i,
}
// Captions that are about something other than the habitat even when they name it
const PHOTO_EXCLUDE = /sculpture|tile|mural|art\b|canoe|kayak|ship|tanker|vessel|marina|\bboat\b|logo|map\b|graph|chart|sign\b|poster/i

// ─── Action blocks: what Friends would like done ───
const GUIDE = `${SSE}/reports/living-with-the-shoreline.html`
const KELP_REPORT = `${SSE}/reports/kelp-habitat-value-and-threats.html`

const ACTIONS = {
  onTheWater: {
    kicker: 'On the water here',
    html: 'Anchor outside kelp and eelgrass, slow down near beds, and plan in-water work outside the spawning window.',
    button: { label: 'Living with the shoreline', href: GUIDE },
  },
  kelp: {
    kicker: 'On the water here',
    html: 'Steer and anchor clear of the canopy, and keep runoff and sediment from reaching the water.',
    button: { label: 'Why kelp matters', href: KELP_REPORT },
  },
  beach: {
    kicker: 'If this is your beach',
    html: 'Keep the drift log line, skip new bulkheads and fill, and time beach work outside spawning season.',
    button: { label: 'Beach-friendly practices', href: GUIDE },
  },
}

// ─── Per-layer specs (SSE POPUP_SPECS) ───
const POPUP_SPECS = {
  'friends-bull-kelp': {
    title: () => 'Bull kelp bed',
    subtitle: () => 'Merged canopy patch',
    stats: (p) => {
      const ac = num(p.acres)
      return [
        ...(ac != null
          ? [ac < 0.05 && num(p.sqft) ? { value: fmtInt(num(p.sqft)), unit: 'sq ft', label: 'Canopy area' } : { value: fmtAcresValue(ac), unit: 'ac', label: 'Canopy area' }]
          : []),
        { value: '2007', label: 'Survey year' },
      ]
    },
    chips: () => [{ label: 'Boundaries approximate', tone: 'warn' }, { label: 'WDFW priority habitat', tone: 'teal' }],
    action: ACTIONS.kelp,
    noDetails: true,
  },

  'friends-deepwater-eelgrass': {
    title: () => 'Deep-water edge of eelgrass',
    subtitle: (p) => join(island(p), str(p.SITECODE) ? `site ${str(p.SITECODE)}` : undefined),
    stats: (p) => {
      const len = num(p.LENGTH)
      const n = num(p.SAMP_SIZE)
      return [
        ...(len ? [{ ...fmtFeet(len), label: 'Edge length' }] : []),
        ...(n ? [{ value: fmtInt(n), label: 'Samples' }] : []),
        { value: '2004', label: 'Survey year' },
      ]
    },
    action: ACTIONS.onTheWater,
  },

  'friends-herring-spawning': {
    title: (p) => str(p.Name) || 'Herring spawning ground',
    subtitle: () => 'Pacific herring spawning ground · present or historic',
    stats: (p) => {
      const area = num(p.Shape_Area)
      return [
        ...(area ? [{ value: sqftToAcres(area), unit: 'ac', label: 'Area' }] : []),
        ...shapeLengthStat(p, 'Perimeter'),
        { value: '2004', label: 'WDFW mapping' },
      ]
    },
    action: ACTIONS.onTheWater,
    noDetails: true,
  },

  'friends-documented-forage-spawning': {
    title: (p) => join(str(p.NAME_2) || str(p.NAME) || 'Spawning beach', str(p.C_Type_FOSJ)),
    subtitle: (p) => join(island(p), str(p.ShoreForm_Unit_ID) ? `shoreform unit ${str(p.ShoreForm_Unit_ID)}` : undefined),
    stats: (p) => {
      const species = str(p.SPECIES).replace(/([a-z])([A-Z])/g, '$1 $2')
      const eggs = num(p.EggCount)
      return [
        ...(species ? [{ value: species, label: 'Species' }] : []),
        ...(eggs != null ? [{ value: fmtInt(eggs), label: 'Eggs / sample' }] : []),
        ...(fmtMonthYear(p.DATE_) ? [{ value: fmtMonthYear(p.DATE_), label: 'Surveyed' }] : []),
      ]
    },
    action: ACTIONS.beach,
  },

  'friends-potential-forage-spawning': {
    title: () => 'Potential spawning beach',
    subtitle: (p) => join(str(p.C_Type_FOSJ) ? `beach type ${str(p.C_Type_FOSJ)}` : undefined, str(p.ShoreForm_Unit_ID) ? `shoreform unit ${str(p.ShoreForm_Unit_ID)}` : undefined),
    stats: (p) => shapeLengthStat(p, 'Beach length'),
    action: ACTIONS.beach,
  },
}

// ─── Layer configs (SSE layers.ts: only what the popup reads). swatch is SSE's rule: markerIcon → 'point',
// fillOpacity > 0.05 → 'fill', else 'line'; accent is strokeColor || fillColor. ───
const LIVING_SHORELINE = { credit: 'Living with the Shoreline (Friends of the San Juans)', url: GUIDE }
const FORAGE_WHY = 'Forage fish are small schooling fish that are eaten by larger fish, seabirds, and marine mammals. Forage fish are staples in the diets of Chinook and Coho salmon, lingcod, Marbled Murrelets, Rhinoceros Auklets, and Minke whales. Forage fish utilize the same shoreline areas that humans do, which makes them vulnerable to modifications such as bulkheads, docks, roads, and the removal of vegetation. A NOAA Fisheries study in northern Puget Sound found that surf smelt egg survival was reduced by 50% in places where the beach habitat was both warmer and drier as a result of the presence of hard armored bulkheads and the absence of trees and shrubs.'

export const HABITAT_LAYERS = {
  hhe: {
    id: 'friends-herring-spawning',
    name: 'Forage Fish Spawning: Herring Spawning Grounds',
    accent: '#6D28D9',
    swatch: 'fill',
    swatchColor: '#8B5CF6',
    popupFields: [
      { key: 'Name', label: 'Name' },
      { key: 'OBJECTID', label: 'Object ID' },
    ],
    whyItMatters: {
      text: 'Herring, crucial for marine food webs, spawn on eelgrass habitat in just a few locations in San Juan County that are also popular with boaters including Eastsound and West Sound, Blind Bay, Mud Bay, and Hunter Bay. Eelgrass, a vital marine habitat in the Salish Sea, supports Dungeness crabs, Chinook salmon, Pacific herring, and ultimately the Southern Resident killer whales.',
      source: { credit: 'Become a Green Boater Today (sanjuans.org)', url: 'https://sanjuans.org/become-a-green-boater-today/' },
    },
    sourceCredit: 'Washington Department of Fish and Wildlife; compiled by Friends of the San Juans',
  },
  hkb: {
    id: 'friends-bull-kelp',
    name: 'Bull Kelp',
    accent: '#FFF4CC',
    swatch: 'point',
    swatchColor: '#FFF4CC',
    popupFields: [
      { key: 'acres', label: 'Acres' },
      { key: 'sqft', label: 'Square feet' },
    ],
    whyItMatters: {
      text: 'The San Juans are home to one-third of all floating kelp in the inland waters of Washington State. Kelp helps reduce wave energy that causes beach erosion and provides protected feeding areas for marine mammals, birds, and fish. Kelp shelters urchins, crabs, juvenile rockfish, anemones, starfish, sea cucumbers, octopuses, and many other marine creatures. Shorelines with native vegetation, eelgrass, and kelp help young salmon feed, grow, and avoid predators as they migrate to the open ocean.',
      source: LIVING_SHORELINE,
    },
    sourceCredit: 'Washington Department of Natural Resources and Friends of the San Juans',
  },
  hee: {
    id: 'friends-deepwater-eelgrass',
    name: 'Deepwater/Edge Eelgrass',
    accent: '#20B2AA',
    swatch: 'point',
    swatchColor: '#20B2AA',
    popupFields: [
      { key: 'SITE', label: 'Site' },
      { key: 'ISLAND', label: 'Island' },
      { key: 'MEAN', label: 'Mean Depth' },
      { key: 'MAX_', label: 'Max Depth' },
      { key: 'MIN_', label: 'Min Depth' },
      { key: 'SAMP_SIZE', label: 'Sample Size' },
      { key: 'COMMENTS', label: 'Comments' },
    ],
    whyItMatters: {
      text: 'Eelgrass is a flowering plant that grows in shallow, light-filled marine waters. Eelgrass provides food and shelter for many juvenile fish and shellfish of ecological, cultural, commercial, and recreational importance. The long blades of eelgrass are home to incubating eggs and animals, including crabs and juvenile fish. In addition, eelgrass mitigates wave energy and traps sediments, protecting shorelines from wave driven erosion.',
      source: LIVING_SHORELINE,
    },
    sourceCredit: 'Friends of the San Juans, Washington DNR, and Friday Harbor Labs (countywide eelgrass study)',
  },
  hfp: {
    id: 'friends-potential-forage-spawning',
    name: 'Forage Fish Beach Spawning: Smelt & Sand Lance — Potential Spawning Habitat',
    accent: '#F9A8D4',
    swatch: 'line',
    swatchColor: '#F9A8D4',
    popupFields: [
      { key: 'C_Type_FOSJ', label: 'Shore Type' },
      { key: 'ShoreForm_Unit_ID', label: 'Shoreform Unit' },
    ],
    whyItMatters: { text: FORAGE_WHY, source: LIVING_SHORELINE },
    sourceCredit: 'Friends of the San Juans',
  },
  hfd: {
    id: 'friends-documented-forage-spawning',
    name: 'Forage Fish Beach Spawning: Smelt & Sand Lance — Documented Spawning Beaches',
    accent: '#E11D74',
    swatch: 'line',
    swatchColor: '#E11D74',
    popupFields: [
      { key: 'NAME', label: 'Beach Name' },
      { key: 'ISLAND', label: 'Island' },
      { key: 'SPECIES', label: 'Species' },
      { key: 'SMELT_IND', label: 'Smelt' },
      { key: 'SAND_LANCE_IND', label: 'Sand Lance' },
      { key: 'EggCount', label: 'Egg Count' },
      { key: 'RecordsSource', label: 'Source' },
    ],
    whyItMatters: { text: FORAGE_WHY, source: LIVING_SHORELINE },
    sourceCredit: 'Friends of the San Juans forage fish egg surveys, with WDFW records',
  },
}

// ─── The all-details table (SSE utils/geojson.ts extractAllFeatureProperties, non-showAll mode) ───
const HIDDEN_KEYS = new Set(['Shape_Length', 'Shape_Area', 'OBJECTID', 'RuleID', 'File_Path', 'image_path', 'img_id', 'Assessor', 'Tax_Info'])
const isBlank = (raw) => raw == null || String(raw).trim() === ''

function formatValue(key, label, raw) {
  let value = String(raw).trim()
  const lowerLabel = label.toLowerCase()
  if (lowerLabel.includes('value') || lowerLabel.includes('price')) {
    const n = parseInt(value, 10)
    if (!isNaN(n)) value = '$' + n.toLocaleString()
  }
  if ((key.toLowerCase().includes('date') || key === 'LastUpdate') && value.includes('T')) {
    value = new Date(value).toLocaleDateString()
  }
  return value
}
const humanizeKey = (key) => key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase())

function extractFields(props, configuredFields) {
  const labelMap = new Map(configuredFields.map((f) => [f.key, f.label]))
  const results = []
  const seenKeys = new Set()
  for (const field of configuredFields) {
    const raw = props[field.key]
    if (isBlank(raw)) continue
    results.push({ label: field.label, value: formatValue(field.key, field.label, raw) })
    seenKeys.add(field.key)
  }
  for (const [key, raw] of Object.entries(props)) {
    if (seenKeys.has(key) || HIDDEN_KEYS.has(key) || isBlank(raw)) continue
    const label = labelMap.get(key) || humanizeKey(key)
    results.push({ label, value: formatValue(key, label, raw) })
  }
  return results
}

// "Related content from Friends" block: related articles from sanjuans.org, with the best one's own excerpt
// (Friends' words, never a paraphrase)
function fromFriendsHtml(articles, skipSummaryId) {
  if (!articles.length) return ''
  const rows = articles.map((a, i) => `
    <a class="ssx-art" href="${escHtml(a.url)}" target="_blank" rel="noopener noreferrer">
      ${a.image ? `<img class="ssx-art-img" src="${escHtml(a.image.url)}" alt="" loading="lazy" data-ssx-onerror="remove">` : ''}
      <span class="ssx-art-body">
        <span class="ssx-art-title">${escHtml(a.title)}</span>
        <span class="ssx-art-meta">${escHtml(articleDate(a.date))}</span>
        ${i === 0 && a.excerpt && a.id !== skipSummaryId ? `<span class="ssx-art-sum">${escHtml(a.excerpt)}</span>` : ''}
      </span>
    </a>`).join('')
  return `<div class="ssx-from"><div class="ssx-k">Related content from Friends of the San Juans</div>${rows}</div>`
}

/**
 * The popup HTML for one habitat feature. h: our habitat id (hfd, hfp, hhe, hee, hkb). props: the feature's SSE
 * attributes; our own `h` and `name` keys are dropped first so they never reach the table, title or article match.
 * Before the Friends content index has loaded, photos and the related-articles block are thinner; rebuild once
 * preloadFriendsContent() resolves (as SSE does) if the popup is still open.
 */
export function buildFriendsHabitatPopup(h, props) {
  const config = HABITAT_LAYERS[h]
  if (!config) return ''
  const { h: _h, name: _name, ...p } = props || {}
  const spec = POPUP_SPECS[config.id]
  const fields = extractFields(p, config.popupFields)
  // SSE's getFeatureLabel fallback; every spec here supplies a title, so this is only a guard
  const label = str(p.name || p.NAME || p.id) || 'Feature'
  const title = spec.title?.(p) || (label !== 'Feature' ? label : config.name)

  // Friends' website content: the best articles for this layer supply photos and the related list
  const idx = getFriendsContentSync()
  const related = articlesForFeature(idx, config.id, p, 3)
  // Pick by relevance, then list newest first
  const articles = related.slice().sort((a, b) => b.date.localeCompare(a.date))

  // The curated handout photo first, then only Friends photos whose captions name the subject
  const photos = [LAYER_PHOTOS[config.id]]
  for (const im of photosForSubject(idx, PHOTO_SUBJECTS[config.id], PHOTO_EXCLUDE, 2)) {
    photos.push({ url: im.url, caption: im.caption, credit: 'Friends of the San Juans' })
  }

  // "Why it matters" only ever carries Friends' own words: the layer's sourced whyItMatters text
  const story = { kicker: 'Why it matters', html: escHtml(config.whyItMatters.text), source: config.whyItMatters.source }

  return buildPopupFrame({
    id: `feature-${Date.now()}`,
    accent: config.accent,
    layerName: config.name,
    swatch: config.swatch,
    swatchColor: config.swatchColor,
    title,
    subtitle: spec.subtitle?.(p),
    photos,
    stats: spec.stats?.(p),
    chips: spec.chips?.(p),
    story,
    action: spec.action,
    body: fromFriendsHtml(articles, undefined),
    fields: spec.noDetails ? [] : fields,
    source: { credit: config.sourceCredit, url: undefined },
    footerButtons: [],
  })
}
