#!/usr/bin/env node
/**
 * Reads WDFW Hydraulic Project Approvals (HPAs) for /permits records at forage fish spawning beaches or herring
 * spawning areas: the permit's own provisions (hpa-conditions.mjs parseHpa) and any forage fish survey files in the
 * permit's public WDFW record (Josh 2026-10-15). Writes data/permits/hpa-conditions.json, merged by permit number.
 *
 *   node scripts/permits/hpa-fetch.mjs [--only <permit number>] [--limit N] [--refresh] [--refresh-lists]
 *
 * --refresh-lists re-reads each record's file list (new survey uploads, status changes) but reuses files already
 * downloaded; the weekly bake (.github/workflows/permits-bake.yml) runs it that way.
 *
 * WDFW's HPA site (hpa.wdfw.wa.gov) is a Salesforce site rendered by script, so a headless Chrome reads each record's
 * file list and each file's share page (where Salesforce reveals the file's download id). The files themselves are
 * plain downloads. Everything fetched is kept in scripts/permits/cache/hpa/ (gitignored) and reused unless --refresh.
 * Chrome: CHROME_PATH, else the macOS app, else google-chrome on PATH (GitHub's runners have it).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, basename, join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { parseHpa } from './hpa-conditions.mjs'

const OUT = 'data/permits/hpa-conditions.json'
const CACHE = 'scripts/permits/cache/hpa'
const UA = 'EarthAtlas PermitTracker (https://earthatlas.org/permits)'
const SPAWN = ['hfd', 'hhe']
const args = process.argv.slice(2)
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const ONLY = flag('--only'), LIMIT = Number(flag('--limit') || Infinity), REFRESH = args.includes('--refresh'), LISTS = REFRESH || args.includes('--refresh-lists')
const CHROME = process.env.CHROME_PATH || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
const SURVEY_FILE = /forage fish|\bFFS\b|egg ?survey|spawn(ing)? survey/i
const safe = (s) => s.replace(/[^\w.+-]+/g, '_')

// Which HPAs: those at the dock of a record whose map point is within 300 m of a spawning beach or herring area.
function wanted() {
  const d = JSON.parse(readFileSync('public/permits-data/permits.json', 'utf8'))
  const nums = new Set(d.projects.filter((r) => (r.near || []).some((x) => SPAWN.includes(x.h)))
    .flatMap((r) => (r.docks || []).flatMap((k) => k.permits)).filter((p) => p.agency === 'wdfw' && p.number)
    .flatMap((p) => String(p.number).split(/\s*,\s*/)))
  // The WDFW record page for each permit number, from the /sanjuan-docks bake.
  const rec = new Map()
  for (const f of JSON.parse(readFileSync('public/hpa/san-juan-docks.geojson', 'utf8')).features) {
    for (const p of f.properties.permits) if (/WDFW/.test(p.source) && p.permit_number) rec.set(p.permit_number, { record: p.source_url, issued: p.issued, expires: p.expires, status: p.status })
  }
  // WDFW applications found by hpa-search.mjs (attached to records as hpaApps) bring their own record page.
  for (const r of d.projects.filter((x) => (x.near || []).some((n) => SPAWN.includes(n.h)))) {
    for (const a of r.hpaApps || []) if (a.permit && !rec.has(a.permit)) {
      const app = JSON.parse(readFileSync('data/permits/hpa-applications.json', 'utf8'))[a.apps]
      if (app) { nums.add(a.permit); rec.set(a.permit, { record: app.record, issued: a.issued, status: app.permitStatus ? `HPA ${app.permitStatus}` : app.status }) }
    }
  }
  return [...nums].filter((n) => rec.has(n) && (!ONLY || n === ONLY)).slice(0, LIMIT).map((n) => ({ permit: n, ...rec.get(n) }))
}

// A record page's files: [{ name, share }] (links live inside Lightning web components' shadow roots).
export async function recordFiles(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 })
  for (let i = 0; i < 30; i++) {
    const files = await page.evaluate(() => {
      const out = []
      const walk = (root) => { for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) walk(el.shadowRoot); if (el.tagName === 'A' && /salesforce\.com\/sfc\/p\//.test(el.href)) out.push({ name: el.textContent.trim(), share: el.href }) } }
      walk(document)
      return out
    })
    if (files.length) return [...new Map(files.map((f) => [f.name, f])).values()]
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`no files listed at ${url}`)
}

// A share page loads page images from …/renditionDownload?versionId=…&oid=…&d=…; the same ids give the original file.
export async function downloadUrl(page, share) {
  let hit = null
  const onReq = (req) => { if (!hit && /renditionDownload|\/sfc\/dist\/version\/download/.test(req.url())) hit = req.url() }
  page.on('request', onReq)
  await page.goto(share, { waitUntil: 'networkidle2', timeout: 90000 })
  for (let i = 0; i < 20 && !hit; i++) await new Promise((r) => setTimeout(r, 500))
  page.off('request', onReq)
  if (!hit) return null
  const u = new URL(hit)
  const q = new URLSearchParams({ oid: u.searchParams.get('oid'), ids: u.searchParams.get('versionId') || u.searchParams.get('ids'), d: u.searchParams.get('d'), operationContext: 'DELIVERY', asPdf: 'false', viewId: '' })
  return `${u.origin}/sfc/dist/version/download/?${q}`
}

export async function fetchTo(url, file) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
}
// OCR (Tesseract) for scans and photos: typed text reads well; handwriting does not, and stays for a person to read.
// PDFs are rendered page by page first (up to 4 pages). Missing tesseract → no OCR, never a failure.
export function ocrText(file) {
  try {
    if (/\.pdf$/i.test(file)) {
      execFileSync('pdftoppm', ['-r', '200', '-l', '4', '-png', file, `${file}.ocr`])
      return readdirSync(dirname(file)).filter((f) => f.startsWith(`${basename(file)}.ocr`)).sort()
        .map((f) => execFileSync('tesseract', [join(dirname(file), f), '-', '--psm', '3'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).join('\n')
    }
    return execFileSync('tesseract', [file, '-', '--psm', '3'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch { return '' }
}
export const pdfText = (file) => { try { return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }) } catch { return '' } }

// A survey file's date(s) and egg result, quoted only from its own text. Photos and scans have no text: a person reads
// them. A file named as a survey that is really a copy of the permit is said to be one.
const DATE = /\b(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\b/g
const RESULT = /(?:[A-Za-z]+\s+){0,4}(?:no\s+(?:\w+\s+){0,2}eggs?\b(?:\s+(?:were|was)\s+(?:found|detected|observed))?|eggs?\s+(?:were\s+|was\s+)?(?:not\s+)?(?:found|detected|observed|present)\b)/i
export function readSurvey(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  if (t.length < 40) return { needsPerson: true }
  if (/HYDRAULIC PROJECT APPROVAL/.test(t) && /Permit Number:/.test(t) && /PROVISIONS/.test(t)) return { permitCopy: true }
  const dates = [...new Set(t.match(DATE) || [])].slice(0, 3)
  // Skip a data sheet's code legend ("0 = no eggs visible"): only a finding, never a definition, is a result.
  const re = new RegExp(RESULT.source, 'gi')
  const result = [...t.matchAll(re)].find((m) => !/=/.test(t.slice(Math.max(0, m.index - 6), m.index + m[0].length)))?.[0].trim() || null
  return { dates, result, needsPerson: !result }
}

async function main() {
  const list = wanted()
  console.log(`HPAs to read: ${list.length}${ONLY ? ` (only ${ONLY})` : ''}`)
  const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setUserAgent(UA)
  let requests = 0
  try {
    for (const h of list) {
      const dir = `${CACHE}/${safe(h.permit)}`
      mkdirSync(dir, { recursive: true })
      const filesJson = `${dir}/files.json`
      let files
      if (!LISTS && existsSync(filesJson)) files = JSON.parse(readFileSync(filesJson, 'utf8'))
      else { files = await recordFiles(page, h.record); requests++; writeFileSync(filesJson, JSON.stringify(files, null, 1)) }
      // The permit PDF: "PM_<permit>_<n>.pdf" (older records) or "Hydraulic Project Approval <APPS id>.pdf" (2026 on).
      const permitRe = new RegExp(`^(PM_${h.permit.replace(/[+]/g, '\\+')}_\\d+|Hydraulic Project Approval \\d+)\\.pdf$`, 'i')
      const getFile = async (f) => {
        const local = `${dir}/${safe(f.name)}`
        if (REFRESH || !existsSync(local)) {
          const url = await downloadUrl(page, f.share); requests++
          if (!url) throw new Error(`no download for ${f.name}`)
          await fetchTo(url, local); requests++
        }
        return local
      }
      const permitFile = files.find((f) => permitRe.test(f.name))
      if (!permitFile) { console.warn(`  ${h.permit}: no permit PDF in the record`); continue }
      const parsed = parseHpa(pdfText(await getFile(permitFile)))
      const surveys = []
      for (const f of files.filter((x) => SURVEY_FILE.test(x.name))) {
        const local = await getFile(f)
        // Text first; scans and photos through OCR. A result read by OCR says so; nothing read stays for a person.
        let read = /\.pdf$/i.test(f.name) ? readSurvey(pdfText(local)) : { needsPerson: true, image: true }
        if (read.needsPerson && !read.permitCopy) {
          const o = readSurvey(ocrText(local))
          if (o.permitCopy || o.result) read = { ...o, ocr: true }
          else if (/\.(jpe?g|png|tiff?)$/i.test(f.name)) read = { needsPerson: true, image: true }
        }
        surveys.push({ name: f.name.replace(/^\d+_/, ''), url: f.share, ...read })
      }
      out[h.permit] = { permit: h.permit, record: h.record, file: permitFile.share, issued: h.issued, expires: h.expires || null, status: h.status || null, read: new Date().toISOString().slice(0, 10), ...parsed, surveys }
      console.log(`  ${h.permit}: ${parsed.provisions} provisions; species ${Object.entries(parsed.species).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none named'}; surveys ${surveys.length}`)
    }
  } finally { await browser.close() }
  writeFileSync(OUT, JSON.stringify(out, null, 1))
  console.log(`requests: ${requests}; ${OUT}: ${Object.keys(out).length} permits`)
}

if (process.argv[1]?.endsWith('hpa-fetch.mjs')) main().catch((e) => { console.error(e); process.exit(1) })
