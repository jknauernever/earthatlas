#!/usr/bin/env node
// Build data/species-of-concern/wa-federal-esa.json: federal Endangered Species Act status for
// species that occur in Washington, from USFWS ECOS (the federal listing database, which also
// carries NOAA Fisheries-led listings).
//
//   node scripts/species-of-concern/build-wa-federal.mjs
//   node scripts/species-of-concern/resolve-ids.mjs data/species-of-concern/wa-federal-esa.json
//
// USFWS-led entities: every ECOS entity whose range includes WA. NOAA-led entities carry no state
// range in ECOS, so the Washington ones are picked by ECOS entity id below (NOAA West Coast Region
// species whose listed area includes Washington waters or rivers). One entry per taxon; a taxon
// with several listed populations (salmon ESUs, humpback DPSs) keeps each in `entities`.
// Source IDs already resolved in an existing file are carried over.

import fs from 'node:fs'

const OUT = 'data/species-of-concern/wa-federal-esa.json'
const ECOS = 'https://ecos.fws.gov/ecp/pullreports/catalog/species/report/species/export'
const COLS = '/species@cn,sn,status,status_category,desc,agency,id,listing_date'

// Federal categories reported. "Species of Concern" is an informal USFWS label with no ESA
// protection; it is kept as its own category. Delisted taxa, similarity-of-appearance listings and
// resolved taxa are left out. NOAA's Species of Concern list is not in ECOS and is not used.
const KEEP = new Set(['Endangered', 'Threatened', 'Proposed Endangered', 'Proposed Threatened', 'Candidate',
  'Under Review', 'Experimental Population, Non-Essential', 'Species of Concern'])

// ECOS entries left out on purpose.
const SKIP = {
  9227: 'coyote: ECOS lists Canis latrans as a WA Species of Concern, which no other source supports; it would match nearly every point',
}

const NOAA_WA = {
  9126: 'killer whale, Southern Resident',
  11355: 'humpback whale, Mexico DPS', 11356: 'humpback whale, Central America DPS',
  6235: 'gray whale, Western North Pacific DPS',
  3199: 'blue whale', 3096: 'fin whale', 1769: 'sei whale', 4719: 'sperm whale', 10145: 'North Pacific right whale',
  3318: 'Guadalupe fur seal',
  7590: 'Chinook, Upper Columbia spring', 3398: 'Chinook, Snake spring/summer', 7834: 'Chinook, Lower Columbia',
  4799: 'Chinook, Puget Sound', 4300: 'Chinook, Snake fall',
  5180: 'chum, Columbia River', 1509: 'chum, Hood Canal summer', 9021: 'coho, Lower Columbia',
  6843: 'sockeye, Ozette Lake', 8278: 'sockeye, Snake River',
  6220: 'steelhead, Lower Columbia', 9432: 'steelhead, Puget Sound', 5815: 'steelhead, Middle Columbia',
  7989: 'steelhead, Snake River Basin', 2528: 'steelhead, Upper Columbia',
  10150: 'eulachon, Southern DPS', 4093: 'green sturgeon, Southern DPS',
  10142: 'bocaccio, Puget Sound-Georgia Basin', 10153: 'yelloweye rockfish, Puget Sound-Georgia Basin',
  154: 'leatherback', 9941: 'loggerhead, North Pacific DPS', 11191: 'green sea turtle, East Pacific DPS',
  160: 'olive ridley',
}

// Not in ECOS yet (NOAA proposal, 2023-03-16).
const MANUAL = [{
  ecos_id: null, common: 'sunflower sea star', sci: 'Pycnopodia helianthoides', status: 'Proposed Threatened',
  desc: 'Throughout its range', agency: 'NMFS', url: 'https://www.fisheries.noaa.gov/species/sunflower-sea-star',
}]

// Entities whose listing covers every Washington member of the species, so a species-level
// record in WA is a record of the listed entity (e.g. the only spotted owls in WA are northern).
const ALL_OF_WA = {
  24: 'lynx', 143: 'marbled murrelet', 301: 'bull trout', 6901: 'yellow-billed cuckoo', 160: 'olive ridley',
  2: 'grizzly bear', 4016: 'wolverine', 142: 'northern spotted owl', 10220: 'white-tailed ptarmigan',
  132: 'snowy plover', 33: 'caribou', 11570: 'California condor', 1240: 'pygmy rabbit',
  4734: 'black tern (all North American birds are surinamensis)', 6615: 'northern red-legged frog (all WA red-legged frogs)',
  5150: 'northern sagebrush lizard (all WA sagebrush lizards)',
}

// Plain wording for entities whose ECOS description is a long legal text.
const SHORT_DESC = {
  11: 'western Washington only (west of US 97, SR 17 and US 395); wolves east of that line are delisted',
  11191: 'East Pacific DPS', 9941: 'North Pacific Ocean DPS', 160: 'all populations except the Mexican Pacific breeding colonies',
  6901: 'Western DPS (includes all of Washington)', 1240: 'Columbia Basin DPS (Douglas, Grant, Lincoln, Adams and Benton counties)',
  3: 'Columbia River DPS (Clark, Cowlitz, Pacific, Skamania and Wahkiakum counties)',
  11570: 'experimental population (Oregon, northern California, northwest Nevada)',
}

// Current names where ECOS keeps an old one that the sources no longer use.
const NAME_FIX = {
  1126: { name: 'Lupinus oreganus', rank: 'species', synonyms: ['Lupinus sulphureus kincaidii', 'Lupinus oreganus kincaidii'] }, // Kincaid's lupine
  4734: { name: 'Chlidonias niger surinamensis', rank: 'subspecies', synonyms: [] }, // ECOS misspells "surinamenisis"
  5903: { name: 'Lomatium lithosolamans', rank: 'species', synonyms: ['Tauschia hooveri'] }, // Hoover's tauschia, renamed
  3574: { name: 'Corydalis caseana aquae-gelidae', rank: 'subspecies', synonyms: ['Corydalis aquae-gelidae'] },
  1418: { name: 'Lupinus cusickii', rank: 'species', synonyms: ['Lupinus lepidus cusickii'], inat_name: 'Lupinus lepidus cusickii' }, // Cusick's lupine
}

// Taxa the sources have merged into a common, widespread one: their records of the merged taxon
// are shown as "listed taxon not confirmed", and the resolver leaves these IDs alone (locked).
const MERGED = {
  7509: { // Thurber's reedgrass
    inat_taxon_id: null, inat_species_taxon_id: 140213, gbif_taxon_key: 4121322, gbif_species_key: 4108416,
    note: 'iNaturalist and GBIF now include Calamagrostis crassiglumis in northern reedgrass (Calamagrostis inexpansa). Northern reedgrass records are not confirmed records of Thurber\'s reedgrass.',
  },
}

async function ecos(filter) {
  const u = new URL(ECOS)
  u.searchParams.set('format', 'json'); u.searchParams.set('columns', COLS); u.searchParams.set('filter', filter)
  const res = await fetch(u)
  if (!res.ok) throw new Error(`${res.status} ${u}`)
  return (await res.json()).data.map(r => ({
    common: r[0], sci: r[1].value, url: r[1].url, status: r[2], category: r[3], desc: r[4], agency: r[5],
    ecos_id: r[6], listing_date: r[7] || null,
  }))
}

// "Oncorhynchus (=Salmo) mykiss" -> name + synonym; "Rangifer tarandus ssp. caribou" -> trinomial.
function parseName(sci) {
  const alt = []
  let s = sci.replace(/\s+/g, ' ').trim()
  const m = s.match(/^(\S+) \(=(\S+)\) (.+)$/)
  if (m) { s = `${m[1]} ${m[3]}`; alt.push(`${m[2]} ${m[3]}`) }
  const e = s.match(/^(\S+) (\S+) \(=(\S+)\)(.*)$/)
  // ECOS puts the current epithet in the parentheses: "Physeter catodon (=macrocephalus)"
  if (e) { s = `${e[1]} ${e[3]}${e[4]}`; alt.push(`${e[1]} ${e[2]}${e[4]}`) }
  const rank = / var\. /.test(s) ? 'variety' : s.split(' ').length > 2 ? 'subspecies' : 'species'
  const strip = (x) => x.replace(/ (ssp|subsp|var)\. /, ' ')
  return { name: strip(s), synonyms: alt.map(strip), rank }
}

const RANK_ORDER = ['Endangered', 'Threatened', 'Proposed Endangered', 'Proposed Threatened', 'Candidate',
  'Experimental Population, Non-Essential', 'Under Review', 'Species of Concern']
const WHOLE = /^(wherever found|throughout its range|)$/i

const fws = (await ecos("/species/range_state@abbrev='WA'")).filter(r => r.agency === 'FWS' && KEEP.has(r.status) && !SKIP[r.ecos_id])
const noaa = (await ecos("/species@agency like '%NMFS%'")).filter(r => NOAA_WA[r.ecos_id])
const missing = Object.keys(NOAA_WA).filter(id => !noaa.some(r => r.ecos_id === Number(id)))
if (missing.length) console.warn('NOAA ids not found in ECOS:', missing.map(id => `${id} ${NOAA_WA[id]}`).join('; '))
const rows = [...fws, ...noaa, ...MANUAL]

const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).species : []
const ID_FIELDS = ['inat_taxon_id', 'inat_species_taxon_id', 'gbif_taxon_key', 'gbif_species_key', 'ebird_species_code', 'ebird_issf_code']

const byName = new Map()
for (const r of rows) {
  const p = NAME_FIX[r.ecos_id] || parseName(r.sci)
  const key = p.name.toLowerCase()
  if (!byName.has(key)) byName.set(key, {
    common_name: r.common === 'No common name' ? null : r.common.replace(/\s+/g, ' '), scientific_name: p.name, synonyms: p.synonyms, rank: p.rank,
    status: null, lead_agency: r.agency, match_level: 'species', note: null, entities: [],
    ...(p.inat_name ? { inat_name: p.inat_name } : {}),
  })
  const e = byName.get(key)
  for (const s of p.synonyms) if (!e.synonyms.includes(s)) e.synonyms.push(s)
  if (MERGED[r.ecos_id]) e.merged = MERGED[r.ecos_id]
  e.entities.push({ status: r.status, all_of_wa: !!ALL_OF_WA[r.ecos_id],
    listed_entity: SHORT_DESC[r.ecos_id] || (r.desc || '').replace(/\s*-?\s*See 50 CFR [\d.]+/i, '').trim() || 'Wherever found',
    listing_date: r.listing_date || null, ecos_id: r.ecos_id, source_url: r.url || `https://ecos.fws.gov/ecp/species/${r.ecos_id}` })
}

const species = [...byName.values()].map(e => {
  e.entities.sort((a, b) => RANK_ORDER.indexOf(a.status) - RANK_ORDER.indexOf(b.status))
  e.status = e.entities[0].status
  const covers = (x) => x.all_of_wa || (WHOLE.test(x.listed_entity) && e.rank === 'species')
  if (!e.entities.some(covers)) {
    e.match_level = 'subspecies_or_population'
    e.note = e.rank !== 'species' && e.entities.every(x => WHOLE.test(x.listed_entity))
      ? `Federal status covers only the ${e.rank} ${e.scientific_name}.`
      : `Federal status applies only to: ${e.entities.map(x => `${x.listed_entity} (${x.status})`).join('; ')}.`
  }
  for (const x of e.entities) delete x.all_of_wa
  const old = prev.find(p => p.scientific_name === e.scientific_name)
  for (const f of ID_FIELDS) e[f] = old?.[f] ?? null
  if (e.merged) {
    Object.assign(e, { ...e.merged, match_level: 'subspecies_or_population', locked: true })
    delete e.merged
  }
  if (!e.common_name && old?.common_name) { e.common_name = old.common_name; e.common_name_source = old.common_name_source }
  return e
}).sort((a, b) => RANK_ORDER.indexOf(a.status) - RANK_ORDER.indexOf(b.status) || (a.common_name || a.scientific_name).localeCompare(b.common_name || b.scientific_name))

const out = {
  jurisdiction: 'US-WA',
  authority: 'US federal (Endangered Species Act)',
  compiled: new Date().toISOString().slice(0, 10),
  sources: {
    ecos_export: ECOS,
    usfws_washington: 'https://ecos.fws.gov/ecp/report/species-listings-by-state?stateAbbrev=WA&stateName=Washington&statusCategory=Listed',
    noaa_west_coast: 'https://www.fisheries.noaa.gov/west-coast/endangered-species-conservation',
  },
  notes: [
    'USFWS-led entries: ECOS entities whose range includes WA. NOAA-led entries: chosen by ECOS id (ECOS gives them no state range); see scripts/species-of-concern/build-wa-federal.mjs.',
    '"Species of Concern" is an informal USFWS label with no ESA protection, kept as its own category. NOAA\'s Species of Concern list is not in ECOS and is not used.',
    'Left out: delisted taxa, similarity-of-appearance listings (Dolly Varden, WA), and ECOS\'s WA "Species of Concern" entry for coyote (no other source supports it).',
    'Sunflower sea star is from NOAA Fisheries (proposed 2023-03-16); not yet in ECOS.',
  ],
  species,
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
console.log(`${species.length} taxa (${rows.length} listed entities) -> ${OUT}`)
for (const e of species) console.log(`${e.status.padEnd(22)} ${e.common_name} | ${e.scientific_name}${e.synonyms.length ? ` [${e.synonyms}]` : ''} | ${e.rank}${e.match_level !== 'species' ? ' | POP: ' + e.entities.map(x => x.listed_entity.slice(0, 40)).join('; ') : ''}`)
