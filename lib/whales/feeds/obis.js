/**
 * OBIS (https://obis.org), worldwide Cetacea (WoRMS AphiaID 2688) — history only.
 *
 * Kept (Josh 2026-10-17, option B): human sightings only (basisOfRecord
 * HumanObservation) — no acoustic detections, tag tracks or machine records.
 * Dropped: OBIS's copies of HappyWhale and iNaturalist (datasets titled
 * "Happywhale - …" / "iNaturalist …"); we read both directly.
 */
import { fetchJson } from '../http.js'
import { makeNorm, toInt, toNum, daysBetween, isoUtc } from '../norm.js'

export const FEED = 'obis'
const API = 'https://api.obis.org/v3'
const PAGE = 5000

let excluded = null
export async function excludedDatasets() {
  if (excluded) return excluded
  const j = await fetchJson(`${API}/dataset?taxonid=2688&size=5000`)
  excluded = new Set((j.results || []).filter((d) => /happywhale|inaturalist/i.test(d.title || '')).map((d) => d.id))
  return excluded
}

export function normalizeOccurrence(o) {
  if (!/^humanobservation$/i.test(o.basisOfRecord || '')) return null
  const lat = toNum(o.decimalLatitude)
  const lon = toNum(o.decimalLongitude)
  const date = String(o.eventDate || '').slice(0, 10)
  if (lat === null || lon === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const hasTime = /T\d{2}:\d{2}/.test(o.eventDate || '') && !String(o.eventDate).includes('/')
  const observedAt = hasTime ? isoUtc(o.eventDate) : null
  const n = toInt(o.individualCount)
  const ds = o.datasetName || o.dataset_title || 'OBIS dataset'
  const norm = makeNorm({
    taxon: { raw_name: '', raw_scientific: o.scientificName || '' },
    raw_name: o.scientificName || null,
    observed_at: observedAt,
    observed_date: date,
    time_precision: observedAt ? 'exact' : 'day',
    lat, lon,
    accuracy_m: toInt(o.coordinateUncertaintyInMeters),
    count_min: n, count_max: n,
    channel: ds,
    organization: o.institutionCode || null,
    observer: o.recordedBy || null,
    attribution: `${ds} via OBIS`,
    url: o.dataset_id ? `https://obis.org/dataset/${o.dataset_id}` : 'https://obis.org',
    license: o.license || null,
    occurrence_id: o.occurrenceID || null,
  })
  return { feed: FEED, feed_id: o.id, key: `obis:${o.id}`, feed_day: date, norm, raw: o }
}

export async function fetchWindow(from, to, { log = () => {} } = {}) {
  const skip = await excludedDatasets()
  const records = []
  let after = null
  let seen = 0
  for (let guard = 0; guard < 2000; guard++) {
    const qs = new URLSearchParams({ taxonid: '2688', startdate: from, enddate: to, size: String(PAGE) })
    if (after) qs.set('after', after)
    const j = await fetchJson(`${API}/occurrence?${qs}`)
    const list = j.results || []
    seen += list.length
    for (const o of list) {
      if (skip.has(o.dataset_id)) continue
      const r = normalizeOccurrence(o)
      if (r) records.push(r)
    }
    if (list.length < PAGE) break
    after = list.at(-1).id
  }
  log(`  obis: ${records.length} human sightings kept of ${seen} records ${from}…${to}`)
  return { records, coveredDays: daysBetween(from, to) }
}
