#!/usr/bin/env node
// Upload the baked PER-MONTH vessel-track PMTiles to Vercel Blob and record the
// public URLs in the client manifest (src/shiptraffic/trackSource.json).
//
//   BLOB_READ_WRITE_TOKEN=... node scripts/bake-shiptraffic/upload.mjs
//
// One PMTiles per month (track_tiles/tracks-YYYY-MM.pmtiles), uploaded as
// shiptraffic/tracks-YYYY-MM-<version>.pmtiles with a stable path (no random
// suffix) so re-baking the SAME version overwrites in place; bump `version` in
// trackSource.json to cut a new immutable set of URLs.
//
// Per-month (not one combined file) on purpose: the app stacks only the months
// in view (capped + sampled), so each tile stays small (~150-460 KB). A single
// joined file produced ~16 MB tiles that hung the Mapbox worker.

import { readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { put } from '@vercel/blob';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Missing BLOB_READ_WRITE_TOKEN. Get it from the Vercel project (Storage > Blob) and re-run.');
  process.exit(1);
}

const manifestPath = resolve(repoRoot, 'src', 'shiptraffic', 'trackSource.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const version = manifest.version;

const ALL_MONTHS = [2024, 2025].flatMap((y) =>
  Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`));
// One tileset per month — the app stacks them; no year/all aggregates.
const TILESETS = ALL_MONTHS;

const tilesDir = resolve(__dirname, 'track_tiles');
const urls = {};
let total = 0;

for (const id of TILESETS) {
  const pmtilesPath = resolve(tilesDir, `tracks-${id}.pmtiles`);
  if (!existsSync(pmtilesPath)) {
    console.warn(`  ${id}: SKIP (no tile at ${pmtilesPath})`);
    continue;
  }
  const { size } = await stat(pmtilesPath);
  const key = `shiptraffic/tracks-${id}-${version}.pmtiles`;
  process.stdout.write(`  ${id}: ${(size / 1e6).toFixed(1)} MB -> ${key} ... `);
  const { url } = await put(key, createReadStream(pmtilesPath), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/octet-stream',
    allowOverwrite: true,
    multipart: size > 8e6, // multipart only pays off for the bigger summer months
  });
  urls[id] = url;
  total += size;
  process.stdout.write('done\n');
}

if (!Object.keys(urls).length) {
  console.error('No tiles uploaded. Run build_tracks_tiles.py first.');
  process.exit(1);
}

manifest.tiles = Object.fromEntries(ALL_MONTHS.filter((m) => urls[m]).map((m) => [m, urls[m]]));
manifest.updatedAt = new Date().toISOString().slice(0, 10);
delete manifest.years;
delete manifest.all;
delete manifest.pmtilesUrl;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nUploaded ${Object.keys(urls).length} tilesets (${(total / 1e6).toFixed(0)} MB total).`);
console.log(`Updated ${manifestPath}`);
