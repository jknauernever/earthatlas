#!/usr/bin/env node
/**
 * Upload the baked /ships track files to Vercel Blob and record their public
 * URLs in src/ships/trackSource.json (tiles{} and packs{}), which the
 * production api/ship-tracks.js reads.
 *
 *   BLOB_OIDC_TOKEN=… BLOB_STORE_ID=… node scripts/ships/bake-ais/upload.mjs
 *   (or BLOB_READ_WRITE_TOKEN=…)
 *
 * Credentials come from `vercel env pull <scratch file> --environment=production`.
 * The read-write token is marked sensitive and pulls empty, but the pull
 * includes VERCEL_OIDC_TOKEN + BLOB_STORE_ID, which `vercel blob put` accepts.
 * Never pull into .env.local (it overwrites the file).
 *
 * Paths are versioned (ships/tracks/<version>/…), so a re-bake with a new
 * `version` in trackSource.json gets new immutable URLs and CDN caches can't mix sets.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..')
const manifestPath = path.join(ROOT, 'src', 'ships', 'trackSource.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const auth = process.env.BLOB_READ_WRITE_TOKEN
  ? ['--rw-token', process.env.BLOB_READ_WRITE_TOKEN]
  : process.env.BLOB_OIDC_TOKEN && process.env.BLOB_STORE_ID
    ? ['--oidc-token', process.env.BLOB_OIDC_TOKEN, '--store-id', process.env.BLOB_STORE_ID]
    : null
if (!auth) { console.error('Need BLOB_READ_WRITE_TOKEN, or BLOB_OIDC_TOKEN + BLOB_STORE_ID'); process.exit(1) }

manifest.tiles ||= {}
manifest.packs ||= {}
for (const ym of manifest.months) {
  for (const [ext, slot] of [['pmtiles', 'tiles'], ['pack', 'packs']]) {
    const file = path.join(HERE, 'track_tiles', `tracks-${ym}.${ext}`)
    if (!existsSync(file)) { console.warn(`  ${ym}.${ext}: missing, skipped`); continue }
    const pathname = `ships/tracks/${manifest.version}/tracks-${ym}.${ext}`
    // The CLI prints the uploaded URL on stderr; read both streams. Never echo
    // the command line, since it carries the credential.
    const r = spawnSync('npx', ['vercel', 'blob', 'put', file, '--access', 'public', '--pathname', pathname,
      '--content-type', 'application/octet-stream', '--allow-overwrite', 'true', ...auth],
      { cwd: ROOT, encoding: 'utf8' })
    const text = `${r.stdout || ''}\n${r.stderr || ''}`
    const url = (text.match(/https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/\S+/) || [])[0]
    if (r.status !== 0 || !url) {
      const why = text.split('\n').filter((l) => /Error/.test(l)).join(' ').slice(0, 300)
      console.error(`upload failed for ${pathname}: ${why || `exit ${r.status}, no URL`}`)
      process.exit(1)
    }
    manifest[slot][ym] = url
    console.log(`  ${ym}.${ext} → ${url}`)
  }
}
manifest.uploadedAt = new Date().toISOString()
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`manifest updated: ${Object.keys(manifest.tiles).length} tile sets, ${Object.keys(manifest.packs).length} packs`)
