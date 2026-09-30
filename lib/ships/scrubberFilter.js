/**
 * The "Scrubber-fitted" ship-tracks filter (/ships Ship tracks ⌄): every MMSI held by a vessel that EITHER
 *   - has an IMO GISIS MARPOL Annex VI Reg. 4.2 notification whose own text says it is a scrubber / EGCS (lib/ships/gisis.js,
 *     attribute 'scrubber'; 'equivalent_compliance' rows are not counted), OR
 *   - is on a MEP Alliance scrubber list (lib/ships/mepAlliance.js), through an ACCEPTED link only (IMO_EXACT,
 *     MEP_NAME_CORROBORATED, or MEP_NAME_SALISH_SIZE, which is inferred; candidates never count).
 * vessel_assertions already carries accepted links only. Pure SQL read; bounded by the number of such vessels.
 */
export const SCRUBBER_SOURCES = { gisis: 'imo-gisis-scrubbers', mep: ['mep-alliance-voyages', 'mep-alliance-fitted-ships'] }

/** → { vessels, mmsis: [numbers], by: { gisis, mep, both, mep_inferred } } */
export async function scrubberMmsis(q, S) {
  const rows = await q(
    `WITH s AS (
       SELECT va.vessel_id,
              bool_or(va.source_id = $1) AS gisis,
              bool_or(va.source_id = ANY($2)) AS mep,
              bool_or(va.source_id = ANY($2) AND l.method = 'MEP_NAME_SALISH_SIZE') AS mep_inferred
         FROM ${S}.vessel_assertions va
         JOIN ${S}.entity_links l ON l.source_entity_id = va.source_entity_id AND l.status = 'accepted'
        WHERE va.attribute = 'scrubber' AND (va.source_id = $1 OR va.source_id = ANY($2))
        GROUP BY va.vessel_id)
     SELECT (SELECT json_build_object('vessels', count(*), 'gisis', count(*) FILTER (WHERE gisis), 'mep', count(*) FILTER (WHERE mep),
                                      'both', count(*) FILTER (WHERE gisis AND mep), 'mep_inferred', count(*) FILTER (WHERE mep_inferred AND NOT gisis)) FROM s) AS by,
            (SELECT array_agg(DISTINCT m.value_norm) FROM ${S}.vessel_assertions m JOIN s ON s.vessel_id = m.vessel_id
              WHERE m.attribute = 'mmsi') AS mmsis`, [SCRUBBER_SOURCES.gisis, SCRUBBER_SOURCES.mep])
  const r = rows[0] || {}
  const by = r.by || { vessels: 0, gisis: 0, mep: 0, both: 0, mep_inferred: 0 }
  const mmsis = (r.mmsis || []).filter((m) => /^\d{9}$/.test(String(m))).map(Number)
  return { vessels: Number(by.vessels) || 0, mmsis, by: { gisis: +by.gisis || 0, mep: +by.mep || 0, both: +by.both || 0, mep_inferred: +by.mep_inferred || 0 } }
}
