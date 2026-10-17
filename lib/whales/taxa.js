/**
 * One taxonomy for every feed: iNaturalist's. Each record resolves to an iNat
 * taxon (or to "not identified"), and its animal group comes from that taxon's
 * ancestors.
 *
 * - iNaturalist records carry their taxon and ancestors.
 * - SalishSea.io carries iNat taxon ids (species_id); ancestors are looked up.
 * - HappyWhale species keys map through src/happywhale/hwTaxa.json.
 * - Maplify and OBIS names go through curatedScientific() (Maplify's names are
 *   free text, several languages, sometimes mis-encoded) and then an iNat name
 *   lookup. Every resolution is cached in <schema>.name_map.
 */
import HW_TAXA from '../../src/happywhale/hwTaxa.json' with { type: 'json' }
import { fetchJson } from './http.js'

export const CETACEA = 152871

// Ancestor roots → animal group (iNaturalist taxon ids).
export const GROUP_ROOTS = [
  [152871, 'cetacean'],
  [372843, 'pinniped'],    // Phocoidea
  [46306, 'sirenian'],
  [526556, 'otter'],       // Lutrinae
  [551307, 'shark'],       // Selachii
  [448201, 'ray'],         // Batoidea
  [372234, 'sea_turtle'],  // Chelonioidea
]

export function groupOf(inatId, ancestorIds = []) {
  const ids = new Set([...(ancestorIds || []), inatId])
  for (const [root, group] of GROUP_ROOTS) if (ids.has(root)) return group
  return 'other'
}

/** Undo UTF-8 read as Latin-1 ("Baleine Ã  bosse" → "Baleine à bosse"). */
export function fixMojibake(s) {
  if (!s || !/[ÃÂ]/.test(s)) return s
  try {
    const fixed = Buffer.from(s, 'latin1').toString('utf8')
    return fixed.includes('�') ? s : fixed
  } catch {
    return s
  }
}

const NOT_ANIMAL = { notAnimal: true }
const UNIDENTIFIED = { unidentified: true }

// Ordered: the first matching rule wins (specific before general).
const RULES = [
  [/\b(wood|buoy|object|debris|hazard)\b|^megafauna$|non-whale/, NOT_ANIMAL],
  [/^(unspecified|unknown|other|other species|other - enter below|other \(specify in comments\)|no especificado|non sp[eé]cifi[eé]|autre|ind[eé]termin[eé]|unidentified|unidentified close call|unknown close call)$/, UNIDENTIFIED],
  [/seals? on ice/, 'Phocidae'],
  [/california sea lion/, 'Zalophus californianus'],
  [/steller/, 'Eumetopias jubatus'],
  [/sea lion/, 'Otariidae'],
  [/harbou?r seal/, 'Phoca vitulina'],
  [/elephant seal/, 'Mirounga'],
  [/sea otter/, 'Enhydra lutris'],
  [/manatee/, 'Trichechus'],
  [/blue shark/, 'Prionace glauca'],
  [/thresher/, 'Alopias'],
  [/hammerhead/, 'Sphyrnidae'],
  [/white shark/, 'Carcharodon carcharias'],
  [/basking shark/, 'Cetorhinus maximus'],
  [/whale shark/, 'Rhincodon typus'],
  [/shark/, 'Selachii'],
  [/mola|sunfish/, 'Mola mola'],
  [/right whale dolphin/, 'Lissodelphis borealis'],
  [/false killer/, 'Pseudorca crassidens'],
  [/pygmy killer/, 'Feresa attenuata'],
  [/short.?finned pilot/, 'Globicephala macrorhynchus'],
  [/long.?finned pilot/, 'Globicephala melas'],
  [/pilot whale/, 'Globicephala'],
  [/dwarf sperm/, 'Kogia sima'],
  [/pygmy sperm/, 'Kogia breviceps'],
  [/sperm|cachalot/, 'Physeter macrocephalus'],
  [/killer|orca/, 'Orcinus orca'],
  [/humpback|bosse|jorobada/, 'Megaptera novaeangliae'],
  [/^gr[ae]y\b|gr[ae]y whale|gray_whale|baleine grise|ballena gris/, 'Eschrichtius robustus'],
  [/fin ?back|^fin whale|^fin$|rorqual commun|ballena de aleta/, 'Balaenoptera physalus'],
  [/minke|petit rorqual/, 'Balaenoptera acutorostrata'],
  [/\bsei\b/, 'Balaenoptera borealis'],
  [/blue whale|baleine bleue|ballena azul/, 'Balaenoptera musculus'],
  [/bowhead/, 'Balaena mysticetus'],
  [/right whale|baleine noire|baleine franche/, 'Eubalaena'],
  [/beluga/, 'Delphinapterus leucas'],
  [/baird/, 'Berardius bairdii'],
  [/bottlenose whale/, 'Hyperoodon'],
  [/risso/, "Grampus griseus"],
  [/white.?sided/, 'Lagenorhynchus obliquidens'],
  [/long.?beaked common|common long.?beaked/, 'Delphinus delphis'],
  [/short.?beaked common|common short.?beaked/, 'Delphinus delphis'],
  [/bottlenose dolphin|grand dauphin/, 'Tursiops truncatus'],
  [/common dolphin/, 'Delphinus'],
  [/dall/, 'Phocoenoides dalli'],
  [/harbou?r porpoise|marsouin commun/, 'Phocoena phocoena'],
  [/dolphin|dauphin|delf[ií]n/, 'Delphinidae'],
  [/porpoise|marsouin/, 'Phocoenidae'],
  [/whale|cetacean|baleine|ballena/, 'Cetacea'],
]

const LATIN = /^[A-Z][a-z]+( [a-z-]+){0,2}$/

/**
 * A free-text feed name (+ the feed's own scientific name) →
 * { scientific } | { notAnimal: true } | { unidentified: true }.
 * The name wins over the feed's scientific name: Maplify files
 * "Grand dauphin" (bottlenose) under Delphinus.
 */
export function curatedScientific(name, scientific) {
  const n = fixMojibake(String(name || '')).toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  for (const [re, out] of RULES) {
    if (re.test(n)) return typeof out === 'string' ? { scientific: out } : out
  }
  const sci = String(scientific || '').trim()
  if (LATIN.test(sci)) return { scientific: sci }
  return UNIDENTIFIED
}

export function rawNameKey(name, scientific) {
  return `${fixMojibake(String(name || '')).trim().toLowerCase()}|${String(scientific || '').trim().toLowerCase()}`
}

/** HappyWhale speciesKey → { inat_id, scientific, common, ancestors } | { unidentified } | { notAnimal }. */
export function happywhaleTaxon(speciesKey, configScientific) {
  if (!speciesKey) return UNIDENTIFIED
  const t = HW_TAXA[speciesKey]
  if (t?.inatId) return { inat_id: t.inatId, scientific: t.scientific, common: t.name, ancestors: t.ancestors || [] }
  if (/debris|algae|water_sample/.test(speciesKey)) return NOT_ANIMAL
  if (/^unidentified_(baleen|beaked)/.test(speciesKey)) return { scientific: 'Cetacea' }
  if (speciesKey === 'unidentified_dolphin') return { scientific: 'Delphinidae' }
  if (speciesKey === 'unidentified_seal') return { scientific: 'Phocidae' }
  if (configScientific && LATIN.test(configScientific)) return { scientific: configScientific }
  return UNIDENTIFIED
}

const INAT = 'https://api.inaturalist.org/v1'
// American common names on every site ("Gray Whale", not "Grey Whale"): iNat picks names by place.
export const INAT_NAMES = 'locale=en&preferred_place_id=1'

function taxonRow(t) {
  return {
    inat_id: t.id,
    scientific_name: t.name,
    common_name: t.preferred_common_name || null,
    rank: t.rank || null,
    ancestor_ids: (t.ancestor_ids || []).filter((x) => x !== t.id),
  }
}

/** iNat taxon by exact scientific name (synonyms resolve to the current name). */
export async function inatTaxonByName(scientific) {
  const j = await fetchJson(`${INAT}/taxa?q=${encodeURIComponent(scientific)}&per_page=10&${INAT_NAMES}`)
  const want = scientific.toLowerCase()
  const hit = (j.results || []).find((t) => t.name.toLowerCase() === want && t.is_active !== false)
    || (j.results || []).find((t) => (t.matched_term || '').toLowerCase() === want)
  return hit ? taxonRow(hit) : null
}

/** iNat taxa by id, ≤30 per request. */
export async function inatTaxaByIds(ids) {
  const out = []
  for (let i = 0; i < ids.length; i += 30) {
    const j = await fetchJson(`${INAT}/taxa/${ids.slice(i, i + 30).join(',')}?${INAT_NAMES}`)
    for (const t of j.results || []) out.push(taxonRow(t))
  }
  return out
}

export async function upsertTaxa(c, S, rows) {
  if (!rows.length) return
  const data = rows.map((r) => ({ ...r, animal_group: groupOf(r.inat_id, r.ancestor_ids) }))
  // iNaturalist itself (its feed, and iNat lookups) owns names; other feeds (HappyWhale) only fill gaps,
  // so a species' name doesn't flip between sources every hour.
  const owns = data.filter((r) => r.authoritative !== false)
  const fills = data.filter((r) => r.authoritative === false)
  const names = {
    owns: `scientific_name = EXCLUDED.scientific_name, common_name = COALESCE(EXCLUDED.common_name, ${S}.taxa.common_name)`,
    fills: `scientific_name = CASE WHEN ${S}.taxa.scientific_name ~ '^[0-9]+$' THEN EXCLUDED.scientific_name ELSE ${S}.taxa.scientific_name END,
       common_name = COALESCE(${S}.taxa.common_name, EXCLUDED.common_name)`,
  }
  for (const [kind, batch] of [['owns', owns], ['fills', fills]]) {
    if (!batch.length) continue
    await c.query(
      `INSERT INTO ${S}.taxa (inat_id, scientific_name, common_name, rank, ancestor_ids, animal_group)
       SELECT x.inat_id, x.scientific_name, x.common_name, x.rank, ARRAY(SELECT jsonb_array_elements_text(x.ancestor_ids)::int), x.animal_group
       FROM jsonb_to_recordset($1::jsonb) AS x(inat_id int, scientific_name text, common_name text, rank text, ancestor_ids jsonb, animal_group text)
       ON CONFLICT (inat_id) DO UPDATE SET ${names[kind]},
         rank = COALESCE(EXCLUDED.rank, ${S}.taxa.rank),
         ancestor_ids = CASE WHEN cardinality(EXCLUDED.ancestor_ids) > 0 THEN EXCLUDED.ancestor_ids ELSE ${S}.taxa.ancestor_ids END,
         animal_group = CASE WHEN cardinality(EXCLUDED.ancestor_ids) > 0 THEN EXCLUDED.animal_group ELSE ${S}.taxa.animal_group END,
         updated_at = now()`,
      [JSON.stringify(batch)],
    )
  }
}

/**
 * Fill norm.inat_id on every record (mutates). A record's norm.taxon is one of:
 *   { inat_id, scientific?, common?, ancestors? }   – the feed names the iNat taxon
 *   { raw_name, raw_scientific }                    – resolve through name_map / curated rules / iNat
 *   { notAnimal: true } | { unidentified: true }
 * Returns the records that are animals (notAnimal ones are dropped).
 */
export async function resolveTaxa(c, S, feed, recs, log = () => {}) {
  // 1. Taxa the feeds hand us directly.
  const direct = new Map()
  for (const r of recs) {
    const t = r.norm.taxon
    if (t?.inat_id) direct.set(t.inat_id, t)
  }
  if (direct.size) {
    const { rows } = await c.query(`SELECT inat_id FROM ${S}.taxa WHERE inat_id = ANY($1::int[]) AND cardinality(ancestor_ids) > 0`, [[...direct.keys()]])
    const known = new Set(rows.map((x) => x.inat_id))
    const withAnc = []
    const needAnc = []
    for (const [id, t] of direct) {
      // A feed that hands us the full taxon (iNat, HappyWhale) refreshes names every time;
      // one that only names an id (SalishSea.io) is looked up once.
      if (t.ancestors?.length) withAnc.push({ inat_id: id, scientific_name: t.scientific || String(id), common_name: t.common || null, rank: t.rank || null, ancestor_ids: t.ancestors, authoritative: feed === 'inaturalist' })
      else if (!known.has(id)) needAnc.push(id)
    }
    if (needAnc.length) { log(`  taxa: looking up ${needAnc.length} iNat ids`); withAnc.push(...(await inatTaxaByIds(needAnc))) }
    await upsertTaxa(c, S, withAnc)
  }

  // 2. Names.
  const byKey = new Map()
  for (const r of recs) {
    const t = r.norm.taxon
    if (!t || t.inat_id || t.notAnimal || t.unidentified) continue
    const k = rawNameKey(t.raw_name, t.raw_scientific)
    if (!byKey.has(k)) byKey.set(k, t)
  }
  const resolved = new Map()
  if (byKey.size) {
    const { rows } = await c.query(`SELECT raw_name, inat_id, method FROM ${S}.name_map WHERE feed = $1 AND raw_name = ANY($2::text[])`, [feed, [...byKey.keys()]])
    for (const x of rows) resolved.set(x.raw_name, x)
    const sciCache = new Map()
    for (const [k, t] of byKey) {
      if (resolved.has(k)) continue
      const cur = curatedScientific(t.raw_name, t.raw_scientific)
      let inat_id = null
      let method = cur.notAnimal ? 'not_animal' : cur.unidentified ? 'unresolved' : 'curated'
      if (cur.scientific) {
        if (!sciCache.has(cur.scientific)) sciCache.set(cur.scientific, await inatTaxonByName(cur.scientific))
        const hit = sciCache.get(cur.scientific)
        if (hit) { await upsertTaxa(c, S, [hit]); inat_id = hit.inat_id } else method = 'unresolved'
      }
      await c.query(
        `INSERT INTO ${S}.name_map (feed, raw_name, inat_id, method) VALUES ($1, $2, $3, $4)
         ON CONFLICT (feed, raw_name) DO UPDATE SET inat_id = EXCLUDED.inat_id, method = EXCLUDED.method, resolved_at = now()`,
        [feed, k, inat_id, method],
      )
      resolved.set(k, { raw_name: k, inat_id, method })
      log(`  name: ${feed} "${k}" → ${inat_id ?? '—'} (${method})`)
    }
  }

  // 3. Write back.
  const keep = []
  for (const r of recs) {
    const t = r.norm.taxon || {}
    if (t.notAnimal) continue
    if (t.inat_id) r.norm.inat_id = t.inat_id
    else if (t.unidentified) r.norm.inat_id = null
    else {
      const m = resolved.get(rawNameKey(t.raw_name, t.raw_scientific))
      if (m?.method === 'not_animal') continue
      r.norm.inat_id = m?.inat_id ?? null
    }
    keep.push(r)
  }
  return keep
}
