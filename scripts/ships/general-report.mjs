// Read-only: build the /ships general report (lib/ships/generalReport.js) from the database in SHIPS_DATABASE_URL.
// Production: `zsh scripts/ships/prod.sh report` (every connection READ ONLY). Localhost (dev DB): node --env-file=.env.local scripts/ships/general-report.mjs
//   --limit N    only the first N terminals / anchorages (a quick check)
//   --out FILE   write the JSON here (default public/dev-data/ships/general-report.json, which localhost's report page reads)
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { shipsPool, DEFAULT_SCHEMA as S } from '../../lib/ships/db.js'
import { generalReport, nodeFetchJson } from '../../lib/ships/generalReport.js'
import trackSource from '../../src/ships/trackSource.json' with { type: 'json' }

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
const limit = arg('--limit') ? Number(arg('--limit')) : Infinity
const out = arg('--out') || 'public/dev-data/ships/general-report.json'

const pool = shipsPool()
pool.on('connect', (c) => { c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY') })
const q = async (t, p) => (await pool.query(t, p)).rows
try {
  const r = await generalReport(q, S, { limit, trackSource, fetchJson: nodeFetchJson })
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(r))
  console.error(`general-report: ${r.seconds} s → ${out} (${(JSON.stringify(r).length / 1024).toFixed(0)} KB)${r.failed.length ? `; FAILED parts: ${JSON.stringify(r.failed)}` : ''}`)
} finally {
  await pool.end()
}
