/**
 * Search the places /ships tracks as its own records (Josh 2026-10-07): ports, terminals, anchorages and facilities, by name and by
 * the other names a source gives them (port aliases, anchorage aliases). Feeds the "Fly to a place" box above Mapbox's results
 * (src/components/GeoSearch.jsx localSuggest). Read-only.
 *
 * Ranking: exact name, then names starting with the text, then containing it, then close spellings (pg_trgm word_similarity).
 * A match on another name ranks just below the same kind of match on a real name, and says which name matched. Ports of the
 * same name within ~25 km (World Port Index, Climate TRACE, GFW's labels for several anchorage spots all list Anacortes) collapse to one,
 * preferring the World Port Index entry.
 */

const KINDS = ['terminal', 'anchorage', 'facility', 'port'] // tie order: our most specific nouns first

/** Up to `limit` places matching `text` (≥ 2 characters). Each: { kind, id, name, matched, lat, lon, meta, terminalKey? }. */
export async function searchPlaces(q, S, text, { limit = 8 } = {}) {
  const t = String(text || '').trim().slice(0, 80)
  if (t.length < 2) return []
  const like = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  // score: 4 exact, 3 prefix, 2 contains, else word_similarity (0..1)
  const score = (col) => `CASE WHEN lower(${col}) = lower($1) THEN 4 WHEN ${col} ILIKE $3 THEN 3 WHEN ${col} ILIKE $2 THEN 2 ELSE word_similarity($1, ${col}) END`
  const match = (col) => `(${col} ILIKE $2 OR word_similarity($1, ${col}) > 0.45)`
  const prefix = `${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const rows = await q(`
    WITH hits AS (
      SELECT 'terminal' AS kind, t.key AS id, t.name, t.name AS matched, t.lat, t.lon, t.kind AS sub, t.country AS area, t.key AS terminal_key, ${score('t.name')} AS score
        FROM ${S}.terminals t WHERE t.list_status = 'listed' AND ${match('t.name')}
      UNION ALL
      SELECT 'anchorage', a.source_id || '|' || a.source_key, a.name, x.name, (a.min_lat + a.max_lat) / 2, (a.min_lon + a.max_lon) / 2, a.legal_status, a.location, NULL, x.score
        FROM ${S}.anchorages a
        JOIN LATERAL (
          SELECT a.name AS name, ${score('a.name')} AS score WHERE ${match('a.name')}
          UNION ALL
          SELECT al.alias, ${score('al.alias')} - 0.5 FROM ${S}.anchorage_aliases al
           WHERE al.anchorage_source_id = a.source_id AND al.anchorage_source_key = a.source_key AND al.status = 'accepted' AND ${match('al.alias')}
        ) x ON true
       WHERE a.status = 'active' AND a.geometry IS NOT NULL AND NOT a.no_anchoring
      UNION ALL
      SELECT 'facility', f.key, f.name, f.name, f.lat, f.lon, f.kind, f.admin_area,
             (SELECT tt.key FROM ${S}.terminal_facilities tf JOIN ${S}.terminals tt ON tt.id = tf.terminal_id
               WHERE tf.facility_id = f.id AND tf.status = 'active' ORDER BY tt.key LIMIT 1), ${score('f.name')}
        FROM ${S}.facilities f WHERE f.list_status = 'listed' AND ${match('f.name')}
      UNION ALL
      SELECT 'port', p.id::text, p.name, x.name, p.lat, p.lon, p.origin, p.iso3, NULL, x.score
        FROM ${S}.ports p
        JOIN LATERAL (
          SELECT p.name AS name, ${score('p.name')} AS score WHERE ${match('p.name')}
          UNION ALL
          SELECT pa.name_raw, ${score('pa.name_raw')} - 0.5 FROM ${S}.port_aliases pa
           WHERE pa.port_id = p.id AND pa.status = 'accepted' AND pa.name_raw IS NOT NULL AND ${match('pa.name_raw')}
        ) x ON true
       WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL
    )
    SELECT DISTINCT ON (kind, id) kind, id, name, matched, lat, lon, sub, area, terminal_key, score FROM hits ORDER BY kind, id, score DESC`, [t, like, prefix])
  const order = (k) => KINDS.indexOf(k)
  const ORIGIN = ['wpi', 'dfo_sch', 'gfw_port_label', 'climate_trace']
  const kept = []
  const km = (a, b) => { const r = Math.PI / 180, h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2
    return 12742 * Math.asin(Math.sqrt(h)) }
  return rows
    .map((r) => ({ ...r, score: Number(r.score), lat: Number(r.lat), lon: Number(r.lon) }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))
    .sort((a, b) => b.score - a.score || order(a.kind) - order(b.kind) || ORIGIN.indexOf(a.sub) - ORIGIN.indexOf(b.sub) || a.name.length - b.name.length)
    .filter((r) => {   // one port per name within ~25 km (the best-ranked, World Port Index first)
      if (r.kind !== 'port') return true
      if (kept.some((k) => k.name.toLowerCase() === r.name.toLowerCase() && km(k, r) < 25)) return false
      kept.push(r); return true
    })
    .slice(0, limit)
    .map((r) => ({ kind: r.kind, id: r.id, name: r.name, matched: r.matched && r.matched.toLowerCase() !== r.name.toLowerCase() ? r.matched : null, lat: r.lat, lon: r.lon,
      sub: r.sub || null, area: r.area || null, ...(r.terminal_key ? { terminalKey: r.terminal_key } : {}) }))
}
