/**
 * Step 1 of the Open Waters archive backfill (lib/ships/recordedStops.js; docs/OPENWATERS_AIS.md "Archive"): the ships to ask
 * Open Waters for. Open Waters' track archive (from 2026-08-20) answers one ship at a time, so the backfill needs MMSIs: every
 * ship that ever stopped at a terminal or anchorage in our own counts (NOAA months) or in the GFW estimates for the months NOAA
 * hasn't published, with the identity it last broadcast (AIS reported: name, IMO, type, length), which the archive's track
 * doesn't carry. Reads SHIPS_DATABASE_URL (dev on localhost; production via scripts/ships/prod.sh). Writes
 * scripts/ships/bake-ais/cache/owarchive/mmsis.json.
 *   node --env-file=.env.local scripts/ships/aisstream/owarchive-mmsis.mjs [--schema ships]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { shipsPool, DEFAULT_SCHEMA } from '../../../lib/ships/db.js'

const args = process.argv.slice(2)
const S = args.includes('--schema') ? args[args.indexOf('--schema') + 1] : DEFAULT_SCHEMA
const OUT = 'scripts/ships/bake-ais/cache/owarchive'
const pool = shipsPool()
try {
  const rows = (await pool.query(`
    WITH seen AS (
      SELECT mmsi, t0, ais_name AS name, ais_imo AS imo, ais_vessel_type AS type, ais_length AS length FROM ${S}.terminal_calls
      UNION ALL SELECT mmsi, t0, ais_name, ais_imo, ais_vessel_type, ais_length FROM ${S}.anchorage_stays
      UNION ALL SELECT mmsi, t0, gfw_name, NULL, NULL, NULL FROM ${S}.terminal_call_estimates WHERE mmsi IS NOT NULL
      UNION ALL SELECT mmsi, t0, gfw_name, NULL, NULL, NULL FROM ${S}.anchorage_stay_estimates WHERE mmsi IS NOT NULL
    )
    SELECT mmsi,
           (array_agg(name ORDER BY t0 DESC) FILTER (WHERE name IS NOT NULL))[1] AS name,
           (array_agg(imo ORDER BY t0 DESC) FILTER (WHERE imo IS NOT NULL))[1] AS imo,
           (array_agg(type ORDER BY t0 DESC) FILTER (WHERE type IS NOT NULL))[1] AS type,
           (array_agg(length ORDER BY t0 DESC) FILTER (WHERE length IS NOT NULL))[1] AS length,
           count(*)::int AS stops, max(t0) AS last
      FROM seen WHERE mmsi ~ '^[0-9]{9}$' GROUP BY mmsi ORDER BY count(*) DESC`)).rows
  await mkdir(OUT, { recursive: true })
  await writeFile(`${OUT}/mmsis.json`, JSON.stringify({ schema: S, built_at: new Date().toISOString(), ships: rows }, null, 0))
  console.log(`${rows.length.toLocaleString()} ships → ${OUT}/mmsis.json`)
} finally { await pool.end() }
