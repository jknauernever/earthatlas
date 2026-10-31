#!/usr/bin/env node
/**
 * Upload the /risks scenario tiles (bake.mjs → public/dev-data/risks/<PMTILES_FILE>) to Vercel Blob `risks/`, where
 * api/risks-tiles.js reads them in production. The file name carries the bake version, so an upload never replaces
 * tiles the CDN is already serving.
 *
 *   node --env-file=.env.local scripts/bake-risks/upload.mjs
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { put } from '@vercel/blob'
import { PMTILES_FILE } from '../../src/risks/risksLayers.js'

if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN missing (use --env-file=.env.local)')
const path = join('public/dev-data/risks', PMTILES_FILE)
const size = statSync(path).size
const t0 = Date.now()
const { url } = await put(`risks/${PMTILES_FILE}`, readFileSync(path), {
  access: 'public', addRandomSuffix: false, allowOverwrite: false,
  contentType: 'application/octet-stream', cacheControlMaxAge: 31536000, multipart: size > 20e6,
})
console.log(`${PMTILES_FILE} ${(size / 1e6).toFixed(1)} MB → ${url} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
