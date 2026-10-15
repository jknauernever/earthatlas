#!/usr/bin/env node
/**
 * Finds WDFW Hydraulic Project Approval (HPA) applications in San Juan County on WDFW's own search
 * (hpa.wdfw.wa.gov/s/application-search), including ones still under review (Josh 2026-10-15: WDFW's public HPA map
 * layer stopped updating in Dec 2024, so new permits come from here). Each application's record page gives its
 * position. Writes data/permits/hpa-applications.json, merged by APPS id; the bake maps them as /permits records.
 *
 *   node scripts/permits/hpa-search.mjs [--since 2025-01-01] [--limit N] [--refresh]
 *
 * One search, then one record page per application not already read (or every one with --refresh). The site is
 * rendered by script (Salesforce), so this drives a headless Chrome; see hpa-fetch.mjs for CHROME_PATH.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { recordFiles, downloadUrl, fetchTo, pdfText } from './hpa-fetch.mjs'

const OUT = 'data/permits/hpa-applications.json'
const CACHE = 'scripts/permits/cache/hpa-apps'
// Also kept in the cache folder: the weekly bake's runner restores that folder, not data/ changes, between runs.
const KEPT = `${CACHE}/applications.json`
const SEARCH = 'https://hpa.wdfw.wa.gov/s/application-search'
const UA = 'EarthAtlas PermitTracker (https://earthatlas.org/permits)'
const args = process.argv.slice(2)
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const SINCE = flag('--since') || '2025-01-01', LIMIT = Number(flag('--limit') || Infinity), REFRESH = args.includes('--refresh')
const CHROME = process.env.CHROME_PATH || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const formDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MON[m - 1]} ${d}, ${y}` }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Every element, through shadow roots (the form and table are Lightning web components).
const DEEP = `(() => { const a = []; const w = (r) => { for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) w(e.shadowRoot); a.push(e) } }; w(document); return a })()`
const inputByLabel = (page, label) => page.evaluateHandle(`${DEEP}.find((e) => e.tagName === 'INPUT' && (e.getAttribute('aria-label') || e.labels?.[0]?.textContent || e.name) === ${JSON.stringify(label)})`)

async function search(page) {
  await page.goto(SEARCH, { waitUntil: 'networkidle2', timeout: 90000 })
  for (let i = 0; i < 20 && !(await (await inputByLabel(page, 'County')).asElement()); i++) await sleep(1000)
  const date = (await inputByLabel(page, 'Submitted_Date_From')).asElement()
  await date.click(); await date.type(formDate(SINCE)); await page.keyboard.press('Tab')
  // County is a lookup: type, then pick the matching option.
  const county = (await inputByLabel(page, 'County')).asElement()
  await county.click(); await county.type('San Juan')
  let picked = false
  for (let i = 0; i < 20 && !picked; i++) {
    await sleep(500)
    // The option's label sits in nested shadow roots: find the label, climb (through hosts) to its role=option item.
    picked = await page.evaluate(`(() => { let e = ${DEEP}.find((x) => x.tagName === 'STRONG' && x.textContent.trim() === 'San Juan')
      while (e && e.getAttribute?.('role') !== 'option') e = e.parentElement || e.getRootNode().host
      if (e) { e.click(); return true } return false })()`)
  }
  if (!picked) throw new Error('County lookup offered no "San Juan" option')
  await page.evaluate(`${DEEP}.find((e) => e.tagName === 'BUTTON' && /Search Records/.test(e.textContent)).click()`)
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const n = await page.evaluate(`(() => { const m = ${DEEP}.map((e) => (e.textContent || '').match(/(\\d+) of (\\d+) items/)).find(Boolean); return m ? +m[2] : null })()`)
    if (n) { console.log(`  search lists ${n} applications`); break }
  }
  // Rows: the table's own columns, plus the record link on the APPS id.
  // The record link sits inside the cell's own shadow root, so each row is searched deep too.
  return page.evaluate(`(() => { const deepIn = (root) => { const a = []; const w = (r) => { for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) w(e.shadowRoot); a.push(e) } }; w(root); return a }
    return ${DEEP}.filter((e) => e.tagName === 'TR' && deepIn(e).some((x) => x.tagName === 'A' && /recordId=/.test(x.href))).map((tr) => {
    const c = [...tr.children].map((x) => x.innerText.trim().replace(/\\s+/g, ' '))
    const a = deepIn(tr).find((x) => x.tagName === 'A' && /recordId=/.test(x.href))
    return { apps: c[0], status: c[1], permit: c[2] || null, permitStatus: c[3] || null, kind: c[4], project: c[5], types: c[6], submitted: c[7], issued: c[10] || null, county: c[11], record: a.href }
  }) })()`)
}

// A record page: position ("48.46012,-122.82622" under the project's address) and address.
async function recordPosition(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 })
  for (let i = 0; i < 20; i++) {
    const t = await page.evaluate(() => document.body.innerText)
    const m = t.match(/Primary Location's Address:\s*([^\n]*)\n+\s*(-?\d{2}\.\d+)\s*,\s*(-?\d{3}\.\d+)/)
    if (m) return { address: m[1].trim(), lat: +m[2], lon: +m[3] }
    if (/Primary Location's Address/.test(t) && i > 6) return { address: (t.match(/Primary Location's Address:\s*([^\n]*)/) || [])[1]?.trim() || null, lat: null, lon: null }
    await sleep(1000)
  }
  return { address: null, lat: null, lon: null }
}

// When the record page gives no coordinates, the permit (or public application) PDF does: its location table has a
// "Latitude:  Longitude:" header with the values on the next line.
async function pdfPosition(page, r) {
  const files = await recordFiles(page, r.record)
  const f = files.find((x) => /^(Hydraulic Project Approval \d+|PM_\d{4}-\d+-\d+\+\d+_\d+)\.pdf$/i.test(x.name)) || files.find((x) => /^PM_APPLICATION_PUBLIC_\d+\.pdf$/i.test(x.name))
  if (!f) return null
  mkdirSync(CACHE, { recursive: true })
  const local = `${CACHE}/${r.apps}-${f.name.replace(/[^\w.+-]+/g, '_')}`
  if (!existsSync(local)) { const url = await downloadUrl(page, f.share); if (!url) return null; await fetchTo(url, local) }
  // Older permits: "Latitude:  Longitude:"; 2026 on: "Latitude  Longitude", once per site. The first site places the
  // record; how many sites the permit lists is kept.
  const lines = pdfText(local).split('\n'), sites = []
  lines.forEach((l, i) => {
    if (!/Latitude/.test(l) || !/Longitude/.test(l)) return
    const m = lines.slice(i + 1, i + 4).join(' ').match(/(4[6-9]\.\d{3,})\s+(-12[0-4]\.\d{3,})/)
    if (m) sites.push([+(+m[1]).toFixed(6), +(+m[2]).toFixed(6)])
  })
  return sites.length ? { lat: sites[0][0], lon: sites[0][1], sites: sites.length, positionFrom: f.name } : null
}

async function main() {
  const out = { ...(existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}), ...(existsSync(KEPT) ? JSON.parse(readFileSync(KEPT, 'utf8')) : {}) }
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setUserAgent(UA)
  let requests = 1
  try {
    const rows = (await search(page)).filter((r) => /San Juan/i.test(r.county || ''))
    console.log(`San Juan County applications submitted since ${SINCE}: ${rows.length}`)
    const today = new Date().toISOString().slice(0, 10)
    for (const r of rows.slice(0, LIMIT)) {
      const prev = out[r.apps]
      let pos = !REFRESH && prev?.lat != null ? { address: prev.address, lat: prev.lat, lon: prev.lon, positionFrom: prev.positionFrom } : (requests++, await recordPosition(page, r.record))
      if (pos.lat == null) { const p = await pdfPosition(page, r); requests += 3; if (p) pos = { ...pos, ...p } }
      else if (!pos.positionFrom) pos.positionFrom = 'WDFW record page'
      out[r.apps] = { ...r, ...pos, read: today, first_seen: prev?.first_seen || today }
      console.log(`  ${r.apps} ${r.status} ${r.permit || ''} ${r.project} @ ${pos.lat},${pos.lon}`)
    }
  } finally { await browser.close() }
  writeFileSync(OUT, JSON.stringify(out, null, 1))
  mkdirSync(CACHE, { recursive: true }); writeFileSync(KEPT, JSON.stringify(out))
  console.log(`requests: ${requests}; ${OUT}: ${Object.keys(out).length} applications`)
}

main().catch((e) => { console.error(e); process.exit(1) })
