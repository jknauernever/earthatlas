/**
 * Species of concern recorded near a point: lookupSpeciesOfConcern({ lat, lng, radiusKm, window }).
 * Shared by api/species-of-concern.js and anything server-side (e.g. /permits, per permit location).
 *
 * Returns one row per listed species with every list's status, record counts by source, the most
 * recent date, nearest distance, blurred-location counts, the population caveat where a record can't
 * confirm the listed population, and the records themselves (each linking to its source page).
 */
import { INDEX, QUERY_IDS, LIST_META, TAXA } from './lists.js'
import { fetchRegulatory } from './regulatory.js'
import { orcaEcotype } from './orcaEcotype.js'
import { fetchHumpbackDps, DPS } from './humpbackDps.js'
import { fetchTaxonInfo } from './taxonInfo.js'
import { STATUS_ORDER, NOT_CONFIRMED, BLURRED_ONLY, statusRank, groupRank } from './statusOrder.js'
import { fetchInat, fetchGbif, fetchEbird, fetchWhales, distanceKm } from './sources.js'

export const WINDOWS = { '30d': 30, '1y': 365, '10y': 3652, all: null }
export const DEFAULT_RADIUS_KM = 5
export const MAX_RADIUS_KM = 50

const SOURCE_LABELS = {
  inaturalist: { label: 'iNaturalist', url: 'https://www.inaturalist.org' },
  gbif: { label: 'GBIF', url: 'https://www.gbif.org' },
  ebird: { label: 'eBird', url: 'https://ebird.org' },
}

export function windowDates(window, today = new Date().toISOString().slice(0, 10)) {
  const days = WINDOWS[window]
  const from = days === null ? '1900-01-01' : new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10)
  return { from, to: today }
}

// Most specific ID first, so a subspecies record lands on the subspecies row, not also its species.
function matchRecord(r) {
  for (const src of ['inat', 'gbif', 'ebird']) {
    const ids = r.ids[src]
    if (!ids) continue
    const ordered = src === 'inat' && ids.length > 1 ? [ids[0], ...ids.slice(1).reverse()] : ids
    for (const id of ordered) {
      const hits = INDEX[src].get(id)
      if (hits) return hits
    }
  }
  return null
}

const ONLY_POPULATION = 'Species recorded; listed population not confirmed.'

// Listed populations a record can confirm. Each reader returns { id, name, tentative, evidence, confirms } or null.
//   Killer whales: federal = Southern Residents only; a remark naming J, K or L pod (not hedged) confirms it.
//   Humpbacks: federal = Mexico and Central America populations; a Happywhale photo-ID match of the same whale on
//   that breeding ground confirms it (r.dps, filled in before matching).
const ECOTYPE_WORDS = { 'southern-resident': 'Southern Resident', biggs: "Bigg's", 'northern-resident': 'Northern Resident', mixed: 'Southern Resident and Bigg\'s named' }
const POPULATION_READERS = {
  'Orcinus orca': {
    list: 'us-federal',
    read: (r) => { const e = orcaEcotype(r.remarks, r.individual); return e.ecotype ? { id: e.ecotype, name: ECOTYPE_WORDS[e.ecotype], tentative: e.tentative, evidence: e.evidence, confirms: e.ecotype === 'southern-resident' && !e.tentative, status: 'Endangered', population: 'Southern Residents' } : null },
  },
  'Megaptera novaeangliae': {
    list: 'us-federal',
    read: (r) => {
      if (!r.dps) return null
      if (r.dps.dps === 'mixed') return { id: 'mixed', name: 'seen on two breeding grounds', tentative: true, evidence: r.dps.areas.join(', '), url: r.dps.url, confirms: false }
      if (!r.dps.dps) return { id: 'unknown', name: 'breeding ground not yet matched', tentative: false, evidence: `${r.dps.name || 'this whale'}: no winter breeding-ground sighting on Happywhale`, url: r.dps.url, confirms: false }
      return { id: r.dps.dps, name: `${r.dps.label} (${r.dps.status})`, tentative: false, evidence: `${r.dps.name || 'this whale'} seen ${r.dps.evidence.region}, ${r.dps.evidence.date}`, url: r.dps.url, confirms: r.dps.listed, status: r.dps.dps === 'mexico' ? 'Threatened' : 'Endangered', population: r.dps.label }
    },
  },
}
const HUMPBACK = /megaptera novaeangliae|humpback/i
const POPULATION_NOTE = {
  'Orcinus orca': (list, n) => `Observers' remarks name: ${list} (of ${n} records). Only a Southern Resident identification that is not hedged confirms the federal listing.`,
  'Megaptera novaeangliae': (list, n) => `Happywhale photo-ID of the same whale on its breeding ground: ${list} (of ${n} records). Only a match to the Mexico or Central America breeding grounds confirms the federal listing.`,
}
export const POPULATION_BASIS = { 'Orcinus orca': "Observers' remarks name", 'Megaptera novaeangliae': 'Happywhale photo-ID' }
export { NOT_CONFIRMED, BLURRED_ONLY }

export async function lookupSpeciesOfConcern({ lat, lng, radiusKm = DEFAULT_RADIUS_KM, window = '1y', today } = {}) {
  const { from, to } = windowDates(window, today)
  const q = { lat, lng, radiusKm, from, to }
  const runs = {
    inaturalist: fetchInat(q, QUERY_IDS.inat),
    gbif: fetchGbif(q, QUERY_IDS.gbif),
    ebird: fetchEbird(q, QUERY_IDS.ebird),
    whales: fetchWhales(q),
  }
  const regulatoryRun = fetchRegulatory({ lat, lng, radiusKm })
  const settled = Object.fromEntries(await Promise.all(Object.entries(runs).map(async ([k, p]) => {
    try { return [k, { ok: true, ...(await p) }] } catch (e) { return [k, { ok: false, error: String(e.message || e), records: [] }] }
  })))

  // Humpbacks photo-identified by Happywhale: which breeding population each individual belongs to.
  const hwRecords = (settled.whales.records || []).filter((r) => r.individual_id && HUMPBACK.test(`${r.taxon_name} ${r.common_name}`))
  let dpsNote = null
  if (hwRecords.length) {
    const freq = {}
    for (const r of hwRecords) freq[r.individual_id] = (freq[r.individual_id] || 0) + 1
    const { results, note } = await fetchHumpbackDps(Object.keys(freq).sort((a, b) => freq[b] - freq[a]))
    dpsNote = note
    for (const r of hwRecords) r.dps = results.get(String(r.individual_id)) || null
  }

  const rows = new Map()
  const listedCounts = {}
  for (const run of Object.values(settled)) {
    for (const r of run.records) {
      const hits = matchRecord(r)
      if (!hits) continue
      const distance = r.obscured ? null : distanceKm(lat, lng, r.lat, r.lng)
      for (const [taxon, matches] of groupBy(hits, h => h.taxon)) {
        if (!rows.has(taxon)) rows.set(taxon, { taxon, records: [], confirmedLists: new Set(), confirmedAs: {} })
        const row = rows.get(taxon)
        for (const m of matches) if (m.confirms) row.confirmedLists.add(m.status.list)
        const reader = POPULATION_READERS[taxon.scientific_name]
        const eco = reader ? reader.read(r) : null
        if (eco?.confirms) {
          row.confirmedLists.add(reader.list)
          // the listed population this record confirms, most protective first (Endangered beats Threatened)
          const prev = row.confirmedAs[reader.list]
          if (!prev || statusRank(eco.status) < statusRank(prev.status)) row.confirmedAs[reader.list] = { status: eco.status, populations: new Set([...(prev?.populations || []), eco.population]) }
          else prev.populations.add(eco.population)
        }
        row.records.push({
          ...(eco ? { ecotype: { name: eco.name, id: eco.id, tentative: eco.tentative, evidence: eco.evidence, ...(eco.url ? { url: eco.url } : {}) } } : {}),
          source: r.source, url: r.url, date: r.date, lat: r.lat, lng: r.lng,
          distance_km: distance === null ? null : Math.round(distance * 100) / 100,
          location: r.obscured ? 'blurred' : 'exact',
          reported_as: r.common_name ? `${r.common_name} (${r.taxon_name})` : r.taxon_name,
          observer: r.observer, quality: r.quality, remarks: r.remarks || null,
          confirms: matches.some(m => m.confirms),
          ...(r.dataset ? { dataset: r.dataset } : {}), ...(r.location_name ? { location_name: r.location_name } : {}),
        })
      }
      listedCounts[r.source] = (listedCounts[r.source] || 0) + 1
    }
  }

  const species = [...rows.values()].map(({ taxon, records, confirmedLists, confirmedAs }) => {
    records.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    const statuses = taxon.statuses.map(s => ({
      list: s.list, list_label: s.list_label, source_url: s.source_url,
      // a population-level confirmation shows that population's own status (Mexico humpbacks: Threatened)
      status: confirmedAs[s.list]?.status || s.status,
      ...(confirmedAs[s.list] ? { confirmed_population: [...confirmedAs[s.list].populations].join(', ') } : {}),
      confirmed: confirmedLists.has(s.list), note: s.note, ...(s.phs_criteria ? { phs_criteria: s.phs_criteria } : {}),
    })).sort((a, b) => statusRank(a.status) - statusRank(b.status))
    const bySource = {}
    for (const r of records) bySource[r.source] = (bySource[r.source] || 0) + 1
    const exact = records.filter(r => r.location === 'exact')
    const unconfirmed = statuses.filter(s => !s.confirmed)
    const confirmed = statuses.filter(s => s.confirmed)
    const notes = [...new Set(unconfirmed.map(s => s.note).filter(Boolean))]
    const eco = {}
    for (const r of records) if (r.ecotype) { const k = r.ecotype.tentative ? `${r.ecotype.name} (tentative)` : r.ecotype.name; eco[k] = (eco[k] || 0) + 1 }
    if (Object.keys(eco).length && unconfirmed.length)
      notes.unshift(POPULATION_NOTE[taxon.scientific_name](Object.entries(eco).map(([k, n]) => `${k} ${n}`).join(', '), records.length))
    if (unconfirmed.length && !notes.length && taxon.rank !== 'species')
      notes.push(`The list names the ${taxon.rank} ${taxon.scientific_name}; these records are identified only to the species.`)
    return {
      common_name: taxon.common_name, scientific_name: taxon.scientific_name, inat_id: taxon.inat_id || null,
      group: !confirmed.length ? NOT_CONFIRMED : exact.length ? confirmed[0].status : BLURRED_ONLY,
      confirmed: confirmed.length > 0,
      statuses,
      records_count: records.length,
      latest_date: records[0]?.date || null,
      nearest_km: exact.length ? Math.min(...exact.map(r => r.distance_km)) : null,
      sources: bySource,
      locations: { exact: exact.length, blurred: records.length - exact.length },
      ...(Object.keys(eco).length ? { ecotypes: eco, population_basis: POPULATION_BASIS[taxon.scientific_name] } : {}),
      caveat: unconfirmed.length ? { text: ONLY_POPULATION, lists: unconfirmed.map(s => s.list_label), notes } : null,
      records,
    }
  }).sort((a, b) => groupRank(a.group) - groupRank(b.group) || (a.common_name || a.scientific_name).localeCompare(b.common_name || b.scientific_name))

  const regulatory = await regulatoryRun
  const taxonBySci = new Map(TAXA.map(t => [t.scientific_name.toLowerCase(), t]))
  for (const c of regulatory.critical_habitat) {
    const t = c.scientific_name && taxonBySci.get(c.scientific_name.toLowerCase())
    if (t?.inat_id) c.inat_id = t.inat_id
  }
  const taxonByCommon = new Map(TAXA.filter(t => t.common_name).map(t => [t.common_name.toLowerCase(), t]))
  for (const p of regulatory.phs) {
    // WDFW leaves the scientific name off masked records (e.g. golden eagle nest areas): match those by common name
    const t = (p.scientific_name && taxonBySci.get(p.scientific_name.toLowerCase())) || (p.kind === 'species' && taxonByCommon.get(p.name.toLowerCase()))
    if (t && !p.scientific_name) p.scientific_name = t.scientific_name
    if (t?.inat_id) p.inat_id = t.inat_id
    if (t) p.listed = t.statuses.filter(s => s.match_level === 'species').map(s => ({ list: s.list, list_label: s.list_label, status: s.status, source_url: s.source_url }))
  }
  // Photos and short descriptions (iNaturalist taxon records) for every species shown.
  const infos = await fetchTaxonInfo([...species.map(r => r.inat_id), ...regulatory.critical_habitat.map(c => c.inat_id), ...regulatory.phs.map(p => p.inat_id)])
  for (const it of [...species, ...regulatory.critical_habitat, ...regulatory.phs]) if (it.inat_id && infos.get(it.inat_id)) it.info = infos.get(it.inat_id)
  const whales = settled.whales
  const sources = [
    ...['inaturalist', 'gbif', 'ebird'].map(id => ({ id, ...SOURCE_LABELS[id], ok: settled[id].ok, error: settled[id].error, note: settled[id].note || null, listed_records: listedCounts[id] || 0, ...(id === 'gbif' && settled.gbif.latest ? { latest_record: settled.gbif.latest } : {}) })),
    ...(whales.ok ? Object.entries(whales.labels || {}).map(([id, l]) => ({ id, label: l.label, url: l.url, ok: true, listed_records: listedCounts[id] || 0, via: 'EarthAtlas whales database' }))
      : [{ id: 'whales', label: 'Whale sightings (EarthAtlas whales database)', ok: false, error: whales.error, listed_records: 0 }]),
  ]

  return {
    query: { lat, lng, radius_km: radiusKm, window, from, to },
    regulatory,
    groups: [...STATUS_ORDER, BLURRED_ONLY, NOT_CONFIRMED].filter(s => species.some(r => r.group === s)),
    species,
    sources,
    lists: LIST_META,
    notes: [
      'No records here does not mean a species is absent; it means none was reported to these sources in this window.',
      ...Object.values(settled).map(r => r.note).filter(Boolean),
      ...(dpsNote ? [dpsNote] : []),
    ],
  }
}

function groupBy(items, keyFn) {
  const m = new Map()
  for (const it of items) { const k = keyFn(it); if (!m.has(k)) m.set(k, []); m.get(k).push(it) }
  return m
}
