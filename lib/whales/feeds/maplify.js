/**
 * Maplify / Conserve.io (the Whale Alert backend), worldwide:
 *   GET https://maplify.com/waseak/php/search-all-sightings.php?BBOX=-180,-90,180,90&start=YYYY-MM-DD&end=YYYY-MM-DD
 * No key; `created` is UTC. Large ranges exhaust the server's memory (it answers
 * a PHP error page), so ranges are fetched ≤ 31 days at a time.
 * Josh approved global use 2026-10-17; published by the Acartia co-op as CC BY 4.0.
 *
 * `source` codes seen (docs/ACARTIA.md): whale_alert, rwsas, CINMS, FARPB, wras,
 * unified, mmag_HSL, API (a test row).
 */
import { fetchJson } from '../http.js'
import { makeNorm, stripHtml, toInt, toNum, daysBetween, addDays, isoUtc } from '../norm.js'

export const FEED = 'maplify'
const URL_BASE = 'https://maplify.com/waseak/php/search-all-sightings.php'
const CHUNK_DAYS = 31

export const SOURCE_CHANNEL = {
  whale_alert: 'Whale Alert',
  unified: 'Whale Alert',
  rwsas: 'Right Whale Sighting Advisory System',
  CINMS: 'Channel Islands National Marine Sanctuary',
  FARPB: 'Point Blue',
  wras: 'Ocean Wise WhaleReport',
  mmag_HSL: 'Marine Hazard Reporting System',
}

/** Free-text comments, minus the app's request-header JSON (it carries a client IP). */
export function cleanComments(s) {
  if (!s) return null
  const cut = String(s).search(/\{"SourceHeaders"/)
  return stripHtml(cut >= 0 ? String(s).slice(0, cut) : s)
}

/** "[Orca Network] Biggs T65A5 northbound (Kimberly Leui Kovach)" → channel + observer. */
export function parseBracketed(comments) {
  const m = /^\s*\[([^\]]+)\]/.exec(comments || '')
  if (!m) return { channel: null, observer: null }
  const first = (comments.split('\n')[0] || '')
  const o = /\(([^()]+)\)\s*$/.exec(first)
  return { channel: m[1].trim(), observer: o ? o[1].trim() : null }
}

export function normalizeRow(r) {
  const lat = toNum(r.latitude)
  const lon = toNum(r.longitude)
  if (lat === null || lon === null || !r.created) return null
  const observedAt = isoUtc(`${String(r.created).replace(' ', 'T')}Z`)
  if (!observedAt) return null
  const remarks = cleanComments(r.comments)
  const br = parseBracketed(remarks)
  const channel = br.channel || SOURCE_CHANNEL[r.source] || 'Whale Alert'
  const n = toInt(r.number_sighted)
  const norm = makeNorm({
    taxon: { raw_name: r.name || '', raw_scientific: r.scientific_name && r.scientific_name !== 'N/A' ? r.scientific_name : '' },
    raw_name: r.name || null,
    observed_at: observedAt,
    observed_date: observedAt.slice(0, 10),
    time_precision: 'exact',
    lat, lon,
    count_min: n, count_max: n,
    channel,
    organization: 'Conserve.io',
    organization_url: 'https://conserve.io',
    observer: br.observer,
    attribution: channel === 'Whale Alert' ? 'Whale Alert (Conserve.io)' : `${channel} via Whale Alert (Conserve.io)`,
    license: 'CC-BY-4.0',
    photo_url: r.photo_url || null,
    remarks,
    trusted: r.trusted === 1 || r.trusted === '1',
    test: r.is_test === 1 || r.is_test === '1' || r.source === 'API',
  })
  const cut = String(r.comments || '').search(/\{"SourceHeaders"/)
  const raw = cut >= 0 ? { ...r, comments: String(r.comments).slice(0, cut) } : r
  return { feed: FEED, feed_id: String(r.id), key: `maplify:${r.id}`, feed_day: String(r.created).slice(0, 10), norm, raw }
}

export async function fetchWindow(from, to, { log = () => {} } = {}) {
  const records = []
  const days = daysBetween(from, to)
  for (let i = 0; i < days.length; i += CHUNK_DAYS) {
    const a = days[i]
    const b = days[Math.min(i + CHUNK_DAYS, days.length) - 1]
    const j = await fetchJson(`${URL_BASE}?BBOX=-180,-90,180,90&start=${a}&end=${addDays(b, 1)}`)
    for (const r of j.results || []) {
      const day = String(r.created || '').slice(0, 10)
      if (day < a || day > b) continue
      const rec = normalizeRow(r)
      if (rec) records.push(rec)
    }
  }
  log(`  maplify: ${records.length} records ${from}…${to}`)
  return { records, coveredDays: days }
}
