#!/usr/bin/env node
/**
 * Set up (or finish setting up) a white-label partner host — see src/lib/brand.js.
 *
 *   node scripts/brand/new-partner.mjs <id> <host> "<Site title>" [--org "Org name"] [--href https://org.site] [--dry-run]
 *   e.g. node scripts/brand/new-partner.mjs friends sanjuans.earthatlas.org "Salish Sea Explorer"
 *
 * Steps, each skipped when already done (so it is safe to re-run):
 *   1. Mapbox: creates a public token for the partner, limited to https://<host> and to the read-only map
 *      scopes, so their map loads show under their own token in Mapbox's statistics (billable to them).
 *      Needs MAPBOX_TOKENS_WRITE in .env.local: a secret token (sk.…) with the tokens:write scope, made once at
 *      https://console.mapbox.com/account/access-tokens/.
 *   2. Vercel: adds <host> to this project (vercel CLI, your login). earthatlas.org's DNS is on Vercel, so the
 *      subdomain record is created with it. Skipped when the brand already lists the host.
 *   3. src/lib/brand.js: writes the token into the brand's entry, or adds a draft entry for a new brand.
 *
 * Nothing is committed or pushed. After it: add the logos under public/brands/<id>/, preview on localhost with
 * ?brand=<id>, then push as usual. --dry-run prints what each step would do and changes nothing.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const BRAND_FILE = join(ROOT, 'src/lib/brand.js')
// A public token's default scopes: map styles, tiles, fonts — nothing that writes or reads account data.
const SCOPES = ['styles:tiles', 'styles:read', 'fonts:read', 'datasets:read', 'vision:read']

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v }
const dry = args.includes('--dry-run') && args.splice(args.indexOf('--dry-run'), 1)
let org = flag('--org')
const href = flag('--href')
const [id, host, title] = args
if (!id || !host || !title || !/^[a-z0-9-]+$/.test(id) || !/^[a-z0-9.-]+\.[a-z]+$/.test(host)) {
  console.error('Usage: node scripts/brand/new-partner.mjs <id> <host> "<Site title>" [--org "Org name"] [--href https://…] [--dry-run]')
  process.exit(1)
}

const env = Object.fromEntries(readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(([, k, v]) => [k, v.replace(/^"|"$/g, '')]))
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

let src = readFileSync(BRAND_FILE, 'utf8')
const entry = findEntry(src, id)
const token = entry?.text.match(/mapboxToken:\s*'([^']+)'/)?.[1]
const hasHost = entry?.text.includes(`'${host}'`)
org ||= entry?.text.match(/logoAlt:\s*'([^']+)'/)?.[1]

// ─── 1. Mapbox token ──────────────────────────────────────────────────────────
let newToken = token
if (token) console.log(`1. Mapbox: ${id} already has a token (${token.slice(0, 12)}…), skipping.`)
else {
  const sk = env.MAPBOX_TOKENS_WRITE
  if (!sk && !dry) fail('MAPBOX_TOKENS_WRITE is missing from .env.local — a secret token (sk.…) with the tokens:write scope, from https://console.mapbox.com/account/access-tokens/')
  const who = await (await fetch(`https://api.mapbox.com/tokens/v2?access_token=${env.VITE_MAPBOX_TOKEN}`)).json()
  const user = who?.token?.user || fail(`couldn't read the Mapbox account name: ${JSON.stringify(who)}`)
  const body = { note: `EarthAtlas · ${org || title} (${host})`, scopes: SCOPES, allowedUrls: [`https://${host}`] }
  if (dry) { console.log(`1. Mapbox: would create a token on ${user}:`, JSON.stringify(body)); newToken = 'pk.DRY-RUN' }
  else {
    const r = await fetch(`https://api.mapbox.com/tokens/v2/${user}?access_token=${sk}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const j = await r.json()
    if (!r.ok || !j.token) fail(`Mapbox refused the token (${r.status}): ${JSON.stringify(j)}`)
    newToken = j.token
    console.log(`1. Mapbox: created "${body.note}" (${newToken.slice(0, 12)}…), limited to https://${host}.`)
  }
}

// ─── 2. Vercel domain ─────────────────────────────────────────────────────────
if (hasHost) console.log(`2. Vercel: ${host} is already a ${id} host, skipping.`)
else {
  const project = JSON.parse(readFileSync(join(ROOT, '.vercel/project.json'), 'utf8')).projectName
  if (dry) console.log(`2. Vercel: would run: vercel domains add ${host} ${project}`)
  else {
    try {
      execFileSync('vercel', ['domains', 'add', host, project, '--non-interactive'], { cwd: ROOT, stdio: 'inherit' })
      console.log(`2. Vercel: added ${host} to ${project}.`)
    } catch {
      // Keep going: the token from step 1 must still be written down.
      console.error(`2. Vercel: adding ${host} failed (output above). Add it in the Vercel dashboard (project ${project} → Domains), then re-run.`)
    }
  }
}

// ─── 3. brand.js ──────────────────────────────────────────────────────────────
if (entry && token) console.log('3. brand.js: nothing to change.')
else {
  if (entry) {
    const text = /mapboxToken:/.test(entry.text)
      ? entry.text.replace(/mapboxToken:\s*[^,\n]+,/, `mapboxToken: ${q(newToken)},`)
      : entry.text.replace(/(\n\s*accent:[^\n]*\n)/, `$1    mapboxToken: ${q(newToken)},\n`)
    src = src.slice(0, entry.start) + text + src.slice(entry.end)
  } else {
    const close = src.indexOf('\n]\n', src.indexOf('export const BRANDS = ['))
    if (close < 0) fail("couldn't find the end of BRANDS in brand.js")
    src = src.slice(0, close) + `
  {
    id: ${q(id)},
    hosts: [${q(host)}],
    title: ${q(title)},
    chip: 'dark',
    logo: { dark: '/brands/${id}/logo-white.png', light: '/brands/${id}/logo-black.png' },
    logoAlt: ${q(org || title)},
    href: ${q(href || `https://${host}`)},
    accent: '#0e7490',
    mapboxToken: ${q(newToken)},
  },` + src.slice(close)
  }
  if (dry) {
    const tmp = join(mkdtempSync(join(tmpdir(), 'new-partner-')), 'brand.js')
    writeFileSync(tmp, src)
    console.log(`3. brand.js: would change it like this:`)
    try { execFileSync('diff', ['-u', BRAND_FILE, tmp], { stdio: 'inherit' }) } catch { /* diff exits 1 when files differ */ }
  }
  else { writeFileSync(BRAND_FILE, src); console.log(`3. brand.js: ${entry ? `token written into ${id}'s entry` : `new ${id} entry added`}.`) }
}

console.log(`
Next:${entry ? '' : `
  - logos: public/brands/${id}/logo-white.png (white on transparent) and logo-black.png (original colors);
    optional link-preview picture public/brands/${id}/share.jpg (1200×630) → shareImage in brand.js
  - check href / logoAlt / chip in brand.js`}
  - preview: http://localhost:5173/?brand=${id} (localhost keeps EarthAtlas's own token; the partner token works only on https://${host})
  - push (Josh's go-ahead) — the partner's maps switch to their token on the next deploy
  - their usage: https://console.mapbox.com/account/statistics/ (filter by the token named "EarthAtlas · ${org || title} (${host})")`)

/** The `{ … }` object in BRANDS whose id is `id`: { start, end, text }, or null. */
function findEntry(s, brandId) {
  const at = s.indexOf(`id: ${q(brandId)},`)
  if (at < 0) return null
  const start = s.lastIndexOf('\n  {', at) + 1
  const end = s.indexOf('\n  },', at) + '\n  },'.length
  return { start, end, text: s.slice(start, end) }
}

function fail(msg) { console.error(`new-partner: ${msg}`); process.exit(1) }
