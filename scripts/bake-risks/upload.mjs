#!/usr/bin/env node
/**
 * Upload the /risks scenario tiles (bake.mjs → public/dev-data/risks/<PMTILES_FILE>) to Vercel Blob `risks/`, where
 * api/risks-tiles.js reads them in production. The file name carries the bake version, so an upload never replaces
 * tiles the CDN is already serving.
 *
 *   node --env-file=.env.local scripts/bake-risks/upload.mjs           San Juan County's tiles
 *   node --env-file=.env.local scripts/bake-risks/upload.mjs king      a CoSMoS region's (REGIONS, cosmos.mjs)
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { put } from '@vercel/blob'
import { PMTILES_FILE, REGIONS } from '../../src/risks/risksLayers.js'

if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN missing (use --env-file=.env.local)')
const region = process.argv[2]
const FILE = region ? REGIONS.find((r) => r.id === region)?.file : PMTILES_FILE
if (!FILE) throw new Error(`unknown region ${region}`)
const path = join('public/dev-data/risks', FILE)
const size = statSync(path).size
const t0 = Date.now()
const { url } = await put(`risks/${FILE}`, readFileSync(path), {
  access: 'public', addRandomSuffix: false, allowOverwrite: false,
  contentType: 'application/octet-stream', cacheControlMaxAge: 31536000, multipart: size > 20e6,
})
console.log(`${FILE} ${(size / 1e6).toFixed(1)} MB → ${url} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
