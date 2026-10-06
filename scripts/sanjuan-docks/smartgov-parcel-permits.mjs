#!/usr/bin/env node
// Fetch San Juan County SmartGov permits (2010 → today) for a list of parcels, via the
// public "Parcel Permit Search 2010-YTD" report — the only public route: SmartGov has
// no API and its report runs in a browser (Exago) and downloads one .xlsx per parcel.
//
//   node scripts/sanjuan-docks/smartgov-parcel-permits.mjs 262314005000 262022004000
//   node scripts/sanjuan-docks/smartgov-parcel-permits.mjs --from-docks [--limit N]
//
// --from-docks takes the parcels of the docks in public/hpa/san-juan-docks.geojson.
// Needs puppeteer-core (not a repo dependency), installed in data/sanjuan-docks/tools
// (`npm i --prefix data/sanjuan-docks/tools puppeteer-core@23`) or PUPPETEER_DIR=<dir>.
// Writes every permit row to data/sanjuan-docks/smartgov-raw/<parcel>.json (resumable:
// parcels already fetched are skipped) and the dock-related rows to
// data/sanjuan-docks/smartgov-permits.json, which scripts/bake-sanjuan-docks.mjs reads.
// One parcel at a time with a pause between, to be gentle on the county's server.

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve(process.env.PUPPETEER_DIR ?? 'data/sanjuan-docks/tools', 'noop.js'));
const puppeteer = require('puppeteer-core');

const PORTAL = 'https://co-sanjuan-wa.smartgovcommunity.com/Public/ReportsView';
const REPORT_ID = 'b2f93386-ce64-48fd-b1d3-c8b03eee4cf7'; // "Parcel Permit Search 2010-YTD"
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const RAW_DIR = 'data/sanjuan-docks/smartgov-raw';
const OUT = 'data/sanjuan-docks/smartgov-permits.json';
const PAUSE_MS = 3000;

// Dock work in SmartGov: shoreline permit types, or any permit whose description names it.
const DOCK_WORDS = /\b(dock|docks|pier|piers|float|floats|gangway|gangways|moorage|boat ?lift)\b/i;

// ─── Parcels to fetch ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const limitAt = args.indexOf('--limit');
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;
let parcels = args.filter((a, i) => /^\d{9,12}$/.test(a) && (limitAt < 0 || i !== limitAt + 1));
if (args.includes('--from-docks')) {
  const fc = JSON.parse(readFileSync('public/hpa/san-juan-docks.geojson', 'utf8'));
  const set = new Set();
  for (const f of fc.features) {
    for (const p of f.properties.permits) {
      for (const d of String(p.parcel_number ?? '').match(/\d{9,12}/g) ?? []) set.add(d.length === 9 ? `${d}000` : d);
    }
  }
  parcels = [...set].sort();
}
parcels = parcels.slice(0, limit);
if (!parcels.length) { console.error('No parcels given.'); process.exit(1); }

// ─── xlsx → rows (no dependency: unzip + read the sheet XML) ────────────────
function readXlsx(file) {
  const unzip = (member) => {
    try { return execFileSync('unzip', ['-p', file, member], { encoding: 'utf8', maxBuffer: 64 << 20 }) } catch { return '' }
  };
  const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const shared = [...unzip('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const sheet = unzip('xl/worksheets/sheet1.xml');
  return [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells = {};
    for (const c of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] ?? '')?.[1];
      const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] ?? '')?.[1];
      if (v == null && inline == null) continue;
      cells[c[1]] = / t="s"/.test(c[2]) ? shared[Number(v)] : inline != null ? unescape(inline) : v;
    }
    return cells;
  });
}

// Excel serial date → YYYY-MM-DD
const excelDate = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 20000 ? new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10) : (v ?? null);
};

// The report: a title block, then a header row ("Permit Number", "Permit Type", …).
function permitsFromRows(rows, parcel) {
  const h = rows.findIndex((r) => Object.values(r).includes('Permit Number'));
  if (h < 0) return [];
  const col = Object.fromEntries(Object.entries(rows[h]).map(([k, v]) => [v, k]));
  return rows.slice(h + 1)
    .filter((r) => r[col['Permit Number']] && r[col['Permit Type']]) // drops the report's footer count row
    .map((r) => ({
      parcel_number: parcel,
      permit_number: r[col['Permit Number']],
      permit_type: r[col['Permit Type']] ?? null,
      site_address: r[col['Site Address']] ?? null,
      applicant: r[col['Applicant']] ?? null,
      project_description: r[col['Project Description']] ?? null,
      submitted: excelDate(r[col['Date Submitted']]),
      issued: excelDate(r[col['Date Issued']]),
      status: r[col['Permit Status']] ?? null,
      island: r[col['Island']] ?? null,
    }));
}

const isDockPermit = (p) =>
  DOCK_WORDS.test(`${p.project_description ?? ''} ${p.permit_type ?? ''}`) ||
  (/^SHORELINE /.test(p.permit_type ?? '') && !/TREE REMOVAL|MOORING BUOY/.test(p.permit_type));

// ─── Drive the report ───────────────────────────────────────────────────────
async function fetchParcel(browser, parcel, dlDir) {
  rmSync(dlDir, { recursive: true, force: true });
  mkdirSync(dlDir, { recursive: true });
  const page = await browser.newPage();
  try {
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(dlDir) });
    await page.goto(PORTAL, { waitUntil: 'networkidle2', timeout: 60000 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
      page.evaluate((id) => window.ReportsView.viewReport(id, 'Exago'), REPORT_ID),
    ]);
    // Filter dialog: one value box for Permits.Primary Parcel Number, then "Run Report".
    const input = await page.waitForSelector('input[type="text"]:not([readonly])', { visible: true, timeout: 60000 });
    await input.click();
    await input.type(parcel);
    const run = await page.waitForSelector('::-p-text(Run Report)', { visible: true, timeout: 20000 });
    await run.click();
    for (let t = 0; t < 90; t++) {
      await new Promise((r) => setTimeout(r, 1000));
      const done = readdirSync(dlDir).find((f) => f.endsWith('.xlsx'));
      if (done) return permitsFromRows(readXlsx(path.join(dlDir, done)), parcel);
      // A parcel with no permits since 2010 gets a "No Data Qualified" dialog, not a file.
      if (t >= 3 && await page.evaluate(() => document.body.innerText.includes('No Data Qualified'))) return [];
    }
    throw new Error('no download after 90 s');
  } finally {
    await page.close();
  }
}

mkdirSync(RAW_DIR, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const dlDir = 'data/sanjuan-docks/.download';
let fetched = 0;
try {
  for (const [i, parcel] of parcels.entries()) {
    const raw = path.join(RAW_DIR, `${parcel}.json`);
    if (existsSync(raw)) continue;
    const t0 = Date.now();
    try {
      const permits = await fetchParcel(browser, parcel, dlDir);
      writeFileSync(raw, JSON.stringify(permits, null, 1));
      fetched++;
      console.log(`[${i + 1}/${parcels.length}] ${parcel}: ${permits.length} permits, ${permits.filter(isDockPermit).length} dock (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (e) {
      console.log(`[${i + 1}/${parcels.length}] ${parcel}: FAILED — ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
} finally {
  await browser.close();
  rmSync(dlDir, { recursive: true, force: true });
}

// Rebuild the dock-permit file from every parcel fetched so far.
const all = readdirSync(RAW_DIR).filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(path.join(RAW_DIR, f), 'utf8')));
const docks = all.filter(isDockPermit);
writeFileSync(OUT, JSON.stringify(docks, null, 1));
console.log(`fetched ${fetched} new parcel(s); ${docks.length} dock permits of ${all.length} → ${OUT}`);
