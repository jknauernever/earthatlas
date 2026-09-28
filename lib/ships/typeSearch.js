/**
 * Ship search by KIND OF SHIP (Josh, 2026-09-27: "type: oil tanker and find all of the oil tankers, or
 * 'ferry' and find all the ferries"). A query is read against EarthAtlas's own taxonomy (lib/ships/taxonomy.js),
 * so "ferry" means what the ship card calls a ferry, from every source that says so (AIS code, registries,
 * Wikidata, Wikimedia Commons categories), combined by the same rule the card uses (classifyClaims).
 *
 * parseTypeQuery("washington ferries") → { group: 'passenger', class: 'ferry', label: 'Ferry…', rest: 'washington' }
 * The rest of the words, if any, narrow the ships by name or owner.
 */
import { GROUPS, CLASSES, crosswalkClaim, classifyClaims } from './taxonomy.js'

// Extra words people use, beyond the taxonomy's own labels (singular; the query is singularised first).
const SYNONYMS = {
  ferry: ['ferry', 'ferry boat', 'car ferry', 'passenger ferry', 'ro-pax', 'ropax'],
  cruise_ship: ['cruise ship', 'cruise liner', 'cruise'],
  high_speed_craft: ['high-speed craft', 'high speed craft', 'fast ferry'],
  excursion: ['excursion boat', 'tour boat', 'excursion'],
  container_ship: ['container ship', 'containership', 'container'],
  bulk_carrier: ['bulk carrier', 'bulker', 'bulk'],
  general_cargo: ['general cargo', 'multi-purpose'],
  reefer: ['reefer', 'refrigerated cargo'],
  roro_cargo: ['ro-ro', 'roro'],
  vehicle_carrier: ['vehicle carrier', 'car carrier'],
  heavy_lift: ['heavy-lift', 'heavy lift'],
  livestock_carrier: ['livestock carrier'],
  oil_tanker: ['oil tanker', 'crude tanker', 'product tanker', 'crude oil tanker'],
  chemical_tanker: ['chemical tanker'],
  oil_chemical_tanker: ['oil/chemical tanker', 'oil & chemical tanker', 'oil and chemical tanker', 'oil chemical tanker'],
  lng_carrier: ['lng carrier', 'lng tanker', 'lng'],
  lpg_carrier: ['lpg carrier', 'lpg tanker', 'lpg'],
  gas_carrier: ['gas carrier'],
  bunker_tanker: ['bunker tanker', 'bunkering tanker', 'bunker barge'],
  tug: ['tug', 'tugboat', 'tug boat'],
  towing: ['towing', 'pusher', 'push boat'],
  pilot: ['pilot boat', 'pilot vessel'],
  search_rescue: ['search and rescue', 'search & rescue', 'rescue boat', 'lifeboat'],
  patrol: ['patrol boat', 'patrol vessel', 'coast guard', 'coastguard', 'law enforcement'],
  icebreaker: ['icebreaker'],
  buoy_tender: ['buoy tender'],
  dredger: ['dredger', 'dredge'],
  research_vessel: ['research vessel', 'research ship', 'survey vessel', 'survey ship'],
  seismic_survey: ['seismic survey', 'seismic vessel'],
  fishing_vessel: ['fishing vessel', 'fishing boat'],
  trawler: ['trawler'],
  fish_factory: ['fish factory', 'factory ship'],
  warship: ['warship', 'navy ship', 'naval ship'],
  yacht: ['yacht', 'superyacht', 'motor yacht'],
  sailing_vessel: ['sailing vessel', 'sailboat', 'sailing ship', 'tall ship'],
  museum_ship: ['museum ship'],
  offshore_support: ['offshore support', 'supply vessel', 'platform supply', 'crew boat', 'crew transfer'],
}
const GROUP_SYNONYMS = {
  passenger: ['passenger', 'passenger ship', 'passenger vessel'],
  cargo: ['cargo', 'cargo ship', 'freighter'],
  tanker: ['tanker'],
  tug_tow: ['tug / tow', 'towboat'],
  fishing: ['fishing'],
  research: ['research'],
  naval: ['naval', 'navy', 'military'],
  government: ['government'],
  recreational: ['pleasure', 'pleasure craft', 'recreational', 'sailing'],
  offshore: ['offshore'],
  port_service: ['port service'],
}

// A search for one of these also finds the other kind that includes it ("oil tanker" → oil / chemical tankers too).
export const RELATED = { oil_tanker: ['oil_chemical_tanker'], chemical_tanker: ['oil_chemical_tanker'] }

/** Plural → singular, word by word ("ferries" → "ferry", "tankers" → "tanker", "tugs" → "tug"). */
export function singular(word) {
  const w = word.toLowerCase()
  if (/ies$/.test(w) && w.length > 4) return `${w.slice(0, -3)}y`
  if (/(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2)
  if (/s$/.test(w) && !/(ss|us|is)$/.test(w) && w.length > 3) return w.slice(0, -1)
  return w
}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9&/+ -]+/g, ' ').split(/\s+/).filter(Boolean).map(singular).join(' ')

// Phrase → target, longest phrases first so "oil tanker" wins over "tanker".
const PHRASES = (() => {
  const out = []
  for (const [cls, [group, label]] of Object.entries(CLASSES)) {
    const base = label.replace(/\(.*?\)/g, '').split('/').map((x) => x.trim()).filter(Boolean)
    for (const p of [...base, ...(SYNONYMS[cls] || [])]) out.push([norm(p), { group, class: cls, label }])
  }
  for (const [group, label] of Object.entries(GROUPS)) {
    if (group === 'unknown' || group === 'other' || group === 'non_vessel') continue
    for (const p of [label, ...(GROUP_SYNONYMS[group] || [])]) out.push([norm(p), { group, class: null, label }])
  }
  const seen = new Set()
  return out.filter(([p]) => p && !seen.has(p) && seen.add(p)).sort((a, b) => b[0].length - a[0].length)
})()

export function parseTypeQuery(text) {
  const q = norm(text)
  if (!q) return null
  for (const [p, target] of PHRASES) {
    const re = new RegExp(`(^| )${p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}( |$)`)
    if (re.test(q)) return { ...target, phrase: p, rest: q.replace(re, ' ').trim() }
  }
  return null
}

/**
 * Vessels whose EarthAtlas classification (now) is the target group / class. Candidates are the vessels with a
 * type claim that maps into the target (the distinct claim values are few, so they are crosswalked here), then
 * each candidate is classified from ALL its type claims, as its card is. `restNorm` (normName of the leftover
 * words) must appear in the ship's name or owner. Returns { total, ids } (ids sorted by name, at most `limit`).
 */
export async function vesselsOfType(q, S, target, { restNorm = '', limit = 50, candidateCap = 5000 } = {}) {
  const classes = target.class ? [target.class, ...(RELATED[target.class] || [])] : []
  const combos = await q(
    `SELECT source_id, value_norm, detail->>'code' AS code, detail->>'category' AS category, detail->>'service_subtype' AS service_subtype
       FROM ${S}.vessel_assertions WHERE attribute = 'vessel_type'
      GROUP BY 1, 2, 3, 4, 5`, [])
  const hit = combos.filter((c) => {
    const m = crosswalkClaim({ source_id: c.source_id, value_norm: c.value_norm, value_raw: c.category,
      detail: { code: c.code, category: c.category, service_subtype: c.service_subtype } })
    // A ship is only a <class> if some claim names that class (group-only claims like AIS "passenger" can't make it one).
    return m && m.group === target.group && (!target.class || classes.includes(m.class))
  })
  if (!hit.length) return { total: 0, ids: [] }
  const cand = await q(
    `SELECT DISTINCT va.vessel_id FROM ${S}.vessel_assertions va
       JOIN unnest($1::text[], $2::text[]) AS h(source_id, value_norm)
         ON h.source_id = va.source_id AND h.value_norm = va.value_norm
      WHERE va.attribute = 'vessel_type'
        AND ($3 = '' OR EXISTS (SELECT 1 FROM ${S}.vessel_assertions n WHERE n.vessel_id = va.vessel_id
              AND n.attribute = ANY($4) AND n.value_norm LIKE '%' || $3 || '%'
              AND (n.detail->>'display') IS DISTINCT FROM 'false'))
      LIMIT $5`,
    [hit.map((c) => c.source_id), hit.map((c) => c.value_norm), restNorm, ['name', ...OWNER_ATTRS], candidateCap])
  if (!cand.length) return { total: 0, ids: [] }
  const claims = await q(
    `SELECT va.vessel_id, va.source_id, va.evidence_class, va.value_raw, va.value_norm, va.detail, va.period_kind,
            lower(va.period) AS "from", upper(va.period) AS "to"
       FROM ${S}.vessel_assertions va WHERE va.attribute = 'vessel_type' AND va.vessel_id = ANY($1)`,
    [cand.map((c) => c.vessel_id)])
  const by = new Map()
  for (const c of claims) (by.get(c.vessel_id) || by.set(c.vessel_id, []).get(c.vessel_id)).push(c)
  const now = new Date().toISOString()
  const ok = []
  for (const [vid, cs] of by) {
    const c = classifyClaims(cs, { from: now, to: now, keepObserved: true })
    if (c.group === target.group && (!target.class || classes.includes(c.class))) ok.push(vid)
  }
  if (!ok.length) return { total: 0, ids: [] }
  const named = await q(
    `SELECT v.id, min(n.value_norm) AS nm FROM unnest($1::uuid[]) AS v(id)
       LEFT JOIN ${S}.vessel_assertions n ON n.vessel_id = v.id AND n.attribute = 'name'
      GROUP BY v.id ORDER BY min(n.value_norm) NULLS LAST LIMIT $2`, [ok, limit])
  return { total: ok.length, ids: named.map((r) => r.id), capped: cand.length >= candidateCap }
}

/** Owner / operator / manager attributes a search reads (the card's ROLE_ROWS). */
export const OWNER_ATTRS = ['registry_owner', 'owner', 'registered_owner', 'beneficial_owner', 'operator', 'ship_manager',
  'technical_manager', 'commercial_manager', 'ism_manager', 'bareboat_charterer']

/**
 * Every vessel's EarthAtlas kind of ship, in one pass (for the tracks "Kind of ship" picker, Josh 2026-09-27):
 * vessels with a type claim that names a CLASS are classified from all their type claims (classifyClaims, as the
 * card does). Returns { byClass: { class: Set(vesselId) }, tally: [{ group, class, n }] }. Cached per instance for
 * an hour — it only changes when new claims arrive.
 */
let classCache = null
export async function classIndex(q, S) {
  if (classCache && Date.now() - classCache.at < 3600e3 && classCache.S === S) return classCache
  const combos = await q(
    `SELECT source_id, value_norm, detail->>'code' AS code, detail->>'category' AS category, detail->>'service_subtype' AS service_subtype
       FROM ${S}.vessel_assertions WHERE attribute = 'vessel_type' GROUP BY 1, 2, 3, 4, 5`, [])
  const classed = combos.filter((c) => crosswalkClaim({ source_id: c.source_id, value_norm: c.value_norm, value_raw: c.category,
    detail: { code: c.code, category: c.category, service_subtype: c.service_subtype } })?.class)
  const byClass = {}
  if (classed.length) {
    const claims = await q(
      `SELECT va.vessel_id, va.source_id, va.evidence_class, va.value_raw, va.value_norm, va.detail, va.period_kind,
              lower(va.period) AS "from", upper(va.period) AS "to"
         FROM ${S}.vessel_assertions va
        WHERE va.attribute = 'vessel_type' AND va.vessel_id IN (
          SELECT DISTINCT v.vessel_id FROM ${S}.vessel_assertions v
            JOIN unnest($1::text[], $2::text[]) AS h(source_id, value_norm) ON h.source_id = v.source_id AND h.value_norm = v.value_norm
           WHERE v.attribute = 'vessel_type')`,
      [classed.map((c) => c.source_id), classed.map((c) => c.value_norm)])
    const by = new Map()
    for (const c of claims) (by.get(c.vessel_id) || by.set(c.vessel_id, []).get(c.vessel_id)).push(c)
    const now = new Date().toISOString()
    for (const [vid, cs] of by) {
      const c = classifyClaims(cs, { from: now, to: now, keepObserved: true })
      if (c.class && !String(c.class).endsWith('_unspecified')) (byClass[c.class] ||= new Set()).add(vid)
    }
  }
  const tally = Object.entries(byClass).map(([cls, set]) => ({ group: CLASSES[cls]?.[0] ?? null, class: cls, label: CLASSES[cls]?.[1] ?? cls, n: set.size }))
    .sort((a, b) => b.n - a.n)
  classCache = { at: Date.now(), S, byClass, tally }
  return classCache
}

/** MMSIs (numbers) of the vessels in these classes (a track filter). Every MMSI each vessel has held. */
export async function mmsisOfClasses(q, S, classes) {
  const idx = await classIndex(q, S)
  const ids = [...new Set(classes.flatMap((c) => [...(idx.byClass[c] || [])]))]
  if (!ids.length) return { vessels: 0, mmsis: [] }
  const rows = await q(`SELECT DISTINCT value_norm FROM ${S}.vessel_assertions WHERE attribute = 'mmsi' AND vessel_id = ANY($1)`, [ids])
  return { vessels: ids.length, mmsis: rows.map((r) => Number(r.value_norm)).filter((m) => /^\d{9}$/.test(String(m))) }
}
