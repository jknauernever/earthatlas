// Upload the Southern Resident killer whale critical habitat tiles (1.2 MB) to Vercel Blob, at the path
// src/ships/trackSource.json `srkw.tiles` points to. Run from the earthatlas folder:
//   node --env-file=.env.local scripts/ships/bake-srkw/upload-srkw.mjs
import { put } from '@vercel/blob'
import { createReadStream, statSync, readFileSync } from 'node:fs'

const url = JSON.parse(readFileSync('src/ships/trackSource.json', 'utf8')).srkw.tiles
const name = url.split('/').pop()
const file = `scripts/ships/bake-srkw/build/${name}`
const size = statSync(file).size
console.log(`uploading ${file} (${(size / 1e6).toFixed(1)} MB) → ships/srkw/${name}`)
const r = await put(`ships/srkw/${name}`, createReadStream(file), {
  access: 'public', token: process.env.BLOB_READ_WRITE_TOKEN,
  addRandomSuffix: false, allowOverwrite: true, multipart: true, contentType: 'application/octet-stream',
})
const probe = await fetch(r.url, { headers: { Range: `bytes=${size - 1}-${size - 1}` } })
const total = Number((probe.headers.get('content-range') || '').split('/')[1])
console.log(total === size ? `done: ${r.url} (${size} bytes, verified)` : `uploaded to ${r.url} but size check failed: ${total} vs ${size}`)
