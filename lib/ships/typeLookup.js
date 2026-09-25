/**
 * MMSI → EarthAtlas type over time, for the track bake (docs/SHIP_CLASSIFICATION.md §6).
 *
 * Resolution never uses the MMSI alone: each entry comes from an MMSI claim that
 * belongs to a vessel through an ACCEPTED entity link, inside that claim's own
 * time window (transmitted / registry MMSIs only; community-curated MMSIs never
 * place a track). The type is the vessel's classification (taxonomy.combine,
 * ranked sources over the GFW model) from the type claims overlapping that window.
 * If two different vessels hold the same MMSI in overlapping windows, both entries
 * are flagged `a: 1` (ambiguous) — the bake must not pick one.
 */
import { classifyClaims, TAXONOMY, TAXONOMY_VERSION } from './taxonomy.js'

const iso = (d) => (d == null ? null : new Date(d).toISOString().replace('.000Z', 'Z'))
const ms = (d) => (d == null ? null : new Date(d).getTime())

/** Union of overlapping windows (null bound = open). Pure; tested. */
export function mergeWindows(ws) {
  const s = [...ws].sort((x, y) => (ms(x.from) ?? -Infinity) - (ms(y.from) ?? -Infinity))
  const out = []
  for (const w of s) {
    const last = out.at(-1)
    if (last && (ms(last.to) == null || ms(w.from) == null || ms(w.from) <= ms(last.to))) {
      if (ms(last.to) != null && (ms(w.to) == null || ms(w.to) > ms(last.to))) last.to = w.to
    } else out.push({ from: w.from, to: w.to })
  }
  return out
}

/** Pure core: rows → { mmsi: [{f,t,g,c,h?,a?,x?}] } plus coverage stats. */
export function buildTypeLookup(mmsiRows, typeRows) {
  const typesByVessel = new Map()
  for (const r of typeRows) (typesByVessel.get(r.vessel_id) || typesByVessel.set(r.vessel_id, []).get(r.vessel_id)).push(r)
  const byKey = new Map()
  for (const r of mmsiRows) {
    const k = `${r.mmsi}|${r.vessel_id}`
    ;(byKey.get(k) || byKey.set(k, []).get(k)).push({ from: r.from, to: r.to })
  }
  const lookup = {}
  const stats = { mmsis: 0, entries: 0, specificClass: 0, groupOnly: 0, unknown: 0, conflict: 0, ambiguous: 0, hazardous: 0 }
  const perMmsi = new Map()
  for (const [k, ws] of byKey) {
    const [mmsi, vesselId] = k.split('|')
    for (const w of mergeWindows(ws)) {
      const c = classifyClaims(typesByVessel.get(vesselId) || [], { from: w.from, to: w.to })
      const e = { f: iso(w.from), t: iso(w.to), g: c.group ?? 'unknown', c: c.class ?? 'unknown_unspecified' }
      if (c.conflict) e.x = 1
      const h = [...new Set(c.hazardous_cargo.map((z) => z.category))].sort().join('')
      if (h) e.h = h
      ;(perMmsi.get(mmsi) || perMmsi.set(mmsi, []).get(mmsi)).push({ e, vesselId, w })
    }
  }
  for (const [mmsi, list] of perMmsi) {
    for (const a of list) {
      if (list.some((b) => b.vesselId !== a.vesselId
        && (ms(a.w.to) == null || ms(b.w.from) == null || ms(b.w.from) <= ms(a.w.to))
        && (ms(b.w.to) == null || ms(a.w.from) == null || ms(a.w.from) <= ms(b.w.to)))) a.e.a = 1
    }
    lookup[mmsi] = list.map((x) => x.e).sort((x, y) => String(x.f).localeCompare(String(y.f)))
    stats.mmsis++
    for (const e of lookup[mmsi]) {
      stats.entries++
      if (e.a) stats.ambiguous++
      if (e.x) stats.conflict++
      if (e.h) stats.hazardous++
      if (e.g === 'unknown') stats.unknown++
      else if (e.c.endsWith('_unspecified')) stats.groupOnly++
      else stats.specificClass++
    }
  }
  return { lookup, stats }
}

/** Read the database and build the lookup. `q(text, params) → rows`. */
export async function typeLookup(q, S) {
  const mmsiRows = await q(
    `SELECT va.value_norm AS mmsi, va.vessel_id::text AS vessel_id, lower(va.period) AS "from", upper(va.period) AS "to"
       FROM ${S}.vessel_assertions va JOIN ${S}.vessels v ON v.id = va.vessel_id AND v.status = 'active'
      WHERE va.attribute = 'mmsi' AND va.period_kind <> 'unknown' AND va.evidence_class <> 'community_curated'
        AND va.value_norm ~ '^[0-9]{9}$'`, [])
  const typeRows = await q(
    `SELECT vessel_id::text AS vessel_id, attribute, source_id, evidence_class, value_norm,
            jsonb_build_object('code', detail->'code') AS detail, period_kind, lower(period) AS "from", upper(period) AS "to"
       FROM ${S}.vessel_assertions WHERE attribute = 'vessel_type'`, [])
  const { lookup, stats } = buildTypeLookup(mmsiRows, typeRows)
  return {
    meta: { generated_at: new Date().toISOString(), schema: S, taxonomy_version: TAXONOMY_VERSION,
      format: 'mmsi → [{ f: from, t: to (UTC, null = open), g: group id, c: class id, h?: AIS hazardous-cargo categories (self-declared), x?: 1 = sources conflict (type unknown), a?: 1 = MMSI shared with another vessel in this window (do not pick) }]',
      stats },
    taxonomy: TAXONOMY,
    mmsi: lookup,
  }
}
