/**
 * Local runner for the /systems dataset bakes (currents, sst, waves — wind
 * has its own: scripts/bake-gfs-wind.mjs).
 *
 *   node scripts/bake-systems.mjs           # all datasets
 *   node scripts/bake-systems.mjs currents  # one dataset
 *
 * With BLOB_READ_WRITE_TOKEN set, writes to Vercel Blob like the cron;
 * without it, writes public/dev-data/systems/ (gitignored) for localhost dev.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYSTEMS_DATASETS } from '../api/_systems-datasets.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const which = process.argv[2] ? [process.argv[2]] : Object.keys(SYSTEMS_DATASETS)

for (const ds of which) {
  const entry = SYSTEMS_DATASETS[ds]
  if (!entry) { console.error(`bake-systems: unknown dataset "${ds}"`); process.exit(1) }
  try {
    const result = await entry.fetchGrid()
    const meta = result.jsons?.[0]?.json || result.json || result.meta
    const stamp = `valid ${new Date(meta.valid_ms ?? meta.fetched_ms).toISOString()}`
    const files = result.jsons
      ? result.jsons.map((f) => [basename(f.path), JSON.stringify(f.json), 'application/json'])
      : result.json
        ? [[`${basename(entry.blobBase)}.json`, JSON.stringify(result.json), 'application/json']]
        : [
            [`${basename(entry.blobBase)}-grid.bin`, result.gridBuffer, 'application/octet-stream'],
            [`${basename(entry.blobBase)}-meta.json`, JSON.stringify(result.meta), 'application/json'],
          ]
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import('@vercel/blob')
      const putOpts = (contentType) => ({
        access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType, cacheControlMaxAge: 300,
      })
      for (const [name, body, type] of files) await put(`systems/${name}`, body, putOpts(type))
      console.log(`bake-systems[${ds}]: uploaded to Blob — ${stamp}`)
    } else {
      const outDir = join(__dirname, '..', 'public', 'dev-data', 'systems')
      mkdirSync(outDir, { recursive: true })
      for (const [name, body] of files) writeFileSync(join(outDir, name), body)
      console.log(`bake-systems[${ds}]: wrote public/dev-data/systems/ — ${stamp}`)
    }
  } catch (err) {
    console.error(`bake-systems[${ds}]: FAILED — ${err}`)
    process.exitCode = 1
  }
}
