/**
 * eaGeoSearch — canonical geo lookup for earthatlas.org sites.
 *
 * Behavioral parity with /forestmonitor's search box: same Mapbox Search Box
 * v1 endpoint, same `types`, same categorization, same zoom presets, same
 * normalized result shape. Sites adopt this module so the geo-search UX
 * stays consistent across earthatlas.org properties.
 *
 * Two transports:
 *   1. Proxy (default) — calls /api/geo/{suggest,retrieve} on the current
 *      origin. The Mapbox token stays server-side. Works from any
 *      earthatlas.org subdomain. To call from a different host (e.g.
 *      envirolink.org), set `endpoint` to "https://earthatlas.org/api/geo".
 *   2. Direct — pass `accessToken` to bypass the proxy and call Mapbox
 *      directly. Use only for local dev without the API routes.
 */

const DEFAULT_ENDPOINT = '/api/geo'
const DEFAULT_TYPES = 'country,region,district,postcode,place,locality,neighborhood,street,address,poi'
const DEFAULT_LIMIT = 8
const MIN_QUERY_LENGTH = 2

export const SEARCH_TYPE_LABELS = {
  country:      'Country',
  region:       'State / Region',
  district:     'District / County',
  postcode:     'ZIP / Postcode',
  place:        'City',
  locality:     'Town',
  neighborhood: 'Neighborhood',
  street:       'Street',
  address:      'Address',
  poi:          'Place',
}

export const SEARCH_ZOOM_BY_TYPE = {
  country:      4,
  region:       6,
  district:     8,
  postcode:    11,
  place:       10,
  locality:    12,
  neighborhood: 14,
  street:      15,
  address:     16,
  poi:         13,
}

const NATURE_POI_RE = /park|forest|nature|reserve|wilderness|garden|mountain|peak|trail/

export function searchCategoryOf(s) {
  const t = s?.feature_type
  if (t === 'poi') {
    const cats = (s.poi_category || []).map((c) => String(c).toLowerCase())
    if (cats.some((c) => NATURE_POI_RE.test(c))) return 'nature'
    return 'poi'
  }
  if (t === 'country' || t === 'region' || t === 'district' || t === 'postcode') return 'region'
  if (t === 'place' || t === 'locality' || t === 'neighborhood') return 'city'
  if (t === 'address' || t === 'street') return 'address'
  return 'pin'
}

export function searchResultMeta(s) {
  return s?.place_formatted || s?.full_address || ''
}

export function searchTypeLabel(s) {
  if (s?.feature_type === 'poi' && s.poi_category?.length) return toTitleCase(s.poi_category[0])
  return SEARCH_TYPE_LABELS[s?.feature_type] || 'Place'
}

export function newSessionToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function buildSuggestUrl({ q, sessionToken, limit, types, proximity, language, endpoint, accessToken }) {
  const params = new URLSearchParams({
    q,
    session_token: sessionToken,
    limit: String(limit),
    types,
  })
  if (proximity) params.set('proximity', proximity)
  if (language) params.set('language', language)
  if (accessToken) {
    params.set('access_token', accessToken)
    return `https://api.mapbox.com/search/searchbox/v1/suggest?${params}`
  }
  return `${endpoint.replace(/\/$/, '')}/suggest?${params}`
}

function buildRetrieveUrl({ id, sessionToken, language, endpoint, accessToken }) {
  const params = new URLSearchParams({ session_token: sessionToken })
  if (language) params.set('language', language)
  if (accessToken) {
    params.set('access_token', accessToken)
    return `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(id)}?${params}`
  }
  params.set('id', id)
  return `${endpoint.replace(/\/$/, '')}/retrieve?${params}`
}

function normalizeProximity(p) {
  if (!p) return ''
  if (Array.isArray(p)) {
    const [lng, lat] = p
    return Number.isFinite(lng) && Number.isFinite(lat) ? `${lng},${lat}` : ''
  }
  if (Number.isFinite(p.lng) && Number.isFinite(p.lat)) return `${p.lng},${p.lat}`
  return ''
}

export async function suggest(query, {
  sessionToken,
  proximity,
  limit = DEFAULT_LIMIT,
  types = DEFAULT_TYPES,
  language,
  endpoint = DEFAULT_ENDPOINT,
  accessToken,
  signal,
} = {}) {
  const q = String(query || '').trim()
  if (q.length < MIN_QUERY_LENGTH) return []
  if (!sessionToken) throw new Error('eaGeoSearch.suggest: sessionToken required')

  const url = buildSuggestUrl({
    q,
    sessionToken,
    limit,
    types,
    proximity: normalizeProximity(proximity),
    language,
    endpoint,
    accessToken,
  })

  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`eaGeoSearch.suggest: HTTP ${res.status}`)
  const data = await res.json()
  return Array.isArray(data.suggestions) ? data.suggestions : []
}

export async function retrieve(suggestion, {
  sessionToken,
  language,
  endpoint = DEFAULT_ENDPOINT,
  accessToken,
  signal,
} = {}) {
  const id = typeof suggestion === 'string' ? suggestion : suggestion?.mapbox_id
  if (!id) throw new Error('eaGeoSearch.retrieve: missing mapbox_id')
  if (!sessionToken) throw new Error('eaGeoSearch.retrieve: sessionToken required')

  const url = buildRetrieveUrl({ id, sessionToken, language, endpoint, accessToken })
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`eaGeoSearch.retrieve: HTTP ${res.status}`)
  const data = await res.json()
  const feature = data.features?.[0]
  if (!feature) return null

  const coords = feature.geometry?.coordinates || []
  const [lng, lat] = coords

  const sugObj = typeof suggestion === 'object' && suggestion ? suggestion : {}
  const props = feature.properties || {}
  const type = sugObj.feature_type || props.feature_type
  const name = props.name || sugObj.name || ''
  const bbox = props.bbox || null

  return {
    id,
    name,
    type,
    category: searchCategoryOf({ feature_type: type, poi_category: sugObj.poi_category || props.poi_category }),
    place_formatted: props.place_formatted || sugObj.place_formatted || '',
    full_address: props.full_address || sugObj.full_address || '',
    lat,
    lng,
    bbox,
    zoom: SEARCH_ZOOM_BY_TYPE[type] ?? 10,
    feature,
    suggestion: sugObj,
  }
}

export function highlightMatch(text, query) {
  const t = String(text || '')
  const q = String(query || '')
  if (!t || !q) return escapeHTML(t)
  const idx = t.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return escapeHTML(t)
  return (
    escapeHTML(t.slice(0, idx)) +
    '<mark>' + escapeHTML(t.slice(idx, idx + q.length)) + '</mark>' +
    escapeHTML(t.slice(idx + q.length))
  )
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c])
}

function toTitleCase(s) {
  return String(s).replace(/(^|[\s_-])(\w)/g, (_, sep, c) => sep + c.toUpperCase())
}

export const SEARCH_ICON_PATHS = {
  nature:  'M12 2C8.13 2 5 5.13 5 9c0 5 7 13 7 13s7-8 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z M12 14l-2 3h4l-2-3z',
  poi:     'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
  region:  'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
  city:    'M15 11V5l-3-3-3 3v2H3v14h18V11h-6zm-8 8H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm6 12h-2v-2h2v2z',
  address: 'M12 2c-4.2 0-8 3.22-8 8.2 0 3.32 2.67 7.25 8 11.8 5.33-4.55 8-8.48 8-11.8C20 5.22 16.2 2 12 2zm0 10c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
  pin:     'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
}

export const DEFAULTS = Object.freeze({
  endpoint: DEFAULT_ENDPOINT,
  types: DEFAULT_TYPES,
  limit: DEFAULT_LIMIT,
  minQueryLength: MIN_QUERY_LENGTH,
  debounceMs: 220,
})
