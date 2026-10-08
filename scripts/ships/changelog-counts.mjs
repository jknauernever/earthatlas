// Read-only: the numbers for the /ships changelog's "Data on the site" cards (lib/ships/changelogCounts.js).
// Run against production with `zsh scripts/ships/prod.sh counts`; every connection is READ ONLY.
//   --limit N        only the first N terminals / anchorages (a quick check)
//   --parts a,b      only these parts (base, terminals, anchorages, tracks)
import { shipsPool, DEFAULT_SCHEMA as S } from '../../lib/ships/db.js'
import { changelogCounts, PARTS } from '../../lib/ships/changelogCounts.js'
import trackSource from '../../src/ships/trackSource.json' with { type: 'json' }

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
const limit = arg('--limit') ? Number(arg('--limit')) : Infinity
const parts = arg('--parts') ? arg('--parts').split(',') : PARTS

const pool = shipsPool()
pool.on('connect', (c) => { c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY') })
const q = async (t, p) => (await pool.query(t, p)).rows
const t0 = Date.now()
try {
  const out = await changelogCounts(q, S, { parts, limit, trackSource, fetchJson: async (u) => (await fetch(u)).json() })
  console.log(JSON.stringify(out, null, 1))
  console.error(`changelog-counts: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
} finally {
  await pool.end()
}
