#!/usr/bin/env node
/**
 * One-off bake: HappyWhale speciesKey → iNaturalist taxon (id + ancestor ids).
 *
 * The main EarthAtlas search is keyed on iNaturalist taxa ("Cetaceans" = iNat 152871). HappyWhale's API has no species
 * filter and its own speciesKeys, so the main site needs to know which HappyWhale species fall under the taxon a
 * visitor picked. This resolves each HappyWhale scientific name to its iNat taxon once and writes
 * src/happywhale/hwTaxa.json: { speciesKey: { scientific, name, inatId, ancestors: [...] } }.
 * Pages then match with zero lookups (selected taxon id ∈ [inatId, ...ancestors]).
 *
 * Re-run when HappyWhale adds species (unmapped keys are simply left out of main-site results):
 *   HW_SPECIES_URL=http://localhost:5173/api/happywhale?op=species node scripts/happywhale/bake-taxa.mjs
 * ~1 iNat call per unique scientific name, spaced 1.1 s (iNat asks for ≤ 60/min).
 * ONLY_MISSING=1 keeps the existing file and looks up just the species it lacks.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const SPECIES_URL = process.env.HW_SPECIES_URL || 'http://localhost:5173/api/happywhale?op=species'
const OUT = new URL('../../src/happywhale/hwTaxa.json', import.meta.url)
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const species = await (await fetch(SPECIES_URL)).json()
if (!Array.isArray(species)) throw new Error('unexpected species payload')

// Only real binomials (skips "other", water samples, marine debris, "unidentified …" with no scientific name).
const isBinomial = (s) => /^[A-Z][a-z]+ [a-z-]+( [a-z-]+)?$/.test((s || '').trim())
const existing = process.env.ONLY_MISSING && existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const have = new Set(Object.values(existing).map((t) => t.scientific))
const names = [...new Set(species.map((s) => (s.scientific || '').trim()).filter(isBinomial))]
  .filter((n) => !have.has(n) && !/ spp$/.test(n))
  .slice(0, LIMIT)
console.log(`${species.length} HappyWhale species → ${names.length} scientific names to resolve`)

const byName = {}
for (const name of names) {
  const url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(name)}&is_active=true&per_page=10`
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'EarthAtlas taxa bake (earthatlas.org)' } })
    const data = await res.json()
    // Exact name first; else iNat's synonym match (HappyWhale keeps some older names, e.g. Lagenorhynchus obliquidens
    // → iNat's Aethalodelphis obliquidens), which iNat reports as matched_term.
    const lc = name.toLowerCase()
    const hit = (data.results || []).find((t) => t.name.toLowerCase() === lc)
      || (data.results || []).find((t) => (t.matched_term || '').toLowerCase() === lc && ['species', 'subspecies'].includes(t.rank))
    if (hit) byName[name] = { inatId: hit.id, ancestors: hit.ancestor_ids || [] }
    else console.warn(`  no exact iNat match: ${name}`)
  } catch (err) {
    console.warn(`  lookup failed: ${name} (${err.message})`)
  }
  await sleep(1100)
}

const out = { ...existing }
for (const s of species) {
  const t = byName[(s.scientific || '').trim()]
  if (t) out[s.code] = { scientific: s.scientific.trim(), name: s.name, inatId: t.inatId, ancestors: t.ancestors }
}
writeFileSync(OUT, JSON.stringify(out, null, 0) + '\n')
console.log(`wrote ${Object.keys(out).length} species to ${OUT.pathname}`)
