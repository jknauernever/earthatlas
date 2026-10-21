#!/usr/bin/env node
// Resolve a species-of-concern status list to iNaturalist taxon IDs, GBIF taxonKeys and
// eBird species codes, using each source's own name matching. Writes the IDs back into the
// list and prints every entry that did not resolve cleanly, so a person can decide it.
//
//   node scripts/species-of-concern/resolve-ids.mjs [file] [--limit N] [--only i,j] [--dry]
//
// Default file: data/species-of-concern/wa-state-listed.json
// Calls: ~1 iNaturalist + ~1 GBIF per entry (+1 per synonym if the main name misses), 1 eBird
// taxonomy download. iNaturalist is paced at 1 request/second.

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const file = args.find((a, i) => !a.startsWith('--') && !['--limit', '--only'].includes(args[i - 1]))
  || 'data/species-of-concern/wa-state-listed.json'
const limit = flag('--limit') ? Number(flag('--limit')) : Infinity
const only = flag('--only') ? flag('--only').split(',').map(Number) : null
const dry = args.includes('--dry')

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n')
  .map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
  .map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]))
const EBIRD_KEY = process.env.EBIRD_API_KEY || env.EBIRD_API_KEY || env.VITE_EBIRD_API_KEY

const UA = { 'User-Agent': 'EarthAtlas species-of-concern resolver (earthatlas.org)' }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let lastInat = 0
async function getJson(url, headers = {}) {
  if (url.includes('inaturalist.org')) {
    const wait = lastInat + 1000 - Date.now()
    if (wait > 0) await sleep(wait)
    lastInat = Date.now()
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { ...UA, ...headers } })
      if (res.status === 429 || res.status >= 500) throw new Error(`${res.status} ${url}`)
      if (!res.ok) throw Object.assign(new Error(`${res.status} ${url}`), { final: true })
      return await res.json()
    } catch (err) {
      if (err.final || attempt >= 4) throw err
      await sleep(2000 * attempt ** 2)  // dropped connections and rate limits: back off and retry
    }
  }
}

const norm = (s) => (s || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim()
const RANKS = { species: 'species', subspecies: 'subspecies,variety,form' }

// iNaturalist: exact scientific-name match among taxa; inactive names are followed to
// their current taxon. Returns { taxon, via } or null.
async function inatMatch(name, rank) {
  const q = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(name)}&rank=${RANKS[rank] || rank}&per_page=30&all_names=true`
  const { results } = await getJson(q)
  const exact = results.filter(t => norm(t.name) === norm(name))
  const active = exact.filter(t => t.is_active)
  if (active.length === 1) return { taxon: active[0], via: 'name' }
  if (active.length > 1) return { taxon: null, ambiguous: active.map(t => `${t.id} ${t.name} (${t.iconic_taxon_name})`) }
  // Name is a synonym on iNat: the search hit carries matched_term; take the active taxon
  // whose names include it.
  const syn = results.filter(t => t.is_active && norm(t.matched_term) === norm(name))
  if (syn.length === 1) return { taxon: syn[0], via: `synonym of ${syn[0].name}` }
  if (exact.length === 1) {
    const t = await getJson(`https://api.inaturalist.org/v1/taxa/${exact[0].id}`)
    const cur = t.results[0]?.current_synonymous_taxon_ids
    if (cur?.length === 1) {
      const c = await getJson(`https://api.inaturalist.org/v1/taxa/${cur[0]}`)
      return { taxon: c.results[0], via: `inactive ${exact[0].name} -> ${c.results[0].name}` }
    }
  }
  return null
}

// GBIF: the accepted taxon's key, except when GBIF folds the name into a taxon with a different
// final epithet (e.g. Sidalcea oregana var. calva -> subsp. oregana). Then the accepted key would
// pull in the common taxon's records, so keep the key for records filed under the listed name.
// compared without the Latin gender ending (Mimulus patulus = Erythranthe patula)
const lastEpithet = (n) => norm(n).split(' ').filter(w => !['var', 'subsp', 'ssp', 'f'].includes(w)).slice(1).pop()
  ?.replace(/(us|um|a|is|e|i)$/, '')
async function gbifMatch(name, rank) {
  const r = await getJson(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}&rank=${rank.toUpperCase()}&strict=true&verbose=true`)
  if (r.matchType === 'NONE' || !r.usageKey) return null
  const acc = r.acceptedUsageKey ? await getJson(`https://api.gbif.org/v1/species/${r.acceptedUsageKey}`) : null
  // also when a subspecies/variety name is accepted only as its species: the species key would
  // include every other subspecies (e.g. all cutthroat trout for coastal cutthroat)
  const folded = acc && (lastEpithet(acc.canonicalName) !== lastEpithet(name) || (rank !== 'species' && acc.rank === 'SPECIES'))
  return { key: folded ? r.usageKey : (r.acceptedUsageKey || r.usageKey), folded, matchType: r.matchType, status: r.status,
    name: r.scientificName, accepted: acc?.scientificName || null, acceptedKey: acc?.key, acceptedRank: acc?.rank,
    rank: r.rank, cls: r.class, speciesKey: r.speciesKey }
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'))
let todo = data.species.map((e, i) => [i, e])
if (only) todo = todo.filter(([i]) => only.includes(i))
todo = todo.filter(([, e]) => !e.locked)

// Reuse IDs already resolved for the same name and rank in the other lists in this folder.
const ID_FIELDS = ['inat_taxon_id', 'inat_species_taxon_id', 'gbif_taxon_key', 'gbif_species_key', 'ebird_species_code', 'ebird_issf_code']
const known = new Map()
for (const f of fs.readdirSync(path.dirname(file)).filter(f => f.endsWith('.json') && path.join(path.dirname(file), f) !== path.normalize(file))) {
  for (const o of JSON.parse(fs.readFileSync(path.join(path.dirname(file), f), 'utf8')).species || []) {
    if (!o.locked && (o.inat_taxon_id || o.inat_species_taxon_id)) known.set(`${o.scientific_name}|${o.rank}`, o)
  }
}
let reused = 0
todo = todo.filter(([, e]) => {
  if (e.inat_taxon_id || e.inat_species_taxon_id) return true
  const o = known.get(`${e.scientific_name}|${e.rank}`)
  if (!o) return true
  for (const f of ID_FIELDS) e[f] = o[f] ?? null
  if (!e.common_name && o.common_name) e.common_name = o.common_name
  reused++
  return false
})
if (reused) console.log(`reused IDs from other lists for ${reused} entries`)
todo = todo.slice(0, limit)

let ebirdTax = null
if (todo.some(([, e]) => true)) {
  if (!EBIRD_KEY) console.warn('no eBird key; skipping eBird codes')
  else ebirdTax = await getJson('https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&cat=species,issf', { 'X-eBirdApiToken': EBIRD_KEY })
}

const issues = []
let done = 0
for (const [i, e] of todo) {
  const names = [e.scientific_name, ...(e.synonyms || [])]
  const flagIt = (msg) => issues.push(`#${i} ${e.common_name} (${e.scientific_name}): ${msg}`)

  // iNaturalist
  let im = e.inat_name ? await inatMatch(e.inat_name, 'species,subspecies,variety') : null
  if (im?.taxon) im.via = 'name'
  else for (const n of names) { im = await inatMatch(n, e.rank); if (im) break }
  if (!im) flagIt('iNaturalist: no exact match')
  else if (!im.taxon) flagIt(`iNaturalist: several matches ${im.ambiguous.join('; ')}`)
  else if (im.via !== 'name' && data.species.some(o => o !== e && norm(o.scientific_name) === norm(im.taxon.name)))
    // iNat merged this name into another species on the same list (e.g. Erigeron davisii -> E. disparipilus)
    flagIt(`iNaturalist: merges this into ${im.taxon.name}, which is its own entry on this list; left unresolved`)
  else {
    e.inat_taxon_id = im.taxon.id
    if (im.via !== 'name') flagIt(`iNaturalist: ${im.via} (id ${im.taxon.id})`)
    const cn = im.taxon.preferred_common_name
    if (!e.common_name && cn) { e.common_name = cn; e.common_name_source = 'iNaturalist' }
    if (e.needs_verification && cn && !norm(e.common_name).includes(norm(cn).split(' ').pop()))
      flagIt(`iNaturalist common name "${cn}" differs from list "${e.common_name}"`)
    if (e.rank !== 'species' && im.taxon.ancestor_ids) {
      // species ID so species-level records can be shown as "listed population not confirmed"
      const sp = await getJson(`https://api.inaturalist.org/v1/taxa/${im.taxon.parent_id}`)
      if (sp.results[0]?.rank === 'species') e.inat_species_taxon_id = sp.results[0].id
    }
  }
  if (!e.inat_taxon_id && e.rank !== 'species') {
    // subspecies not in iNat: at least resolve the species
    const sp = await inatMatch(e.scientific_name.split(' ').slice(0, 2).join(' '), 'species')
    if (sp?.taxon) { e.inat_species_taxon_id = sp.taxon.id; flagIt(`iNaturalist: subspecies missing, species id ${sp.taxon.id} stored`) }
  }

  // GBIF
  let gm = null
  for (const n of names) { gm = await gbifMatch(n, e.rank); if (gm) break }
  if (!gm) flagIt('GBIF: no match')
  else {
    e.gbif_taxon_key = gm.key
    if (gm.matchType !== 'EXACT' || gm.status !== 'ACCEPTED')
      flagIt(`GBIF: ${gm.matchType} ${gm.status} "${gm.name}"${gm.accepted ? ` -> accepted ${gm.accepted}` : ''} (key ${gm.key})${gm.folded ? ' FOLDED: kept the listed name\'s own key' : ''}`)
    if (e.rank !== 'species') e.gbif_species_key = gm.folded && gm.acceptedRank === 'SPECIES' ? gm.acceptedKey : (gm.speciesKey || e.gbif_species_key)
  }
  if (!e.gbif_taxon_key && e.rank !== 'species') {
    const sp = await gbifMatch(e.scientific_name.split(' ').slice(0, 2).join(' '), 'species')
    if (sp) { e.gbif_species_key = sp.key; flagIt(`GBIF: subspecies missing, species key ${sp.key} stored`) }
  }

  // eBird (birds only: iNat iconic taxon Aves, or GBIF class Aves)
  const isBird = im?.taxon?.iconic_taxon_name === 'Aves' || gm?.cls === 'Aves'
  if (isBird && ebirdTax) {
    const cands = [...names, im?.taxon?.name].filter(Boolean).map(norm)
    const sp = ebirdTax.filter(t => t.category === 'species' && cands.includes(norm(t.sciName)))
    const ssp = e.rank !== 'species' ? ebirdTax.filter(t => t.category === 'issf' && cands.some(c => norm(t.sciName).startsWith(c))) : []
    if (e.rank !== 'species') {
      const binomials = cands.map(c => c.split(' ').slice(0, 2).join(' '))
      const parent = ebirdTax.find(t => t.category === 'species' && binomials.includes(norm(t.sciName)))
      if (parent) e.ebird_species_code = parent.speciesCode
      if (ssp.length) e.ebird_issf_code = ssp[0].speciesCode
      flagIt(`eBird: species code ${parent?.speciesCode || 'none'}${ssp.length ? `, subspecies group ${ssp[0].speciesCode} "${ssp[0].comName}"` : ', no subspecies group'}`)
    } else if (sp.length === 1) e.ebird_species_code = sp[0].speciesCode
    else flagIt(`eBird: ${sp.length ? 'several' : 'no'} species match`)
  }

  if (!dry && ++done % 25 === 0) fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')  // keep progress
  console.log(`#${i} ${e.common_name}: inat=${e.inat_taxon_id ?? '-'}${e.inat_species_taxon_id ? `/sp ${e.inat_species_taxon_id}` : ''} gbif=${e.gbif_taxon_key ?? '-'}${e.gbif_species_key ? `/sp ${e.gbif_species_key}` : ''} ebird=${e.ebird_species_code ?? '-'}${e.ebird_issf_code ? `/${e.ebird_issf_code}` : ''}`)
}

console.log(`\n${issues.length} entries to review:`)
for (const s of issues) console.log('- ' + s)
if (!dry) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
  console.log(`\nwrote ${path.relative(process.cwd(), file)}`)
}
