#!/usr/bin/env node
// Publishes the article index built by friends-content.py to Blob as shoreline/friends-content.json, which
// src/friends/friendsContent.js reads (falling back to public/friends/friends-content.json).
//
//   node --env-file=.env.local scripts/shoreline/upload-friends-content.mjs [--dry-run]
//
// Gates: not a --sample run; at least 150 articles; no more than 10% fewer than the index it replaces; every map
// layer the popups read still has articles. Uploads: BLOB_READ_WRITE_TOKEN locally; in GitHub Actions a one-file pass
// from api/cron/permits-upload-token.js (PERMITS_TOKEN_URL + CRON_SECRET).

import { readFile } from 'node:fs/promises'

const dry = process.argv.includes('--dry-run')
const fail = (msg) => { console.error(`refused: ${msg}`); process.exit(1) }
const meta = JSON.parse(await readFile('data/shoreline/friends-content.meta.json', 'utf8'))
const body = await readFile('data/shoreline/friends-content.json', 'utf8')
const idx = JSON.parse(body)

if (meta.sample) fail('this is a --sample run')
if (meta.items < 150) fail(`only ${meta.items} articles`)
if (meta.items < meta.before * 0.9) fail(`articles fell from ${meta.before} to ${meta.items}`)
const empty = ['friends-bull-kelp', 'friends-deepwater-eelgrass', 'friends-herring-spawning', 'friends-documented-forage-spawning',
  'friends-armor', 'friends-docks', 'friends-mooring-buoys', 'upland-property'].filter((l) => !idx.byLayer[l]?.length)
if (empty.length) fail(`no articles for ${empty.join(', ')}`)
console.log(`gates passed: ${meta.items} articles (was ${meta.before}; ${meta.added} new, ${meta.dropped} gone), ${meta.layers} layers`)
if (dry) process.exit(0)

const pathname = 'shoreline/friends-content.json'
const rw = process.env.BLOB_READ_WRITE_TOKEN
const tokenUrl = process.env.PERMITS_TOKEN_URL, cron = process.env.CRON_SECRET
if (!rw && !(tokenUrl && cron)) throw new Error('need BLOB_READ_WRITE_TOKEN (local) or PERMITS_TOKEN_URL + CRON_SECRET (CI)')
let token = rw
if (!rw) {
  const r = await fetch(tokenUrl, { method: 'POST', headers: { authorization: `Bearer ${cron}`, 'content-type': 'application/json' }, body: JSON.stringify({ pathname }) })
  if (!r.ok) throw new Error(`upload pass: HTTP ${r.status} ${await r.text()}`)
  token = (await r.json()).token
}
const blob = rw ? await import('@vercel/blob') : await import('@vercel/blob/client')
const { url } = await blob.put(pathname, body, { access: 'public', contentType: 'application/json', addRandomSuffix: false,
  allowOverwrite: true, token, ...(rw ? { cacheControlMaxAge: 300 } : {}) })
console.log(`uploaded → ${url}`)
