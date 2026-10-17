/**
 * The normalized record every feed produces, and small shared helpers.
 *
 * A feed record is { feed, feed_id, key, feed_day, norm, raw }:
 *   key       canonical sighting key, shared across feeds for the same upstream
 *             record (maplify:<id>, inat:<id>, hw:<id>, obis:<id>, salishsea:<uuid>, orcasound:<id>)
 *   feed_day  the day the feed itself files the record under (what a window query asks for)
 *   norm      NORM_FIELDS below
 *   raw       the upstream payload (trimmed where large)
 */
export const NORM_FIELDS = [
  'kind', 'taxon', 'raw_name', 'observed_at', 'observed_date', 'time_precision', 'lat', 'lon',
  'accuracy_m', 'obscured', 'count_min', 'count_max', 'channel', 'organization', 'organization_url',
  'observer', 'attribution', 'url', 'license', 'photo_url', 'photo_thumb_url', 'photo_license',
  'photo_attribution', 'individual_id', 'individual_label', 'remarks', 'trusted', 'test', 'occurrence_id',
]

export function makeNorm(fields) {
  const n = {}
  for (const f of NORM_FIELDS) n[f] = fields[f] ?? null
  n.kind = n.kind || 'sighting'
  n.obscured = !!n.obscured
  n.test = !!n.test
  return n
}

export function stripHtml(s) {
  if (!s) return null
  const t = String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return t || null
}

export function toInt(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}

export function toNum(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 'YYYY-MM-DD' list from..to inclusive. */
export function daysBetween(from, to) {
  const out = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
}

export function isoUtc(s) {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}
