#!/usr/bin/env node
// Extract + normalize a region's parcels to NDJSON GeoJSON (one Feature per line),
// which tippecanoe reads directly. Adapter-agnostic: picks the adapter from
// the region config's source.type.
//
//   node scripts/bake-parcels/extract.mjs nm
//
// Output: scripts/bake-parcels/build/<regionId>-<version>.ndjson  (gitignored)

import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { extractArcgis } from './lib/adapters/arcgis.mjs';
import { extractFile } from './lib/adapters/file.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADAPTERS = { arcgis: extractArcgis, file: extractFile };

const regionId = process.argv[2];
if (!regionId) {
  console.error('usage: node extract.mjs <regionId>   (e.g. nm)');
  process.exit(1);
}

const cfg = JSON.parse(await readFile(resolve(__dirname, 'configs', `${regionId}.json`), 'utf8'));
const adapter = ADAPTERS[cfg.source.type];
if (!adapter) {
  console.error(`no adapter for source.type="${cfg.source.type}"`);
  process.exit(1);
}

const buildDir = resolve(__dirname, 'build');
await mkdir(buildDir, { recursive: true });
const outPath = resolve(buildDir, `${cfg.regionId}-${cfg.version}.ndjson`);
const out = createWriteStream(outPath);

console.log(`Extracting ${cfg.label} (${cfg.source.type}) -> ${outPath}`);
const started = Date.now();
let total = 0;
let lastLog = 0;
let curLayer = null;

for await (const { layerId, feature } of adapter(cfg, {
  onProgress: ({ layerId, offset }) => {
    if (layerId !== curLayer) {
      curLayer = layerId;
      process.stdout.write(`\n  layer ${layerId}: `);
    }
  },
})) {
  if (!out.write(JSON.stringify(feature) + '\n')) {
    await new Promise((r) => out.once('drain', r)); // respect backpressure
  }
  total++;
  if (total - lastLog >= 5000) {
    lastLog = total;
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    process.stdout.write(`${total.toLocaleString()} (${secs}s) `);
  }
}

await new Promise((r) => out.end(r));
const secs = ((Date.now() - started) / 1000).toFixed(0);
console.log(`\nDone: ${total.toLocaleString()} features in ${secs}s -> ${outPath}`);
