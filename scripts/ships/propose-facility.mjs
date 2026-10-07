#!/usr/bin/env node
/**
 * WA rollout, stage 1 (Josh 2026-10-06): PROPOSE a facility entry for a terminal, for hand review before it goes into
 * lib/ships/data/salish-facilities.json. Writes nothing to any database; prints the candidates and a draft entry.
 *
 *   node scripts/ships/propose-facility.mjs <terminal key> [--words "kinder morgan,ksh"] [--radius 0.75]
 *
 * Small, cached requests (scripts/ships/facilities/cache, gitignored; ECHO retried — it 503s / returns HTML intermittently):
 *   1. ECHO all-media facility search within --radius miles of each berth (one search + one result page per berth).
 *   2. PARIS PermitLookup for every water permit those candidates list (one postback per permit), to find PARIS FacilityIds.
 * A candidate is "likely" when its EPA name contains one of --words (default: words from the terminal's operator and name).
 * The reviewer decides; nothing here is accepted automatically.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadTerminalData } from '../../lib/ships/terminals.js'

const UA = 'EarthAtlas-ships/1.0 (+https://earthatlas.org/ships; facility proposal)'
const CACHE = 'scripts/ships/facilities/cache'
const ECHO = 'https://echodata.epa.gov/echo'
const PARIS = 'https://apps.ecology.wa.gov/paris/PermitLookup.aspx'
const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const key = args.find((a) => /^(wa|bc)-/.test(a))
if (!key) { console.error('usage: propose-facility.mjs <terminal key> [--words "a,b"] [--radius 0.75]'); process.exit(2) }
const radius = Number(opt('radius', '0.75'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let requests = 0

async function cachedFetch(name, url, init = {}, { json = true } = {}) {
  const file = path.join(CACHE, `${name.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`)
  try { return JSON.parse(await readFile(file, 'utf8')).body } catch {}
  for (let i = 1; ; i++) {
    await sleep(1500)
    requests++
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } })
      const text = await res.text()
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = json ? JSON.parse(text) : text
      if (json && body?.Results?.Error) throw new Error(JSON.stringify(body.Results.Error).slice(0, 120))
      await mkdir(CACHE, { recursive: true })
      await writeFile(file, JSON.stringify({ url, retrieved_at: new Date().toISOString(), body }))
      return body
    } catch (e) {
      if (i >= 6) throw new Error(`${name}: ${e.message}`)
      await sleep(4000 * i)
    }
  }
}

async function echoNear(lat, lon) {
  const tag = `${lat.toFixed(5)}_${lon.toFixed(5)}_${radius}`
  const s = await cachedFetch(`echo-near-${tag}`, `${ECHO}/echo_rest_services.get_facilities?output=JSON&p_lat=${lat}&p_long=${lon}&p_radius=${radius}`)
  const qid = s?.Results?.QueryID
  if (!qid) throw new Error('ECHO search returned no QueryID')
  const r = await cachedFetch(`echo-near-${tag}-rows`, `${ECHO}/echo_rest_services.get_qid?output=JSON&qid=${qid}&responseset=500`)
  return r?.Results?.Facilities || []
}

/** PARIS FacilityId(s) for a permit number: one PermitLookup postback (inactive permits included). */
async function parisFacilityIds(permit) {
  const html = await cachedFetch(`paris-lookup-${permit}`, PARIS, {}, { json: false })
  const fields = {}
  for (const tag of String(html).match(/<input[^>]*>/g) || []) {
    const n = /name="([^"]+)"/.exec(tag)?.[1]
    if (n && n.startsWith('__')) fields[n] = (/value="([^"]*)"/.exec(tag)?.[1] ?? '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  }
  fields['ctl00$ContentPlaceHolder1$txtboxPermitNumber'] = permit
  fields['ctl00$ContentPlaceHolder1$ButtonPermitSearch'] = 'Search'
  fields['ctl00$ContentPlaceHolder1$chkinactivepermits'] = 'on'
  // The postback needs the GET's session cookie; not cached as a pair, so the GET above is re-done when this isn't cached.
  const file = path.join(CACHE, `paris-lookup-result-${permit}.json`)
  try { return JSON.parse(await readFile(file, 'utf8')).body } catch {}
  await sleep(1500)
  requests += 2
  const g = await fetch(PARIS, { headers: { 'User-Agent': UA } })
  const cookie = (g.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ')
  const fresh = await g.text()
  for (const tag of fresh.match(/<input[^>]*>/g) || []) {
    const n = /name="([^"]+)"/.exec(tag)?.[1]
    if (n && n.startsWith('__')) fields[n] = (/value="([^"]*)"/.exec(tag)?.[1] ?? '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  }
  const p = await fetch(PARIS, { method: 'POST', body: new URLSearchParams(fields),
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}) } })
  const out = await p.text()
  const ids = [...new Set([...out.matchAll(/FacilitySummary\.aspx\?FacilityId=(\d+)[^>]*>([^<]*)</g)].map((m) => `${m[1]}|${m[2].replace(/\s*≡\s*$/, '').trim()}`))]
    .map((x) => { const [id, name] = x.split('|'); return { id, name } }).filter((x) => x.name && x.name !== 'Facility Summary')
  await writeFile(file, JSON.stringify({ url: PARIS, retrieved_at: new Date().toISOString(), body: ids }))
  return ids
}

const data = await loadTerminalData()
const t = data.main.terminals.find((x) => x.id === key)
if (!t) { console.error(`no terminal ${key}`); process.exit(2) }
const stop = new Set(['the', 'and', 'of', 'terminal', 'marine', 'llc', 'inc', 'company', 'corporation', 'co', 'wa', 'usace', 'ecology', 'filed', 'as'])
const words = (opt('words') ? opt('words').split(',') : `${t.operator || ''} ${t.name}`.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/))
  .map((w) => w.trim().toLowerCase()).filter((w) => w.length > 2 && !stop.has(w))
console.log(`${t.id}: ${t.name} (${t.kind}) · operator ${t.operator ?? '—'} · words [${words.join(', ')}]`)

const seen = new Map()
for (const b of t.berths) for (const f of await echoNear(b.lat, b.lon)) if (!seen.has(f.RegistryID)) seen.set(f.RegistryID, f)
const rows = [...seen.values()].map((f) => {
  const name = String(f.FacName || '')
  const hit = words.find((w) => name.toLowerCase().includes(w)) || null
  return { frs: f.RegistryID, name, street: f.FacStreet || null, city: f.FacCity || null, cwa: f.CWAPermitTypes || null,
    caa: f.CAAComplianceStatus || null, rcra: f.RCRAComplianceStatus || null, likely: hit }
}).sort((a, b) => (b.likely ? 1 : 0) - (a.likely ? 1 : 0) || a.name.localeCompare(b.name))
console.log(`\nECHO within ${radius} mi of ${t.berths.length} berth(s): ${rows.length} facilities; likely by name: ${rows.filter((r) => r.likely).length}`)
for (const r of rows.filter((x) => x.likely)) console.log(`  * ${r.frs} | ${r.name} | ${r.street ?? ''} | water ${r.cwa ?? '—'} | air ${r.caa ?? '—'} (matched "${r.likely}")`)
const others = rows.filter((x) => !x.likely)
if (others.length) console.log(`  … ${others.length} others nearby (not shown; see the cached search)`)
console.log(`requests so far: ${requests}`)
await writeFile(path.join(CACHE, `proposal-${key}.json`), JSON.stringify({ terminal: key, words, radius, rows }, null, 1))
console.log(`candidates written to ${CACHE}/proposal-${key}.json`)
