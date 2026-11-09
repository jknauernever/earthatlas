/**
 * Popups for Friends of the San Juans layers (/shoreline: all 16 of its feature layers; /permits: the five habitat
 * layers), with Salish Sea Explorer's content (salish-sea-propmapper: buildFeaturePopupHtml / fishUsePopupParts in
 * src/components/Map/FeaturePopup.tsx, POPUP_SPECS / ACTIONS / LAYER_PHOTOS / PHOTO_SUBJECTS in src/config/popups.ts,
 * the layer configs in src/config/layers.ts, the details table from extractAllFeatureProperties in src/utils/geojson.ts).
 * Every string here is SSE's (Friends' own words). SSE is being retired (docs/SHORELINE_PORT_PLAN.md): this file is
 * now the copy of record — edit here.
 *
 * The frame is EarthAtlas's (./popupCard.js, decision 4), not SSE's cream card; the slots and their content are SSE's.
 * Differences forced by hosting: SSE's site-relative report links and handout photos point at our copies in
 * /friends/reports, and the fish-use "More about this data" link opens the data's source instead of SSE's info modal.
 *
 * Usage (Mapbox):
 *   installPopupCardHandlers(); preloadFriendsContent()
 *   new mapboxgl.Popup({ maxWidth: '360px', offset: 10 }).setLngLat(lngLat).setHTML(buildFriendsPopup(layerId, props)).addTo(map)
 *   (rebuild once preloadFriendsContent() resolves if the popup is still open: photos and articles come from it)
 */

import { buildPopupCard, escapeHtml as escHtml, installPopupCardHandlers } from './popupCard.js'
import { getFriendsContentSync, preloadFriendsContent, articlesForFeature, photosForSubject, articleDate } from './friendsContent.js'
import { FISH_SPECIES, FISH_TIERS, fishTier, SHOREFORM_GROUPS } from '../shoreline/shorelineLayers.js'

export { installPopupCardHandlers, preloadFriendsContent }

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
const HML = { H: 'high', M: 'medium', L: 'low' }
const YN = (v) => {
  const s = str(v).toUpperCase()
  if (s === 'Y' || s === 'YES' || s === '1' || s === 'TRUE') return true
  if (s === 'N' || s === 'NO' || s === '0' || s === 'FALSE') return false
  return null
}
const MATERIAL = { W: 'Wood', C: 'Concrete', R: 'Rock', S: 'Steel', P: 'Plastic', M: 'Metal', F: 'Fiberglass', O: 'Other' }
const CONDITION = { G: 'Good', F: 'Fair', P: 'Poor', E: 'Excellent' }
const BUOY_TYPE = { B: 'Mooring buoy', F: 'Float', R: 'Raft' }
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
const IMG = '/friends/reports/shoreline-images'
const FRIENDS = 'Friends of the San Juans'

const LAYER_PHOTOS = {
  'friends-bull-kelp': { url: `${IMG}/kelp.jpg`, caption: 'Bull kelp canopy at the surface', credit: FRIENDS },
  'friends-deepwater-eelgrass': { url: `${IMG}/eelgrass.jpg`, caption: 'Eelgrass meadow at low tide', credit: FRIENDS },
  'friends-herring-spawning': { url: `${IMG}/eelgrass.jpg`, caption: 'Eelgrass, where herring lay their eggs', credit: FRIENDS },
  'friends-documented-forage-spawning': { url: `${IMG}/forage-fish.jpg`, caption: 'Forage fish spawning beach', credit: FRIENDS },
  'friends-potential-forage-spawning': { url: `${IMG}/forage-fish.jpg`, caption: 'Sand and pea-gravel beach, the substrate forage fish need', credit: FRIENDS },
  'friends-shoreline-geology': { url: `${IMG}/feeder-bluffs.jpg`, caption: 'A feeder bluff supplying the beaches downdrift', credit: FRIENDS },
  'friends-armor': { url: `${IMG}/adapt-fortify.jpg`, caption: 'Hard armoring along the shore', credit: FRIENDS },
  'friends-mooring-buoys': { url: `${IMG}/mooring-float.jpg`, caption: 'A mid-line float keeps the mooring line off the eelgrass', credit: FRIENDS },
  'friends-groins': { url: `${IMG}/erosion-before.jpg`, caption: 'Armored shoreline', credit: FRIENDS },
  'friends-boat-ramps': { url: `${IMG}/preserve.jpg`, caption: 'Shoreline access', credit: FRIENDS },
  'friends-marine-railway': { url: `${IMG}/preserve.jpg`, caption: 'Shoreline access', credit: FRIENDS },
  'friends-pilings': { url: `${IMG}/preserve.jpg`, caption: 'In-water structures', credit: FRIENDS },
}
const LAYER_PHOTOS_MORE = {
  'friends-mooring-buoys': [{ url: `${IMG}/boats-on-moorings.jpg`, caption: 'Boats on moorings', credit: `${FRIENDS} · Gardner` }],
}
// What a photo's caption must mention to illustrate a layer (see photosForSubject)
const PHOTO_SUBJECTS = {
  'friends-deepwater-eelgrass': /eelgrass|seagrass/i,
  'friends-bull-kelp': /\bkelp\b/i,
  'friends-herring-spawning': /herring/i,
  'friends-documented-forage-spawning': /forage fish|sand lance|smelt|spawn/i,
  'friends-potential-forage-spawning': /forage fish|sand lance|smelt|spawn/i,
  'fish-use': /salmon|herring|smelt|sand lance|forage fish/i,
  'friends-shoreline-geology': /bluff|beach|shoreline/i,
  'friends-armor': /armor|bulkhead|riprap|seawall|rock/i,
  'friends-pilings': /piling|creosote/i,
  'friends-mooring-buoys': /buoy|mooring/i,
}
// Captions that are about something other than the habitat even when they name it
const PHOTO_EXCLUDE = /sculpture|tile|mural|art\b|canoe|kayak|ship|tanker|vessel|marina|\bboat\b|logo|map\b|graph|chart|sign\b|poster/i

// ─── Action blocks: what Friends would like done ───
const GUIDE = '/friends/reports/living-with-the-shoreline.html'
const KELP_REPORT = '/friends/reports/kelp-habitat-value-and-threats.html'
const SITE_VISIT = 'https://sanjuans.org/our-work/landowner-resources/#SiteVisit'

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
  // Armor: the button signs the landowner up for Friends' free site visit; the guide stays as a text link
  armor: {
    kicker: 'If this is your shoreline',
    html: `Ask about a shore-friendly stabilization site visit before adding or replacing armor. <a href="${GUIDE}" target="_blank" rel="noopener noreferrer">Living with the shoreline</a> has more.`,
    button: { label: 'Request a free site visit', href: SITE_VISIT },
  },
  structure: {
    kicker: 'If this is yours',
    html: 'Grated decking, no creosote, and floats that stay off the bottom keep light and habitat under the structure.',
    button: { label: 'Living with the shoreline', href: GUIDE },
  },
}

// ─── Shoreforms (SSE shoreforms.ts): class labels for the geology popup; descriptions (Friends' handout) for the property popup ───
export const SHOREFORM_TYPES = {
  FBE: { label: 'Feeder Bluff Exceptional', group: 'feeder',
    description: 'Highly erosive in its natural state, these shore forms tend to have exposed sandy slopes and they are an important source of sediment to form and maintain down-drift beaches.' },
  FB: { label: 'Feeder Bluff', group: 'feeder',
    description: 'Episodically erosive in its natural state, these shore forms provide sediment that forms and maintains down-drift beaches.' },
  HFBE: { label: 'Historic Feeder Bluff Exceptional', group: 'feeder',
    description: 'A bluff that was an exceptional sediment source before it was modified. Highly erosive in its natural state, these shore forms are an important source of sediment to form and maintain down-drift beaches.' },
  HFB: { label: 'Historic Feeder Bluff', group: 'feeder',
    description: 'A bluff that historically supplied beach sediment but has since been modified (typically armored), cutting off that supply to down-drift beaches.' },
  PFB: { label: 'Feeder Bluff (partial)', group: 'feeder',
    description: 'A bluff that supplies sediment to down-drift beaches along part of its length or at a reduced rate.' },
  TZ: { label: 'Transport Zone', group: 'transport',
    description: 'Neither eroding nor accreting, sediment tends to move through transport zones from feeder, or sediment supply bluffs, to accretionary beaches (spits, barrier beaches).' },
  BAB: { label: 'Barrier Beach', group: 'barrier',
    description: 'These beaches are typically wide with extended backshores and are where material from the sediment supply bluffs is deposited.' },
  'Embayments - Estuary': { label: 'Embayment – Estuary', group: 'embayment',
    description: 'Relatively closed bay with a freshwater source.' },
  'Embayments - Lagoon': { label: 'Embayment – Lagoon', group: 'embayment',
    description: 'Lagoons can be open or closed to the marine environment but lack a consistent freshwater source like a stream.' },
  'Pocket Beach': { label: 'Pocket Beach', group: 'pocket',
    description: 'A sand and gravel beach located between two rocky headlands. The source of material for pocket beaches is the adjacent bank; while material may adjust between the headlands, it seldom leaves the system entirely.' },
  'Rocky Shoreline': { label: 'Rocky Shoreline', group: 'rocky',
    description: 'While local rocky shorelines include a variety of rock types and configurations, they are all characterized by a lack of appreciable sediment drift or erosion.' },
  ART: { label: 'Artificial', group: 'artificial',
    description: 'Altered so much that the historic shore type is not known.' },
}
const shoreformLabel = (code) => SHOREFORM_TYPES[code]?.label ?? code
const shoreformGroup = (code) => SHOREFORM_GROUPS[SHOREFORM_TYPES[code]?.group] || null

// ─── Fish use (SSE fishUse.ts): every species' level on a segment, highest first ───
export const FISH_USE_NAME = 'Priority Shorelines for Fish'
const FISH_PATH = 'M1.5 12C4.6 7.4 8.8 5.6 12.6 5.6c3 0 5.6 1.2 7.4 3.5L23 6.2v11.6l-3-2.9c-1.8 2.3-4.4 3.5-7.4 3.5-3.8 0-8-1.8-11.1-6.4zM7.6 9.7a1.15 1.15 0 100 2.3 1.15 1.15 0 000-2.3z'
export const fishIconSvg = (size = 16, color = '#0D4F4F') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${Math.round(size * 0.75)}" viewBox="0 3 24 18" aria-hidden="true"><path fill="${color}" fill-rule="evenodd" d="${FISH_PATH}"/></svg>`
const TIER_TEXT = { 1: '#5B4300', 2: '#FFFFFF', 3: '#FFFFFF' }
export function fishUseEntries(props, codes) {
  const only = codes ? new Set(codes) : null
  const out = []
  for (const sp of FISH_SPECIES) {
    if (only && !only.has(sp.code)) continue
    const raw = props?.[`HRM_${sp.code}`]
    if (raw == null || raw === '') continue
    const hrm = Number(raw)
    if (!Number.isFinite(hrm)) continue
    out.push({ species: sp, hrm, tier: fishTier(sp, hrm) })
  }
  return out.sort((a, b) => b.tier - a.tier)
}
/** Species codes the line is colored by for a Color by mode ('all' = all seven). */
export const fishCodesForMode = (mode) => (mode === 'all' ? FISH_SPECIES.map((s) => s.code) : [(FISH_SPECIES.find((s) => s.mode === mode) || FISH_SPECIES[0]).code])
export const fishPill = (t) => `<span class="fp-pill" style="background:${FISH_TIERS[t].color};color:${TIER_TEXT[t]}">${FISH_TIERS[t].label}</span>`
/** Compact lines (hover card, chooser row): "● Juvenile Chinook Salmon · Highest priority", the emphasized species first. */
export function fishUseLinesHtml(entries, emphasize) {
  const on = emphasize ? new Set(emphasize) : null
  const ordered = on ? [...entries.filter((e) => on.has(e.species.code)), ...entries.filter((e) => !on.has(e.species.code))] : entries
  return ordered.map((e) => {
    const quiet = !!on && !on.has(e.species.code)
    return `<span style="display:flex;align-items:center;gap:6px;white-space:nowrap;${quiet ? 'opacity:.7;font-weight:400;' : ''}"><span style="line-height:0;flex-shrink:0;">${fishIconSvg(15, FISH_TIERS[e.tier].color)}</span><span><strong style="font-weight:${quiet ? 500 : 600};">${escHtml(e.species.name)}</strong> · ${FISH_TIERS[e.tier].label}</span></span>`
  }).join('')
}
export function fishUseListHtml(entries, emphasize) {
  const on = emphasize ? new Set(emphasize) : null
  const row = (e, quiet) => `<div class="fp-fish${quiet ? ' fp-fish-quiet' : ''}"><span style="line-height:0">${fishIconSvg(18, quiet ? '#64748B' : '#0D4F4F')}</span><span class="fp-fish-name">${escHtml(e.species.name)}</span>${fishPill(e.tier)}</div>`
  if (!on || !on.size) return entries.map((e) => row(e, false)).join('')
  const lead = entries.filter((e) => on.has(e.species.code)), rest = entries.filter((e) => !on.has(e.species.code))
  return lead.map((e) => row(e, false)).join('') + (rest.length ? '<div class="fp-k" style="margin-top:8px">Other species on this shoreline</div>' : '') + rest.map((e) => row(e, true)).join('')
}
const FISH_USE_SOURCE = 'https://gis.sanjuancountywa.gov/arcgis/rest/services/Habitat/SRSC_ShorelineFishPresence/MapServer'
function fishUsePopupParts(props, codes) {
  const name = str(props.Name).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
  const unit = str(props.GeoUnit), area = str(props.SiteType2)
  const lead = `<div class="fp-k">Priority by species</div>${fishUseListHtml(fishUseEntries(props), codes)}
    <p class="fp-note">Priority reflects how likely fish are to be present and abundant here. Salmon levels are for rearing juveniles. Nothing is ranked low: fish can and do use every shoreline. <a href="${FISH_USE_SOURCE}" target="_blank" rel="noopener noreferrer">More about this data &rarr;</a></p>`
  return {
    title: name || (unit ? `${unit} shoreline` : 'Shoreline segment'),
    subtitle: [name ? unit : '', area].filter(Boolean).join(' · ') || undefined,
    lead,
  }
}

// ─── Per-layer specs (SSE POPUP_SPECS) ───
const structureSpec = (noun, timeKey) => ({
  title: () => noun,
  subtitle: (p) => join(island(p), fmtMonthYear(p[timeKey]) ? `surveyed ${fmtMonthYear(p[timeKey])}` : undefined),
  action: ACTIONS.structure,
})

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

  'friends-shoreline-geology': {
    // Tina, Sept 2026: only what the shoreform dataset says — no photos, related website content or guide text;
    // every attribute is listed, blanks included, so Friends can see the quality of the data
    dataOnly: true,
    allFields: true,
    detailsOpen: true,
    title: (p) => shoreformLabel(str(p.PIAT_shoreforms)) || 'Shoreline unit',
    subtitle: (p) => {
      const g = shoreformGroup(str(p.PIAT_shoreforms))
      const groupNote = g && g.label.toLowerCase() !== shoreformLabel(str(p.PIAT_shoreforms)).toLowerCase() ? g.label : undefined
      const ft = num(p.Shape_Length)
      return join(groupNote, str(p.ShoreForm_Unit_ID) ? `unit ${str(p.ShoreForm_Unit_ID)}` : undefined, ft ? `${fmtFeet(ft).value} ${fmtFeet(ft).unit}` : undefined)
    },
    chips: (p) => {
      const chips = []
      const r = HML[str(p.PIATrestoration).toUpperCase()]
      if (r) chips.push({ label: `Restoration priority: ${r}`, tone: r === 'high' ? 'warn' : 'default' })
      const pr = HML[str(p.PIATprotection).toUpperCase()]
      if (pr) chips.push({ label: `Protection priority: ${pr}`, tone: pr === 'high' ? 'teal' : 'default' })
      return chips
    },
  },

  'friends-armor': {
    // "Rock bulkhead", "Concrete seawall", "Wood bulkhead" — material first, then what kind of structure
    title: (p) => {
      const m = str(p.ArmorMaterial).toLowerCase()
      const parts = []
      if (/rock/.test(m)) parts.push('Rock')
      if (/concrete/.test(m)) parts.push('Concrete')
      if (/wood/.test(m)) parts.push('Wood')
      if (!parts.length && /other/.test(m)) {
        const d = str(p.ArmorMaterial_otherDESC)
        parts.push(d && d.length <= 16 ? d.charAt(0).toUpperCase() + d.slice(1) : 'Mixed-material')
      }
      // "Rock and wood", "Rock, concrete and wood"
      const lower = parts.map((x, i) => (i === 0 ? x : x.toLowerCase()))
      const material = !lower.length ? 'Shoreline'
        : lower.length === 1 ? lower[0]
        : `${lower.slice(0, -1).join(', ')} and ${lower[lower.length - 1]}`
      const noun = !parts.length ? 'armor'
        : YN(p.Bulkhead) === false && !/bulkhead/i.test(str(p.ArmorAssoc)) ? 'armor'
        : parts.length === 1 && parts[0] === 'Concrete' ? 'seawall' : 'bulkhead'
      return `${material} ${noun}`
    },
    subtitle: (p) => {
      // Condition stays in the details table only (client, Sept 2026)
      const ft = num(p.ArmorLength_Value)
      return join(island(p), ft && ft > 0 ? `${fmtInt(ft)} ft` : undefined)
    },
    chips: (p) => {
      const chips = []
      const protects = [['House', 'House'], ['Cabin', 'Cabin'], ['Road', 'Road'], ['RoadEnd', 'Road end'], ['Dock', 'Dock'], ['Boathouse', 'Boathouse'], ['Boatramp', 'Boat ramp'], ['BeachAccess', 'Beach access'], ['StormwaterOutfall', 'Stormwater outfall'], ['Groin', 'Groin'], ['Jetty', 'Jetty'], ['Breakwater', 'Breakwater']]
      for (const [key, label] of protects) if (YN(p[key])) chips.push({ label })
      const bin = str(p.ArmorToeElev_BIN)
      const below = /^below/i.test(str(p.ArmorToeElev_AboveBelow)) || bin === 'BelowOrAtMeanSeaLevel' || bin === 'MeanSeaLevelToMeanHigherHighWater'
      if (below) chips.push({ label: 'Toe below the high tide line', tone: 'warn' })
      if (YN(p.FB)) chips.push({ label: 'On a feeder bluff', tone: 'warn' })
      if (YN(p.Doc_FF)) chips.push({ label: 'On a forage fish spawning beach', tone: 'warn' })
      if (YN(p.Creosote)) chips.push({ label: 'Creosote', tone: 'warn' })
      const change = str(p.ArmorNEW).toLowerCase()
      if (change === 'y') chips.push({ label: 'New since 2009', tone: 'warn' })
      else if (change === 'increase') chips.push({ label: 'Enlarged since 2009', tone: 'warn' })
      else if (change === 'removed') chips.push({ label: 'Removed since 2009', tone: 'on' })
      else if (YN(p.SurveyData_2009)) chips.push({ label: 'Unchanged since 2009' })
      return chips
    },
    action: ACTIONS.armor,
  },

  'friends-docks': {
    title: () => 'Dock',
    subtitle: (p) => join(fmtMonthYear(p.SurveyTime) ? `surveyed ${fmtMonthYear(p.SurveyTime)}` : undefined),
    chips: (p) => {
      const chips = []
      const m = MATERIAL[str(p.Material).toUpperCase()]
      if (m) chips.push({ label: `${m} deck` })
      const fm = MATERIAL[str(p.FloatMaterial).toUpperCase()]
      if (fm) chips.push({ label: `${fm} float` })
      if (YN(p.Creosote)) chips.push({ label: 'Creosote', tone: 'warn' })
      if (YN(p.Grating)) chips.push({ label: 'Grated', tone: 'on' })
      const c = CONDITION[str(p.Condition).toUpperCase()]
      if (c) chips.push({ label: `Condition: ${c}` })
      return chips
    },
    action: ACTIONS.structure,
  },
  'friends-mooring-buoys': {
    title: (p) => BUOY_TYPE[str(p.Type).toUpperCase()] || 'Mooring buoy or float',
    action: ACTIONS.onTheWater,
  },
  'friends-groins': structureSpec('Groin', 'SurveyTime'),
  'friends-boat-ramps': structureSpec('Boat ramp', 'SurveyDate'),
  'friends-marine-railway': structureSpec('Marine railway', 'Surveytime'),
  'friends-pilings': {
    title: () => 'Pilings',
    stats: (p) => {
      const n = num(p.Count_)
      return n ? [{ value: fmtInt(n), label: 'Pilings' }] : []
    },
    chips: (p) => (YN(p.Creosote) ? [{ label: 'Creosote', tone: 'warn' }] : []),
    action: ACTIONS.structure,
  },
  'building-footprints': {
    title: () => 'Building',
  },
}

// ─── Layer configs (SSE layers.ts: only what the popup reads). swatch is SSE's rule: markerIcon → 'point',
// fillOpacity > 0.05 → 'fill', else 'line'; accent is strokeColor || fillColor. ───
const LIVING_SHORELINE = { credit: 'Living with the Shoreline (Friends of the San Juans)', url: GUIDE }
const FORAGE_WHY = 'Forage fish are small schooling fish that are eaten by larger fish, seabirds, and marine mammals. Forage fish are staples in the diets of Chinook and Coho salmon, lingcod, Marbled Murrelets, Rhinoceros Auklets, and Minke whales. Forage fish utilize the same shoreline areas that humans do, which makes them vulnerable to modifications such as bulkheads, docks, roads, and the removal of vegetation. A NOAA Fisheries study in northern Puget Sound found that surf smelt egg survival was reduced by 50% in places where the beach habitat was both warmer and drier as a result of the presence of hard armored bulkheads and the absence of trees and shrubs.'
const INVENTORY = 'Friends of the San Juans shoreline inventory'

export const LAYERS = {
  'friends-herring-spawning': {
    name: 'Forage Fish Spawning: Herring Spawning Grounds',
    accent: '#6D28D9', swatch: 'fill', swatchColor: '#8B5CF6',
    popupFields: [{ key: 'Name', label: 'Name' }, { key: 'OBJECTID', label: 'Object ID' }],
    whyItMatters: {
      text: 'Herring, crucial for marine food webs, spawn on eelgrass habitat in just a few locations in San Juan County that are also popular with boaters including Eastsound and West Sound, Blind Bay, Mud Bay, and Hunter Bay. Eelgrass, a vital marine habitat in the Salish Sea, supports Dungeness crabs, Chinook salmon, Pacific herring, and ultimately the Southern Resident killer whales.',
      source: { credit: 'Become a Green Boater Today (sanjuans.org)', url: 'https://sanjuans.org/become-a-green-boater-today/' },
    },
    sourceCredit: 'Washington Department of Fish and Wildlife; compiled by Friends of the San Juans',
  },
  'friends-bull-kelp': {
    name: 'Bull Kelp',
    accent: '#B89A3A', swatch: 'point', swatchColor: '#FFF4CC',
    popupFields: [{ key: 'acres', label: 'Acres' }, { key: 'sqft', label: 'Square feet' }],
    whyItMatters: {
      text: 'The San Juans are home to one-third of all floating kelp in the inland waters of Washington State. Kelp helps reduce wave energy that causes beach erosion and provides protected feeding areas for marine mammals, birds, and fish. Kelp shelters urchins, crabs, juvenile rockfish, anemones, starfish, sea cucumbers, octopuses, and many other marine creatures. Shorelines with native vegetation, eelgrass, and kelp help young salmon feed, grow, and avoid predators as they migrate to the open ocean.',
      source: LIVING_SHORELINE,
    },
    sourceCredit: 'Washington Department of Natural Resources and Friends of the San Juans',
  },
  'friends-deepwater-eelgrass': {
    name: 'Deepwater/Edge Eelgrass',
    accent: '#20B2AA', swatch: 'point', swatchColor: '#20B2AA',
    popupFields: [
      { key: 'SITE', label: 'Site' }, { key: 'ISLAND', label: 'Island' }, { key: 'MEAN', label: 'Mean Depth' }, { key: 'MAX_', label: 'Max Depth' },
      { key: 'MIN_', label: 'Min Depth' }, { key: 'SAMP_SIZE', label: 'Sample Size' }, { key: 'COMMENTS', label: 'Comments' },
    ],
    whyItMatters: {
      text: 'Eelgrass is a flowering plant that grows in shallow, light-filled marine waters. Eelgrass provides food and shelter for many juvenile fish and shellfish of ecological, cultural, commercial, and recreational importance. The long blades of eelgrass are home to incubating eggs and animals, including crabs and juvenile fish. In addition, eelgrass mitigates wave energy and traps sediments, protecting shorelines from wave driven erosion.',
      source: LIVING_SHORELINE,
    },
    sourceCredit: 'Friends of the San Juans, Washington DNR, and Friday Harbor Labs (countywide eelgrass study)',
  },
  'friends-potential-forage-spawning': {
    name: 'Forage Fish Beach Spawning: Smelt & Sand Lance — Potential Spawning Habitat',
    accent: '#F9A8D4', swatch: 'line', swatchColor: '#F9A8D4',
    popupFields: [{ key: 'C_Type_FOSJ', label: 'Shore Type' }, { key: 'ShoreForm_Unit_ID', label: 'Shoreform Unit' }],
    whyItMatters: { text: FORAGE_WHY, source: LIVING_SHORELINE },
    sourceCredit: 'Friends of the San Juans',
  },
  'friends-documented-forage-spawning': {
    name: 'Forage Fish Beach Spawning: Smelt & Sand Lance — Documented Spawning Beaches',
    accent: '#E11D74', swatch: 'line', swatchColor: '#E11D74',
    popupFields: [
      { key: 'NAME', label: 'Beach Name' }, { key: 'ISLAND', label: 'Island' }, { key: 'SPECIES', label: 'Species' }, { key: 'SMELT_IND', label: 'Smelt' },
      { key: 'SAND_LANCE_IND', label: 'Sand Lance' }, { key: 'EggCount', label: 'Egg Count' }, { key: 'RecordsSource', label: 'Source' },
    ],
    whyItMatters: { text: FORAGE_WHY, source: LIVING_SHORELINE },
    sourceCredit: 'Friends of the San Juans forage fish egg surveys, with WDFW records',
  },
  'fish-use': {
    name: FISH_USE_NAME,
    accent: '#0D4F4F', swatch: 'point',
    fishUse: true,
    popupFields: [
      { key: 'Name', label: 'Location' }, { key: 'GeoUnit', label: 'Geomorphic Unit' }, { key: 'RITT_SysTy', label: 'System Type' }, { key: 'RITT_SubTy', label: 'Sub Type' },
      ...FISH_SPECIES.map((s) => ({ key: `HRM_${s.code}`, label: `${s.name}: fish use score (high-resolution model)` })),
    ],
    whyItMatters: {
      text: 'The San Juans are important rearing habitat for out-migrating juvenile salmon. Researchers have found juvenile salmon from twenty of the twenty two populations of threatened Puget Sound Chinook salmon (along with many other species and populations of young salmon) throughout the shallow waters of the San Juans. The time young salmon spend in the marine nearshore is critical to their ability to survive as adults. Shorelines with native vegetation, eelgrass, and kelp help young salmon feed, grow, and avoid predators as they migrate to the open ocean.',
      source: LIVING_SHORELINE,
    },
    whyItMattersByMode: {
      herring: { text: 'Herring, crucial for marine food webs, spawn on eelgrass habitat in just a few locations in San Juan County that are also popular with boaters including Eastsound and West Sound, Blind Bay, Mud Bay, and Hunter Bay. Eelgrass, a vital marine habitat in the Salish Sea, supports Dungeness crabs, Chinook salmon, Pacific herring, and ultimately the Southern Resident killer whales.', source: { credit: 'Become a Green Boater Today (sanjuans.org)', url: 'https://sanjuans.org/become-a-green-boater-today/' } },
      smelt: { text: FORAGE_WHY, source: LIVING_SHORELINE },
      'sand-lance': { text: FORAGE_WHY, source: LIVING_SHORELINE },
    },
    sourceCredit: 'Beamer & Fresh 2012, Skagit River System Cooperative (juvenile salmon and forage fish shoreline surveys, 2008–2009)',
  },
  'friends-shoreline-geology': {
    name: 'Shoreline Geology: Shoreforms',
    accent: '#708090', swatch: 'point',
    popupFields: [
      { key: 'PIAT_shoreforms', label: 'Shoreform' }, { key: 'ShoreForm_Unit_ID', label: 'Shoreform Unit' }, { key: 'FFhab', label: 'Forage Fish Habitat' },
      { key: 'FISHuse_SF', label: 'Fish Use (shoreform unit)' }, { key: 'LandUse', label: 'Land Use' }, { key: 'ShoreDESIG', label: 'Shore Designation' },
      { key: 'PIATprotection', label: 'Protection Priority' }, { key: 'PIATrestoration', label: 'Restoration Priority' },
      { key: 'SLR_Protect', label: 'SLR Protection' }, { key: 'SLR_Restore', label: 'SLR Restoration' },
    ],
    sourceCredit: 'Friends of the San Juans geomorphic shoreform mapping',
  },
  'friends-armor': {
    name: 'Shoreline Armor (2019 survey)',
    accent: '#8B0000', swatch: 'point',
    popupFields: [{ key: 'Island', label: 'Island' }, { key: 'ArmorLength', label: 'Armor Length' }, { key: 'ArmorMaterial', label: 'Material' }, { key: 'ArmorCondition', label: 'Condition' }],
    whyItMatters: {
      text: 'Hard shoreline armoring can reduce short-term wave erosion hazards, but it also starves nearby beaches, impacts fish and wildlife habitat, requires maintenance, and does not address flooding. Bulkheads cause erosion of the beach itself when waves reflect off the hard structure, and they interrupt the processes that maintain beaches over the long term. A NOAA Fisheries study found surf smelt egg survival cut by half where beaches were warmer and drier because of hard armored bulkheads and the absence of trees and shrubs. Hundreds of bulkheads in San Juan County are unnecessary, placed where natural erosion rates are low, and can be removed or redesigned to better protect property and help feed forage fish, salmon, and orca.',
      source: LIVING_SHORELINE,
    },
    sourceCredit: 'Friends of the San Juans shoreline inventory (2009) and armor change survey (2019)',
  },
  'friends-groins': {
    name: 'Groins', accent: '#8B4513', swatch: 'point',
    popupFields: [{ key: 'Material', label: 'Material' }, { key: 'Waypoint', label: 'Waypoint' }, { key: 'CalculatedElevation', label: 'Elevation' }],
    sourceCredit: INVENTORY,
  },
  'friends-boat-ramps': {
    name: 'Boat Ramps', accent: '#4682B4', swatch: 'point',
    popupFields: [{ key: 'Waypoint', label: 'Waypoint' }, { key: 'SurveyDate', label: 'Survey Date' }],
    sourceCredit: INVENTORY,
  },
  'friends-marine-railway': {
    name: 'Marine Railways', accent: '#2F4F4F', swatch: 'point',
    popupFields: [{ key: 'waypoint', label: 'Waypoint' }, { key: 'Surveytime', label: 'Survey Time' }],
    sourceCredit: INVENTORY,
  },
  'friends-mooring-buoys': {
    name: 'Mooring Buoys & Floats', accent: '#191970', swatch: 'point',
    popupFields: [{ key: 'Type', label: 'Type' }, { key: 'OBJECTID', label: 'Object ID' }],
    whyItMatters: {
      text: 'Around the world and here at home, boat anchors and mooring buoys are known to damage eelgrass when chains drag across the seafloor. Divers inspected 150 buoys and found many located in eelgrass habitat lacked mid-line floats—the simple devices that keep chains from scouring the bottom. With support from the National Fish and Wildlife Foundation, Friends and Frog Marine worked with interested mooring buoy owners to install mid-line floats on 81 moorings, immediately removing this source of damage to eelgrass.',
      source: { credit: 'Restoring Eelgrass to Protect Herring and Salmon (sanjuans.org)', url: 'https://sanjuans.org/restoring-eelgrass-to-protect-herring-and-salmon/' },
    },
    sourceCredit: INVENTORY,
  },
  'friends-pilings': {
    name: 'Pilings', accent: '#A0522D', swatch: 'point',
    popupFields: [{ key: 'Count_', label: 'Count' }, { key: 'Creosote', label: 'Creosote' }],
    whyItMatters: {
      text: 'While the San Juans do not have large industrial sources of pollution, cars, creosote pilings, failing septic systems, sedimentation, fertilizers, and household chemicals all cause water quality issues. Removal of degraded structures such as derelict docks, boathouses, and creosote pilings can reduce known sources of toxic materials in our waters and recover habitat for fish, shellfish, and people.',
      source: LIVING_SHORELINE,
    },
    sourceCredit: INVENTORY,
  },
  'friends-docks': {
    name: 'Docks', accent: '#008B8B', swatch: 'point',
    // Data fix (Josh 2026-11-02): the docks file's TYPE is empty for all 474 docks, so its row is never shown
    hideKeys: ['TYPE'],
    popupFields: [
      { key: 'Material', label: 'Material' }, { key: 'Condition', label: 'Condition' }, { key: 'Creosote', label: 'Creosote' },
      { key: 'Grating', label: 'Grating' }, { key: 'PierHeight', label: 'Pier Height' }, { key: 'Waypoint', label: 'Waypoint' },
    ],
    whyItMatters: {
      text: 'Juvenile salmon often avoid swimming under docks, and instead move out into deeper waters where they are at risk from predators. Since eelgrass needs light to grow, use a marina or mooring buoy instead of building a new dock which can shade out marine vegetation. If you already have a dock, look into improvements that can increase light penetration such as grating. Removal of degraded structures such as derelict docks, boathouses, and creosote pilings can reduce known sources of toxic materials in our waters and recover habitat for fish, shellfish, and people.',
      source: LIVING_SHORELINE,
    },
    sourceCredit: INVENTORY,
  },
  'building-footprints': {
    name: 'Building Footprints',
    accent: '#1A252F', swatch: 'fill', swatchColor: '#60A5FA',
    friends: false,
    // Josh 2026-11-02: footprint area to tenths of a square foot (the county stores 8 decimals)
    formats: { Sq_Ft: (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : v) },
    popupFields: [
      { key: 'ADDRESS', label: 'Address' }, { key: 'Sq_Ft', label: 'Footprint (sq ft)' }, { key: 'Island', label: 'Island' },
      { key: 'PIN', label: 'Parcel PIN' }, { key: 'Discriptio', label: 'Description' }, { key: 'Source', label: 'Data Source' },
    ],
    sourceCredit: 'San Juan County GIS',
  },
}

// The five habitat layers by /permits' habitat id (src/permits/habitat.js)
const HABITAT_IDS = { hhe: 'friends-herring-spawning', hkb: 'friends-bull-kelp', hee: 'friends-deepwater-eelgrass', hfp: 'friends-potential-forage-spawning', hfd: 'friends-documented-forage-spawning' }
export const HABITAT_LAYERS = Object.fromEntries(Object.entries(HABITAT_IDS).map(([h, id]) => [h, { id, ...LAYERS[id] }]))

// ─── The all-details table (SSE utils/geojson.ts extractAllFeatureProperties) ───
const HIDDEN_KEYS = new Set(['Shape_Length', 'Shape_Area', 'OBJECTID', 'RuleID', 'File_Path', 'image_path', 'img_id', 'Assessor', 'Tax_Info'])
const BLANK = '(blank)'
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
  // The county's sale dates arrive as epoch milliseconds (midnight UTC)
  if (key.toLowerCase().includes('date') && typeof raw === 'number' && raw > 1e11) {
    value = new Date(raw).toLocaleDateString('en-US', { timeZone: 'UTC' })
  }
  return value
}
const humanizeKey = (key) => key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase())

// showAll: every attribute in the record, blank ones and housekeeping keys included (data-quality review)
export function extractFields(props, configuredFields, showAll = false) {
  const labelMap = new Map(configuredFields.map((f) => [f.key, f.label]))
  const results = []
  const seenKeys = new Set()
  for (const field of configuredFields) {
    const raw = props[field.key]
    if (isBlank(raw)) {
      if (!showAll || !(field.key in props)) continue
      results.push({ label: field.label, value: BLANK })
      seenKeys.add(field.key)
      continue
    }
    results.push({ label: field.label, value: formatValue(field.key, field.label, raw) })
    seenKeys.add(field.key)
  }
  for (const [key, raw] of Object.entries(props)) {
    if (seenKeys.has(key)) continue
    if (!showAll && (HIDDEN_KEYS.has(key) || isBlank(raw))) continue
    const label = labelMap.get(key) || humanizeKey(key)
    results.push({ label, value: isBlank(raw) ? BLANK : formatValue(key, label, raw) })
  }
  return results
}

// "Related content from Friends" block: related articles from sanjuans.org, with the best one's own excerpt
// (Friends' words, never a paraphrase)
export function fromFriendsHtml(articles) {
  if (!articles.length) return ''
  const rows = articles.map((a, i) => `
    <a class="fp-art" href="${escHtml(a.url)}" target="_blank" rel="noopener noreferrer">
      ${a.image ? `<img class="fp-art-img" src="${escHtml(a.image.url)}" alt="" loading="lazy" data-fp-onerror="remove">` : ''}
      <span class="fp-art-body">
        <span class="fp-art-title">${escHtml(a.title)}</span>
        <span class="fp-art-meta">${escHtml(articleDate(a.date))}</span>
        ${i === 0 && a.excerpt ? `<span class="fp-art-sum">${escHtml(a.excerpt)}</span>` : ''}
      </span>
    </a>`).join('')
  return `<div class="fp-from"><div class="fp-k">Related content from Friends of the San Juans</div>${rows}</div>`
}

// Our own keys, never shown: `h`/`name` (the /permits habitat file), `mid`/`lengthRank` (pins), `t_*` (fish levels), `bid` (building id)
const ownKey = (k) => k === 'h' || k === 'name' || k === 'mid' || k === 'lengthRank' || k === 'bid' || /^t_/.test(k)

/** A short title for a feature (the chooser row and the hover card): SSE's rowFor. */
export function featureTitle(layerId, props, { fishMode } = {}) {
  const p = Object.fromEntries(Object.entries(props || {}).filter(([k]) => !ownKey(k)))
  if (LAYERS[layerId]?.fishUse) return fishUseEntries(p, fishCodesForMode(fishMode)).map((e) => `${e.species.name}: ${FISH_TIERS[e.tier].label}`).join(', ')
  return (POPUP_SPECS[layerId]?.title?.(p) || str(p.name || p.NAME || p.id) || LAYERS[layerId]?.name || 'Feature').replace(/\s+/g, ' ')
}

/**
 * The popup HTML for one feature of an SSE layer (layerId: SSE's id, e.g. 'friends-armor'). props: the feature's
 * attributes. fishMode: the fish line's Color by choice (its species lead the fish popup and pick "why it matters").
 * Before the Friends content index has loaded, photos and the related-articles block are thinner; rebuild once
 * preloadFriendsContent() resolves (as SSE does) if the popup is still open.
 * detailsExpanded: "All details" starts open (/shoreline, Josh 2026-11-09).
 * related: false drops the "Related content from Friends of the San Juans" block (/shoreline, Josh 2026-11-09).
 */
export function buildFriendsPopup(layerId, props, { fishMode, related = true, detailsExpanded = false } = {}) {
  const config = LAYERS[layerId]
  if (!config) return ''
  const p = Object.fromEntries(Object.entries(props || {}).filter(([k]) => !ownKey(k) && !config.hideKeys?.includes(k))
    .map(([k, v]) => [k, config.formats?.[k] && v != null && v !== '' ? config.formats[k](v) : v]))
  const spec = POPUP_SPECS[layerId] || {}
  const fields = extractFields(p, config.popupFields, !!spec.allFields)
  const fish = config.fishUse ? fishUsePopupParts(p, fishCodesForMode(fishMode)) : null
  const label = str(p.name || p.NAME || p.id)
  const title = fish?.title || spec.title?.(p) || label || config.name

  // Friends' website content: the best articles for this layer supply photos and the related list
  const idx = spec.dataOnly ? null : getFriendsContentSync()
  const articles = articlesForFeature(idx, layerId, p, 3).slice().sort((a, b) => b.date.localeCompare(a.date))
  // The curated handout photo first, then only Friends photos whose captions name the subject
  const photos = []
  if (!spec.dataOnly) {
    if (LAYER_PHOTOS[layerId]) photos.push(LAYER_PHOTOS[layerId])
    if (LAYER_PHOTOS_MORE[layerId]) photos.push(...LAYER_PHOTOS_MORE[layerId])
    if (PHOTO_SUBJECTS[layerId]) {
      for (const im of photosForSubject(idx, PHOTO_SUBJECTS[layerId], PHOTO_EXCLUDE, 2)) photos.push({ url: im.url, caption: im.caption, credit: FRIENDS })
    }
  }

  // "Why it matters" only ever carries Friends' own words: the layer's sourced text (per Color by choice for fish)
  const why = (fishMode && config.whyItMattersByMode?.[fishMode]) || config.whyItMatters
  const story = !spec.dataOnly && why ? { kicker: 'Why it matters', html: escHtml(why.text), source: why.source } : undefined

  return buildPopupCard({
    accent: config.accent,
    layerName: config.name,
    swatch: config.swatch,
    swatchColor: config.swatchColor,
    title,
    subtitle: fish ? fish.subtitle : spec.subtitle?.(p),
    lead: fish?.lead,
    photos,
    stats: spec.stats?.(p),
    chips: spec.chips?.(p),
    story,
    action: spec.action,
    body: spec.dataOnly || !related ? '' : fromFriendsHtml(articles),
    fields: spec.noDetails ? [] : fields,
    detailsOpen: spec.detailsOpen,
    detailsExpanded,
    source: { credit: config.sourceCredit },
    friends: config.friends !== false,
  })
}

/** /permits: a habitat feature by its habitat id (hfd, hfp, hhe, hee, hkb). */
export const buildFriendsHabitatPopup = (h, props) => buildFriendsPopup(HABITAT_IDS[h], props)
