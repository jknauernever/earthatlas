#!/usr/bin/env node
// Upload a region's PMTiles to Vercel Blob and record the public URL in the
// client manifest (src/fire/parcelSources.json).
//
//   BLOB_READ_WRITE_TOKEN=... node scripts/bake-parcels/upload.mjs nm
//
// The file is uploaded as parcels/<regionId>-<version>.pmtiles with a stable
// path (no random suffix) so re-baking the SAME version overwrites in place;
// bump `version` in the config to cut a new immutable URL.

import { readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { put } from '@vercel/blob';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const regionId = process.argv[2];
if (!regionId) { console.error('usage: node upload.mjs <regionId>'); process.exit(1); }
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Missing BLOB_READ_WRITE_TOKEN. Get it from the Vercel project (Storage > Blob) and re-run.');
  process.exit(1);
}

const cfg = JSON.parse(await readFile(resolve(__dirname, 'configs', `${regionId}.json`), 'utf8'));
const pmtilesPath = resolve(__dirname, 'build', `${cfg.regionId}-${cfg.version}.pmtiles`);
const { size } = await stat(pmtilesPath);

const key = `parcels/${cfg.regionId}-${cfg.version}.pmtiles`;
console.log(`Uploading ${(size / 1e6).toFixed(1)} MB -> Blob ${key} (multipart) ...`);
// Stream + multipart: a single PUT of a half-gig file stalls; multipart chunks
// it (and is resilient to a flaky part). The SDK streams from disk, so we don't
// hold the whole file in memory either.
const { url } = await put(key, createReadStream(pmtilesPath), {
  access: 'public',
  addRandomSuffix: false,
  contentType: 'application/octet-stream',
  allowOverwrite: true,
  multipart: true,
  onUploadProgress: ({ loaded, total, percentage }) => {
    process.stdout.write(`\r  ${percentage}%  (${(loaded / 1e6).toFixed(0)}/${(total / 1e6).toFixed(0)} MB)        `);
  },
});
process.stdout.write('\n');
console.log('Blob URL:', url);

// Update the committed client manifest the FireApp imports.
const manifestPath = resolve(repoRoot, 'src', 'fire', 'parcelSources.json');
let manifest = {};
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* first run */ }
manifest[cfg.regionId] = {
  pmtilesUrl: url,
  sourceLayer: 'parcels',
  version: cfg.version,
  updatedAt: new Date().toISOString().slice(0, 10),
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Updated ${manifestPath}`);
