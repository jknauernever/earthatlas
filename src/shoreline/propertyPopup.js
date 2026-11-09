/**
 * /shoreline property popup: Salish Sea Explorer's tabbed parcel report (FeaturePopup.tsx handleParcelClick and its
 * tab builders), in the EarthAtlas card (src/friends/popupCard.js). Tabs: Summary · Shoreline · Fish · Wildlife ·
 * Modifications · Vegetation · Property; an inland parcel drops Shoreline, Fish and Modifications, as SSE does.
 *
 * Everything but birds comes from one detail shard (scripts/shoreline/bake-parcels.py → Blob
 * shoreline/<version>/detail/<fid % 256>.json): p assessor fields, ad address points, bl buildings, ns nearshore
 * stats (nearshore-stats.py), gr greenery + island percentile (greenery-stats.py). Birds are eBird via /api/ebird.
 *
 * Differences from SSE, by decision (docs/SHORELINE_PORT_PLAN.md): the Vegetation tab keeps greenery only (decision 3);
 * the mini-map is a small Mapbox satellite map drawn from the same parcel tiles; a parcel the county has no address
 * point for is titled by its PIN (SSE asked Google for the nearest street address).
 */
import mapboxgl from 'mapbox-gl'
import { shorelineBake as PARCELS } from './bake.js'
import { buildPopupCard, escapeHtml as esc } from '../friends/popupCard.js'
import { SHOREFORM_TYPES, FISH_USE_NAME, fishUseListHtml, fishPill, extractFields } from '../friends/habitatPopups.js'
import { FISH_SPECIES, fishTier, SHOREFORM_GROUPS } from './shorelineLayers.js'
import './propertyPopup.css'

const ACCENT = '#F97316'
// Search distances the nearshore stats were computed with (scripts/shoreline/nearshore-stats.py)
const D = { kelpFt: 500, eelgrassFt: 500, forageFt: 200, potentialFt: 25, herringFt: 100, shoreformFt: 200, fishFt: 200, armorFt: 50, structureFt: 100, buoyFt: 300 }
const GUIDE = '/friends/reports/living-with-the-shoreline.html'
const KELP_REPORT = '/friends/reports/kelp-habitat-value-and-threats.html'
const SITE_VISIT_URL = 'https://sanjuans.org/our-work/landowner-resources/#SiteVisit'
const ARMOR_WEBINAR_URL = 'https://www.youtube.com/watch?v=Ts8aC0REZJA'
const FISH_USE_SOURCE = 'https://gis.sanjuancountywa.gov/arcgis/rest/services/Habitat/SRSC_ShorelineFishPresence/MapServer'
const PARCEL_SOURCE = 'https://gis.sanjuancountywa.gov/arcgis/rest/services/OpenData/Parcels/MapServer/1'
const MINI_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12'

// Each tab credits its own sources (the footer follows the open tab)
const TAB_SOURCES = {
  summary: 'San Juan County GIS (assessor parcels); Friends of the San Juans (shore type, kelp, eelgrass)',
  shoreline: 'Friends of the San Juans (shoreform mapping with Coastal Geologic Services, kelp, eelgrass); Washington DNR (kelp, eelgrass); Friday Harbor Labs (eelgrass)',
  fish: 'Beamer & Fresh 2012, Skagit River System Cooperative (fish use scores); Friends of the San Juans (forage fish spawning beaches); WDFW (forage fish records, herring spawning grounds)',
  wildlife: 'eBird, Cornell Lab of Ornithology (birds); EarthAtlas (marine mammal sightings)',
  mods: 'Friends of the San Juans (shoreline inventory 2009, armor change survey 2019)',
  vegetation: 'USDA NAIP imagery via Google Earth Engine (greenery)',
  property: 'San Juan County GIS (assessor parcels, building footprints)',
}
const TABS = [['summary', 'Summary'], ['shoreline', 'Shoreline'], ['fish', 'Fish'], ['wildlife', 'Wildlife'], ['mods', 'Modifications'], ['vegetation', 'Vegetation'], ['property', 'Property']]
// SSE layers.ts tax-parcels popupFields: these first, then every other assessor field
const PARCEL_FIELDS = [
  { key: 'PIN', label: 'Parcel ID' }, { key: 'Short_Lega', label: 'Legal Description' }, { key: 'Acres', label: 'Acres' },
  { key: 'Tax_Area', label: 'Tax Area' }, { key: 'Land_Value', label: 'Land Value' }, { key: 'Appraised_', label: 'Appraised Value' },
  { key: 'Bldg_Value', label: 'Building Value' }, { key: 'Use_Code', label: 'Use Code' }, { key: 'Descriptio', label: 'Description' },
  { key: 'Sale_date', label: 'Last Sale Date' }, { key: 'Sale_Price', label: 'Last Sale Price' },
]

// ─── Data ─────────────────────────────────────────────────────────────────────
const shards = new Map()
/** The parcel's detail record ({ p, ad, bl, ns, gr }), or null. One shard holds ≈75 parcels; each is fetched once. */
export function fetchParcelDetail(fid) {
  const n = Number(fid) % PARCELS.detailShards
  if (!shards.has(n)) {
    shards.set(n, fetch(`${PARCELS.detailBase}${n}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => { shards.delete(n); return null }))
  }
  return shards.get(n).then((s) => s?.[String(fid)] ?? null)
}

let projects = null
/** Friends' projects (public/shoreline-data/friends-projects.geojson): data for the inland card only, not on the map. */
export function loadFriendsProjects() {
  projects ??= fetch('/shoreline-data/friends-projects.geojson').then((r) => (r.ok ? r.json() : { features: [] })).then((fc) => fc.features || []).catch(() => [])
  return projects
}

// ─── Small pieces (SSE's card language, in EarthAtlas type) ───────────────────
const card = (inner, cls = '') => `<div class="pp-card${cls ? ` ${cls}` : ''}">${inner}</div>`
const heading = (t) => `<div class="pp-h">${esc(t)}</div>`
const muted = (t) => card(`<p class="pp-muted">${t}</p>`)
const ft = (n) => `${Number(n).toLocaleString('en-US')} ft`
const cite = (url, title) => ` <span class="pp-cite">&mdash; <a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>, Friends of the San Juans</span>`
const lws = () => cite(GUIDE, 'Living with the Shoreline')
const fmtAcres = (v) => { const n = Number(v); return !n || isNaN(n) ? '0' : n % 1 === 0 ? String(n) : n.toFixed(2) }

// Friends of the San Juans' own words (Living with the Shoreline handout), cited under each card
const KELP_TEXT = `The San Juans are home to one-third of all floating kelp in the inland waters of Washington State. Kelp helps reduce wave energy that causes beach erosion and provides protected feeding areas for marine mammals, birds, and fish.${lws()}`
const EELGRASS_TEXT = `Eelgrass provides food and shelter for many juvenile fish and shellfish of ecological, cultural, commercial, and recreational importance. In addition, eelgrass mitigates wave energy and traps sediments, protecting shorelines from wave driven erosion.${lws()}`
const FORAGE_TEXT = `Forage fish are small schooling fish that are eaten by larger fish, seabirds, and marine mammals. Forage fish utilize the same shoreline areas that humans do, which makes them vulnerable to modifications such as bulkheads, docks, roads, and the removal of vegetation.${lws()}`
const HERRING_TEXT = `Pacific herring deposit transparent, adhesive eggs on eelgrass and marine algae. Salmon and forage fish need the protection of eelgrass and kelp.${lws()}`

/** SSE nearshoreFromStats: the shard's ns record in the shape the cards read. */
function nearshore(ns) {
  const k = ns?.kelp, e = ns?.eelgrass, f = ns?.forage, h = ns?.herring ?? []
  return {
    bullKelp: { present: !!k && k.n > 0, featureCount: k?.n ?? 0, totalAcres: k?.acres ?? 0, distFt: k?.distFt ?? null },
    eelgrass: { present: !!e && e.n > 0, segmentCount: e?.n ?? 0, totalLengthFt: e?.lengthFt ?? 0, sites: e?.sites ?? [], meanDepth: e?.meanDepth ?? null, maxDepth: e?.maxDepth ?? null, distFt: e?.distFt ?? null },
    forage: { present: !!f && ((f.documented?.length ?? 0) > 0 || (f.potentialN ?? 0) > 0), documented: f?.documented ?? [], potentialCount: f?.potentialN ?? 0, potentialDistFt: f?.potentialDistFt ?? null, potentialForm: f?.potentialForm ?? '' },
    herring: { present: h.length > 0, names: h, distFt: ns?.herringDistFt ?? null },
    shoreform: ns?.shoreform ?? null, fish: ns?.fish ?? null, mods: ns?.mods ?? null, shore: ns?.shore ?? null,
  }
}

/** Shoreline property: waterfront or tidelands on record, or any shore feature within the search distances. */
function isShorelineParcel(p, v) {
  if ((Number(p.WF_LGTH) || 0) > 0 || (Number(p.TidelandFt) || 0) > 0) return true
  return !!(v.shoreform || v.fish || v.bullKelp.present || v.eelgrass.present || v.forage.present || v.herring.present || v.mods)
}

const ISLAND_NAMES = ['San Juan', 'Orcas', 'Lopez', 'Shaw', 'Blakely', 'Decatur', 'Stuart', 'Waldron', 'Sucia', 'Brown', 'Henry', 'Spieden', 'Jones', 'Patos', 'Matia', 'Obstruction', 'Crane', 'Center', 'Pearl', 'Johns', 'Sinclair', 'Cypress']
/** Which island a parcel is on, from the assessor tax area ("ORCAS/CEMETERY" → "Orcas"), else its address point. */
function islandOfParcel(p, ad) {
  for (const c of [p.Tax_Area, ad?.[0]?.PLACENAME, ad?.[0]?.MSAG]) {
    const u = String(c ?? '').toUpperCase()
    const hit = ISLAND_NAMES.find((n) => u.startsWith(n.toUpperCase()) || u.includes(n.toUpperCase() + ' IS'))
    if (hit) return hit
  }
  return ''
}
function projectsOnIsland(island, feats) {
  if (!island) return []
  return feats.map((f) => f.properties || {})
    .filter((p) => String(p.ISLAND ?? '').trim().toLowerCase().startsWith(island.toLowerCase()))
    .map((p) => ({ name: String(p.NAME ?? ''), kind: String(p.kind ?? ''), date: String(p.DATE ?? ''), link: String(p.LINK ?? '') }))
    .sort((a, b) => b.date.localeCompare(a.date))
}
const PROJECT_KIND_COLORS = { 'Restoration project': '#0297BA', 'Riparian project': '#3D6410', 'In/over-water structure project': '#8F6B2E', 'Restoration site': '#0D4F4F' }

// ─── Summary ──────────────────────────────────────────────────────────────────
function atAGlance(p, bl, ad) {
  const sqFt = bl.reduce((s, b) => s + (Number(b.Sq_Ft) || 0), 0)
  const wf = Number(p.WF_LGTH) || 0
  const stat = (value, label) => `<div class="pp-glance-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`
  const rows = [stat(fmtAcres(p.Acres || p.Legal_Acre), 'Acres')]
  if (bl.length) rows.push(stat(String(bl.length), bl.length === 1 ? 'Building' : 'Buildings'))
  if (sqFt > 0) rows.push(stat(Math.round(sqFt).toLocaleString('en-US'), 'Sq Ft'))
  if (wf > 0) rows.push(stat(`${Math.round(wf)} ft`, 'Waterfront'))
  const pill = (t) => `<b class="pp-pill">${esc(t)}</b>`
  const details = []
  if (p.Tax_Area) details.push(`Located in ${pill(p.Tax_Area)}`)
  if (p.Descriptio) details.push(`classified as ${pill(p.Descriptio)}`)
  if (ad?.[0]?.BLDGTYPE) details.push(`${pill(ad[0].BLDGTYPE)} use`)
  // No dollar values in the Summary: those stay on the Property tab
  let text = details.length ? `<p>${details.join(', ')}.</p>` : ''
  if (ad?.length) {
    const parts = [ad[0].PLACENAME ? pill(ad[0].PLACENAME) : '', ad[0].MSAG ? esc(ad[0].MSAG) : ''].filter(Boolean)
    if (parts.length) text += `<p>${parts.join(', ')}.</p>`
    const others = ad.slice(1).filter((e) => e.FULLADDR)
    if (others.length) text += `<p>${pill(others.length === 1 ? '1 additional address' : `${others.length} additional addresses`)} on this parcel.</p>`
  }
  return card(`<div class="pp-h">At a Glance</div><div class="pp-glance">${rows.join('')}</div><div class="pp-glance-text">${text}</div>`, 'pp-fill')
}

const HML = { H: 'High', M: 'Medium', L: 'Low', None: 'None', Y: 'Yes', N: 'No', P: 'Potential' }
// San Juan County Shoreline Master Program environment designations
const SHORE_DESIG = { N: 'Natural', C: 'Conservancy', R: 'Rural', U: 'Urban', A: 'Aquatic' }
function shoreformCard(sf) {
  const type = SHOREFORM_TYPES[sf.code]
  const label = type?.label ?? sf.code ?? 'Unclassified'
  const color = SHOREFORM_GROUPS[type?.group]?.color ?? '#036E88'
  const chip = (k, v) => (v ? `<span class="pp-kv">${k} <b>${esc(v)}</b></span>` : '')
  const chips = [
    chip('Forage fish habitat', HML[sf.ffhab] ?? sf.ffhab), chip('Protection priority', HML[sf.protection] ?? sf.protection),
    chip('Restoration priority', HML[sf.restoration] ?? sf.restoration), chip('SMP designation', SHORE_DESIG[sf.shoreDesig] ?? sf.shoreDesig),
    sf.publicOwnership ? chip('Ownership', 'Some public') : '',
  ].filter(Boolean).join('')
  return card(`${heading('Shoreline Type')}
    <div class="pp-sf"><span class="pp-sf-sw" style="background:${color}"></span><b>${esc(label)}</b>${sf.distFt > 0 ? `<span>${sf.distFt} ft from parcel line</span>` : ''}</div>
    ${type?.description ? `<p>${esc(type.description)}</p>` : ''}
    ${chips ? `<div class="pp-kvs">${chips}</div>` : ''}
    <p class="pp-small">Geomorphic shoreform mapping by Friends of the San Juans (Coastal Geologic Services, 2012). Coastal processes affect each shore form differently, resulting in different management concerns and priorities.</p>`)
}

function shorelineDescriptionCard(seg) {
  const t = (k) => String(seg[k] ?? '').trim()
  const name = t('name'), geoUnit = t('geoUnit'), systemType = t('systemType'), subType = t('subType'), materialClass = t('materialClass'), featureType = t('featureType')
  if (!name && !geoUnit && !subType && !materialClass) return ''
  const b = (x) => `<b class="pp-pill">${esc(x)}</b>`
  const s = []
  if (name && geoUnit) s.push(`The nearest shoreline is located at ${b(name)}, which is classified as a ${b(geoUnit)}.`)
  else if (name) s.push(`The nearest shoreline is located at ${b(name)}.`)
  else if (geoUnit) s.push(`The adjacent shoreline is classified as a ${b(geoUnit)}.`)
  if (systemType && subType) s.push(`It is part of a ${b(systemType)} system, specifically a ${b(subType)}.`)
  else if (systemType) s.push(`It is part of a ${b(systemType)} system.`)
  else if (subType) s.push(`The shoreline is classified as a ${b(subType)}.`)
  if (materialClass) s.push(`The bottom material is ${b(materialClass)}.`)
  if (featureType) s.push(`The shoreline feature type is ${b(featureType)}.`)
  return card(`${heading('Shoreline Description')}<p>${s.join(' ')}</p>`)
}

/** Survey codes → plain names: "SurfSmelt", "SL", "Smelt/SL". */
function speciesLabel(code) {
  const c = String(code ?? '').trim().toLowerCase()
  if (!c) return ''
  const parts = []
  if (/smelt|^ss$/.test(c)) parts.push('surf smelt')
  if (/\bsl\b|lance/.test(c)) parts.push('Pacific sand lance')
  return parts.join(', ') || code
}
const formLabel = (code) => SHOREFORM_TYPES[code]?.label ?? code
function forageSummary(f) {
  const docs = f.documented
  if (docs.length) {
    const species = new Set()
    for (const d of docs) {
      if (d.smelt) species.add('surf smelt')
      if (d.sandLance) species.add('Pacific sand lance')
      if (!d.smelt && !d.sandLance && d.species) species.add(speciesLabel(d.species))
    }
    const names = docs.map((d) => d.name).filter(Boolean)
    const sp = species.size ? ` (${[...species].join(', ')})` : ''
    return `Documented spawning beach${docs.length > 1 ? 'es' : ''}${names.length ? `: ${esc(names.slice(0, 3).join(', '))}` : ''}${esc(sp)}`
  }
  if (f.potentialCount > 0) return `Potential spawning beach fronting the parcel${f.potentialForm ? ` (${esc(formLabel(f.potentialForm).toLowerCase())})` : ''} — substrate suitable for surf smelt or sand lance`
  return ''
}
const kelpExtent = (acres) => (acres >= 5 ? 'Extensive kelp canopy' : acres >= 1 ? 'Moderate kelp presence' : acres >= 0.1 ? 'Small kelp patches' : 'Trace kelp presence')
const kelpDensity = (n) => (n === 1 ? 'one mapped patch' : `${n} mapped patches`)
const eelgrassExtent = (n, len) => (len >= 5000 ? 'Extensive eelgrass coverage' : len >= 1000 ? 'Moderate eelgrass presence' : n >= 3 ? 'Multiple eelgrass survey sites' : 'Eelgrass detected nearby')

function nearshoreEcologyCard(v) {
  const { bullKelp: k, eelgrass: e, forage: f, herring: h } = v
  const anyVeg = k.present || e.present
  const row = (present, label, detail) => `<div class="pp-row${present ? ' pp-row-on' : ''}"><span class="pp-dot"></span><span><b>${label}</b>${detail ? ` &mdash; ${detail}` : ''}</span></div>`
  const kelpDetail = k.present
    ? `${kelpExtent(k.totalAcres).toLowerCase().replace(/ kelp /, ' ')} within ${D.kelpFt} ft${k.distFt != null ? ` (nearest ${k.distFt} ft)` : ''}`
    : `none mapped within ${D.kelpFt} ft`
  const eelDetail = e.present
    ? `${eelgrassExtent(e.segmentCount, e.totalLengthFt).toLowerCase().replace(/^eelgrass /, '')} within ${D.eelgrassFt} ft${e.distFt != null ? ` (nearest ${e.distFt} ft)` : ''}`
    : `deep-water edge not mapped within ${D.eelgrassFt} ft`
  const forageDetail = f.present ? forageSummary(f) : `none mapped within ${D.forageFt} ft`
  const herringDetail = h.present
    ? `${esc(h.names.join(', '))}${h.distFt != null && h.distFt > 0 ? `, ${h.distFt} ft away` : ' along the parcel'}`
    : `no mapped spawning ground within ${D.herringFt} ft`
  const para = (label, text) => `<p class="pp-para"><b>${label}.</b> ${text}</p>`
  const paras = [k.present && para('Bull kelp', KELP_TEXT), e.present && para('Eelgrass', EELGRASS_TEXT), f.present && para('Forage fish', FORAGE_TEXT), h.present && para('Herring', HERRING_TEXT)].filter(Boolean)
  if (!anyVeg) paras.push(`<p class="pp-para pp-muted">No bull kelp or eelgrass beds were identified within ${D.kelpFt} ft of this property in Friends of the San Juans survey data. This does not necessarily indicate poor condition &mdash; these marine plants require specific substrate, depth, and light conditions. Kelp needs rocky substrate and higher energy environments and eelgrass needs soft sediment in protected, shallow waters.</p>`)
  const significance = anyVeg ? `<div class="pp-note pp-note-sand"><div class="pp-h">Ecological Significance</div><p>
      ${e.present ? 'Eelgrass is protected under <b>Washington State law</b> and San Juan County’s <b>Environmentally Sensitive Areas</b> code. ' : ''}
      ${k.present ? 'Bull kelp is a <b>priority habitat</b> for the Washington Department of Fish &amp; Wildlife and is protected under <b>San Juan County code</b>. ' : ''}
      Activities that increase sedimentation, shading, or nutrient runoff near this property can affect these habitats.</p></div>` : ''
  const learnMore = `<div class="pp-note pp-note-green"><p>Want to know how you can help protect the shoreline around your property?
      <a href="${GUIDE}" target="_blank" rel="noopener noreferrer">Read the guide for shoreline property owners</a> &mdash; it’s full of practical ideas from your neighbors in the San Juans. You can also
      <a href="${KELP_REPORT}" target="_blank" rel="noopener noreferrer">learn more about kelp</a> and why these underwater forests matter so much to the health of our islands.</p></div>`
  return card(`${heading('Nearshore Habitat')}<div class="pp-rows">${row(k.present, 'Bull kelp', kelpDetail)}${row(e.present, 'Eelgrass', eelDetail)}${row(h.present, 'Forage fish: herring spawning', herringDetail)}${row(f.present, 'Forage fish: smelt &amp; sand lance beach', forageDetail)}</div>${paras.join('')}${significance}${learnMore}`)
}

/** Header chips: what living shoreline is near this parcel, lit when present. */
function livingShorelineChips(v) {
  const { bullKelp: k, eelgrass: e, herring: h, forage: f } = v
  return [
    { on: k.present, label: k.present && k.distFt != null ? `Bull kelp ${k.distFt} ft` : 'No bull kelp' },
    { on: e.present, label: e.present && e.distFt != null ? `Eelgrass ${e.distFt} ft` : 'No eelgrass' },
    { on: h.present, label: h.present ? `Herring ${h.distFt != null && h.distFt > 0 ? `${h.distFt} ft` : 'spawning'}` : 'No herring spawning' },
    { on: f.present, label: f.present ? (f.documented.length ? 'Smelt & sand lance beach' : 'Potential smelt & sand lance beach') : 'No smelt & sand lance beach' },
  ].map((c) => ({ label: c.label, tone: c.on ? 'on' : 'default' }))
}

function shoreHeading(raw) {
  const name = String(raw ?? '').replace(/\s+Is\.?$/i, ' Island').trim()
  return name ? `Distance to the nearest ${name} shoreline:` : 'Distance to the nearest shoreline:'
}

/** Summary for a property off the shore: distance to the water, tree cover, Friends' work on the island, upland stewardship. */
function inlandCards(v, gr, island, islandProjects) {
  const cards = []
  if (v.shore) {
    const n = v.shore.distFt
    const dist = n >= 5280 ? `${(n / 5280).toFixed(1)} mi` : `${n.toLocaleString('en-US')} ft`
    cards.push(card(`${heading(shoreHeading(v.shore.name))}<div class="pp-big">${esc(dist)}</div>
      <p class="pp-para">Rain that falls here drains toward that shoreline. Forest cover, streamside vegetation, and how runoff leaves the property all shape the beach and the nearshore water below it.</p>`))
  }
  if (gr) {
    const beachNote = `<p class="pp-para">An undisturbed forest can intercept up to 40% of rainfall, protecting against erosion while also slowing surface runoff, increasing infiltration, and protecting water quality. Overhanging vegetation also provides shade, a key factor in keeping beach conditions cool, moist, and organically rich. The insects that live in the trees and shrubs then become food for small fish.${lws()}</p>`
    cards.push(greeneryCard(gr, false, beachNote))
  }
  if (islandProjects.length) {
    const rows = islandProjects.map((pr) => `<div class="pp-proj"><span class="pp-proj-dot" style="background:${PROJECT_KIND_COLORS[pr.kind] ?? '#036E88'}"></span><div>
        <div class="pp-proj-name">${pr.link ? `<a href="${esc(pr.link)}" target="_blank" rel="noopener noreferrer">${esc(pr.name)} &#8599;</a>` : esc(pr.name)}</div>
        <div class="pp-proj-meta">${esc(pr.kind)}${pr.date ? ` · ${esc(pr.date)}` : ''}</div></div></div>`).join('')
    cards.push(card(`${heading(`Friends' work on ${island} Island`)}
      <p class="pp-para">${islandProjects.length === 1 ? 'One Friends of the San Juans project' : `${islandProjects.length} Friends of the San Juans projects`} on ${esc(island)}, most recent first.</p>${rows}`))
  }
  cards.push(card(`${heading('Upland stewardship')}
    <div class="fp-block fp-act"><div class="fp-k">What you can do here</div><div class="fp-text">You can help by maintaining or restoring native vegetation along the shore to slow and filter runoff, installing pervious walks and driveways to allow filtration, directing stormwater flow from gutters and roads into vegetated areas, maintaining onsite sewage systems, and using compost instead of chemical fertilizers. Maintaining native vegetation will also help reduce the impact of heavy rains and provide habitat for wildlife.${lws()}</div>
      <a class="fp-btn" href="https://sanjuans.org/our-work/landowner-resources/" target="_blank" rel="noopener noreferrer">Landowner resources</a></div>`))  // no "Related content from Friends" on /shoreline (Josh 2026-11-09)
  return cards
}

// ─── Shoreline / Fish / Modifications tabs (all from the precompute) ──────────
function vegetationHtml(v, mode) {
  const { bullKelp: k, eelgrass: e, forage: f, herring: h } = v
  const stat = (value, label) => `<div class="pp-stat"><b>${value}</b><span>${label}</span></div>`
  const absent = (label) => `<div class="pp-absent"><span class="pp-dot"></span>${label}</div>`
  const reason = (t) => `<p class="pp-reason">${t}</p>`
  if (mode === 'spawn') {
    const herringHtml = h.present
      ? `<div class="pp-box pp-box-blue"><div class="pp-box-h"><span class="pp-dot pp-dot-on"></span>Herring &mdash; spawning ground</div>
          <p>${esc(h.names.join(', '))}, a mapped Pacific herring spawning ground (present or historic).</p>
          ${reason(`Why it is here: the ground is ${h.distFt != null && h.distFt > 0 ? `${h.distFt} ft from the parcel line` : 'along this parcel'} (grounds within ${D.herringFt} ft are counted).`)}
          <p class="pp-quote">${HERRING_TEXT}</p></div>`
      : absent(`Herring: no spawning ground mapped within ${D.herringFt} ft`)
    let forageHtml
    if (f.present) {
      const beachRows = f.documented.map((d) => {
        const sp = [d.smelt ? 'surf smelt' : '', d.sandLance ? 'Pacific sand lance' : ''].filter(Boolean).join(', ') || speciesLabel(d.species)
        const where = [d.shoreform ? formLabel(d.shoreform).toLowerCase() : '', d.distFt > 0 ? `${d.distFt} ft` : 'along this parcel'].filter(Boolean).join(', ')
        return `<li>${esc(d.name || 'Unnamed beach')}${sp ? ` &mdash; ${esc(sp)}` : ''}${where ? ` <span class="pp-muted">(${esc(where)})</span>` : ''}</li>`
      }).join('')
      const potentialLine = f.potentialCount > 0
        ? `Potential habitat: ${f.potentialForm ? `${esc(formLabel(f.potentialForm).toLowerCase())} ` : ''}beach substrate suitable for surf smelt or Pacific sand lance ${f.potentialDistFt != null && f.potentialDistFt > 0 ? `${f.potentialDistFt} ft from the parcel line` : 'along this parcel'}.` : ''
      forageHtml = `<div class="pp-box pp-box-sand"><div class="pp-box-h"><span class="pp-dot pp-dot-on"></span>Beach spawning &mdash; smelt &amp; sand lance</div>
        ${f.documented.length ? `<p>Documented spawning ${f.documented.length === 1 ? 'beach' : 'beaches'}:</p><ul>${beachRows}</ul>
          ${reason(`Why it is here: surveyed spawning beaches within ${D.forageFt} ft of the parcel line are counted.`)}` : ''}
        ${potentialLine ? `<p>${potentialLine}</p>${reason(`Why it is here: potential habitat counts only where it fronts the parcel (within ${D.potentialFt} ft) and never on rocky shoreline.`)}` : ''}
        <p class="pp-quote">${FORAGE_TEXT}</p></div>`
    } else {
      forageHtml = absent(`Beach spawning: no surf smelt or sand lance beach mapped within ${D.forageFt} ft, and no potential habitat fronting this parcel`)
    }
    return card(`${heading('Forage Fish Spawning')}<p class="pp-muted pp-para">Friends of the San Juans and WDFW survey data. Herring spawn on eelgrass and algae in sheltered bays; surf smelt and Pacific sand lance spawn on the upper beach.</p>${herringHtml}${forageHtml}`)
  }
  let kelpHtml
  if (k.present) {
    const acres = k.totalAcres >= 0.1 ? k.totalAcres.toFixed(1) : '< 0.1'
    kelpHtml = `<div class="pp-box pp-box-green"><div class="pp-box-h"><span class="pp-dot pp-dot-on"></span>Bull Kelp Present</div>
      <p>${kelpExtent(k.totalAcres)}, ${kelpDensity(k.featureCount)} within ${D.kelpFt} ft of this property.</p>
      <div class="pp-stats">${stat(acres, 'Acres (approx.)')}${k.distFt != null ? stat(String(k.distFt), 'Nearest (ft)') : ''}${stat(k.featureCount.toLocaleString('en-US'), k.featureCount === 1 ? 'Patch' : 'Patches')}</div>
      <p class="pp-quote">${KELP_TEXT}</p></div>`
  } else kelpHtml = absent(`No bull kelp mapped within ${D.kelpFt} ft`)
  let eelHtml
  if (e.present) {
    const len = e.totalLengthFt >= 1 ? Math.round(e.totalLengthFt).toLocaleString('en-US') : ''
    eelHtml = `<div class="pp-box pp-box-teal"><div class="pp-box-h"><span class="pp-dot pp-dot-on"></span>Eelgrass Present</div>
      <p>${eelgrassExtent(e.segmentCount, e.totalLengthFt)} within ${D.eelgrassFt} ft of this property${e.segmentCount > 1 ? ` across ${e.segmentCount} survey transects` : ''}. The mapped line is the deep-water edge of the meadow; the meadow extends from there toward shore.</p>
      <div class="pp-stats">${e.distFt != null ? stat(String(e.distFt), 'Nearest (ft)') : ''}${len ? stat(len, 'Length (ft)') : ''}${e.meanDepth != null ? stat(e.meanDepth.toFixed(1), 'Avg depth') : ''}${e.maxDepth != null ? stat(e.maxDepth.toFixed(1), 'Max depth') : ''}</div>
      ${e.sites.length ? `<p class="pp-small">Survey sites: ${esc(e.sites.slice(0, 3).join(', '))}</p>` : ''}
      <p class="pp-quote">${EELGRASS_TEXT}</p></div>`
  } else eelHtml = absent(`No eelgrass deep-water edge mapped within ${D.eelgrassFt} ft`)
  return card(`${heading('Nearshore Habitat')}<p class="pp-muted pp-para">Friends of the San Juans survey data: bull kelp and eelgrass within ${D.kelpFt} ft of the property.</p>${kelpHtml}${eelHtml}`)
}

function fishTab(v) {
  let scores
  const entries = Object.entries(v.fish?.scores ?? {}).flatMap(([code, s]) => {
    const sp = FISH_SPECIES.find((x) => x.code === code)
    return sp ? [{ species: sp, hrm: s.hrm, tier: fishTier(sp, s.hrm) }] : []
  }).sort((a, b) => b.tier - a.tier)
  if (entries.length) {
    const top = entries.filter((x) => x.tier === entries[0].tier).map((x) => x.species.name)
    const list = top.length > 2 ? `${top.slice(0, -1).join(', ')} and ${top[top.length - 1]}` : top.join(' and ')
    const distFt = v.fish.distFt
    scores = card(`${heading(FISH_USE_NAME)}
      <p class="pp-para">Along this shoreline, ${esc(list)} ${top.length === 1 ? 'ranks' : 'rank'} ${fishPill(entries[0].tier)} for fish use.</p>
      <p class="pp-para pp-muted">The shorelines of the San Juans are critical rearing, resting and feeding habitat for out-migrating juvenile salmon from rivers across Puget Sound and southern British Columbia, as well as other fish species that support marine food webs. Priority levels show where each species is more likely to be both present and abundant, relative to other places in the county. Salmon levels are for rearing juveniles. Nothing is ranked low: fish can and do use every shoreline. <a href="${FISH_USE_SOURCE}" target="_blank" rel="noopener noreferrer">More about this data &rarr;</a></p>
      ${fishUseListHtml(entries)}
      <p class="pp-small">Levels are for the surveyed shoreline segment${distFt != null && distFt > 0 ? ` ${distFt} ft from the parcel line` : ' along this parcel'} (segments within ${D.fishFt} ft are considered). Source: Beamer &amp; Fresh 2012, Skagit River System Cooperative.</p>`)
  } else {
    scores = card(`${heading(FISH_USE_NAME)}<p class="pp-para pp-muted">No surveyed shoreline segment lies within ${D.fishFt} ft of this parcel, so there are no fish use levels to show. Shoreline segments are scored countywide; inland parcels have none.</p>`)
  }
  return scores + vegetationHtml(v, 'spawn')
}

function modsTab(v) {
  const m = v.mods ?? {}
  const MATERIAL = { W: 'wood', C: 'concrete', R: 'rock', S: 'steel', P: 'plastic', M: 'metal', F: 'fiberglass', O: 'other' }
  const CONDITION = { G: 'good', F: 'fair', P: 'poor', E: 'excellent' }
  const BUOY = { B: 'mooring buoy', F: 'float', R: 'raft' }
  const chip = (t, tone) => `<span class="fp-chip${tone ? ` fp-chip-${tone}` : ''}">${esc(t)}</span>`
  const row = (present, title, detail, within) => `<div class="pp-mod${present ? ' pp-mod-on' : ''}"><span class="pp-dot"></span><div>
      <div class="pp-mod-h">${esc(title)}<span>within ${esc(within)}</span></div>${detail ? `<div class="pp-mod-d">${detail}</div>` : ''}</div></div>`
  const up = (s) => String(s ?? '').toUpperCase()
  const rows = []
  const a = m.armor
  rows.push(row(!!a, 'Shoreline armor', a
    ? `About ${ft(a.lengthFt)} of bulkhead, riprap, or other hard armor along this parcel (${a.n} mapped ${a.n === 1 ? 'segment' : 'segments'}, nearest ${ft(a.distFt)}).`
    : 'No mapped armor along the parcel line.', `${D.armorFt} ft of the parcel line`))
  const docks = m.docks ?? []
  rows.push(row(docks.length > 0, docks.length === 1 ? 'Dock' : `Docks (${docks.length})`, docks.length
    ? docks.map((k) => {
      const bits = [MATERIAL[up(k.material)] ? `${MATERIAL[up(k.material)]} deck` : '', MATERIAL[up(k.floatMaterial)] ? `${MATERIAL[up(k.floatMaterial)]} float` : '', CONDITION[up(k.condition)] ? `condition ${CONDITION[up(k.condition)]}` : ''].filter(Boolean).join(', ')
      return `<div>${ft(k.distFt)} away${bits ? ` &mdash; ${esc(bits)}` : ''} ${k.creosote ? chip('creosote', 'warn') : ''}${k.grating ? chip('grated', 'on') : ''}</div>`
    }).join('')
    : 'No mapped dock nearby.', `${D.structureFt} ft`))
  const simple = (key, title, noun) => {
    const x = m[key]
    rows.push(row(!!x, title, x ? `${x.n} mapped ${x.n === 1 ? noun : noun + 's'}, nearest ${ft(x.distFt)}.` : `No mapped ${noun} nearby.`, `${D.structureFt} ft`))
  }
  simple('groins', 'Groins', 'groin')
  simple('ramps', 'Improved boat ramps', 'ramp')
  simple('railways', 'Marine railways', 'railway')
  const pl = m.pilings
  rows.push(row(!!pl, 'Pilings', pl ? `${pl.count || pl.n} ${pl.count === 1 ? 'piling' : 'pilings'} not tied to a dock, nearest ${ft(pl.distFt)}. ${pl.creosote ? chip('creosote', 'warn') : ''}` : 'No mapped stand-alone pilings nearby.', `${D.structureFt} ft`))
  const b = m.buoys
  rows.push(row(!!b, 'Mooring buoys & floats', b
    ? `${b.n} mapped (${Object.entries(b.types).map(([t, n]) => `${n} ${BUOY[t] ?? 'moorage'}${n === 1 ? '' : 's'}`).join(', ')}), nearest ${ft(b.distFt)}.`
    : 'No mapped moorage nearby.', `${D.buoyFt} ft`))
  const any = !!(a || docks.length || m.groins || m.ramps || m.railways || pl || b)
  const cta = any
    ? `<div class="fp-block fp-act"><div class="fp-k">Friends can help</div><div class="fp-text">Friends of the San Juans offers free site visits and technical assistance to remove failing armor, soften banks, and upgrade docks, floats, and moorings to shore-friendly designs.</div>
        <a class="fp-btn" href="${SITE_VISIT_URL}" target="_blank" rel="noopener noreferrer">Sign up for a site visit</a> <a class="fp-btn fp-btn-quiet" href="${ARMOR_WEBINAR_URL}" target="_blank" rel="noopener noreferrer">Armor research webinar &#8599;</a></div>`
    : `<div class="fp-block fp-act"><div class="fp-k">Keeping it that way</div><div class="fp-text">Planning a dock, mooring, or bank work? Friends offers free site visits to help design it around the habitat.</div>
        <a class="fp-btn" href="${SITE_VISIT_URL}" target="_blank" rel="noopener noreferrer">Sign up for a site visit</a></div>`
  return card(`${heading('Shoreline Modifications')}
    <p class="pp-para pp-muted">Human-made structures from Friends of the San Juans field surveys (2009, updated 2019): armor within ${D.armorFt} ft of the parcel line; docks, groins, ramps, railways, and pilings within ${D.structureFt} ft; mooring buoys and floats within ${D.buoyFt} ft.</p>
    ${rows.join('')}`) + cta
}

// ─── Vegetation: greenery & tree cover (NAIP NDVI, island percentile) ─────────
function greeneryCard(gr, isWaterfront, extraHtml = '') {
  const { mean, stdDev, water, bare, sparse, moderate, dense, veryDense } = gr
  const pct = gr.pct ?? null
  // The assessor tax area ("SAN JUAN") in title case, as SSE's island index names it
  const islandName = gr.island ? String(gr.island).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : ''
  const scoreColor = pct != null
    ? (pct < 15 ? '#d73027' : pct < 30 ? '#fc8d59' : pct < 50 ? '#fee08b' : pct < 70 ? '#d9ef8b' : pct < 85 ? '#66bd63' : '#1a9850')
    : (mean < 0.1 ? '#d73027' : mean < 0.25 ? '#fc8d59' : mean < 0.4 ? '#fee08b' : mean < 0.55 ? '#d9ef8b' : mean < 0.7 ? '#66bd63' : '#1a9850')
  let rating, description
  const isl = esc(islandName)
  if (pct != null && islandName) {
    if (pct < 10) { rating = 'Well Below Average'; description = `This property has less vegetation than most on ${isl}. Most of the land is buildings, pavement, or bare ground. Adding native plants could help absorb rainwater and support local wildlife.` }
    else if (pct < 25) { rating = 'Below Average'; description = `This property has less greenery than about three-quarters of properties on ${isl}. There is room to add native plants that would help absorb rainwater and create habitat.` }
    else if (pct < 50) { rating = 'Average'; description = `This property has a typical amount of vegetation for ${isl}. The existing greenery helps absorb some rainwater and provides basic habitat.` }
    else if (pct < 75) { rating = 'Above Average'; description = `This property is greener than most on ${isl}. The vegetation helps keep rainwater out of the storm drains and provides habitat for birds and pollinators.` }
    else if (pct < 90) { rating = 'Well Above Average'; description = `This property has more tree and plant cover than the vast majority on ${isl}. The canopy significantly reduces runoff and creates valuable wildlife corridors.` }
    else { rating = 'Among the Greenest'; description = `This property is one of the most heavily vegetated on ${isl}. Mature forests like this are the best natural protection against erosion and flooding.` }
    if (isWaterfront && pct < 30) description += ' On waterfront properties, adding native shoreline plantings can reduce polluted runoff reaching the water.'
  } else if (mean < 0.15) { rating = 'Low'; description = 'This property has very little tree or plant cover.' }
  else if (mean < 0.35) { rating = 'Moderate'; description = 'This property has a mix of developed and green areas.' }
  else if (mean < 0.55) { rating = 'Good'; description = 'This property has solid tree and plant coverage.' }
  else { rating = 'Excellent'; description = 'This property has dense, healthy vegetation.' }

  const display = pct != null ? String(pct) : String(Math.max(0, Math.min(100, Math.round(((mean + 0.1) / 0.9) * 100))))
  const subtitle = pct != null ? `Greener than ${pct}% on ${isl}` : 'Greenery Score (out of 100)'
  const circle = `<div class="pp-green"><div class="pp-ring" style="border-color:${scoreColor}"><b>${display}${pct != null ? '<small>%</small>' : ''}</b></div>
    <div><div class="pp-green-r">${esc(rating)}</div><div class="pp-green-s">${subtitle}</div></div></div>`
  let bar = ''
  if (pct != null && islandName) {
    bar = `<div class="pp-cmp"><div class="pp-cmp-bar"><span style="left:${Math.max(2, Math.min(98, pct))}%"></span></div>
      <div class="pp-cmp-ends"><span>Least green on ${isl}</span><span>Most green</span></div>
      <div class="pp-cmp-n">Compared to ${Number(gr.n).toLocaleString('en-US')} properties on ${isl}</div></div>`
  }
  // Class breaks are calibrated to the October 2023 NAIP scene against NLCD land cover (greenery-stats.py)
  const classes = [
    { label: 'Water', pct: water, color: '#3B82F6' }, { label: 'Bare / Paved', pct: bare, color: '#d73027' },
    { label: 'Grass, pasture, lawn', pct: sparse, color: '#fc8d59' }, { label: 'Shrubs / open woodland', pct: moderate, color: '#a3d977' },
    { label: 'Tree canopy', pct: dense, color: '#66bd63' }, { label: 'Dense forest', pct: veryDense, color: '#006837' },
  ].filter((c) => c.pct >= 1)
  const breakdown = classes.length ? `<div class="pp-cover"><div class="pp-cover-h">What covers this property</div>
      <div class="pp-cover-bar">${classes.map((c) => `<div style="width:${c.pct}%;background:${c.color}" title="${c.label}: ${Math.round(c.pct)}%"></div>`).join('')}</div>
      ${classes.map((c) => `<div class="pp-cover-row"><span style="background:${c.color}"></span><span>${c.label}</span><b>${Math.round(c.pct)}%</b></div>`).join('')}</div>` : ''
  const variability = stdDev > 0.15 ? '<p class="pp-para">This property has a mix of open and heavily vegetated areas.</p>' : ''
  return card(`${heading('Greenery & Tree Cover')}${circle}<p class="pp-para">${description}</p>${extraHtml}${bar}${breakdown}${variability}`)
}

// ─── Property tab ─────────────────────────────────────────────────────────────
function propertyTab(p, ad, bl) {
  const address = ad?.[0]?.FULLADDR
  const fields = extractFields(p, PARCEL_FIELDS)
  const table = `<table class="pp-table"><tr><td>Address</td><td>${address ? esc(address) : '<i class="pp-muted">No address on file with the county</i>'}</td></tr>
    ${fields.map((f) => `<tr><td>${esc(f.label)}</td><td>${esc(f.value)}</td></tr>`).join('')}</table>`
  let buildings
  if (!bl.length) {
    buildings = card('<div class="pp-bigstat"><b>0</b><span>Buildings on this property</span></div><p class="pp-muted pp-center">No building footprints were found within this parcel boundary.</p>')
  } else {
    const total = Math.round(bl.reduce((s, b) => s + (Number(b.Sq_Ft) || 0), 0))
    const rows = bl.map((b, i) => {
      const d = []
      if (b.Sq_Ft) d.push(`<b>${Math.round(b.Sq_Ft).toLocaleString('en-US')} sq ft</b>`)
      if (b.ADDRESS) d.push(esc(b.ADDRESS))
      if (b.Discriptio) d.push(esc(b.Discriptio))
      if (b.Source) d.push(`<span class="pp-muted">Source: ${esc(b.Source)}</span>`)
      return `<div class="pp-bldg"><div class="pp-bldg-h">Building ${i + 1}</div><div>${d.join(' &middot; ')}</div></div>`
    }).join('')
    buildings = card(`<div class="pp-bigstats"><div class="pp-bigstat"><b>${bl.length}</b><span>${bl.length === 1 ? 'Building' : 'Buildings'}</span></div>
      ${total > 0 ? `<div class="pp-bigstat"><b>${total.toLocaleString('en-US')}</b><span>Total Sq Ft</span></div>` : ''}</div>${rows}`)
  }
  return card(table) + buildings
}

// ─── Wildlife ─────────────────────────────────────────────────────────────────
function whaleLink(lat, lng, name) {
  const url = `https://earthatlas.org/whales?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&name=${encodeURIComponent(name)}&z=12`
  return `<div class="fp-block fp-story"><div class="fp-k">Whales &amp; marine mammals</div><div class="fp-text">Recent orca, humpback, porpoise, and seal sightings around this shoreline are mapped on EarthAtlas, centered on this parcel.</div>
    <a class="fp-btn" href="${url}" target="_blank" rel="noopener noreferrer">See sightings near here &#8599;</a></div>`
}
// eBird takes whole kilometers; SSE's 1 / 5 / 10 / 20 mile choices
const BIRD_RADII = [{ miles: 1, km: 2 }, { miles: 5, km: 8 }, { miles: 10, km: 16 }, { miles: 20, km: 32 }]
const BIRD_PERIODS = [{ value: 1, label: 'Today' }, { value: 7, label: 'Past Week' }, { value: 30, label: 'Past 30 Days' }]
async function fetchBirds(lat, lng, back, km) {
  const r = await fetch(`/api/ebird?op=obsRecent&lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&dist=${km}&back=${back}&maxResults=10000`)
  if (!r.ok) throw new Error(`eBird ${r.status}`)
  const obs = await r.json()
  if (!Array.isArray(obs)) throw new Error('eBird unavailable')
  // One row per species, counts summed (howMany defaults to 1); most first, then by name
  const by = new Map()
  for (const o of obs) {
    const q = o.howMany ?? 1
    const cur = by.get(o.speciesCode)
    if (cur) cur.count += q
    else by.set(o.speciesCode, { speciesCode: o.speciesCode, comName: o.comName, sciName: o.sciName, count: q })
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.comName.localeCompare(b.comName))
}
function birdsHtml(results, back, miles) {
  const sel = (name, opts, cur) => `<select data-pp-bird="${name}">${opts.map((o) => `<option value="${o.v}"${o.v === cur ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`
  const head = `<div class="pp-birds-h"><b>${results.length} species</b><span>${sel('back', BIRD_PERIODS.map((o) => ({ v: o.value, l: o.label })), back)}${sel('miles', BIRD_RADII.map((o) => ({ v: o.miles, l: `${o.miles} mi` })), miles)}</span></div>
    <div class="pp-muted pp-birds-sub">Recent birds reported within a ${miles} mile radius</div>`
  const list = results.length
    ? card(results.map((sp) => `<div class="pp-bird"><div><a href="https://ebird.org/species/${encodeURIComponent(sp.speciesCode)}" target="_blank" rel="noopener noreferrer">${esc(sp.comName)}</a><i>${esc(sp.sciName)}</i></div><b>${sp.count}</b></div>`).join(''), 'pp-flush')
    : muted('No bird observations recorded in this area for the selected period.')
  return `${head}${list}<div class="pp-attr">Data from <a href="https://ebird.org" target="_blank" rel="noopener noreferrer">eBird</a> (Cornell Lab of Ornithology)</div>`
}

// ─── The card ─────────────────────────────────────────────────────────────────
/**
 * The popup's HTML for one parcel. rec: the detail record; at: [lng, lat] (whale link, birds);
 * islandProjects: Friends' projects (loadFriendsProjects()).
 */
export function buildPropertyPopupHtml(fid, rec, at, allProjects = []) {
  const p = rec.p || {}, ad = rec.ad || null, bl = rec.bl || [], gr = rec.gr || null
  const v = nearshore(rec.ns)
  const shore = isShorelineParcel(p, v)
  const island = islandOfParcel(p, ad)
  const address = ad?.[0]?.FULLADDR
  const tabs = shore ? TABS : TABS.filter(([id]) => !['shoreline', 'fish', 'mods'].includes(id))

  const summaryCards = []
  if (!shore) summaryCards.push(...inlandCards(v, gr, island, projectsOnIsland(island, allProjects)))
  else if (v.shoreform) summaryCards.push(shoreformCard(v.shoreform))
  else if (v.fish?.segment?.geoUnit) summaryCards.push(shorelineDescriptionCard(v.fish.segment))
  if (shore) summaryCards.push(nearshoreEcologyCard(v))

  const panels = {
    summary: `<div class="pp-two">${atAGlance(p, bl, ad)}<div class="pp-mini" data-pp-mini><span class="pp-muted">Loading map…</span></div></div>${summaryCards.join('')}`,
    shoreline: (v.shoreform ? shoreformCard(v.shoreform) : '') + vegetationHtml(v, 'veg'),
    fish: fishTab(v),
    wildlife: `${whaleLink(at[1], at[0], address || `Parcel ${p.PIN ?? ''}`.trim())}<div data-pp-birds>${muted('<i>Loading bird observations…</i>')}</div>`,
    mods: modsTab(v),
    vegetation: gr ? greeneryCard(gr, Number(p.WF_LGTH) > 0) : card(`${heading('Greenery & Tree Cover')}<p class="pp-muted">No vegetation index is available for this parcel yet.</p>`),
    property: propertyTab(p, ad, bl),
  }
  const body = `<div class="pp-tabs" role="tablist">${tabs.map(([id, name], i) => `<button type="button" role="tab" class="pp-tab${i === 0 ? ' on' : ''}" data-pp-tab="${id}">${name}</button>`).join('')}</div>
    ${tabs.map(([id], i) => `<div class="pp-panel" data-pp-panel="${id}"${i === 0 ? '' : ' hidden'}>${panels[id]}</div>`).join('')}`

  const acres = Number(p.Acres || p.Legal_Acre) || 0, wf = Number(p.WF_LGTH) || 0
  const stats = []
  if (acres > 0) stats.push({ value: acres >= 10 ? Math.round(acres).toLocaleString('en-US') : acres.toFixed(acres >= 1 ? 1 : 2), unit: 'ac', label: 'Parcel' })
  if (wf > 0) stats.push({ value: Math.round(wf).toLocaleString('en-US'), unit: 'ft', label: 'Waterfront' })
  const html = buildPopupCard({
    accent: ACCENT, layerName: 'Properties', swatch: 'fill', swatchColor: 'rgba(249,115,22,0.25)',
    title: address || (p.PIN ? `Parcel ${p.PIN}` : 'Property report'),
    subtitle: [p.PIN ? `PIN ${p.PIN}` : '', 'Property report'].filter(Boolean).join(' · '),
    stats, chips: shore ? livingShorelineChips(v) : [], body,
    source: { credit: TAB_SOURCES.summary, url: PARCEL_SOURCE }, friends: true,
  })
  return html.replace('class="fp"', `class="fp pp" data-pp-fid="${esc(fid)}"`)
}

/**
 * Wire an open property popup: tab switching (the footer credit follows the tab), the birds list, and the mini-map.
 * bbox: the parcel's [w, s, e, n] from the main map's tiles. Returns a cleanup function (removes the mini-map).
 */
export function mountPropertyPopup(root, { at, bbox, fid }) {
  const el = root.querySelector('.pp')
  if (!el) return () => {}
  const src = el.querySelector('.fp-src')
  el.querySelectorAll('[data-pp-tab]').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.dataset.ppTab
    el.querySelectorAll('[data-pp-tab]').forEach((b) => b.classList.toggle('on', b === btn))
    el.querySelectorAll('[data-pp-panel]').forEach((pn) => { pn.hidden = pn.dataset.ppPanel !== id })
    if (src) src.innerHTML = `Source: <a href="${PARCEL_SOURCE}" target="_blank" rel="noopener noreferrer">${esc(TAB_SOURCES[id])} &#8599;</a>`
    if (id === 'summary') mini?.resize()
  }))

  // Birds (SSE: 30 days, 5 miles to start)
  const birdsEl = el.querySelector('[data-pp-birds]')
  const loadBirds = (back, miles) => {
    const km = BIRD_RADII.find((o) => o.miles === miles)?.km ?? 8
    fetchBirds(at[1], at[0], back, km)
      .then((res) => { if (birdsEl.isConnected) birdsEl.innerHTML = birdsHtml(res, back, miles) })
      .catch(() => { if (birdsEl.isConnected) birdsEl.innerHTML = muted('Unable to load bird observations. Check your connection and try again.') })
  }
  birdsEl?.addEventListener('change', (e) => {
    const s = e.target.closest?.('[data-pp-bird]')
    if (!s) return
    const back = Number(birdsEl.querySelector('[data-pp-bird="back"]').value), miles = Number(birdsEl.querySelector('[data-pp-bird="miles"]').value)
    birdsEl.innerHTML = muted('<i>Loading bird observations…</i>')
    loadBirds(back, miles)
  })
  if (birdsEl) loadBirds(30, 5)

  // Mini-map: the parcel (orange, as the selection on the main map) and its buildings over satellite
  let mini = null
  const box = el.querySelector('[data-pp-mini]')
  if (box && bbox) {
    box.innerHTML = ''
    mini = new mapboxgl.Map({
      container: box, style: MINI_STYLE, bounds: bbox, fitBoundsOptions: { padding: 20, maxZoom: 19 },
      interactive: false, attributionControl: false,
    })
    mini.addControl(new mapboxgl.AttributionControl({ compact: true }))
    mini.on('load', () => {
      mini.addSource('pp', { type: 'vector', tiles: [`${window.location.origin}/api/parcel-tiles?r=shoreline-sjc&v=${PARCELS.version}&z={z}&x={x}&y={y}`], minzoom: 12, maxzoom: 15 })
      const mine = ['==', ['get', 'fid'], Number(fid)]
      mini.addLayer({ id: 'pp-b', type: 'fill', source: 'pp', 'source-layer': 'buildings', paint: { 'fill-color': '#60A5FA', 'fill-opacity': 0.7, 'fill-outline-color': '#1E3A5F' } })
      mini.addLayer({ id: 'pp-f', type: 'fill', source: 'pp', 'source-layer': 'parcels', filter: mine, paint: { 'fill-color': ACCENT, 'fill-opacity': 0.25 } })
      mini.addLayer({ id: 'pp-l', type: 'line', source: 'pp', 'source-layer': 'parcels', filter: mine, paint: { 'line-color': ACCENT, 'line-width': 4 } })
      // The main map may have held only part of a big parcel: refit once the mini-map has all of it
      mini.once('idle', () => {
        const all = parcelBbox(mini.querySourceFeatures('pp', { sourceLayer: 'parcels', filter: mine }))
        if (all && (all[0] < bbox[0] || all[1] < bbox[1] || all[2] > bbox[2] || all[3] > bbox[3])) mini.fitBounds(all, { padding: 20, maxZoom: 19, duration: 0 })
      })
    })
  } else if (box) {
    box.innerHTML = '<span class="pp-muted">Map unavailable</span>'
  }
  return () => { mini?.remove(); mini = null }
}

/** [w, s, e, n] around tile pieces of one parcel, or null. */
export function parcelBbox(feats) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const walk = (c) => {
    if (typeof c[0] === 'number') { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; return }
    for (const x of c) walk(x)
  }
  for (const f of feats) if (f.geometry?.coordinates) walk(f.geometry.coordinates)
  return Number.isFinite(w) ? [w, s, e, n] : null
}
