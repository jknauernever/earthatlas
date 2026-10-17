/**
 * SalishSea.io (https://salishsea.io): the read-path day files its build
 * rewrites every five minutes, one per Pacific day, at
 *   /read-path/days/YYYY-MM-DD.json   (a missing file = no sightings, once the
 *   manifest's covered_through has reached that day)
 *
 * Kept: SalishSea.io's own submissions ("direct"), Orcasound hydrophone
 * detections (kind 'acoustic'), and its copies of Maplify records — which carry
 * SalishSea.io's curated species, channel and observer and so enrich the
 * maplify:<id> sighting. Skipped: its iNaturalist rows (the iNaturalist feed is
 * canonical for those and applies iNat's license rules).
 *
 * Licenses (docs/ACARTIA.md): Maplify-derived CC BY 4.0; native CC BY-NC 4.0.
 */
import { fetchJson } from '../http.js'
import { makeNorm, stripHtml, toInt, toNum, daysBetween, isoUtc } from '../norm.js'

export const FEED = 'salishsea'
const BASE = 'https://salishsea.io/read-path'

export function keyFor(id) {
  if (id.startsWith('inaturalist:')) return null
  if (id.startsWith('maplify:')) return id
  if (id.startsWith('orcasound:')) return id
  return `salishsea:${id}`
}

export function normalizeRow(row, day) {
  const key = keyFor(row.id)
  if (!key) return null
  const lat = toNum(row.location?.lat)
  const lon = toNum(row.location?.lon)
  if (lat === null || lon === null) return null
  const isMaplify = key.startsWith('maplify:')
  const isAcoustic = key.startsWith('orcasound:')
  const t = row.taxon || {}
  const photo = (row.photos || [])[0] || null
  const observedAt = isoUtc(row.observed_at)
  const norm = makeNorm({
    kind: isAcoustic ? 'acoustic' : 'sighting',
    taxon: t.species_id
      ? { inat_id: t.species_id, scientific: t.scientific_name, common: t.vernacular_name }
      : { raw_name: t.vernacular_name || '', raw_scientific: t.scientific_name || '' },
    raw_name: t.vernacular_name || t.scientific_name || null,
    observed_at: observedAt,
    observed_date: (observedAt || day).slice(0, 10),
    time_precision: observedAt ? 'exact' : 'day',
    lat, lon,
    accuracy_m: toInt(row.accuracy),
    count_min: toInt(row.count),
    count_max: toInt(row.count),
    channel: row.collection || null,
    organization: row.organization || null,
    organization_url: row.organization_url || null,
    observer: row.observer || null,
    attribution: row.attribution || null,
    url: row.source_url || row.url || null,
    license: isMaplify ? 'CC-BY-4.0' : isAcoustic ? null : 'CC-BY-NC-4.0',
    photo_url: photo?.src || null,
    photo_thumb_url: photo?.thumb || null,
    photo_license: photo?.license || null,
    photo_attribution: photo?.attribution || null,
    individual_label: (row.identifiers || []).join(', ') || null,
    remarks: stripHtml(row.body),
  })
  return { feed: FEED, feed_id: row.id, key, feed_day: day, norm, raw: row }
}

/** Day files from..to. Days past the manifest's covered_through are not reported as covered. */
export async function fetchWindow(from, to, { log = () => {} } = {}) {
  const manifest = await fetchJson(`${BASE}/manifest.json`)
  const covered = manifest?.covered_through || '0000-00-00'
  const records = []
  const coveredDays = []
  for (const day of daysBetween(from, to)) {
    const rows = await fetchJson(`${BASE}/days/${day}.json`, { allow404: true })
    if (rows === null) {
      if (day <= covered) coveredDays.push(day)
      continue
    }
    coveredDays.push(day)
    for (const row of rows) {
      const r = normalizeRow(row, day)
      if (r) records.push(r)
    }
  }
  log(`  salishsea: ${records.length} records over ${coveredDays.length} covered days (covered through ${covered})`)
  return { records, coveredDays }
}
