#!/usr/bin/env node
/**
 * Fill ships.fcc_ship_lookup (migration 038) from the FCC ULS weekly ship-licence file, so the web intake page
 * (earthatlas.org/ships/intake) can find a boat's licences by name. Only licences that carry an MMSI (~169k).
 * Licensee names only for organisations (lib/ships/registry.js partyPrivacy); a person's name is never stored.
 * DEV database unless run through `zsh scripts/ships/prod.sh fcc-lookup` (backs up production first).
 *
 *   npm run ships:import-fcc-lookup -- --names "ISLAND EXPRESS,LEEWAY"   # dev: just these names (prove it works)
 *   npm run ships:import-fcc-lookup                                       # the whole file (replaces the table)
 *   add --fetch to download the weekly file first (~44 MB, data.fcc.gov), --dry-run to count only
 *
 * Input: scripts/ships/bake-ais/build/registries/l_ship/{SH,HD,EN,counts} (as scripts/ships/import-fcc.mjs uses).
 */
import { createReadStream, existsSync } from 'node:fs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA, schemaIdent, withTx } from '../../lib/ships/db.js'
import { normName } from '../../lib/ships/normalize.js'
import { partyPrivacy } from '../../lib/ships/registry.js'
import { splitLine, SH_FIELDS as SH, LICENSE_STATUS } from '../../lib/ships/fccUls.js'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bake-ais', 'build', 'registries')
const FCC = path.join(DIR, 'l_ship')
const URL_ZIP = 'https://data.fcc.gov/download/pub/uls/complete/l_ship.zip'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const S = schemaIdent(opt('schema') || DEFAULT_SCHEMA)
const only = opt('names') ? new Set(opt('names').split(',').map((x) => normName(x.trim())).filter(Boolean)) : null

async function* lines(f) { for await (const l of createInterface({ input: createReadStream(f), crlfDelay: Infinity })) yield l }

if (args.includes('--fetch')) {
  await mkdir(DIR, { recursive: true })
  const zip = path.join(DIR, 'l_ship.zip')
  const res = await fetch(URL_ZIP)
  if (!res.ok) throw new Error(`FCC download HTTP ${res.status}`)
  await writeFile(zip, Buffer.from(await res.arrayBuffer()))
  execFileSync('unzip', ['-o', '-q', zip, '-d', FCC])
}
if (!existsSync(path.join(FCC, 'SH.dat'))) throw new Error(`no FCC file in ${FCC} (run with --fetch)`)
const stamp = (await readFile(path.join(FCC, 'counts'), 'utf8').catch(() => '')).match(/File Creation Date: (.+)/)?.[1]?.trim() || 'unknown'

const rows = new Map()
for await (const l of lines(path.join(FCC, 'SH.dat'))) {
  if (!l.startsWith('SH|')) continue
  const f = splitLine(l)
  const mmsi = (f[SH.station_number] || '').trim()
  const name = (f[SH.ship_name] || '').trim()
  if (!/^\d{9}$/.test(mmsi) || !name) continue
  const norm = normName(name)
  if (only && !only.has(norm)) continue
  rows.set(f[1], { usi: f[1], callsign: f[SH.callsign] || null, ship_name: name, name_norm: norm, mmsi,
    length_m: Number(f[SH.ship_length]) > 0 ? Number(f[SH.ship_length]) : null, status: null, service: null, licensee_org: null, licensee_place: null })
}
for await (const l of lines(path.join(FCC, 'HD.dat'))) {
  const r = rows.get(l.split('|', 3)[1]); if (!r) continue
  const f = splitLine(l); r.status = LICENSE_STATUS[f[5]] || f[5] || null; r.service = f[6] || null
}
for await (const l of lines(path.join(FCC, 'EN.dat'))) {
  const r = rows.get(l.split('|', 3)[1]); if (!r) continue
  const f = splitLine(l)
  if (partyPrivacy({ applicantType: f[23], recreational: false }).storeName && f[7]) { r.licensee_org = f[7]; r.licensee_place = [f[16], f[17]].filter(Boolean).join(' ') || null }
}
const list = [...rows.values()]
const host = new URL(process.env.SHIPS_DATABASE_URL).host.split('.')[0]
console.log(`FCC file ${stamp}: ${list.length} licences with an MMSI${only ? ` (names: ${[...only].join(', ')})` : ''} → ${S}.fcc_ship_lookup on ${host}`)
if (args.includes('--dry-run')) process.exit(0)

const pool = shipsPool()
try {
  await withTx(pool, async (c) => {
    // The whole file replaces the table; a --names load replaces just those names.
    if (only) await c.query(`DELETE FROM ${S}.fcc_ship_lookup WHERE name_norm = ANY($1)`, [[...only]])
    else await c.query(`DELETE FROM ${S}.fcc_ship_lookup`)
    for (let i = 0; i < list.length; i += 2000) {
      await c.query(`INSERT INTO ${S}.fcc_ship_lookup (usi, callsign, ship_name, name_norm, mmsi, length_m, status, service, licensee_org, licensee_place, dataset_version)
        SELECT r.usi, r.callsign, r.ship_name, r.name_norm, r.mmsi, r.length_m, r.status, r.service, r.licensee_org, r.licensee_place, $2
          FROM jsonb_to_recordset($1::jsonb) AS r(usi text, callsign text, ship_name text, name_norm text, mmsi text, length_m numeric,
               status text, service text, licensee_org text, licensee_place text)
        ON CONFLICT (usi) DO UPDATE SET callsign = EXCLUDED.callsign, ship_name = EXCLUDED.ship_name, name_norm = EXCLUDED.name_norm,
          mmsi = EXCLUDED.mmsi, length_m = EXCLUDED.length_m, status = EXCLUDED.status, service = EXCLUDED.service,
          licensee_org = EXCLUDED.licensee_org, licensee_place = EXCLUDED.licensee_place, dataset_version = EXCLUDED.dataset_version, loaded_at = now()`,
      [JSON.stringify(list.slice(i, i + 2000)), stamp])
      if (!only) process.stdout.write(`\r  ${Math.min(i + 2000, list.length)} / ${list.length}`)
    }
  })
  const [{ n }] = (await pool.query(`SELECT count(*)::int AS n FROM ${S}.fcc_ship_lookup`)).rows
  console.log(`\ndone: table now holds ${n} licences`)
} finally {
  await pool.end()
}
