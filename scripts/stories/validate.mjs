#!/usr/bin/env node
/**
 * Checks every story content file (content/, schema in content/schema/content.schema.json) before a build:
 * the schema first, then everything the schema can't see — ids, references between records, photo files,
 * layer ids against the subsite's registry, data keys against its published report counts, and sources.
 *
 * Usage:  node scripts/stories/validate.mjs        (exit 1 with a list of problems; npm run build runs it first)
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import { createServer } from 'vite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONTENT = join(ROOT, 'content')
const PUBLIC = join(ROOT, 'public')
const SCHEMA = JSON.parse(readFileSync(join(CONTENT, 'schema', 'content.schema.json'), 'utf8'))

// file name → record type and its schema definition
const TYPES = {
  'photos.json': 'photo', 'texts.json': 'text', 'stats.json': 'stat', 'actions.json': 'action', 'sources.json': 'source',
  'places.json': 'place', 'labels.json': 'labelSet', 'views.json': 'view', 'chapters.json': 'chapter',
}
// which owners may hold which types: organizations own wording, photos and chapters; subsites own maps and data
const ORG_TYPES = new Set(['photo', 'text', 'stat', 'action', 'source', 'chapter', 'story'])
const SUBSITE_TYPES = new Set(['stat', 'source', 'place', 'labelSet', 'view'])

const problems = []
const fail = (file, msg) => problems.push(`${relative(ROOT, file)}: ${msg}`)

// Load the brand list and the subsites' registries the way the site does (Vite resolves their imports).
const vite = await createServer({ root: ROOT, configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } })
let BRANDS, STORY_SUBSITES, countOf, COUNT_TOKEN
const registries = {}
try {
  ;({ BRANDS } = await vite.ssrLoadModule('/src/lib/brand.js'))
  ;({ STORY_SUBSITES, countOf, COUNT_TOKEN } = await vite.ssrLoadModule('/src/stories/subsites.js'))
  for (const [id, s] of Object.entries(STORY_SUBSITES)) registries[id] = { ...(await s.registry()), look: await s.look() }
} finally {
  await vite.close()
}
const ORGS = new Set(BRANDS.map((b) => b.id))
const SUBSITES = new Set(Object.keys(STORY_SUBSITES))
const counts = {}
for (const [id, s] of Object.entries(STORY_SUBSITES)) {
  const f = join(PUBLIC, s.counts)
  if (existsSync(f)) counts[id] = JSON.parse(readFileSync(f, 'utf8'))
  else problems.push(`src/stories/subsites.js: ${id}'s counts file ${s.counts} doesn't exist`)
}

// ── Read and schema-check every file ──
const ajv = new Ajv2020({ allErrors: true, strict: false })
ajv.addSchema(SCHEMA, 'content')
const check = (type) => ajv.getSchema(`content#/$defs/${type}`)
// oneOf alternatives explained in words (ajv's own messages for these are unreadable)
const ONE_OF = {
  stat: 'needs either a dataKey (a published count) or a literal value with its source, not both',
  view: 'camera needs exactly one of: place, bounds, or center with zoom',
}
const why = (errs, type) => (errs.some((e) => e.keyword === 'oneOf') && ONE_OF[type] ? [{ instancePath: '', message: ONE_OF[type] }, ...errs.filter((e) => !['oneOf', 'not', 'required'].includes(e.keyword) || e.instancePath.startsWith('/layers'))] : errs).map((e) => `${e.instancePath ? e.instancePath + ' ' : ''}${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(', ')})` : ''}${e.params?.additionalProperty ? ` '${e.params.additionalProperty}'` : ''}`).join('; ')

const records = {}   // type → id → { rec, owner, file }
const bad = new Set() // type:id of records that failed the schema: their own fields aren't checked further
const stories = []   // { story, owner, file }
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { fail(file, `isn't valid JSON (${e.message})`); return null } }

for (const owner of readdirSync(CONTENT).filter((d) => d !== 'schema' && statSync(join(CONTENT, d)).isDirectory())) {
  const dir = join(CONTENT, owner)
  const isOrg = ORGS.has(owner), isSubsite = SUBSITES.has(owner)
  if (!isOrg && !isSubsite) { fail(dir, `'${owner}' is neither an organization in src/lib/brand.js (${[...ORGS].join(', ')}) nor a story subsite in src/stories/subsites.js (${[...SUBSITES].join(', ')})`); continue }
  for (const name of readdirSync(dir)) {
    const file = join(dir, name)
    if (name === 'stories' && statSync(file).isDirectory()) {
      if (!isOrg) { fail(file, 'stories belong to an organization folder, not a subsite'); continue }
      for (const sn of readdirSync(file).filter((n) => n.endsWith('.json'))) {
        const sf = join(file, sn), story = readJson(sf)
        if (!story) continue
        if (!check('story')(story)) { fail(sf, why(check('story').errors, 'story')); continue }
        stories.push({ story, owner, file: sf })
      }
      continue
    }
    const type = TYPES[name]
    if (!type) { fail(file, `unknown file; content files are ${Object.keys(TYPES).join(', ')} and stories/<slug>.json`); continue }
    if (isOrg && !ORG_TYPES.has(type)) { fail(file, `${name} belongs in a subsite folder (it names that subsite's map or data)`); continue }
    if (isSubsite && !SUBSITE_TYPES.has(type)) { fail(file, `${name} belongs in an organization folder (wording, photos and chapters are the organization's)`); continue }
    const list = readJson(file)
    if (!list) continue
    if (!Array.isArray(list)) { fail(file, 'must be a list of records'); continue }
    for (const [i, rec] of list.entries()) {
      if (!check(type)(rec)) {
        fail(file, `record ${rec?.id ? `'${rec.id}'` : i + 1}: ${why(check(type).errors, type)}`)
        if (typeof rec?.id !== 'string') continue
        bad.add(`${type}:${rec.id}`)   // still registered, so references to it don't add a second, misleading problem
      }
      records[type] ??= {}
      const prev = records[type][rec.id]
      if (prev) { fail(file, `${type} id '${rec.id}' is also used in ${relative(ROOT, prev.file)}; ids are unique per record type`); continue }
      records[type][rec.id] = { rec, owner, file }
    }
  }
}

// ── References, files, layers, data ──
const get = (type, id) => records[type]?.[id]
function ref(file, where, type, id, label = type) {
  if (id == null) return null
  const r = get(type, id)
  if (!r) fail(file, `${where}: unknown ${label} '${id}'`)
  return r
}
function tokens(file, where, str) {
  for (const m of str.matchAll(COUNT_TOKEN)) {
    const [, sub, key] = m
    if (!SUBSITES.has(sub)) fail(file, `${where}: {{${sub}.${key}}} names unknown subsite '${sub}'`)
    else if (counts[sub] && countOf(counts[sub], key) === undefined) fail(file, `${where}: {{${sub}.${key}}} isn't in ${STORY_SUBSITES[sub].counts}`)
  }
  const stray = str.replace(COUNT_TOKEN, '').match(/\{\{[^}]*\}\}?/)
  if (stray) fail(file, `${where}: '${stray[0]}' isn't a valid count token; write {{subsite.key}} or {{subsite.key|decimals}}`)
}
const okBounds = ([w, s, e, n]) => w < e && s < n && w >= -180 && e <= 180 && s >= -90 && n <= 90

for (const { rec, file } of Object.values(records.photo || {}).filter((r) => !bad.has(`photo:${r.rec.id}`))) {
  if (!existsSync(join(PUBLIC, rec.src))) fail(file, `photo '${rec.id}': ${rec.src} isn't in public/`)
}
for (const { rec, file } of Object.values(records.text || {}).filter((r) => !bad.has(`text:${r.rec.id}`))) {
  tokens(file, `text '${rec.id}' body`, rec.body)
  for (const s of rec.sources || []) ref(file, `text '${rec.id}'`, 'source', s)
}
for (const { rec, owner, file } of Object.values(records.stat || {}).filter((r) => !bad.has(`stat:${r.rec.id}`))) {
  tokens(file, `stat '${rec.id}' label`, rec.label)
  if (rec.dataKey) {
    if (!SUBSITES.has(owner)) fail(file, `stat '${rec.id}': a stat bound to data (dataKey) belongs in its subsite's stats.json`)
    else if (counts[owner] && countOf(counts[owner], rec.dataKey) === undefined) fail(file, `stat '${rec.id}': dataKey '${rec.dataKey}' isn't in ${STORY_SUBSITES[owner].counts}`)
  } else {
    if (!ORGS.has(owner)) fail(file, `stat '${rec.id}': a literal value belongs in the organization's stats.json, with its source`)
    ref(file, `stat '${rec.id}'`, 'source', rec.source)
  }
}
for (const { rec, file } of Object.values(records.place || {}).filter((r) => !bad.has(`place:${r.rec.id}`))) {
  if (!okBounds(rec.bounds)) fail(file, `place '${rec.id}': bounds must be [west, south, east, north] with west < east and south < north`)
}
for (const { rec, owner, file } of Object.values(records.view || {}).filter((r) => !bad.has(`view:${r.rec.id}`))) {
  const reg = registries[owner], at = `view '${rec.id}'`
  const c = rec.camera
  if (c.place) { const p = ref(file, `${at} camera`, 'place', c.place); if (p && p.owner !== owner) fail(file, `${at}: place '${c.place}' is ${p.owner}'s, not ${owner}'s`) }
  if (c.bounds && !okBounds(c.bounds)) fail(file, `${at}: camera bounds must be [west, south, east, north] with west < east and south < north`)
  if (rec.labels) ref(file, at, 'labelSet', rec.labels, 'label set')
  for (const f of rec.frames || []) ref(file, `${at} frames`, 'place', f)
  const seen = new Set()
  for (const l of rec.layers) {
    if (!reg.layerIds.includes(l.id)) { fail(file, `${at}: unknown layer id '${l.id}' for ${owner}; its layers are ${reg.layerIds.join(', ')}`); continue }
    if (seen.has(l.id)) fail(file, `${at}: layer '${l.id}' is listed twice`)
    if (!reg.look.layers[l.id]) fail(file, `${at}: layer '${l.id}' has no story look yet (src/stories/looks/${owner}.js); story maps can show ${Object.keys(reg.look.layers).join(', ')}`)
    seen.add(l.id)
    if (l.opacity != null && l.emphasis !== 'dim') fail(file, `${at}: layer '${l.id}' has an opacity but emphasis '${l.emphasis}'; opacity is for dim only`)
    if (l.highlight && counts[owner]) {
      const s = counts[owner].sets?.[l.highlight]
      if (!s) fail(file, `${at}: layer '${l.id}' highlights set '${l.highlight}', which isn't in ${STORY_SUBSITES[owner].counts}${counts[owner].sets ? `; its sets are ${Object.keys(counts[owner].sets).join(', ')}` : ''}`)
      else if (s.layer !== l.id) fail(file, `${at}: set '${l.highlight}' is features of layer '${s.layer}', not '${l.id}'`)
    }
    if (l.highlight && l.emphasis === 'glow') fail(file, `${at}: layer '${l.id}' highlights '${l.highlight}' but is already at glow; give the rest of the layer 'dim' or 'on'`)
    for (const k of Object.keys(l.filter || {})) {
      const ok = reg.filters?.[l.id] || []
      if (!ok.includes(k)) fail(file, `${at}: layer '${l.id}' can't be filtered on '${k}'${ok.length ? `; it can on ${ok.join(', ')}` : ''}`)
    }
  }
}
for (const { rec, file } of Object.values(records.chapter || {}).filter((r) => !bad.has(`chapter:${r.rec.id}`))) {
  const at = `chapter '${rec.id}'`
  ref(file, at, 'text', rec.text); ref(file, at, 'photo', rec.photo); ref(file, at, 'view', rec.view); ref(file, at, 'stat', rec.stat)
  for (const a of rec.actions || []) ref(file, at, 'action', a)
}

for (const { story, owner, file } of stories) {
  const at = `story '${story.slug}'`
  if (basename(file, '.json') !== story.slug) fail(file, `${at}: slug must match the file name (${basename(file, '.json')})`)
  if (story.author !== owner) fail(file, `${at}: author '${story.author}' must be the organization whose folder holds it ('${owner}')`)
  if (!SUBSITES.has(story.subsite)) fail(file, `${at}: unknown subsite '${story.subsite}'; stories can be told on ${[...SUBSITES].join(', ')}`)
  if (story.layout !== 'split') fail(file, `${at}: layout '${story.layout}' isn't built yet; use 'split'`)
  for (const s of story.sources || []) ref(file, at, 'source', s)
  for (const cid of story.chapters) {
    const ch = ref(file, at, 'chapter', cid)
    if (!ch) continue
    const c = ch.rec
    if (ch.owner !== owner) fail(file, `${at}: chapter '${cid}' is ${ch.owner}'s, not ${owner}'s`)
    const v = get('view', c.view), st = c.stat && get('stat', c.stat)
    if (v && v.owner !== story.subsite) fail(file, `${at}: chapter '${cid}' uses view '${c.view}' from ${v.owner}, but the story is on ${story.subsite}`)
    const t = get('text', c.text)
    for (const str of [t?.rec.body, st?.rec.label].filter(Boolean)) {
      for (const m of str.matchAll(COUNT_TOKEN)) if (m[1] !== story.subsite) fail(file, `${at}: chapter '${cid}' uses {{${m[1]}.${m[2]}}}, but the story is on ${story.subsite}; a story can only show its own subsite's counts`)
    }
    if (st?.rec.dataKey && st.owner !== story.subsite) fail(file, `${at}: chapter '${cid}' uses ${st.owner}'s stat '${c.stat}', but the story is on ${story.subsite}`)
  }
  if (story.status === 'published') {
    const unconfirmed = story.chapters.map((cid) => get('photo', get('chapter', cid)?.rec.photo)).filter((p) => p && p.rec.rights !== 'confirmed').map((p) => p.rec.id)
    if (unconfirmed.length) fail(file, `${at}: can't be published until the rights to these photos are confirmed: ${unconfirmed.join(', ')}`)
  }
}

if (problems.length) {
  console.error(`Story content has ${problems.length} problem${problems.length > 1 ? 's' : ''}:\n` + problems.map((p) => `  • ${p}`).join('\n'))
  process.exit(1)
}
const n = (t) => Object.keys(records[t] || {}).length
console.log(`Story content OK: ${stories.length} stor${stories.length === 1 ? 'y' : 'ies'}, ${n('chapter')} chapters, ${n('photo')} photos, ${n('text')} texts, ${n('stat')} stats, ${n('view')} views.`)
