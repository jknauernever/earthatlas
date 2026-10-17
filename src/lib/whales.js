/**
 * Client helper for /api/whales — our own whale-sightings database
 * (docs/WHALES_DB.md). Every site fetches whales through this, never the
 * upstream sources.
 *
 * Areas are snapped outward to the same grid the Explore pages use
 * (src/explore/wildQuery.js quantizeBounds), so nearby visitors share
 * edge-cache entries; callers filter the held rows to their exact view.
 */
import { quantizeBounds } from '../explore/wildQuery.js'
import { WHALE_SOURCES } from '../../lib/whales/sources.js'

/**
 * @param {object} o
 * @param {{minLat,maxLat,minLng,maxLng}} [o.bounds]  omit (with a taxon) for worldwide
 * @param {string} [o.from]   YYYY-MM-DD (default: server's last 30 days)
 * @param {string} [o.to]     YYYY-MM-DD
 * @param {number} [o.taxon]  iNaturalist taxon id; includes everything below it
 * @param {string[]} [o.exclude]  origins the caller already shows (e.g. ['inaturalist','happywhale'])
 * @param {string} [o.group]  'cetacean' (default) | 'all' | comma list
 * @param {number} [o.limit]
 * @returns {Promise<{count,total,truncated,sources,updated,sightings}>}
 */
export async function fetchWhales({ bounds, from, to, taxon, exclude, group, limit, signal } = {}) {
  const sp = new URLSearchParams()
  if (bounds) {
    const b = quantizeBounds(bounds)
    sp.set('bbox', [b.minLng, b.minLat, b.maxLng, b.maxLat].join(','))
  }
  if (from) sp.set('from', from)
  if (to) sp.set('to', to)
  if (taxon) sp.set('taxon', String(taxon))
  if (group) sp.set('group', group)
  if (exclude?.length) sp.set('exclude', [...exclude].sort().join(','))
  if (limit) sp.set('limit', String(limit))
  const r = await fetch(`/api/whales?${sp}`, { signal })
  if (!r.ok) throw new Error(`whales: HTTP ${r.status}`)
  return r.json()
}

// ─── Showing whale-database sightings on a page ─────────────────────────────
// Rule (Josh 2026-10-17): every whale report we know about, each one once.
// A page that also loads iNaturalist / HappyWhale / GBIF itself drops ITS copy
// of any report the whale database has (matched by record id), because the
// database's copy carries the full credit; everything else is added.

export { WHALE_SOURCES }

export const whaleSourceLabel = (s) => WHALE_SOURCES[s.source]?.label || s.source

// 'CC-BY-NC-4.0' → 'CC BY-NC 4.0', 'CC0-1.0' → 'CC0 1.0'; anything else as given.
const LICENSE_TEXT = (l) => {
  if (!l) return null
  const m = /^CC(0)?-?(.*?)-?(\d\.\d)$/.exec(String(l))
  if (!m) return String(l)
  return m[1] ? `CC0 ${m[3]}` : `CC ${m[2]} ${m[3]}`
}

/** One-line inline credit, e.g. "Orca Network via Whale Alert · CC BY 4.0". */
export function whaleCredit(s) {
  const src = whaleSourceLabel(s)
  // "Orca Network via Whale Alert"; a channel that already names its source ("SalishSea.io Direct") stands alone.
  const via = !s.channel || s.channel === src ? src : s.channel.includes(src) ? s.channel : `${s.channel} via ${src}`
  return [via, LICENSE_TEXT(s.license)].filter(Boolean).join(' · ')
}

/** Display name: the iNat common name, else what the source called it. */
export function whaleName(s) {
  const t = s.taxon || {}
  if (t.common) return t.common
  if (t.scientific) return t.scientific
  const r = String(t.reported_as || '').replace(/_/g, ' ').trim()
  return r && !/^(unspecified|unknown|other)$/i.test(r) ? r : 'Unidentified whale'
}

/** Ids the whale database already covers, for dropping a page's own copies. */
export function whaleIndex(sightings = []) {
  const inat = new Set()
  const hw = new Set()
  const occ = new Set()
  for (const s of sightings) {
    const id = String(s.id || '')
    if (id.startsWith('inat:')) inat.add(id.slice(5))
    else if (id.startsWith('hw:')) { hw.add(id.slice(3)); occ.add(id.slice(3)) }
    if (s.occurrence_id) occ.add(String(s.occurrence_id))
  }
  return { inat, hw, occ }
}

/** Is this page row a copy of a report the whale database already has? (iNat / HappyWhale / GBIF row shapes) */
export function isWhaleDuplicate(row, idx) {
  if (!idx) return false
  const src = row.source
  if (!src || src === 'iNaturalist') return idx.inat.has(String(row.id).replace(/^inat-/, ''))
  if (src === 'HappyWhale') return idx.hw.has(String(row.hw?.encounterId ?? String(row.id).replace(/^hw-/, '')))
  if (src === 'GBIF') return !!row.occurrenceID && idx.occ.has(String(row.occurrenceID))
  return false
}

const ICONIC = { cetacean: 'Mammalia', pinniped: 'Mammalia', sirenian: 'Mammalia', otter: 'Mammalia', sea_turtle: 'Reptilia' }

function hwFrom(s) {
  if (s.source !== 'happywhale') return null
  const [primaryId, nickname] = String(s.individual?.label || '').split(' · ')
  return {
    encounterId: Number(String(s.id).slice(3)),
    speciesKey: s.taxon?.reported_as || null,
    individual: s.individual?.id ? { id: Number(s.individual.id), primaryId: primaryId || null, nickname: nickname || null } : null,
  }
}

/** API sighting → the main search's iNaturalist-like row (src/App.jsx). */
export function whaleToRow(s) {
  const t = s.taxon || {}
  return {
    id: `wdb-${s.id}`,
    source: whaleSourceLabel(s),
    whale: s,
    geojson: { coordinates: [s.lng, s.lat] },
    observed_on: s.observed_date,
    time_observed_at: s.observed_at,
    place_guess: null,
    taxon: { id: t.id, name: t.scientific || '', preferred_common_name: whaleName(s), iconic_taxon_name: ICONIC[t.group] || null },
    photos: s.photo ? [{ url: s.photo.url || s.photo.thumb }] : [],
    user: s.observer ? { login: s.observer } : null,
    hw: hwFrom(s),
  }
}

/** "View on …" text for a report's link: the site it actually opens (a Whale Alert report links its SalishSea.io page). */
export function whaleLinkLabel(s) {
  if (!s?.url) return null
  let host = ''
  try { host = new URL(s.url).host } catch { return `View on ${whaleSourceLabel(s)}` }
  const site = /salishsea\.io$/.test(host) ? 'SalishSea.io' : /inaturalist\.org$/.test(host) ? 'iNaturalist'
    : /happywhale\.com$/.test(host) ? 'HappyWhale' : /obis\.org$/.test(host) ? 'OBIS' : /orcasound\.net$/.test(host) ? 'Orcasound'
    : /facebook\.com$/.test(host) ? 'Facebook (Orca Network group)' : whaleSourceLabel(s)
  return `View on ${site}`
}

/** Extra fields ExploreMap's popup reads for a whale-database sighting (credit + link). */
export function whalePopupFields(s) {
  const src = WHALE_SOURCES[s.source] || {}
  return {
    whale: s,
    credit: whaleCredit(s),
    url: s.url || src.url || null,
    linkText: s.url ? whaleLinkLabel(s) : `Source: ${whaleSourceLabel(s)}`,
    hw: hwFrom(s),
  }
}

/** Per-source counts for a list of sightings, most first: [{ id, label, url, count }]. */
export function whaleSourceCounts(sightings = []) {
  const n = {}
  for (const s of sightings) n[s.source] = (n[s.source] || 0) + 1
  return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, count, label: WHALE_SOURCES[id]?.label || id, url: WHALE_SOURCES[id]?.url || null }))
}

const CETACEA = 152871
// Cetacea and the taxa above it (life → Animalia → Chordata → Vertebrata → Mammalia → Theria → Artiodactyla → Whippomorpha).
const ABOVE_CETACEA = new Set([48460, 1, 2, 355675, 40151, 848317, 152870, 925158, CETACEA])

/** Should a search for this iNat taxon include whale-database sightings? */
export function taxonMayIncludeWhales(taxon) {
  if (!taxon) return true
  const id = Number(taxon.id)
  if (ABOVE_CETACEA.has(id)) return true
  if (Array.isArray(taxon.ancestorIds) && taxon.ancestorIds.includes(CETACEA)) return true
  // Below Cetacea or a non-whale mammal: ask (the API answers by taxon subtree, edge-cached).
  return taxon.iconicTaxon === 'Mammalia' || !taxon.iconicTaxon
}

// HappyWhale media licence levels → readable text ('C' = the photographer keeps all rights).
const HW_PHOTO_LICENSE = {
  PUBLIC_DOMAIN: 'Public domain', CC_BY: 'CC BY', CC_BY_SA: 'CC BY-SA', CC_BY_ND: 'CC BY-ND', CC_BY_NC: 'CC BY-NC',
  CC_BY_NC_SA: 'CC BY-NC-SA', CC_BY_NC_ND: 'CC BY-NC-ND', C: '©',
}

/**
 * A report's photo with its own credit line, or null:
 *   { url, thumb, credit: 'Photo: Jane Doe · CC BY-NC 4.0', href: link to the original record }
 * Every photo is shown with whoever took it (or the channel it came through) and its licence, inline.
 */
export function whalePhoto(s) {
  const p = s?.photo
  if (!p || !(p.url || p.thumb)) return null
  const lic = p.license
    ? (HW_PHOTO_LICENSE[p.license] || LICENSE_TEXT(String(p.license).replace(/^cc/i, 'CC').replace(/^CC-?0$/i, 'CC0-1.0')) || p.license)
    : null
  // iNaturalist's own attribution already reads "(c) Name, some rights reserved (CC BY-NC)".
  const who = p.attribution
    || (s.source === 'happywhale' ? 'HappyWhale contributor' : s.observer || `${whaleSourceLabel(s)} reporter`)
  const credit = /\(c\)|©/i.test(who) ? `Photo: ${who}` : `Photo: ${lic === '©' || !lic ? `© ${who}` : `${who} · ${lic}`}`
  return { url: p.url || p.thumb, thumb: p.thumb || p.url, credit, href: s.url || null }
}
