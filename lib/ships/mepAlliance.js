/**
 * MEP Alliance scrubber lists for /ships (Marine Environmental Protection Alliance, mepalliance.org). Rules: src/ships/CLAUDE.md.
 * Schema: migrations/021. Resolver: resolve.js v1.9 (decideMep).
 *
 * Permission (Josh, 2026-09-30): Lovel of Friends of the San Juans (a founding member of MEP Alliance) confirmed that
 * https://www.mepalliance.org/list-of-scrubber-fitted-ships is reputable and that EarthAtlas may use it and attach it to ships.
 * Attribution: "MEP Alliance". The site's own Terms & Conditions (quoted in the source notes) are personal-use only; the
 * permission above is what EarthAtlas relies on.
 *
 * Two lists, studied 2026-09-30 (pages saved as received in the gitignored scripts/ships/mep/raw/):
 *   'mep-alliance-voyages'       https://www.mepalliance.org/list-of-scrubber-fitted-ships, titled "Polluting Scrubber Voyages":
 *                                a Webflow CMS table, 100 rows per page (?9e6caa88_page=N). Each row = one reported voyage of a
 *                                scrubber-fitted ship: ship name, owner (+ contact), the customer leasing it (charterer, + contact),
 *                                reported date. NO IMO number. Two more columns (cargo route, cost to lease) are empty on every row.
 *   'mep-alliance-fitted-ships'  /bulk-carriers, /tankers, /container-ships, /cruise-ships ("Scrubber-Fitted Ships by Vessel Type",
 *                                same menu): ship name, IMO number, controller, builder, year. Ships "with scrubbers installed (or
 *                                pending)", per the page. Undated rows; the site menus label the list "as of Q2 2024" and
 *                                "as of Q2 2025".
 *
 *   evidence        source_records: each row's cells exactly as published (column → text) plus the row's HTML, grouped per ship:
 *                     kind mep_voyage_ship   key 'NAME <normalized name>'  every voyage report of that ship name
 *                     kind mep_fitted_imo    key 'IMO 1234567'             every vessel-type-list row with that IMO
 *                     kind mep_fitted_name   key 'NAME <norm> · <list>'    a vessel-type-list row with no usable IMO
 *                   Contact details (emails, phones, addresses, named people) stay in the stored record only; the API strips
 *                   them before any record is shown (publicRecordPayload), and no claim carries them.
 *   claim           one 'scrubber' assertion per row, evidence class 'unverified' (an advocacy group's list of reported facts:
 *                   not a registry, not a flag Administration's notification), period 'unknown' (dates only, no time zone:
 *                   kept in detail). detail = company-level owner / charterer text (contacts and people removed), the reported
 *                   date, the list and category.
 *   interpretation  resolve.js v1.9 decideMep: IMO_EXACT for rows with an IMO; name rows accept only a unique corroborated
 *                   name match (MEP_NAME_CORROBORATED) or, per Josh 2026-09-30, a unique big ship known in the Salish Sea
 *                   (MEP_NAME_SALISH_SIZE, marked inferred). Everything else: candidates (MEP_NAME_ONLY) or nothing.
 *
 * Pure functions first (unit-tested offline with REAL rows), then persistence.
 */
import { canonicalJson, sha256, upsertSource, upsertAssertions } from './store.js'
import { storeRawRecords } from './ports.js'
import { normImo, normName } from './normalize.js'
import { resolveEntity } from './resolve.js'
import { stripContacts, CONTACT_COLUMNS, publicRecordPayload } from './mepPublic.js'

export { stripContacts, CONTACT_COLUMNS, publicRecordPayload }

export const SITE = 'https://www.mepalliance.org'
export const VOYAGES_URL = `${SITE}/list-of-scrubber-fitted-ships`
export const FITTED_LISTS = { 'bulk-carriers': 'Bulk Carriers', tankers: 'Tankers', 'container-ships': 'Container Ships', 'cruise-ships': 'Cruise Ships' }
export const fittedUrl = (slug) => `${SITE}/${slug}`
export const TERMS_URL = `${SITE}/terms-conditions`

export const PERMISSION = 'Permission via Friends of the San Juans (MEP Alliance founding member), 2026-09-30'
export const PERMISSION_DETAIL = 'Josh, 2026-09-30: Lovel of Friends of the San Juans (a founding member of MEP Alliance) confirmed that '
  + 'https://www.mepalliance.org/list-of-scrubber-fitted-ships is reputable and that EarthAtlas may use it and attach it to ships. '
  + 'Attribution: "MEP Alliance".'
// The site's Terms & Conditions, sections 3 and 4, quoted as published (checked 2026-09-30).
export const TERMS_QUOTE = 'MEP Alliance Terms & Conditions (' + TERMS_URL + ', 2026-09-30), quoted: "3. License Grant: Users are granted a '
  + 'personal, revocable, limited, non-exclusive, royalty-free, and non-transferable license. Materials can be printed or downloaded '
  + 'for personal use only, with all copyright notices intact. 4. Restrictions: Users are prohibited from: Modifying, distributing, '
  + 'sublicensing, selling, or exploiting the site content. Using automatic devices like "deep-link," "robot," or "spider" to access '
  + 'or monitor the site." The permission above is what EarthAtlas relies on.'
const PRIVACY_NOTE = 'Privacy: the list names company officers with their emails and phone numbers. Those stay in the stored record '
  + 'only; EarthAtlas shows company names, never a person\'s contact details.'

export const VOYAGES_SOURCE = {
  id: 'mep-alliance-voyages',
  name: 'MEP Alliance: Polluting Scrubber Voyages (list of scrubber-fitted ships, with owners and charterers)',
  publisher: 'Marine Environmental Protection Alliance (MEP Alliance), an advocacy group',
  homepage_url: VOYAGES_URL,
  license: PERMISSION,
  license_url: VOYAGES_URL,
  commercial_use: false,
  attribution_text: 'MEP Alliance',
  attribution_url: VOYAGES_URL,
  notes: `${PERMISSION}. ${PERMISSION_DETAIL} ${TERMS_QUOTE} What it is: an advocacy list of reported voyages of scrubber-fitted `
    + 'ships ("companies using polluting scrubber-installed vessels in Q4 2025"), each with the ship name, owner, the customer '
    + 'leasing the ship (charterer) and a reported date; the cargo-route and lease-cost columns are empty on every row. No IMO '
    + 'numbers, so ships are matched by name (lib/ships/mepAlliance.js). Reported facts, not a registry. ' + PRIVACY_NOTE,
}
export const FITTED_SOURCE = {
  id: 'mep-alliance-fitted-ships',
  name: 'MEP Alliance: Scrubber-Fitted Ships by Vessel Type (bulk carriers, tankers, container ships, cruise ships)',
  publisher: 'Marine Environmental Protection Alliance (MEP Alliance), an advocacy group',
  homepage_url: fittedUrl('tankers'),
  license: PERMISSION,
  license_url: VOYAGES_URL,
  commercial_use: false,
  attribution_text: 'MEP Alliance',
  attribution_url: fittedUrl('tankers'),
  notes: `${PERMISSION}. ${PERMISSION_DETAIL} These four pages sit under the same "List of Scrubber-Fitted Ships" menu on the site `
    + `(the permission named the list page itself). ${TERMS_QUOTE} What it is: ships "with scrubbers installed (or pending)" and their `
    + 'controller, builder and year, with IMO numbers. Rows are undated; the site menus label the list "as of Q2 2024" and "as of '
    + 'Q2 2025". Reported facts from an advocacy group, not a registry.',
}
export const MEP_SOURCES = [VOYAGES_SOURCE, FITTED_SOURCE]
export const MEP_SOURCE_IDS = MEP_SOURCES.map((s) => s.id)
export const KIND = { voyageShip: 'mep_voyage_ship', fittedImo: 'mep_fitted_imo', fittedName: 'mep_fitted_name' }
export const EVIDENCE_CLASS = 'unverified'
export const BASIS = 'advocacy list (MEP Alliance): reported, not a registry record or a flag Administration\'s notification'

// ── HTML ─────────────────────────────────────────────────────────────────────

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' }
/** HTML fragment → plain text: tags out (block ends become line breaks), entities decoded, whitespace per line tidied. Pure. */
export function htmlText(h) {
  return String(h ?? '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m))
    .replace(/[​-‍﻿­]/g, '').replace(/�/g, '')
    .split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n')
}

/** The page's "Last Published" stamp (Webflow writes it as the first comment). Pure. */
export function lastPublished(html) {
  const m = /<!-- Last Published: ([^-]+?) -->/.exec(String(html))
  return m ? m[1].trim() : null
}
/** The next-page link's number after page `current` (the last page links only back), or null. Pure. */
export function nextPage(html, current = 1) {
  const ns = [...String(html).matchAll(/href="\?[0-9a-f]+_page=(\d+)"/g)].map((m) => Number(m[1])).filter((n) => n > current)
  return ns.length ? Math.min(...ns) : null
}

// Voyage table: the page's own column headers, in order (the name cell has an id attribute; the others only a class).
export const VOYAGE_COLUMNS = ['Ship Name', 'Cargo-Loading are-Destination', 'Cost to Lease Polluting Ship', 'Owner of Polluting Ship',
  'Owner’s Contact Details', 'Customer Leasing Polluting Ship', 'Customer’s Contact Details', 'Reported date']

/** Throws when the page's header row is not the one this code was written for (a changed page must be looked at, not guessed). */
export function checkVoyageHeader(html) {
  const got = [...String(html).matchAll(/class="pollutents-table-title">([^<]*)</g)].map((m) => htmlText(m[1]))
  if (got.join('|') !== VOYAGE_COLUMNS.join('|')) throw new Error(`MEP voyage table header changed: ${got.join(' | ')}`)
}

/**
 * "Polluting Scrubber Voyages" page HTML → rows [{ cells: {column → text}, html }] in page order. Empty cells are '' (Webflow
 * marks them w-dyn-bind-empty). Pure.
 */
export function parseVoyagePage(html) {
  const items = String(html).split(/<div fs-cmsload-resetix="true" role="listitem" class="collection-item w-dyn-item">/).slice(1)
  return items.map((it) => {
    const body = it.split(/<\/div><\/div><\/div><\/div>(?=<div fs-cmsload-resetix|<\/div>)/)[0] + '</div></div></div>'
    const cells = [...body.matchAll(/<div (?:id="[^"]*" )?class="polluting-title-container[^"]*"><div[^>]*>([\s\S]*?)<\/div><\/div>/g)].map((m) => htmlText(m[1]))
    if (cells.length !== VOYAGE_COLUMNS.length) throw new Error(`MEP voyage row has ${cells.length} cells, expected ${VOYAGE_COLUMNS.length}`)
    return { cells: Object.fromEntries(VOYAGE_COLUMNS.map((c, i) => [c, cells[i]])), html: `<div role="listitem">${body}` }
  })
}

export const FITTED_COLUMNS = ['Ship Name', 'IMO NUMBER', 'Controller', 'Builder', 'Year']
const FITTED_CELL = { name: 'Ship Name', imo: 'IMO NUMBER', controller: 'Controller', builder: 'Builder', year: 'Year' }
export function checkFittedHeader(html) {
  const got = [...String(html).matchAll(/class="table-heading">([^<]*)</g)].map((m) => htmlText(m[1]))
  if (got.join('|') !== FITTED_COLUMNS.join('|')) throw new Error(`MEP vessel-type table header changed: ${got.join(' | ')}`)
}
/** A vessel-type page (/tankers …) → rows [{ cells, html }]. Pure. */
export function parseFittedPage(html) {
  const items = String(html).split(/<div fs-cmsfilter-showquery="true" role="listitem" class="collection-item-4 w-dyn-item">/).slice(1)
  return items.map((it) => {
    const cells = Object.fromEntries(FITTED_COLUMNS.map((c) => [c, '']))
    for (const m of it.matchAll(/class="table_(name|imo|controller|builder|year)-cell"[^>]*><div[^>]*>([\s\S]*?)<\/div>/g)) cells[FITTED_CELL[m[1]]] = htmlText(m[2])
    const end = it.indexOf('</div></div></div></div>')
    return { cells, html: `<div role="listitem">${end > 0 ? it.slice(0, end + 24) : it}` }
  })
}

// ── Values ───────────────────────────────────────────────────────────────────

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
/** "December 31, 2025" → '2025-12-31' (a calendar date; the page gives no time zone, so no instant is claimed). Pure. */
export function mepDate(v) {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(String(v || '').trim())
  const mo = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1
  return mo < 0 ? null : `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

/**
 * A voyage row's ship name → { name, note }: the list sometimes appends a size or year hint in brackets ("STAR NICOLE (81K)",
 * "UM JIANGSU (66K/2025)"); it is kept as a note, not as part of the name. Pure.
 */
export function shipName(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim()
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(s)
  return m && m[1] ? { name: m[1], note: m[2] } : { name: s, note: null }
}
export const shipKey = (raw) => normName(shipName(raw).name)

const NA = /^(n\/?a|-+|none|tbc|tba)$/i
// Roles next to a person's name in the owner / customer cells ("NORDEN JAN RINDBO - CEO", "DR. KURT KLEMME", "Dir: Kimitaka Okawa").
const ROLE_RE = /(^|[\s,\-–(])(g?ceo|chairman|chairwoman|president|chief\s+executiv\w*|managing\s+director|managing\s+partner|mang\.?\s+director|g\.?\s*mang\.?|mang\.?|director|dir:|md|g\.?\s*m\.?|mg|ops\s+manager|fleet\s+manager|senior\s+manager|manager|owner|commercial\s+director|eng\.|dr\.|capt\.|mr\.|mrs\.|ms\.)(?=$|[\s,\-–):.])/i
// Words that end a company name ("… SHIPPING CO LTD", "… MARITIME", "… BULKERS").
const SUFFIX = new Set(['LTD', 'LIMITED', 'INC', 'CORP', 'CORPORATION', 'CO', 'SA', 'S.A.', 'GMBH', 'PTE', 'LLC', 'DMCC', 'KK', 'AS', 'ASA',
  'PLC', 'LP', 'BV', 'NV', 'SPA', 'AG', 'AB', 'ULC', 'LINES', 'LINE', 'SHIPPING', 'MARITIME', 'NAVIGATION', 'BULKERS', 'CARRIERS',
  'SHIPMANAGEMENT', 'MANAGEMENT', 'GROUP', 'KISEN', 'KAIUN', 'TANKERS', 'BULK', 'MARINE', 'OCEAN', 'SHIPS'])
// "(OWS BENEFIT)", "(CHARTS BENEFIT)", "Chrts Benefit -", "(scrubber benefit to chrts)", "(SCRUBBER BENEFIT 50/50)", "(80% OWS BENEFIT)"
const BENEFIT_RE = /\(?\s*(?:\d+\s*%\s*)?(?:(?:owns?|ows|owners?|chrts?|charts?|charterers?)\s+benefit|(?:scrubber\s+)?benefit\s+(?:to|for)\s+(?:owns?|ows|chrts?|charts?)|scrubber\s+benefit(?:\s+(?:to|for)\s+\w+|\s+\d+\/\d+)?|(?:owns?|ows|chrts?|charts?)\s+benefit|chrts\s+benefit\s*-?)[^)]*\)?/gi

/** Who the list says gets the scrubber's fuel saving, as written ("OWS BENEFIT" → 'owner'). null = not stated. Pure. */
export function benefitOf(raw) {
  const m = String(raw || '').match(BENEFIT_RE)
  if (!m) return null
  const t = m.join(' ').toLowerCase()
  if (/50\/50/.test(t)) return 'shared'
  if (/\bow(n|ns|s|ners?)?\b/.test(t) && /\bch(r|ar)ts?\b|charterer/.test(t)) return 'shared'
  if (/\bch(r|ar)ts?\b|charterer/.test(t)) return 'charterer'
  if (/\bow(n|ns|s|ners?)?\b/.test(t)) return 'owner'
  return null
}

/**
 * An owner / customer cell → the company as a company-level name, or null when it cannot be separated from a person's name.
 * Pure; `known` = the site's own "Polluters" dropdown entries (knownNames). Rules, in order:
 *   1. contacts out (stripContacts), benefit notes out (benefitOf reads them), "N/A" → null; a benefit note right after the
 *      company ends it ("PANOCEAN (OWS BENEFIT) JOONG-HO AHN - CEO" → "PANOCEAN")
 *   2. a plain cell (no role word, nothing after the name such as a web address or phone) → its first segment as written
 *      ("SHANDONG YUHE SHIPPING CO LTD", "BLUE PLANET (HOWNS)")
 *   3. otherwise a person may follow the company, so only the part that is certainly the company is kept:
 *      a. the segment before an explicit separator ("STAR BULK - PETROS PAPPAS - CEO", "GLOBUS SHIPMANAGEMENT CORP, Georgios …")
 *      b. else the longer of: the longest known company name the text starts with ("GOLDEN OCEAN ULRIK ANDERSEN" → "GOLDEN
 *         OCEAN"), and the text up to its last company-suffix word ("C TRANSPORT MARITIME JOHN MICHAEL RADZIWILL" → "C TRANSPORT
 *         MARITIME")
 *         and the leading words spelled inside the company's own web address ("BUNGE GREGORY HECKMAN - CEO www.bunge.com")
 *      c. else a single word ("ANGELAKOS www.angelakos.gr" → "ANGELAKOS")
 *   4. otherwise null: never guess where a person's name starts.
 */
export function companyName(raw, known = []) {
  const first = String(raw || '').split('\n')[0]
  // A benefit note ("(OWS BENEFIT)") sits right after the company in this list, so it also marks where the company ends.
  const marked = stripContacts(first).replace(BENEFIT_RE, ' \u0001 ').replace(/\s+/g, ' ').trim()
  const tidyCo = (s) => (s || '').replace(/[\s,\-–:(\u0001]+$/, '').replace(/^[\s,\-–:)\u0001]+/, '').replace(/\s+/g, ' ').trim() || null
  const t = tidyCo(marked.replace(/\u0001/g, ' ')) || ''
  if (!t || NA.test(t)) return null
  const beforeNote = tidyCo(marked.split('\u0001')[0])
  const afterNote = tidyCo(marked.split('\u0001').slice(1).join(' '))
  if (marked.includes('\u0001') && beforeNote && afterNote) return tidyCo(beforeNote.split(/\s+[-–]\s*|,\s*/)[0])
  const role = ROLE_RE.exec(t)
  // Something followed the name in the cell (a web address, phone, email), which is where this list puts a person's name.
  const tail = stripContacts(first).length < first.replace(/\s+/g, ' ').trim().length - 1
  if (!role && !tail) return tidyCo(t.split(/\s{2,}|\s[-–]\s|,\s*/)[0])
  const head = role ? t.slice(0, role.index + role[1].length) : t
  const segs = head.split(/\s+[-–]\s*|\s*[-–]\s+|,\s*/).map((s) => s.trim()).filter(Boolean)
  if (segs.length >= 2) return tidyCo(segs[0])
  const up = normName(head)
  const hit = known.map((k) => String(k || '').trim()).filter((k) => k && normName(k).length >= 3 && up.startsWith(normName(k)))
    .sort((a, b) => normName(b).length - normName(a).length)[0]
  let byKnown = null
  if (hit) {
    let n = 0, i = 0
    const want = normName(hit).length
    for (; i < head.length && n < want; i++) if (/[A-Za-z0-9]/.test(head[i])) n++
    byKnown = tidyCo(head.slice(0, i))
  }
  const words = head.trim().split(/\s+/)
  let cut = -1
  words.forEach((w, i) => { if (SUFFIX.has(w.toUpperCase().replace(/[.,]+$/, ''))) cut = i })
  const bySuffix = cut >= 0 ? tidyCo(words.slice(0, cut + 1).join(' ')) : null
  // The company's own web address, when the cell gives one: the longest run of leading words spelled inside the domain
  // ("BUNGE GREGORY HECKMAN - CEO www.bunge.com" → "BUNGE", "EP RESOURCES … www.epresources.ch" → "EP RESOURCES").
  const dom = /\b(?:https?:\/\/)?(?:www?\.)?([a-z0-9-]+)\.[a-z]{2,}/i.exec(first.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' '))
  let byDomain = null
  if (dom && /www?\.|https?:/i.test(first)) {
    const d = normName(dom[1])
    for (let k = words.length; k >= 1; k--) { const c = normName(words.slice(0, k).join(' ')); if (c.length >= 3 && d.includes(c)) { byDomain = tidyCo(words.slice(0, k).join(' ')); break } }
  }
  const best = [byKnown, bySuffix, byDomain].filter(Boolean).sort((a, b) => b.length - a.length)[0]
  if (best) return best
  return words.length === 1 ? tidyCo(words[0]) : null
}

/** The site's "Polluters" dropdown entries (value and label), used as known company names. Pure. */
export function knownNames(html) {
  const out = new Set()
  for (const m of String(html).matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)) { out.add(htmlText(m[1])); out.add(htmlText(m[2])) }
  return [...out].filter((x) => x && !/^select|choice$/i.test(x))
}

// ── Grouping + claims ────────────────────────────────────────────────────────

const rowRef = (cells) => `row ${sha256(canonicalJson(cells)).slice(0, 16)}`

/** Voyage rows → one group per normalized ship name (identical rows kept once, page order). Pure. */
export function groupVoyages(rows) {
  const by = new Map()
  for (const r of rows) {
    const k = shipKey(r.cells['Ship Name'])
    if (!k) continue
    const key = `NAME ${k}`
    const g = by.get(key) || { key, kind: KIND.voyageShip, name_norm: k, rows: [] }
    if (!g.rows.some((x) => canonicalJson(x.cells) === canonicalJson(r.cells))) g.rows.push(r)
    by.set(key, g)
  }
  return [...by.values()]
}

/** Vessel-type rows (each with .list = page slug) → one group per IMO, or per name + list when the IMO is missing/invalid. Pure. */
export function groupFitted(rows) {
  const by = new Map()
  for (const r of rows) {
    const raw = String(r.cells['IMO NUMBER'] || '').trim()
    const n = /^(IMO\s*)?\d{7}$/i.test(raw) ? normImo(raw) : null
    const name = normName(r.cells['Ship Name'])
    const key = n?.valid ? `IMO ${n.value}` : `NAME ${name || '?'} · ${r.list}`
    const g = by.get(key) || { key, kind: n?.valid ? KIND.fittedImo : KIND.fittedName, imo: n?.valid ? n.value : null, name_norm: name, rows: [] }
    if (!g.rows.some((x) => x.list === r.list && canonicalJson(x.cells) === canonicalJson(r.cells))) g.rows.push(r)
    by.set(key, g)
  }
  return [...by.values()]
}

/** One voyage group → its claims: one 'scrubber' assertion per reported voyage, no contact details. Pure. */
export function voyageAssertions(g, known = []) {
  return g.rows.map((r) => {
    const c = r.cells
    const sn = shipName(c['Ship Name'])
    const owner = companyName(c['Owner of Polluting Ship'], known)
    const customer = companyName(c['Customer Leasing Polluting Ship'], known)
    return {
      attribute: 'scrubber', value_raw: 'scrubber-fitted (reported)', value_norm: 'SCRUBBERFITTED',
      period_from: null, period_to: null, period_kind: 'unknown',
      evidence_class: EVIDENCE_CLASS, sub_record_ref: rowRef(c),
      detail: {
        basis: BASIS, list: 'voyages', list_title: 'Polluting Scrubber Voyages', page_url: VOYAGES_URL,
        ship_name: sn.name, ship_note: sn.note,
        reported: mepDate(c['Reported date']), reported_raw: c['Reported date'] || null,
        owner, owner_benefit: benefitOf(c['Owner of Polluting Ship']) ?? null,
        charterer: customer, charterer_benefit: benefitOf(c['Customer Leasing Polluting Ship']) ?? null,
        owner_withheld: !owner && !!c['Owner of Polluting Ship'] && !NA.test(c['Owner of Polluting Ship'].trim()),
        charterer_withheld: !customer && !!c['Customer Leasing Polluting Ship'] && !NA.test(c['Customer Leasing Polluting Ship'].trim()),
      },
    }
  })
}

/** One vessel-type group → its claims: one 'scrubber' assertion per list row. Pure. */
export function fittedAssertions(g) {
  return g.rows.map((r) => {
    const c = r.cells
    const y = /^\d{4}$/.test(String(c.Year || '').trim()) ? Number(c.Year) : null
    return {
      attribute: 'scrubber', value_raw: 'scrubber-fitted or pending (listed)', value_norm: 'SCRUBBERFITTEDORPENDING',
      period_from: null, period_to: null, period_kind: 'unknown',
      evidence_class: EVIDENCE_CLASS, sub_record_ref: `${r.list} ${rowRef(c)}`,
      detail: {
        basis: BASIS, list: 'fitted', list_title: `Scrubber-Fitted Ships by Vessel Type: ${FITTED_LISTS[r.list] || r.list}`,
        category: FITTED_LISTS[r.list] || r.list, page_url: fittedUrl(r.list), pending_possible: true,
        ship_name: c['Ship Name'] || null, imo: g.imo, imo_raw: c['IMO NUMBER'] || null,
        controller: stripContacts(c.Controller) || null, builder: c.Builder || null, year_built: y,
      },
    }
  })
}

// ── Matching (pure; lib/ships/mepMatch.js, shared with resolve.js without an import cycle) ──
export { companyWords, companyOverlap, isBigShip, BIG_M } from './mepMatch.js'

// ── Persistence ──────────────────────────────────────────────────────────────

export async function ensureMepSources(c, S) {
  for (const s of MEP_SOURCES) await upsertSource(c, S, s)
}

/**
 * Groups → evidence + claims + resolution. Idempotent. sourceId picks the list. → { groups, recordsCreated, claimsCreated,
 * superseded, resolved: { 'accept:IMO_EXACT': n, ... } }
 */
export async function importMepChunk(c, S, sourceId, groups, { runId = null, datasetVersion = null, known = [], pages = null } = {}) {
  await c.query(`SELECT pg_advisory_xact_lock(hashtext('ships.mep'))`)
  const out = { groups: groups.length, recordsCreated: 0, claimsCreated: 0, superseded: 0, resolved: {} }
  for (const kind of Object.values(KIND)) {
    const gs = groups.filter((g) => g.kind === kind)
    if (!gs.length) continue
    const url = sourceId === VOYAGES_SOURCE.id ? VOYAGES_URL : FITTED_SOURCE.homepage_url
    const recs = await storeRawRecords(c, S, sourceId, kind,
      gs.map((g) => ({ key: g.key, payload: { name_norm: g.name_norm, ...(g.imo ? { imo: g.imo } : {}), rows: g.rows, pages } })),
      { runId, retrievalUrl: url, datasetVersion })
    out.recordsCreated += recs.created
    const { rows: ents } = await c.query(`SELECT id, entity_key FROM ${S}.source_entities WHERE source_id = $1 AND entity_kind = $2 AND entity_key = ANY($3)`,
      [sourceId, kind, gs.map((g) => g.key)])
    const eid = new Map(ents.map((e) => [e.entity_key, e.id]))
    for (const g of gs) {
      const assertions = kind === KIND.voyageShip ? voyageAssertions(g, known) : fittedAssertions(g)
      const r = await upsertAssertions(c, S, { entityId: eid.get(g.key), recordId: recs.byKey.get(g.key).at(-1), assertions })
      out.claimsCreated += r.created; out.superseded += r.superseded
    }
  }
  return out
}

/** The ids of a MEP source's entities (resolve them in chunks with resolveMepIds, after both lists are stored). */
export async function mepEntityIds(c, S, sourceId) {
  const { rows } = await c.query(`SELECT id FROM ${S}.source_entities WHERE source_id = $1 ORDER BY id`, [sourceId])
  return rows.map((r) => r.id)
}
/**
 * Resolve these entities (resolve.js v1.9 decideMep). → tally { 'accept:IMO_EXACT': n, 'unresolved:no_name_match': n, … }
 * Fast path, same decision: an entity with no link yet whose IMO (IMO rows) or name (name rows) no vessel carries at all is
 * 'no_vessel_with_imo' / 'no_name_match' without asking the resolver (it would write nothing for it either).
 */
export async function resolveMepIds(c, S, ids) {
  const tally = {}
  const { rows: idle } = await c.query(
    `SELECT se.id FROM ${S}.source_entities se
      WHERE se.id = ANY($1) AND NOT EXISTS (SELECT 1 FROM ${S}.entity_links l WHERE l.source_entity_id = se.id AND l.status = 'accepted')
        AND ((se.entity_kind = $2 AND NOT EXISTS (SELECT 1 FROM ${S}.assertions a WHERE a.attribute = 'imo' AND a.value_norm = substr(se.entity_key, 5) AND a.status = 'active'))
          OR (se.entity_kind <> $2 AND NOT EXISTS (SELECT 1 FROM ${S}.assertions a WHERE a.attribute = 'name' AND a.status = 'active'
                AND a.value_norm = split_part(substr(se.entity_key, 6), ' ', 1))))`, [ids, KIND.fittedImo])
  const skip = new Set(idle.map((r) => String(r.id)))
  const { rows: kinds } = await c.query(`SELECT id, entity_kind FROM ${S}.source_entities WHERE id = ANY($1)`, [[...skip]])
  for (const k of kinds) { const t = k.entity_kind === KIND.fittedImo ? 'unresolved:no_vessel_with_imo' : 'unresolved:no_name_match'; tally[t] = (tally[t] || 0) + 1 }
  for (const id of ids) {
    if (skip.has(String(id))) continue
    const d = await resolveEntity(c, S, id)
    const k = `${d.action}${d.method ? `:${d.method}` : ''}${d.reason ? `:${d.reason}` : ''}${d.action === 'unresolved' && d.candidates?.length ? ':with_candidates' : ''}`
    tally[k] = (tally[k] || 0) + 1
  }
  return tally
}

/** Entities of this source the pages no longer list: their active claims become 'superseded' (kept, never deleted). */
export async function finishMep(c, S, sourceId, keys) {
  const { rowCount } = await c.query(
    `UPDATE ${S}.assertions a SET status = 'superseded'
       FROM ${S}.source_entities se
      WHERE se.id = a.source_entity_id AND se.source_id = $1 AND NOT (se.entity_key = ANY($2)) AND a.status = 'active'`,
    [sourceId, keys])
  return { superseded: rowCount }
}
