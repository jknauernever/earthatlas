#!/usr/bin/env node
// Tile a region's NDJSON into PMTiles with tippecanoe.
//
//   node scripts/bake-parcels/tile.mjs nm
//
// Reads  build/<regionId>-<version>.ndjson
// Writes build/<regionId>-<version>.pmtiles  (source-layer is always "parcels")

import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const regionId = process.argv[2];
if (!regionId) { console.error('usage: node tile.mjs <regionId>'); process.exit(1); }

const cfg = JSON.parse(await readFile(resolve(__dirname, 'configs', `${regionId}.json`), 'utf8'));
const base = resolve(__dirname, 'build', `${cfg.regionId}-${cfg.version}`);
const input = `${base}.ndjson`;
const output = `${base}.pmtiles`;
await stat(input); // throws a clear error if extract hasn't run

const maxZoom = 16;
const minZoom = cfg.minZoom ?? 12;
const args = [
  '-o', output,
  '-l', 'parcels',                 // stable source-layer name across all regions
  '-n', `${cfg.label} Parcels ${cfg.version}`,
  '-A', `Parcel data: ${cfg.citation.short}`,
  `-Z${minZoom}`, `-z${maxZoom}`,
  '--drop-densest-as-needed',      // size backstop at low zoom
  '--extend-zooms-if-still-dropping',
  '--simplification=8',            // shrink low-zoom geometry → fewer features dropped

  '--force',
  input,
];

console.log('tippecanoe', args.join(' '));
const child = spawn('tippecanoe', args, { stdio: 'inherit' });
child.on('exit', async (code) => {
  if (code !== 0) { console.error(`tippecanoe exited ${code}`); process.exit(code ?? 1); }
  const { size } = await stat(output);
  console.log(`\nPMTiles: ${output}  (${(size / 1e6).toFixed(1)} MB)`);
});
