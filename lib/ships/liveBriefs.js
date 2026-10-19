/**
 * What our ships database knows about the ships on /ships?live=1 (Josh 2026-10-19: "we have a LOT of info about the Min
 * Zidell but the live popups don't use our own database"). MMSIs → for each, the ship that holds that MMSI now (the same
 * claims the track bake uses, lib/ships/typeLookup.js), its EarthAtlas kind (taxonomy.classifyClaims at `at`) and a few
 * headline facts, each with the source that says it. The live layer colors and counts ships by this kind; a ship we
 * don't know (or an MMSI two ships share right now) keeps its broadcast AIS type.
 */
import { classifyClaims } from './taxonomy.js'

export const MAX_BRIEF_MMSIS = 500
const RECENT_DAYS = 120                      // as vesselsForMmsiRecent: an MMSI claim that ended in the last 120 days still counts
const FACTS = ['name', 'flag', 'imo', 'registry_owner', 'owner', 'registered_owner', 'operator', 'radio_licensee']
// EarthAtlas group → the live layer's kinds (src/ships/TrackControls.jsx TRACK_KINDS).
const LIVE_KIND = { passenger: 'passenger', cargo: 'cargo', tanker: 'tanker', tug_tow: 'tug', fishing: 'fishing', recreational: 'pleasure' }
export const liveKindOf = (group) => (!group || group === 'unknown' ? null : LIVE_KIND[group] || 'other')

const ms = (d) => (d == null ? null : new Date(d).getTime())

/** Pure: MMSI claim rows → { mmsi: vessel_id } for MMSIs one ship holds at `at` (or held most recently). */
export function pickHolders(rows, at) {
  const T = ms(at), by = new Map()
  for (const r of rows) (by.get(r.mmsi) || by.set(r.mmsi, []).get(r.mmsi)).push(r)
  const out = {}
  for (const [mmsi, rs] of by) {
    const now = [...new Set(rs.filter((r) => (ms(r.from) ?? -Infinity) <= T && (ms(r.to) ?? Infinity) >= T).map((r) => r.vessel_id))]
    if (now.length === 1) { out[mmsi] = now[0]; continue }
    if (now.length > 1) continue                               // two ships claim it now: don't pick
    const ended = rs.filter((r) => ms(r.to) != null && ms(r.to) < T).sort((a, b) => ms(b.to) - ms(a.to))
    const top = ended.filter((r) => ms(r.to) === ms(ended[0]?.to)).map((r) => r.vessel_id)
    if (new Set(top).size === 1) out[mmsi] = top[0]
  }
  return out
}

/** → { mmsi: { v: vessel id, k: live kind | null, g, c, gl: group label, cl: class label, f: { attr: { v, s: source id } } } } */
export async function liveBriefs(q, S, mmsis, at = new Date().toISOString()) {
  const list = [...new Set(mmsis.map(String).filter((m) => /^[0-9]{9}$/.test(m)))].slice(0, MAX_BRIEF_MMSIS)
  if (!list.length) return { briefs: {}, sources: {} }
  const rows = await q(
    `SELECT va.value_norm AS mmsi, va.vessel_id::text AS vessel_id, lower(va.period) AS "from", upper(va.period) AS "to"
       FROM ${S}.vessel_assertions va JOIN ${S}.vessels v ON v.id = va.vessel_id AND v.status = 'active'
      WHERE va.attribute = 'mmsi' AND va.value_norm = ANY($1) AND va.period_kind <> 'unknown' AND va.evidence_class <> 'community_curated'
        AND (upper(va.period) IS NULL OR upper(va.period) >= $2::timestamptz - make_interval(days => $3))`, [list, at, RECENT_DAYS])
  const holder = pickHolders(rows, at)
  const ids = [...new Set(Object.values(holder))]
  if (!ids.length) return { briefs: {}, sources: {} }
  const [types, facts] = await Promise.all([
    q(`SELECT vessel_id::text AS vessel_id, attribute, source_id, evidence_class, value_raw, value_norm, detail, period_kind,
              lower(period) AS "from", upper(period) AS "to"
         FROM ${S}.vessel_assertions WHERE attribute = 'vessel_type' AND vessel_id = ANY($1::uuid[])`, [ids]),
    // Registry first, then the newest claim (the card's and search summaries' rule).
    q(`SELECT DISTINCT ON (vessel_id, attribute) vessel_id::text AS vessel_id, attribute, value_raw, source_id, detail->>'display' AS display
         FROM ${S}.vessel_assertions
        WHERE vessel_id = ANY($1::uuid[]) AND attribute = ANY($2)
        ORDER BY vessel_id, attribute, (evidence_class = 'registry') DESC, upper(period) DESC NULLS FIRST, id`, [ids, FACTS]),
  ])
  const typesBy = new Map(), factsBy = new Map()
  for (const r of types) (typesBy.get(r.vessel_id) || typesBy.set(r.vessel_id, []).get(r.vessel_id)).push(r)
  // Privacy rule (docs/VESSEL_REGISTRIES.md §Privacy): a claim flagged display = false never leaves the server.
  for (const r of facts) if (r.display !== 'false') (factsBy.get(r.vessel_id) || factsBy.set(r.vessel_id, {}).get(r.vessel_id))[r.attribute] = { v: r.value_raw, s: r.source_id }
  const briefs = {}, used = new Set()
  for (const [mmsi, vid] of Object.entries(holder)) {
    const c = classifyClaims(typesBy.get(vid) || [], { from: at, to: at, keepObserved: true })
    const f = factsBy.get(vid) || {}
    for (const x of Object.values(f)) used.add(x.s)
    briefs[mmsi] = { v: vid, k: c.conflict ? null : liveKindOf(c.group), g: c.group ?? null, c: c.class ?? null,
      gl: c.groupLabel, cl: c.class && !String(c.class).endsWith('_unspecified') ? c.classLabel : null, ts: typeSources(typesBy.get(vid) || []), f }
    for (const s of briefs[mmsi].ts) used.add(s)
  }
  const sources = used.size ? Object.fromEntries((await q(`SELECT id, name FROM ${S}.sources WHERE id = ANY($1)`, [[...used]])).map((r) => [r.id, r.name])) : {}
  return { briefs, sources }
}
const typeSources = (rows) => [...new Set(rows.map((r) => r.source_id))]
