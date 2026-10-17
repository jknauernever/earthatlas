/**
 * iNaturalist, worldwide, whales/dolphins/porpoises (Cetacea, taxon 152871).
 *
 * iNaturalist's rules, followed here (Josh 2026-10-17):
 * - only observations the observer licensed (cc0 / cc-by*); all-rights-reserved ones are never fetched;
 * - photos only when the photo itself carries a license;
 * - obscured / private locations stay obscured (flagged, with iNat's accuracy);
 * - deleted or re-licensed observations disappear: the hourly window re-check marks
 *   missing ones removed (the deleted-observations endpoint needs a login);
 * - ≤ 1 request/second, with a User-Agent that names us (lib/whales/http.js).
 * Casual-grade (captive, no date/place) observations are skipped.
 */
import { fetchJson } from '../http.js'
import { makeNorm, toInt, toNum, daysBetween, isoUtc } from '../norm.js'
import { CETACEA, INAT_NAMES } from '../taxa.js'

export const FEED = 'inaturalist'
const API = 'https://api.inaturalist.org/v1/observations'
export const LICENSES = 'cc0,cc-by,cc-by-nc,cc-by-sa,cc-by-nd,cc-by-nc-sa,cc-by-nc-nd'

const LICENSE_LABEL = {
  cc0: 'CC0-1.0', 'cc-by': 'CC-BY-4.0', 'cc-by-nc': 'CC-BY-NC-4.0', 'cc-by-sa': 'CC-BY-SA-4.0',
  'cc-by-nd': 'CC-BY-ND-4.0', 'cc-by-nc-sa': 'CC-BY-NC-SA-4.0', 'cc-by-nc-nd': 'CC-BY-NC-ND-4.0',
}

/** The fields we keep of an observation (the full payload is ~10 KB). */
export function trim(o) {
  return {
    id: o.id, uri: o.uri, observed_on: o.observed_on, time_observed_at: o.time_observed_at,
    created_at: o.created_at, updated_at: o.updated_at, quality_grade: o.quality_grade,
    license_code: o.license_code, geoprivacy: o.geoprivacy, obscured: o.obscured,
    positional_accuracy: o.positional_accuracy, geojson: o.geojson, place_guess: o.place_guess,
    description: o.description,
    taxon: o.taxon && { id: o.taxon.id, name: o.taxon.name, rank: o.taxon.rank, preferred_common_name: o.taxon.preferred_common_name, ancestor_ids: o.taxon.ancestor_ids },
    user: o.user && { login: o.user.login, name: o.user.name },
    photos: (o.photos || []).slice(0, 1).map((p) => ({ id: p.id, url: p.url, license_code: p.license_code, attribution: p.attribution })),
  }
}

export function normalizeObservation(o) {
  if (!o.license_code || !o.taxon || !o.observed_on) return null
  const [lon, lat] = (o.geojson?.coordinates || []).map(toNum)
  if (lat === null || lat === undefined || lon === null || lon === undefined) return null
  const observedAt = isoUtc(o.time_observed_at)
  const photo = (o.photos || []).find((p) => p.license_code)
  const who = o.user?.name || o.user?.login || null
  const anc = (o.taxon.ancestor_ids || []).filter((x) => x !== o.taxon.id)
  const norm = makeNorm({
    taxon: { inat_id: o.taxon.id, scientific: o.taxon.name, common: o.taxon.preferred_common_name || null, rank: o.taxon.rank, ancestors: anc },
    raw_name: o.taxon.preferred_common_name || o.taxon.name,
    observed_at: observedAt,
    observed_date: o.observed_on,
    time_precision: observedAt ? 'exact' : 'day',
    lat, lon,
    accuracy_m: toInt(o.positional_accuracy),
    obscured: !!o.obscured || o.geoprivacy === 'obscured' || o.geoprivacy === 'private',
    channel: 'iNaturalist',
    organization: 'iNaturalist',
    organization_url: 'https://www.inaturalist.org',
    observer: who,
    attribution: who ? `${who} on iNaturalist` : 'iNaturalist',
    url: o.uri || `https://www.inaturalist.org/observations/${o.id}`,
    license: LICENSE_LABEL[o.license_code] || o.license_code,
    photo_url: photo ? photo.url.replace('/square.', '/medium.') : null,
    photo_thumb_url: photo ? photo.url : null,
    photo_license: photo ? LICENSE_LABEL[photo.license_code] || photo.license_code : null,
    photo_attribution: photo?.attribution || null,
    remarks: o.description || null,
  })
  return { feed: FEED, feed_id: String(o.id), key: `inat:${o.id}`, feed_day: o.observed_on, norm, raw: trim(o) }
}

async function pages(params, log, label) {
  const out = []
  let above = 0
  for (let guard = 0; guard < 500; guard++) {
    const qs = new URLSearchParams({
      taxon_id: String(CETACEA), quality_grade: 'research,needs_id', license: LICENSES,
      per_page: '200', order_by: 'id', order: 'asc', id_above: String(above), ...params,
    })
    const j = await fetchJson(`${API}?${qs}&${INAT_NAMES}`)
    const list = j.results || []
    out.push(...list)
    if (list.length < 200) break
    above = list.at(-1).id
  }
  log(`  inaturalist: ${out.length} observations (${label})`)
  return out
}

/** Observations observed in from..to (removal-eligible window). */
export async function fetchWindow(from, to, { log = () => {} } = {}) {
  const list = await pages({ d1: from, d2: to }, log, `observed ${from}…${to}`)
  return { records: list.map(normalizeObservation).filter(Boolean), coveredDays: daysBetween(from, to) }
}

/** Observations uploaded since `since` (any observed date) — late uploads. Never used for removal. */
export async function fetchCreatedSince(since, { log = () => {} } = {}) {
  const list = await pages({ created_d1: since }, log, `created since ${since}`)
  return { records: list.map(normalizeObservation).filter(Boolean), coveredDays: [] }
}
