// Copies each US month's pack shard table (the pack's first 8+4(N+1) bytes) into that month's
// manifest.json as `pack_table` (base64), so api/ship-tracks.js can find a ship's shard without
// a second read of the 370 MB pack (Blob's cold-fill window, ~10 s). Idempotent: months that
// already carry a matching table are skipped. Uploads through api/cron/ships-upload-token.js
// (CRON_SECRET), like publish.mjs.
//
//   node --env-file=.env.local scripts/ships/bake-us/pack-table.mjs [YYYY-MM ...]
import { put } from '@vercel/blob/client'

const INDEX = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/tracks/us-v2/index.json'
const TOKEN_URL = process.env.SHIPS_TOKEN_URL || 'https://earthatlas.org/api/cron/ships-upload-token'

async function tokenFor(pathname) {
  if (!process.env.CRON_SECRET) throw new Error('CRON_SECRET missing')
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify({ pathname }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.token) throw new Error(`upload token for ${pathname}: ${r.status} ${j.error || ''}`)
  return j.token
}

// One range read of the pack's start (a first read of a cold file is always correct), checked.
async function tableOf(packUrl, packBytes) {
  const want = 65536
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = await fetch(packUrl, { headers: { Range: `bytes=0-${want - 1}`, 'Accept-Encoding': 'identity' } })
    const b = r.ok ? Buffer.from(await r.arrayBuffer()) : null
    const total = Number((r.headers.get('content-range') || '').split('/')[1])
    if (b && b.length === want && total === packBytes && b.toString('ascii', 0, 4) === 'SHTP') {
      const n = b.readUInt32LE(4)
      if (8 + (n + 1) * 4 > want) throw new Error(`table of ${packUrl} larger than ${want}`)
      return b.subarray(0, 8 + (n + 1) * 4)
    }
    await new Promise((res) => setTimeout(res, 500))
  }
  throw new Error(`could not read table of ${packUrl}`)
}

const idx = await (await fetch(`${INDEX}?t=${Date.now()}`)).json()
const only = process.argv.slice(2)
const months = Object.keys(idx.months).filter((m) => !only.length || only.includes(m)).sort()
let done = 0, skipped = 0
for (const ym of months) {
  const e = idx.months[ym]
  const man = await (await fetch(`${e.manifest}?t=${Date.now()}`)).json()
  const table = (await tableOf(e.pack, e.pack_bytes)).toString('base64')
  if (man.pack_table === table) { skipped++; continue }
  if (man.month !== ym) throw new Error(`manifest for ${ym} says ${man.month}`)
  const path = new URL(e.manifest).pathname.slice(1)
  await put(path, JSON.stringify({ ...man, pack_table: table }, null, 1), { access: 'public', token: await tokenFor(path), contentType: 'application/json' })  // overwrite is set by the token endpoint
  done++; console.log(`  ✓ ${ym} (${table.length} b64 chars)`)
}
console.log(`pack tables: ${done} written, ${skipped} already current, ${months.length} months`)
