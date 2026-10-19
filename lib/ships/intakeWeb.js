/**
 * The web intake page (earthatlas.org/ships/intake; Josh 2026-10-19, option A): read an operator's page, have Claude pull
 * out its boats in the operator's own words, check every extracted value against the page text, keep the job.
 * Matching: lib/ships/intakeMatch.js. Writing: lib/ships/intakeApply.js. Intake document: lib/ships/operatorSite.js.
 *
 * Rules carried over from /ship-intake: facts only as the page states them (verified here: a value whose words don't
 * appear on the page is dropped with a warning, never kept); descriptions verbatim; photos only from the page's own <img>s;
 * no prices or booking text. Claude proposes; Josh decides every match on the page; nothing is linked automatically.
 *
 * Models: READ_MODEL (Haiku) by default, STRONG_MODEL (Opus) on request; structured JSON output. One call for the page, one
 * more when it links each boat to its own page (those pages trimmed to the boat's own part). "Dig deeper": Opus, one call
 * per boat over the candidates' full records.
 */
import Anthropic from '@anthropic-ai/sdk'
import { normName } from './normalize.js'
import { intakeProblems } from './operatorSite.js'

// Josh 2026-10-19 (option A of the cost review): Haiku reads pages by default (measured under 1¢ a page, against ~25-35¢
// on Opus); "Read again with Opus" on the page uses the strong model; "dig deeper" always uses it.
export const READ_MODEL = 'claude-haiku-5-5'
export const STRONG_MODEL = 'claude-opus-5-5'
export const MODEL_LABEL = { [READ_MODEL]: 'Claude Haiku 5.5', [STRONG_MODEL]: 'Claude Opus 5.5' }
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 EarthAtlas-ships-intake/1.0 (+https://earthatlas.org/ships)'
const MAX_HTML = 3_000_000
const MAX_TEXT = 60_000
const MAX_DETAIL_PAGES = 8

// ── Reading a page ────────────────────────────────────────────────────────────

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', deg: '°' }
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m)
const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null }
const abs = (u, base) => { try { return new URL(u, base).href } catch { return null } }
/** Spaces, quotes and dashes normalized, so a quote matches the page however the page typed it. */
export const flat = (s) => String(s ?? '').normalize('NFKC').replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * HTML → { title, description, text, images: [{ url, alt, near, next, width }], links: [{ url, text }] }. No parser dependency:
 * scripts/styles/svg/noscript are cut, block tags become line breaks. `near` = the heading last seen before an image,
 * `next` = the first text after it (fleet pages often put a boat's photo right above its name, heading or not).
 */
export function htmlToPage(html, base) {
  let s = String(html).slice(0, MAX_HTML)
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1] || '').replace(/\s+/g, ' ').trim())
  const metaTag = (re) => { const m = re.exec(s); return m ? attr(m[0], 'content') : null }
  const description = metaTag(/<meta[^>]+name=["']description["'][^>]*>/i) || metaTag(/<meta[^>]+property=["']og:description["'][^>]*>/i) || ''
  s = s.replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  const images = [], links = [], seen = new Set()
  let near = ''
  const out = []
  for (const m of s.matchAll(/<[^>]+>|[^<]+/g)) {
    const t = m[0]
    if (t[0] !== '<') {
      const x = decode(t).replace(/\s+/g, ' ')
      if (x.trim()) { out.push(x); for (const im of images) if (im.next === undefined && x.trim().length > 1) im.next = x.trim().slice(0, 80) }
      continue
    }
    const name = (/^<\/?\s*([a-z0-9]+)/i.exec(t)?.[1] || '').toLowerCase()
    if (/^h[1-6]$/.test(name) && t[1] !== '/') out.push('\n\n## ')
    else if (['p', 'div', 'section', 'article', 'li', 'tr', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figure', 'figcaption', 'ul', 'ol', 'table', 'header', 'footer', 'main'].includes(name)) out.push('\n')
    if (/^h[1-6]$/.test(name) && t[1] === '/') near = out.join('').split('## ').at(-1).trim().slice(0, 80)
    if (name === 'img') {
      // The largest srcset candidate, else src / data-src (lazy loaders).
      const set = attr(t, 'srcset') || attr(t, 'data-srcset')
      // Candidates are separated by a comma AND whitespace: Wix-style addresses carry commas inside them (…0.01,enc_avif,…).
      const best = set ? set.split(/,\s+/).map((x) => x.trim().split(/\s+/)).sort((a, b) => parseFloat(b[1] || 0) - parseFloat(a[1] || 0))[0]?.[0] : null
      const url = abs(best || attr(t, 'data-src') || attr(t, 'src') || '', base)
      const width = Number(attr(t, 'width')) || null
      if (url && /^https?:/.test(url) && !/\.svg(\?|$)/i.test(url) && !(width && width < 120) && !seen.has(url)) {
        seen.add(url); images.push({ url, alt: (attr(t, 'alt') || '').slice(0, 120), near, next: undefined, width })
      }
    }
    if (name === 'a' && t[1] !== '/') {
      const url = abs(attr(t, 'href') || '', base)
      const rest = s.slice(m.index + t.length, m.index + t.length + 300)
      const text = decode(rest.split(/<\/a>/i)[0].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 80)
      if (url && /^https?:/.test(url)) links.push({ url: url.split('#')[0], text })
    }
  }
  const text = out.join('').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT)
  const uniq = [...new Map(links.filter((l) => l.text).map((l) => [l.url, l])).values()]
  for (const im of images) if (im.next === undefined) im.next = ''
  return { title, description, text, images, links: uniq }
}

export async function fetchPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' }, redirect: 'follow', signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`the page answered HTTP ${res.status}`)
  const type = res.headers.get('content-type') || ''
  if (!/html|xml|text\/plain/i.test(type)) throw new Error(`not a web page (${type || 'unknown type'})`)
  const html = await res.text()
  return { url: res.url || url, ...htmlToPage(html, res.url || url) }
}

// ── Claude extraction ────────────────────────────────────────────────────────

// Text fields use "" for "the page doesn't say" (the API allows at most 16 nullable fields per schema); numbers stay nullable.
const str = { type: 'string' }
const num = { type: ['number', 'null'] }
const BOAT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name', 'page_url', 'facts', 'description', 'photos'],
  properties: {
    name: { type: 'string' },
    page_url: str,
    description: { type: 'string' },
    photos: { type: 'array', items: { type: 'string' } },
    facts: {
      type: 'object', additionalProperties: false,
      required: ['length_ft', 'builder', 'build_place', 'year_built', 'hull_material', 'max_capacity', 'capacity_basis', 'propulsion', 'speed_kn', 'speed_basis', 'vessel_type'],
      properties: { length_ft: num, builder: str, build_place: str, year_built: num, hull_material: str, max_capacity: num, capacity_basis: str,
        propulsion: str, speed_kn: str, speed_basis: str, vessel_type: str },
    },
  },
}
const EXTRACT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['operator', 'boats', 'not_a_fleet_page'],
  properties: {
    not_a_fleet_page: str,
    operator: { type: 'object', additionalProperties: false, required: ['name', 'place', 'country', 'service'],
      properties: { name: { type: 'string' }, place: str, country: str, service: str } },
    boats: { type: 'array', items: BOAT_SCHEMA },
  },
}

// Frozen: identical every call so it prompt-caches. Page content goes in the user turn only.
const SYSTEM = `You extract boats from a boat operator's web page for EarthAtlas, a public conservation map of ships. Every value you return is shown publicly next to a link to the page, so it must be exactly what the page says.

Rules:
- Only boats this operator presents as its own vessels. Ignore boats mentioned in passing, blog posts, trip reports, partners.
- name: the boat's name as the page writes it, in title case ("ISLAND EXPRESS II" → "Island Express II"). When one entry covers two or more boats ("Blackfish II & III", "Sea Lion and Sea Otter"), return each boat separately ("Blackfish II", "Blackfish III"), each with the entry's shared facts, description and photos.
- description: the page's own paragraphs about that boat, copied verbatim (keep their wording, punctuation and order; join paragraphs with a blank line). Leave out prices, booking, schedules, tour menus, calls to action. "" if the page has none.
- Any text field the page doesn't give: "". Number fields the page doesn't give: null.
- facts: only what the page states about THAT boat. Never infer, convert or estimate. length_ft only when the page gives feet (copy the number). max_capacity: the passenger number the page gives; capacity_basis: a short phrase copied from the page saying what that number counts (e.g. "certified by the United States Coast Guard"). speed_kn: the number or range as written ("18-21"); speed_basis: the page's word ("cruising", "top cruising"). builder, build_place, hull_material, propulsion: the page's words. vessel_type: the page's own short words for what KIND of boat this is ("whale watching boat", "water taxi", "landing craft"), or "". Section labels, headings and breadcrumbs ("Marine Vessel", "Vessel", "Our Fleet", "Vessels", "Boat") are not a kind of boat: use "" rather than one of those.
- photos: URLs of photos that show THAT boat, chosen only from the IMAGES list. Tell which boat a photo belongs to from its alt text and the headings around it: a photo usually sits right above its boat's name ("text after") or below it ("heading before"); a file name like "BF2 and BF3.jpg" can name the boats too. A photo of two of the operator's boats can go with both. Main photo first. Skip logos, icons, people-only shots and other operators' boats.
- page_url: the boat's own detail page, chosen only from the LINKS list, when the page links one; else "".
- operator.name: the company as the page names itself. place: its town as the page states it. country: two-letter code when the page makes it clear, else "". service: how the site describes its business, copied verbatim from the page TITLE or DESCRIPTION given (e.g. "San Juan Island Whale Watching Tours"), else "".
- If the page is not about an operator's own boats, return no boats and say why in not_a_fleet_page.`

let client = null, clientKey = null
// Built on first use (and again if the key appears later, as on localhost); the key stays server-side.
const anthropic = () => {
  const key = process.env.ANTHROPIC_API_KEY || null
  if (!client || key !== clientKey) { client = new Anthropic(key ? { apiKey: key } : {}); clientKey = key }
  return client
}

async function ask(user, schema, { maxTokens = 16000, model = READ_MODEL } = {}) {
  const res = await anthropic().beta.messages.create({
    model, max_tokens: maxTokens,
    // Server-side refusal fallback exists for Opus; Haiku 5.5 has none.
    ...(model === STRONG_MODEL ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  })
  if (res.stop_reason === 'refusal') throw new Error('the model declined to read this page')
  if (res.stop_reason === 'max_tokens') throw new Error('the page was too long to read in one pass')
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  return { data: JSON.parse(text), usage: res.usage }
}

const pageBlock = (p, label) => [
  `=== ${label}: ${p.url}`, `TITLE: ${p.title}`, `DESCRIPTION: ${p.description}`,
  `IMAGES:\n${p.images.slice(0, 120).map((i) => `- ${i.url} | alt: ${i.alt || '-'} | heading before: ${i.near || '-'} | text after: ${i.next || '-'}`).join('\n')}`,
  `LINKS:\n${p.links.filter((l) => sameSite(l.url, p.url)).slice(0, 150).map((l) => `- ${l.url} | ${l.text}`).join('\n')}`,
  `TEXT:\n${p.text}`].join('\n\n')
/**
 * A boat's own page, trimmed to the boat: from its first heading, cut where blog / report / news sections start, at most
 * BOAT_PAGE_CHARS; no links (its URL is known), at most 30 images. (San Juan Safaris' boat pages are ~9,500 characters,
 * mostly whale-report teasers; the boat's part is a few hundred.) The full text is still what values are checked against.
 */
const BOAT_PAGE_CHARS = 4000
const BLOG_HEADING = /\n## [^\n]*(report|blog|news|sighting|stories|latest|recent|reviews|testimonial|faq|related|you may also)/i
function boatPageBlock(p) {
  let t = p.text
  const h = t.indexOf('## ')
  if (h > 0) t = t.slice(h)
  const cut = BLOG_HEADING.exec(t)
  if (cut) t = t.slice(0, cut.index)
  return [`=== BOAT PAGE: ${p.url}`, `TITLE: ${p.title}`,
    `IMAGES:\n${p.images.slice(0, 30).map((i) => `- ${i.url} | alt: ${i.alt || '-'} | heading before: ${i.near || '-'} | text after: ${i.next || '-'}`).join('\n')}`,
    `TEXT:\n${t.slice(0, BOAT_PAGE_CHARS)}`].join('\n\n')
}
const sameSite = (a, b) => { try { return new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, '') } catch { return false } }

/**
 * Read the page (and, when it links each boat to its own page, those pages), extract, verify.
 * `pasted` = page text pasted by the reviewer for sites that build their content in the browser.
 * Returns { intake, warnings, pages: [url], usage }.
 */
export async function readAndExtract(url, { pasted = null, model = READ_MODEL } = {}) {
  const main = pasted ? { url, title: '', description: '', text: String(pasted).slice(0, MAX_TEXT), images: [], links: [] } : await fetchPage(url)
  if (main.text.length < 200) throw new Error('the page has almost no text when fetched (it may build itself in the browser): paste its text instead')
  const usage = []
  const first = await ask(pageBlock(main, 'PAGE'), EXTRACT_SCHEMA, { model })
  usage.push(first.usage)
  let out = first.data
  // Each boat's own page, when the fleet page links one (same site only, at most MAX_DETAIL_PAGES).
  const detailUrls = [...new Set(out.boats.map((b) => b.page_url).filter((u) => u && sameSite(u, main.url) && u !== main.url))].slice(0, MAX_DETAIL_PAGES)
  const details = (await Promise.all(detailUrls.map((u) => fetchPage(u).catch(() => null)))).filter(Boolean)
  if (details.length) {
    // Not the fleet page again: what was already read from it, plus each boat's own page (trimmed).
    const second = await ask([`=== ALREADY READ FROM THE FLEET PAGE ${main.url}:\n${JSON.stringify(out)}`, ...details.map(boatPageBlock)].join('\n\n\n')
      + '\n\nAbove: what was read from the fleet page, and each boat\'s own page. Return the full result again: every boat, with its fleet-page facts, description paragraphs and photos kept as they are, plus what its own page adds (facts, description paragraphs, photos), following the same rules.', EXTRACT_SCHEMA, { model })
    usage.push(second.usage)
    out = second.data
  }
  const pages = [main, ...details]
  const { intake, warnings } = verify(out, main, pages)
  return { intake, warnings, pages: pages.map((p) => p.url), notFleet: out.not_a_fleet_page || null, usage, model }
}

/**
 * Keep only what the pages say. Text values must appear (normalized) on the main page or the boat's own page; numbers
 * must appear as written; photos must be among the pages' images; page_url among the links. Dropped values → warnings.
 */
export function verify(out, main, pages) {
  const warnings = []
  const textOf = (u) => flat([main.title, main.description, main.text, ...(pages.find((p) => p.url === u && p !== main) ? [pages.find((p) => p.url === u).text] : [])].join('\n'))
  const allImages = new Set(pages.flatMap((p) => p.images.map((i) => i.url)))
  const allLinks = new Set(pages.flatMap((p) => p.links.map((l) => l.url)))
  const boats = []
  for (const b of out.boats || []) {
    const name = String(b.name || '').trim()
    if (!normName(name)) continue
    const hay = textOf(b.page_url)
    // The whole name, or (for a boat split out of a shared entry like "Blackfish II & III") each of its words, is on the page.
    const words = new Set(hay.split(/[^a-z0-9]+/))
    if (!hay.includes(flat(name)) && !flat(name).split(/[^a-z0-9]+/).filter(Boolean).every((w) => words.has(w))) {
      warnings.push(`${name}: the name doesn't appear on the page; left out`); continue
    }
    const facts = {}
    const keepText = (k) => { const v = b.facts?.[k]; if (v == null || v === '') return; if (hay.includes(flat(v))) facts[k] = String(v).trim(); else warnings.push(`${name}: ${k} "${v}" isn't on the page; dropped`) }
    const keepNum = (k) => { const v = b.facts?.[k]; if (v == null) return; const n = Number(v); if (Number.isFinite(n) && new RegExp(`(^|[^0-9.])${String(n).replace('.', '\\.')}([^0-9]|$)`).test(hay)) facts[k] = n; else warnings.push(`${name}: ${k} ${v} isn't on the page; dropped`) }
    ;['builder', 'build_place', 'hull_material', 'capacity_basis', 'propulsion', 'speed_basis', 'vessel_type'].forEach(keepText)
    ;['length_ft', 'year_built', 'max_capacity'].forEach(keepNum)
    if (b.facts?.speed_kn) {
      const nums = String(b.facts.speed_kn).match(/\d+(\.\d+)?/g) || []
      if (nums.length && nums.every((n) => new RegExp(`(^|[^0-9.])${n.replace('.', '\\.')}([^0-9]|$)`).test(hay))) facts.speed_kn = String(b.facts.speed_kn).trim()
      else warnings.push(`${name}: speed "${b.facts.speed_kn}" isn't on the page; dropped`)
    }
    if (facts.max_capacity == null) delete facts.capacity_basis
    // Description: keep the paragraphs that are on the page, verbatim.
    const paras = String(b.description || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    const kept = paras.filter((p) => hay.includes(flat(p)))
    if (kept.length < paras.length) warnings.push(`${name}: ${paras.length - kept.length} description paragraph(s) didn't match the page word for word; dropped`)
    const photos = (b.photos || []).filter((u) => allImages.has(u))
    if (photos.length < (b.photos || []).length) warnings.push(`${name}: ${(b.photos || []).length - photos.length} photo(s) weren't on the page; dropped`)
    const pageUrl = b.page_url && allLinks.has(b.page_url) ? b.page_url : null
    boats.push({ name, ...(pageUrl ? { page_url: pageUrl } : {}), facts, description: kept.join('\n\n') || null, photos: photos.map((url) => ({ url })), match: null })
  }
  const op = out.operator || {}
  const opText = flat([main.title, main.description, main.text].join('\n'))
  const service = op.service && flat([main.title, main.description].join('\n')).includes(flat(op.service)) ? op.service : null
  if (op.service && !service) warnings.push(`operator description "${op.service}" isn't in the page title or description; dropped`)
  const intake = {
    page: { url: main.url, title: main.title || null, retrieved_at: new Date().toISOString(), text: pages.map((p) => `${p.url}\n\n${p.text}`).join('\n\n\n') },
    operator: { name: String(op.name || '').trim(), url: new URL(main.url).origin + '/', place: op.place && opText.includes(flat(op.place)) ? op.place : null,
      country: /^[A-Z]{2}$/.test(op.country || '') ? op.country : null, ...(service ? { service, service_url: main.url } : {}) },
    boats,
  }
  if (!intake.operator.name || !opText.includes(flat(intake.operator.name))) warnings.push('the operator name isn\'t on the page: check it before saving')
  return { intake, warnings }
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

export async function createJob(q, S, { intake, review, warnings, model = null, usage = [] }) {
  const tokens = usage.reduce((a, u) => ({ in: a.in + (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), out: a.out + (u.output_tokens || 0) }), { in: 0, out: 0 })
  const [r] = await q(`INSERT INTO ${S}.intake_jobs (url, intake, review, notes) VALUES ($1, $2, $3, $4) RETURNING id`,
    [intake.page.url, intake, review, { warnings, model, tokens }])
  return r.id
}
export async function readJob(q, S, id) {
  const [j] = await q(`SELECT id, url, status, intake, review, notes, created_at, updated_at, applied_at, applied_by, result FROM ${S}.intake_jobs WHERE id = $1`, [id])
  return j || null
}
export async function listJobs(q, S) {
  return q(`SELECT id, url, status, intake->'operator'->>'name' AS operator, jsonb_array_length(intake->'boats') AS boats,
                   created_at, applied_at FROM ${S}.intake_jobs WHERE status <> 'discarded' ORDER BY created_at DESC LIMIT 50`)
}
/** Replace the job's boats (decisions and reviewer's edits); checks the result is a valid intake. */
export async function saveDecisions(q, S, id, boats, operator, kind) {
  const j = await readJob(q, S, id)
  if (!j) return { error: 'no such job' }
  if (j.status !== 'draft' && j.status !== 'applied') return { error: `job is ${j.status}` }
  const intake = { ...j.intake, ...(operator ? { operator: { ...j.intake.operator, ...operator } } : {}), boats }
  // The page-wide kind of ship, picked from EarthAtlas's list ('' clears it; undefined leaves it as it was).
  if (kind !== undefined) { if (kind) intake.kind = kind; else delete intake.kind }
  const errs = intakeProblems(intake)
  if (errs.length) return { error: errs.join('; ') }
  await q(`UPDATE ${S}.intake_jobs SET intake = $2, updated_at = now() WHERE id = $1`, [id, intake])
  return { ok: true }
}

// ── Dig deeper ────────────────────────────────────────────────────────────────

const DIG_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['vessel_id', 'confidence', 'reasoning'],
  properties: { vessel_id: str, confidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'] }, reasoning: { type: 'string' } },
}

/**
 * Which of a boat's candidates is it? Claude reads the operator's text about the boat and every candidate's full record
 * (names, MMSIs and call signs over time, licensees, owners, registries, sizes, years, places), and answers with one
 * candidate id or none, plus its reasons. Advice for the reviewer only; nothing is decided here.
 */
export async function digDeeper(q, S, job, boatName) {
  const b = job.intake.boats.find((x) => x.name === boatName)
  const r = job.review?.boats?.find((x) => x.name === boatName)
  if (!b || !r) return { error: 'no such boat in this job' }
  const ids = r.ours.map((v) => v.vessel_id)
  if (!ids.length) return { vessel_id: null, confidence: 'none', reasoning: 'We hold no vessel under this name, so there is nothing to compare.' }
  const recs = await q(`SELECT vessel_id::text, attribute, left(value_raw, 160) AS value, source_id, evidence_class,
                               to_char(lower(period), 'YYYY-MM-DD') AS "from", to_char(upper(period), 'YYYY-MM-DD') AS "to"
                          FROM ${S}.vessel_assertions
                         WHERE vessel_id = ANY($1::uuid[]) AND evidence_class <> 'operator_published'
                           AND attribute NOT IN ('uscg_activity', 'certificate', 'event', 'image', 'transceiver')
                         ORDER BY vessel_id, attribute, lower(period) NULLS FIRST LIMIT 1500`, [ids])
  const byV = Object.fromEntries(ids.map((id) => [id, recs.filter((x) => x.vessel_id === id).map(({ vessel_id, ...x }) => x)]))
  const user = [
    `OPERATOR: ${job.intake.operator.name}${job.intake.operator.place ? ` (${job.intake.operator.place})` : ''}`,
    `BOAT: ${b.name}`, `WHAT THE OPERATOR'S PAGE SAYS:\n${b.description || '(no description)'}\nFacts: ${JSON.stringify(b.facts)}`,
    `CANDIDATES (EarthAtlas vessels with the same name; records from AIS, registries and licences, with dates):`,
    ...ids.map((id) => `--- ${id}\n${JSON.stringify(byV[id])}`),
    `FCC licences under this name not attached to any vessel: ${JSON.stringify(r.fcc_not_held.slice(0, 20).map(({ signals, ...h }) => h))}`,
    `Which candidate is the operator's boat? Answer with exactly one candidate id, or null when the records don't show it. Weigh licensee/owner names, places, history the page mentions (where the boat came from, what it did before), size, type and dates. Confidence "high" only when a record ties the vessel to this operator or its story; never pick on name alone. reasoning: under 120 words, citing the records.`,
  ].join('\n\n')
  const res = await anthropic().beta.messages.create({
    model: STRONG_MODEL, max_tokens: 4000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'high', format: { type: 'json_schema', schema: DIG_SCHEMA } },
    system: 'You compare a boat described by its operator with candidate vessel records and say which, if any, is the same boat. Use only the records given. Say plainly when they don\'t settle it.',
    messages: [{ role: 'user', content: user }],
  })
  if (res.stop_reason === 'refusal') return { error: 'the model declined' }
  const ans = JSON.parse(res.content.filter((x) => x.type === 'text').map((x) => x.text).join(''))
  if (ans.vessel_id && !ids.includes(ans.vessel_id)) ans.vessel_id = null
  return { ...ans, model: STRONG_MODEL, at: new Date().toISOString() }
}
