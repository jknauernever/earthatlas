/**
 * Status lists for the species-of-concern lookup (data/species-of-concern/*.json), merged into one
 * index of taxa. Each list entry says which source IDs CONFIRM a record of the listed taxon and which
 * only show the species was recorded (a listed population or subspecies that a species-level record
 * can't confirm, e.g. federal Southern Resident killer whales).
 *
 * Adding a status list (another state, IUCN): build its JSON in the same format and add it to LISTS.
 */
import waState from '../../data/species-of-concern/wa-state-listed.json' with { type: 'json' }
import waFederal from '../../data/species-of-concern/wa-federal-esa.json' with { type: 'json' }
import waPlants from '../../data/species-of-concern/wa-dnr-rare-plants.json' with { type: 'json' }
import waSgcn from '../../data/species-of-concern/wa-sgcn.json' with { type: 'json' }
import waPhs from '../../data/species-of-concern/wa-phs.json' with { type: 'json' }

export const LISTS = [
  { id: 'wa-state', label: 'Washington State', doc: waState, url: 'https://wdfw.wa.gov/species-habitats/at-risk/listed' },
  { id: 'us-federal', label: 'Federal (ESA)', doc: waFederal, url: 'https://ecos.fws.gov/ecp/report/species-listings-by-state?stateAbbrev=WA&stateName=Washington&statusCategory=Listed' },
  { id: 'wa-plants', label: 'Washington rare plants (DNR)', doc: waPlants, url: 'https://dnr.wa.gov/natural-heritage-program/rare-species/species-lists' },
  { id: 'wa-sgcn', label: 'WA Species of Greatest Conservation Need', doc: waSgcn, url: 'https://wdfw.wa.gov/species-habitats/at-risk/swap' },
  { id: 'wa-phs', label: 'WA Priority Habitats and Species', doc: waPhs, url: 'https://wdfw.wa.gov/publications/00165' },
]

export { STATUS_ORDER, statusRank } from './statusOrder.js'
import { statusRank } from './statusOrder.js'

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
// "killer whale (Southern Residents federally)" -> "killer whale": the qualifier belongs in the caveat
const plainName = (s) => (s ? s.replace(/\s*\([^)]*\)\s*$/, '').trim() || s : s)
const add = (set, v) => { if (v !== null && v !== undefined && v !== '') set.add(String(v)) }

/** Source IDs that confirm the listed taxon vs. ones that only show its species was recorded. */
function entryIds(e) {
  const confirm = { inat: new Set(), gbif: new Set(), ebird: new Set() }
  const partial = { inat: new Set(), gbif: new Set(), ebird: new Set() }
  if (e.match_level === 'species') {
    // the whole species (or, for an all-of-WA subspecies, every WA member of it) is listed
    for (const v of [e.inat_taxon_id, e.inat_species_taxon_id]) add(confirm.inat, v)
    for (const v of [e.gbif_taxon_key, e.gbif_species_key]) add(confirm.gbif, v)
    for (const v of [e.ebird_species_code, e.ebird_issf_code]) add(confirm.ebird, v)
  } else if (e.rank !== 'species') {
    // a listed subspecies/variety: its own IDs confirm, its species' IDs don't
    add(confirm.inat, e.inat_taxon_id); add(confirm.gbif, e.gbif_taxon_key); add(confirm.ebird, e.ebird_issf_code)
    add(partial.inat, e.inat_species_taxon_id); add(partial.gbif, e.gbif_species_key); add(partial.ebird, e.ebird_species_code)
  } else {
    // a listed population of a species (DPS/ESU, stock): no record source names the population
    for (const v of [e.inat_taxon_id, e.inat_species_taxon_id]) add(partial.inat, v)
    for (const v of [e.gbif_taxon_key, e.gbif_species_key]) add(partial.gbif, v)
    add(partial.ebird, e.ebird_species_code)
  }
  for (const k of Object.keys(confirm)) for (const v of confirm[k]) partial[k].delete(v)
  return { confirm, partial }
}

function build() {
  const taxa = []
  const byKey = new Map()
  for (const list of LISTS) {
    for (const e of list.doc.species) {
      const keys = [e.inat_taxon_id && `i${e.inat_taxon_id}`, `n${norm(e.scientific_name)}`].filter(Boolean)
      let t = keys.map(k => byKey.get(k)).find(Boolean)
      if (!t) {
        t = { key: keys[0], common_name: plainName(e.common_name), scientific_name: e.scientific_name, rank: e.rank, statuses: [] }
        taxa.push(t)
      }
      for (const k of keys) byKey.set(k, t)
      if (!t.common_name && e.common_name) t.common_name = plainName(e.common_name)
      if (!t.inat_id) t.inat_id = e.inat_taxon_id || e.inat_species_taxon_id || null
      const ids = entryIds(e)
      t.statuses.push({
        list: list.id, list_label: list.label, status: e.status, match_level: e.match_level,
        note: e.note || null, scientific_name: e.scientific_name, common_name: e.common_name,
        source_url: e.entities?.[0]?.source_url || list.url, phs_criteria: e.phs_criteria, ids,
      })
    }
  }
  // Lookup maps: source ID -> [{ taxon, status, confirms }]
  const index = { inat: new Map(), gbif: new Map(), ebird: new Map() }
  for (const t of taxa) {
    t.best = Math.min(...t.statuses.map(s => statusRank(s.status)))
    for (const s of t.statuses) {
      for (const src of Object.keys(index)) {
        for (const [ids, confirms] of [[s.ids.confirm[src], true], [s.ids.partial[src], false]]) {
          for (const id of ids) {
            if (!index[src].has(id)) index[src].set(id, [])
            index[src].get(id).push({ taxon: t, status: s, confirms })
          }
        }
      }
    }
  }
  return { taxa, index }
}

export const { taxa: TAXA, index: INDEX } = build()

/** All IDs to ask each source for. */
export const QUERY_IDS = {
  inat: [...INDEX.inat.keys()].map(Number),
  gbif: [...INDEX.gbif.keys()].map(Number),
  ebird: new Set(INDEX.ebird.keys()),
}

export const LIST_META = LISTS.map(l => ({ id: l.id, label: l.label, authority: l.doc.authority, compiled: l.doc.compiled, url: l.url }))
