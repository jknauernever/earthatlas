/**
 * One feed run: fetch a window → resolve taxa → upsert records → mark records
 * the feed no longer returns as removed → rebuild the affected sightings.
 *
 * Idempotent: re-running a window changes nothing (records whose normalized
 * form is unchanged skip the rebuild). Removal is guarded: an empty answer
 * for days that had records, or one that would remove more than half of a
 * window's records, is treated as an upstream outage and removes nothing.
 */
import { createHash } from 'node:crypto'
import { schemaIdent } from './db.js'
import { resolveTaxa } from './taxa.js'
import { mergeSighting } from './merge.js'
import * as salishsea from './feeds/salishsea.js'
import * as maplify from './feeds/maplify.js'
import * as happywhale from './feeds/happywhale.js'
import * as inaturalist from './feeds/inaturalist.js'
import * as obis from './feeds/obis.js'

export const FEEDS = { salishsea, maplify, happywhale, inaturalist, obis }
// Hourly: the live feeds. OBIS is history only (backfill / monthly).
export const LIVE_FEEDS = ['salishsea', 'maplify', 'happywhale', 'inaturalist']

const BATCH = 500

function hashNorm(norm) {
  return createHash('md5').update(JSON.stringify(norm)).digest('hex')
}

async function upsertRecords(c, S, recs) {
  const touched = new Set()
  let inserted = 0
  let changed = 0
  for (let i = 0; i < recs.length; i += BATCH) {
    const data = recs.slice(i, i + BATCH).map((r) => ({ ...r, hash: hashNorm(r.norm) }))
    const { rows } = await c.query(
      `INSERT INTO ${S}.records AS t (feed, feed_id, key, feed_day, norm, raw, hash)
       SELECT x.feed, x.feed_id, x.key, x.feed_day, x.norm, x.raw, x.hash
       FROM jsonb_to_recordset($1::jsonb) AS x(feed text, feed_id text, key text, feed_day date, norm jsonb, raw jsonb, hash text)
       ON CONFLICT (feed, feed_id) DO UPDATE SET
         key = EXCLUDED.key, feed_day = EXCLUDED.feed_day, norm = EXCLUDED.norm, raw = EXCLUDED.raw, hash = EXCLUDED.hash,
         last_seen = now(),
         changed_at = CASE WHEN t.hash IS DISTINCT FROM EXCLUDED.hash OR t.removed_at IS NOT NULL THEN now() ELSE t.changed_at END,
         removed_at = NULL
       RETURNING t.key, (xmax = 0) AS inserted, (t.changed_at = now()) AS changed`,
      [JSON.stringify(data)],
    )
    for (const r of rows) {
      if (r.inserted) { inserted++; touched.add(r.key) } else if (r.changed) { changed++; touched.add(r.key) }
    }
  }
  return { inserted, changed, touched }
}

async function removeMissing(c, S, feed, days, recs, log) {
  if (!days.length) return { removed: 0, keys: [], note: null }
  const ids = recs.map((r) => r.feed_id)
  const { rows: [{ live }] } = await c.query(
    `SELECT count(*)::int AS live FROM ${S}.records WHERE feed = $1 AND feed_day = ANY($2::date[]) AND removed_at IS NULL`,
    [feed, days],
  )
  const { rows: [{ gone }] } = await c.query(
    `SELECT count(*)::int AS gone FROM ${S}.records WHERE feed = $1 AND feed_day = ANY($2::date[]) AND removed_at IS NULL AND NOT (feed_id = ANY($3::text[]))`,
    [feed, days, ids],
  )
  if (!gone) return { removed: 0, keys: [], note: null }
  if ((recs.length === 0 && live > 5) || (live >= 20 && gone > live / 2)) {
    const note = `removal skipped: ${gone} of ${live} records missing looks like an upstream outage`
    log(`  ${note}`)
    return { removed: 0, keys: [], note }
  }
  const { rows } = await c.query(
    `UPDATE ${S}.records SET removed_at = now(), changed_at = now()
     WHERE feed = $1 AND feed_day = ANY($2::date[]) AND removed_at IS NULL AND NOT (feed_id = ANY($3::text[]))
     RETURNING key`,
    [feed, days, ids],
  )
  return { removed: rows.length, keys: rows.map((r) => r.key), note: null }
}

const SIGHTING_COLS = [
  ['key', 'text'], ['origin', 'text'], ['via', 'jsonb'], ['kind', 'text'], ['inat_id', 'int'], ['raw_name', 'text'],
  ['animal_group', 'text'], ['observed_at', 'timestamptz'], ['observed_date', 'date'], ['time_precision', 'text'],
  ['lat', 'float8'], ['lon', 'float8'], ['accuracy_m', 'int'], ['location_obscured', 'boolean'], ['count_min', 'int'],
  ['count_max', 'int'], ['channel', 'text'], ['organization', 'text'], ['organization_url', 'text'], ['observer', 'text'],
  ['attribution', 'text'], ['url', 'text'], ['license', 'text'], ['photo_url', 'text'], ['photo_thumb_url', 'text'],
  ['photo_license', 'text'], ['photo_attribution', 'text'], ['individual_id', 'text'], ['individual_label', 'text'],
  ['remarks', 'text'], ['trusted', 'boolean'], ['occurrence_id', 'text'], ['quality', 'text'],
]

/** Rebuild the sightings for these keys from all of their records. */
export async function rebuildSightings(c, S, keys) {
  let upserted = 0
  let removed = 0
  const all = [...keys]
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH)
    const { rows } = await c.query(
      `SELECT r.key, r.feed, r.feed_id, r.feed_day::text AS feed_day, r.norm, r.removed_at FROM ${S}.records r WHERE r.key = ANY($1::text[])`,
      [batch],
    )
    const ids = [...new Set(rows.map((r) => r.norm.inat_id).filter(Boolean))]
    const groups = new Map()
    if (ids.length) {
      const { rows: tx } = await c.query(`SELECT inat_id, animal_group FROM ${S}.taxa WHERE inat_id = ANY($1::int[])`, [ids])
      for (const t of tx) groups.set(t.inat_id, t.animal_group)
    }
    const byKey = new Map()
    for (const r of rows) {
      if (!byKey.has(r.key)) byKey.set(r.key, [])
      byKey.get(r.key).push(r)
    }
    const live = []
    const gone = []
    for (const k of batch) {
      const s = mergeSighting(k, byKey.get(k) || [], (id) => groups.get(id))
      if (s.removed) gone.push(k)
      else live.push(s)
    }
    if (live.length) {
      const cols = SIGHTING_COLS.map(([n]) => n)
      const defs = SIGHTING_COLS.map(([n, t]) => `${n} ${t}`).join(', ')
      const sel = cols.map((n) => (n === 'via' ? `ARRAY(SELECT jsonb_array_elements_text(x.via))` : `x.${n}`)).join(', ')
      const upd = cols.filter((n) => n !== 'key').map((n) => `${n} = EXCLUDED.${n}`).join(', ')
      await c.query(
        `INSERT INTO ${S}.sightings (${cols.join(', ')}, geom, removed_at, updated_at)
         SELECT ${sel}, ST_SetSRID(ST_MakePoint(x.lon, x.lat), 4326)::geography, NULL, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(${defs})
         ON CONFLICT (key) DO UPDATE SET ${upd}, geom = EXCLUDED.geom, removed_at = NULL, updated_at = now()`,
        [JSON.stringify(live)],
      )
      upserted += live.length
    }
    if (gone.length) {
      const { rowCount } = await c.query(
        `UPDATE ${S}.sightings SET removed_at = now(), updated_at = now() WHERE key = ANY($1::text[]) AND removed_at IS NULL`,
        [gone],
      )
      removed += rowCount
    }
  }
  return { upserted, removed }
}

/**
 * Run one feed over from..to.
 * opts: { mode, log, limit (keep only the first N records; disables removal), createdSince (iNaturalist late uploads) }
 */
export async function runFeed(pool, schema, feedName, from, to, opts = {}) {
  const S = schemaIdent(schema)
  const log = opts.log || (() => {})
  const feed = FEEDS[feedName]
  if (!feed) throw new Error(`unknown feed ${feedName}`)
  const c = await pool.connect()
  const { rows: [run] } = await c.query(
    `INSERT INTO ${S}.ingest_runs (feed, mode, window_from, window_to) VALUES ($1, $2, $3, $4) RETURNING id`,
    [feedName, opts.mode || 'manual', from, to],
  )
  const out = { feed: feedName, from, to, fetched: 0, inserted: 0, changed: 0, removed: 0, rebuilt: 0, ok: false, note: null }
  try {
    let { records, coveredDays } = await feed.fetchWindow(from, to, { log })
    if (opts.createdSince && feed.fetchCreatedSince) {
      const late = await feed.fetchCreatedSince(opts.createdSince, { log })
      const seen = new Set(records.map((r) => r.feed_id))
      records = records.concat(late.records.filter((r) => !seen.has(r.feed_id)))
    }
    // One row per (feed, feed_id): an upstream answer can repeat a record, and Postgres refuses to update a row twice
    // in one statement. The last copy wins.
    records = [...new Map(records.map((r) => [r.feed_id, r])).values()]
    if (opts.limit) { records = records.slice(0, opts.limit); coveredDays = [] }
    out.fetched = records.length
    const kept = await resolveTaxa(c, S, feedName, records, log)
    const up = await upsertRecords(c, S, kept)
    out.inserted = up.inserted
    out.changed = up.changed
    const rm = await removeMissing(c, S, feedName, coveredDays, kept, log)
    out.removed = rm.removed
    out.note = rm.note
    const keys = new Set([...up.touched, ...rm.keys])
    const rb = await rebuildSightings(c, S, keys)
    out.rebuilt = rb.upserted + rb.removed
    out.ok = true
  } catch (e) {
    out.note = String(e?.message || e).slice(0, 500)
    throw Object.assign(e, { run: out })
  } finally {
    await c.query(
      `UPDATE ${S}.ingest_runs SET finished_at = now(), fetched = $2, inserted = $3, changed = $4, removed = $5, rebuilt = $6, ok = $7, note = $8 WHERE id = $1`,
      [run.id, out.fetched, out.inserted, out.changed, out.removed, out.rebuilt, out.ok, out.note],
    ).catch(() => {})
    c.release()
  }
  return out
}
