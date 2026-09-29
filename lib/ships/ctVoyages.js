/**
 * Climate TRACE ship voyages: who tracked a ship, and the per-ship facts the voyage table carries (pure; browser-safe, no
 * node imports: src/ships/ShipEmissions.jsx imports it, as does the bake scripts/ships/bake-ct-voyages/bake.mjs).
 * Facts: docs/CLIMATETRACE_FACTS.md, section "Shipping voyages — answers from Climate TRACE (2026-09-29)".
 *
 * Tracker (asset_identifier prefix; Climate TRACE's email of 2026-09-29):
 *   om-imo-N               OceanMind, Climate TRACE's shipping sector lead: large, high-information vessels
 *   gfw-imo-N / gfw-mmsi-N Global Fishing Watch: smaller or low-information vessels, and non-broadcasting ones
 *
 * other11 / other12 (float columns the schema file doesn't document). Climate TRACE's email says other11 = CO₂ emissions
 * factor from their RF model (kg per nautical mile) and other12 = deadweight (tonnes). The values we pulled read the OTHER
 * way round (measured 2026-09-29, release v5_11_0, Salish Sea 2024–2025):
 *   - other11 is constant per ship and ranges like deadweight: VLCC tankers ~300,000, Handymax bulkers ~57,000, BC Ferries'
 *     COASTAL RENAISSANCE (IMO 9332755) 2,366;
 *   - other12 is constant per ship and matches the ship's own trips: COASTAL RENAISSANCE other12 = 496.2, while its trips'
 *     CO2_emissions / activity (nautical miles) run 0.49–0.58 t per NM = 490–580 kg per NM.
 * So the mapping below follows the values, and is kept in ONE place (CT_SHIP_FIELDS) so it can be flipped if Climate TRACE
 * confirms otherwise. Both raw columns are kept in the pack under their own names (o11, o12); nothing is overwritten.
 */

export const OCEANMIND = { id: 'oceanmind', name: 'OceanMind', url: 'https://www.oceanmind.global' }
export const GFW = { id: 'gfw', name: 'Global Fishing Watch', url: 'https://globalfishingwatch.org' }
export const CT_TRACKERS = {
  'om-imo': { ...OCEANMIND, idKind: 'imo' },
  'gfw-imo': { ...GFW, idKind: 'imo' },
  'gfw-mmsi': { ...GFW, idKind: 'mmsi' },
}

/** 'om-imo-9332755' → { prefix, number, id, name, url, idKind } (the tracker); null for anything else. */
export function trackerOf(assetId) {
  const m = /^(om-imo|gfw-imo|gfw-mmsi)-(\d+)$/.exec(String(assetId ?? ''))
  if (!m) return null
  return { prefix: m[1], number: m[2], ...CT_TRACKERS[m[1]] }
}

/** Which raw column holds which fact (see the header: follows the values, not the email). */
export const CT_SHIP_FIELDS = { deadweight_t: 'o11', co2_kg_per_nm: 'o12' }
/** Plausible ranges: outside them a value is kept raw but not shown (largest ships afloat are ~560,000 DWT). */
export const DEADWEIGHT_RANGE_T = [1, 600000]
export const CO2_PER_NM_RANGE_KG = [1, 20000]

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const within = (n, [lo, hi]) => n != null && n >= lo && n <= hi

/**
 * The per-ship facts from one pack line's raw columns ({ o11, o12 }) → { deadweight_t, co2_kg_per_nm } (null when absent or
 * implausible). Units: tonnes deadweight; kilograms of CO₂ per nautical mile (Climate TRACE's model for this ship).
 */
export function shipFacts(raw) {
  const d = num(raw?.[CT_SHIP_FIELDS.deadweight_t]), e = num(raw?.[CT_SHIP_FIELDS.co2_kg_per_nm])
  return { deadweight_t: within(d, DEADWEIGHT_RANGE_T) ? d : null, co2_kg_per_nm: within(e, CO2_PER_NM_RANGE_KG) ? e : null }
}

/**
 * One ship's raw other11 / other12 over all its rows → the single value each carries, or a conflict (pure, used by the bake).
 * values: [[o11, o12], …] as strings from the CSV. Returns { o11, o12, conflicts: [...names] }.
 */
export function oneValuePerShip(values) {
  const out = { o11: null, o12: null, conflicts: [] }
  for (const [i, k] of [[0, 'o11'], [1, 'o12']]) {
    const set = new Set(values.map((v) => num(v[i])).filter((n) => n != null))
    if (set.size === 1) out[k] = [...set][0]
    else if (set.size > 1) out.conflicts.push(k)
  }
  return out
}
