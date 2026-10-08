#!/usr/bin/env node
/**
 * Metro Vancouver's PUBLIC lists of air quality permits, read the way a visitor reads them (2026-10-08):
 *   index           the "Current Permits and Approvals" page (…/air-quality-regulatory-program/current-permits-and-approvals): an HTML
 *                   table of current permit PDFs (title, issue date, holder). Plain GET, cached like every Metro Vancouver document
 *                   (scripts/ships/mv-fetch.mjs). It shows 50 rows and has no pager.
 *   search <term…>  Metro Vancouver's public site search (https://metrovancouver.org/Search/Pages/results.aspx?k=<term>), the search box
 *                   on that page. Results render by script, so this opens them in headless Chrome (puppeteer-core, not a repo
 *                   dependency: PUPPETEER_DIR=<dir with node_modules/puppeteer-core>, default data/sanjuan-docks/tools). One term per
 *                   page load, ≥ 2 s apart, EarthAtlas User-Agent; each result list cached in scripts/ships/facilities/cache/mv-search/.
 *                   THE SEARCH IS INCOMPLETE: "Neptune" finds nothing although permit 0081 (Neptune Bulk Terminals) is on the index.
 * The permit library's own listing is access-controlled and is never enumerated.
 *
 *   node scripts/ships/mv-index.mjs index
 *   node scripts/ships/mv-index.mjs search "Westshore" "Neptune" …   (--refresh to search again)
 */
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { mvDoc } from './mv-fetch.mjs'
import { MV_PROGRAM, parseMvIndex } from '../../lib/ships/metroVancouver.js'

export const INDEX_URL = `${MV_PROGRAM}/current-permits-and-approvals`
export const searchUrl = (term) => `https://metrovancouver.org/Search/Pages/results.aspx?k=${encodeURIComponent(term)}`
const SEARCH_CACHE = 'scripts/ships/facilities/cache/mv-search'
const UA = 'EarthAtlas-ships/1.0 (+https://earthatlas.org/ships)'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export async function mvIndex({ refresh = false } = {}) {
  const d = await mvDoc(INDEX_URL, { refresh })
  return { url: d.url, retrieved_at: d.retrieved_at, rows: parseMvIndex(d.text) }
}

/** Cached search results for each term: { term, url, retrieved_at, links: [file names] }; missing ones are searched. */
export async function mvSearch(terms, { refresh = false } = {}) {
  const out = []
  let browser = null, page = null, last = 0
  for (const term of terms) {
    const file = path.join(SEARCH_CACHE, `${slug(term)}.json`)
    if (!refresh) { try { out.push(JSON.parse(await readFile(file, 'utf8'))); continue } catch {} }
    if (!browser) {
      const require = createRequire(path.resolve(process.env.PUPPETEER_DIR ?? 'data/sanjuan-docks/tools', 'noop.js'))
      browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: 'new' })
      page = await browser.newPage()
      await page.setUserAgent(UA)
      await page.setViewport({ width: 1300, height: 1800 })
    }
    const wait = 2000 - (Date.now() - last)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
    const url = searchUrl(term)
    await mkdir(SEARCH_CACHE, { recursive: true })
    await appendFile('scripts/ships/facilities/cache/mv-requests.log', `${new Date().toISOString()} SEARCH ${url}\n`)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 })
    await new Promise((r) => setTimeout(r, 4000))   // results render by script after load
    const links = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="AirQualityPermits/"]')]
      .map((a) => decodeURI(a.href).split('AirQualityPermits/')[1]))])
    const r = { term, url, retrieved_at: new Date().toISOString(), links, method: 'headless Chrome, results page as rendered' }
    await writeFile(file, JSON.stringify(r, null, 1))
    out.push(r)
  }
  if (browser) await browser.close()
  return out
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith('mv-index.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2)
  const refresh = rest.includes('--refresh')
  const terms = rest.filter((x) => x !== '--refresh')
  if (cmd === 'index') {
    const r = await mvIndex({ refresh })
    for (const x of r.rows) console.log(`${x.gva ?? '?'} | ${x.date ?? ''} | ${x.holder ?? ''} | ${x.file}`)
    console.log(`${r.rows.length} rows (read ${r.retrieved_at})`)
  } else if (cmd === 'search') {
    for (const r of await mvSearch(terms, { refresh })) console.log(`${r.term}: ${r.links.length ? r.links.join(' | ') : 'nothing found'}`)
  } else console.log('usage: mv-index.mjs index | search <term…> [--refresh]')
}
