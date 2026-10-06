#!/usr/bin/env node
// Look up the public SmartGov page of every county dock permit in
// data/sanjuan-docks/smartgov-permits.json, so the map can link each permit to its own
// record (status, dates, submittals) instead of the search page. Writes
// data/sanjuan-docks/smartgov-guids.json { permit_number: case GUID }; resumable.
//
//   node scripts/sanjuan-docks/smartgov-permit-links.mjs
//
// The public application search posts a form guarded by SmartGov's per-page
// verification string, so it runs inside a real page (puppeteer-core, see
// smartgov-parcel-permits.mjs) — one search request per permit number.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve(process.env.PUPPETEER_DIR ?? 'data/sanjuan-docks/tools', 'noop.js'));
const puppeteer = require('puppeteer-core');

const SEARCH = 'https://co-sanjuan-wa.smartgovcommunity.com/ApplicationPublic/ApplicationSearch';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const IN = 'data/sanjuan-docks/smartgov-permits.json';
const OUT = 'data/sanjuan-docks/smartgov-guids.json';

const guids = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const todo = [...new Set(JSON.parse(readFileSync(IN, 'utf8')).map((p) => p.permit_number))].filter((n) => !(n in guids));
console.log(`${todo.length} permit numbers to look up (${Object.keys(guids).length} already known)`);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
try {
  const page = await browser.newPage();
  await page.goto(SEARCH, { waitUntil: 'networkidle2', timeout: 60000 });
  for (const [i, number] of todo.entries()) {
    // Exact permit-number match only — the search also matches names and addresses.
    const guid = await page.evaluate(async (q) => {
      const body = new URLSearchParams({ _conv: '1', query: q, __submitFormValidator__: window.FormSupport.requestVerificationString() });
      const html = await (await fetch('/ApplicationPublic/ApplicationSearch/Search', { method: 'POST', body })).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const item of doc.querySelectorAll('.search-result-item')) {
        const a = item.querySelector('.search-result-title a');
        const id = /Detail\/([0-9a-f-]{36})/.exec(a?.getAttribute('onclick') ?? '')?.[1];
        if (id && a.textContent.trim() === q) return id;
      }
      return null;
    }, number);
    guids[number] = guid;
    if ((i + 1) % 25 === 0 || !guid) console.log(`[${i + 1}/${todo.length}] ${number}: ${guid ?? 'NOT FOUND'}`);
    writeFileSync(OUT, JSON.stringify(guids, null, 1));
    await new Promise((r) => setTimeout(r, 500));
  }
} finally {
  await browser.close();
}
const found = Object.values(guids).filter(Boolean).length;
console.log(`${found} of ${Object.keys(guids).length} permits linked → ${OUT}`);
