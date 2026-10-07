/**
 * Washington local clean air agencies' permits for terminal facilities: Puget Sound Clean Air Agency (PSCAA: King, Pierce,
 * Snohomish, Kitsap), Olympic Region Clean Air Agency (ORCAA: Clallam, Jefferson, Grays Harbor, Mason, Pacific, Thurston) and a
 * Southwest Clean Air Agency pilot (SWCAA: Clark, Cowlitz, Lewis, Skamania, Wahkiakum). DEV 2026-10-07. Catalogue and rules:
 * docs/PERMITS_SOURCES.md ("WA local clean air agencies"); data lib/ships/data/wa-air-permits.json; rules src/ships/CLAUDE.md.
 * (NWCAA and the PSCAA Title V list are read by lib/ships/permitDocuments.js.)
 *
 *   evidence        one cached page or document per URL (source = the agency's, kind air_agency_document, key = the URL):
 *                   { url, bytes, sha256, content_type, text, html? , ocr? }; one search record per terminal and agency
 *                   (kind air_agency_search, key = '<terminal>:<agency>') saying what was searched, when, and what was found
 *   claim           permits (system PSCAA / ORCAA / SWCAA, statute 'WA air'; number, holder, address, dates and status as the
 *                   agency's own page or document states them); documents (the agency's files and pages)
 *   interpretation  the hand-checked entries of wa-air-permits.json (holder + site address checked against the agency's text, with
 *                   why); facility_permits; permit_terminal_coverage where a permit's own text names the dock, ship loading or
 *                   vessel fueling (quote checked against the stored text)
 *
 * The agencies publish no searchable list of notices of violation or penalties; PSCAA's (and NWCAA's) are reported to EPA's
 * ICIS-Air and reach us through ECHO (lib/ships/facilities.js), named here by the ICIS-Air id prefix (localAgencyOf).
 */
import { createHash } from 'node:crypto'
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'

/** Cache file stem for one URL (or URL + form body) — stable across encodings of the same URL. */
export const airCacheName = (url) => `air-${createHash('sha1').update(decodeURI(String(url))).digest('hex').slice(0, 16)}`

const CLEARED = 'Public agency record: cleared for EarthAtlas use by Josh 2026-10-06 (public agency records are treated as cleared; terms page not read). Credit and link.'
export const AGENCIES = {
  pscaa: { system: 'PSCAA', name: 'Puget Sound Clean Air Agency', counties: ['King', 'Pierce', 'Snohomish', 'Kitsap'], icis: 'WAPSC',
    source: { id: 'pscaa-documents', name: 'Puget Sound Clean Air Agency — permit documents and public notices',
      publisher: 'Puget Sound Clean Air Agency', homepage_url: 'https://pscleanair.gov/101/Permits-Registration', license: CLEARED, license_url: null,
      commercial_use: false, attribution_text: 'Puget Sound Clean Air Agency', attribution_url: 'https://pscleanair.gov/101/Permits-Registration',
      notes: 'Orders of Approval, worksheets and notices PSCAA posts in its Document Center, project pages and News Flash notices; found by '
        + 'web search of pscleanair.gov and the agency\'s own pages (the Document Center folder tree loads by script and is not enumerated).' } },
  orcaa: { system: 'ORCAA', name: 'Olympic Region Clean Air Agency', counties: ['Clallam', 'Jefferson', 'Grays Harbor', 'Mason', 'Pacific', 'Thurston'], icis: null,
    source: { id: 'orcaa-permits', name: 'Olympic Region Clean Air Agency — notices, permits and registered sources',
      publisher: 'Olympic Region Clean Air Agency', homepage_url: 'https://www.orcaa.org/for-business/notices-registered-businesses/', license: CLEARED,
      license_url: null, commercial_use: false, attribution_text: 'Olympic Region Clean Air Agency',
      attribution_url: 'https://www.orcaa.org/for-business/notices-registered-businesses/',
      notes: 'Notice pages (orcaa.org/notices/…: business, address, notice #, status, date finalized, Final Determination PDF), the list of '
        + 'registered sources (PDF), and site search. Scanned PDFs read by OCR (macOS Vision) at fetch time.' } },
  swcaa: { system: 'SWCAA', name: 'Southwest Clean Air Agency', counties: ['Clark', 'Cowlitz', 'Lewis', 'Skamania', 'Wahkiakum'], icis: null,
    source: { id: 'swcaa-permits', name: 'Southwest Clean Air Agency — Air Discharge Permit search',
      publisher: 'Southwest Clean Air Agency', homepage_url: 'https://www.swcleanair.gov/permits/permitADPsearch.asp', license: CLEARED, license_url: null,
      commercial_use: false, attribution_text: 'Southwest Clean Air Agency', attribution_url: 'https://www.swcleanair.gov/permits/permitADPsearch.asp',
      notes: 'Air Discharge Permit search results per plant (the public search form, posted as the page does): every permit with its '
        + 'ADP / TSD PDFs and final date. Scanned PDFs read by OCR (macOS Vision) at fetch time.' } },
}
export const AIR_SYSTEMS = Object.values(AGENCIES).map((a) => a.system)
export const AIR_SOURCE_IDS = Object.values(AGENCIES).map((a) => a.source.id)
export const agencyBySystem = (system) => Object.values(AGENCIES).find((a) => a.system === system) ?? null

export async function ensureAirSources(c, S) { for (const a of Object.values(AGENCIES)) await upsertSource(c, S, a.source) }

// ICIS-Air ids start with WA + the local agency's code (seen in ECHO: WAPSC… PSCAA, WANCA… NWCAA).
const ICIS_PREFIX = { WAPSC: 'Puget Sound Clean Air Agency', WANCA: 'Northwest Clean Air Agency' }
/** The local agency an ECHO "Local" action belongs to, from its ICIS-Air id (null when the prefix isn't one we know). */
export const localAgencyOf = (sourceId) => ICIS_PREFIX[String(sourceId || '').replace(/^AIR\//, '').slice(0, 5)] ?? null

// ── Parsing ───────────────────────────────────────────────────────────────────

const ENT = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '’', '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”', '&ndash;': '–', '&mdash;': '—', '&#038;': '&', '&#8211;': '–', '&#8217;': '’' }
const decode = (s) => String(s ?? '').replace(/&[#a-z0-9]+;/gi, (e) => ENT[e] ?? (/^&#\d+;$/.test(e) ? String.fromCharCode(Number(e.slice(2, -1))) : e))
/** Collapse to one line. */
export const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim()
/** The readable text of an HTML page (scripts, styles and tags removed). */
export const htmlText = (html) => oneLine(decode(String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')))
/** The text a document's checks run against: PDF text as extracted (or OCR'd), or an HTML page's readable text. */
export const docText = (d) => (/html/i.test(d?.content_type || '') ? htmlText(d.text) : String(d?.text || ''))
/** Is `says` in the text, ignoring line breaks, runs of spaces and case? */
export const quoteIn = (text, says) => oneLine(text).toLowerCase().includes(oneLine(says).toLowerCase())

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
/** "April 25, 2025" / "Tuesday, March 13, 2012" → 2025-04-25 (null when not a date). */
export function longDate(s) {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(String(s || ''))
  const mo = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1
  return mo < 0 ? null : `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

/** One ORCAA notice page (orcaa.org/notices/…): the fields in its details list, its description and its document links. */
export function parseOrcaaNotice(html) {
  const s = String(html || '')
  const title = oneLine(decode((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(s) || [])[1] || '').replace(/<[^>]+>/g, ' ')) || null
  const block = (cls) => { const i = s.indexOf(`class="${cls}"`); return i < 0 ? '' : s.slice(s.indexOf('>', i) + 1, s.indexOf('</section>', i)) }
  const fields = {}
  const links = []
  for (const li of block('notice-details').match(/<li>[\s\S]*?<\/li>/g) || []) {
    const label = oneLine(decode((/notice-label">([\s\S]*?)<\/span>/.exec(li) || [])[1] || '')).replace(/:$/, '')
    if (!label) continue
    for (const a of li.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) links.push({ field: label, label: htmlText(a[2]), url: a[1] })
    fields[label] = htmlText(li.replace(/<span class="notice-label">[\s\S]*?<\/span>/, ''))
  }
  for (const a of block('notice-final-determination').matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) links.push({ field: 'Final Determination', label: htmlText(a[2]), url: a[1] })
  const description = htmlText(block('notice-content').replace(/<h2[\s\S]*?<\/h2>/, '')) || null
  return { title, posted: longDate(fields.Posted), business: fields['Name of Business'] ?? null, address: fields.Address ?? null,
    source_class: (/Classification\s+(\S+)/.exec(fields.Source || '') || [])[1] ?? null, notice: fields['Notice #'] ?? null,
    status: fields.Status ?? null, finalized: longDate(fields['Date Finalized']), type: fields['Notice Type'] ?? null, description, links }
}

/** SWCAA Air Discharge Permit search results for one plant: names, and every permit (number, PDFs, dates) in the agency's order. */
export function parseSwcaaPermits(html) {
  const s = String(html || '')
  const plant = oneLine(decode((/For Source Name = ([^<]+)</.exec(s) || [])[1] || '')) || null
  const previous = [...(/Previous Plant Names:[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/.exec(s)?.[1] || '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => htmlText(m[1]))
  const site = oneLine(decode((/<h2 class="names">([\s\S]*?)<\/h2>/.exec(s) || [])[1]?.replace(/<[^>]+>/g, ' ') || '')) || null
  const parts = s.split(/<h4 class="indent bolder"[^>]*>/).slice(1)
  const abs = (u) => (u ? new URL(u, 'https://www.swcleanair.gov/permits/').href : null)
  const permits = parts.map((p) => {
    const field = (label) => oneLine(decode((new RegExp(`${label}:?(?:&nbsp;)?\\s*<span class="qalt">([\\s\\S]*?)</span>`).exec(p) || [])[1]?.replace(/<[^>]+>/g, ' ') || '')) || null
    return {
      number: oneLine((/PERMIT NO: <span class="qalt bolder">([^<]+)</.exec(p) || [])[1] || '') || null,
      permit_url: abs((/Air Discharge Permit: <span class="qalt"><a href="([^"]+)"/.exec(p) || [])[1]),
      tsd_url: abs((/Technical Support Document: <span class="qalt"><a href="([^"]+)"/.exec(p) || [])[1]),
      final: longDate(field('Date Final')), notice_web: longDate(field('SWCAA Public Notice to Web')),
      sepa: oneLine(decode((/SEPA DETERMINATION NO: <span class="qalt">([^<]*)</.exec(p) || [])[1] || '')) || null,
    }
  }).filter((p) => p.number)
  return { plant, site, previous, permits }
}

// ── Data file checks ──────────────────────────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/
/** The hand-checked data file: what each entry must carry. Returns error strings. */
export function validateAirData(d) {
  const errs = []
  const searches = d?.searches || {}
  for (const [id, s] of Object.entries(searches)) if (!AGENCIES[s.agency] || !s.title || !s.short || !s.url || !ISO.test(s.date || '')) errs.push(`search ${id} incomplete`)
  const seen = new Set()
  for (const e of d?.entries || []) {
    const id = `${e.terminal}:${e.agency}`
    if (!/^wa-[a-z0-9-]+$/.test(e.terminal || '') || !AGENCIES[e.agency]) { errs.push(`entry ${id}: terminal / agency`); continue }
    if (seen.has(id)) errs.push(`entry ${id}: duplicate`)
    seen.add(id)
    if (!(e.searched || []).length || e.searched.some((x) => !searches[x])) errs.push(`entry ${id}: searched must name searches`)
    if (!(e.permits || []).length && !(e.attach || []).length && !e.none) errs.push(`entry ${id}: permits, attach or none`)
    for (const p of e.permits || []) {
      const pid = `${id} ${p.number ?? p.key}`
      if (!(p.number || p.key) || !p.label || !p.kind || !p.holder || !p.address || !p.status || !p.why) errs.push(`${pid}: number/key, label, kind, holder, address, status, why`)
      if (p.issued && !ISO.test(p.issued)) errs.push(`${pid}: issued`)
      if (!(p.docs || []).length || !p.docs[0].url || !p.docs[0].title) errs.push(`${pid}: docs[0] (the main document) needed`)
      for (const c of p.covers || []) if (!c.terminal || !c.doc || !c.where || !c.says) errs.push(`${pid}: covers entry incomplete`)
    }
    for (const a of e.attach || []) {
      if (!a.permit?.system || !a.permit?.key || !((a.docs || []).length || (a.covers || []).length)) errs.push(`${id}: attach needs permit {system, key} and docs or covers`)
      for (const c of a.covers || []) if (!c.terminal || !c.doc || !c.where || !c.says) errs.push(`${id}: attach covers entry incomplete`)
    }
  }
  return errs
}

/** Every URL the entries need from the cache: listing pages, main documents and quoted documents (others are links only). */
export function urlsNeeded(d) {
  const out = []
  const add = (u, form = null) => { if (u && !out.some((x) => x.url === u && JSON.stringify(x.form) === JSON.stringify(form))) out.push({ url: u, form }) }
  for (const e of d.entries || []) {
    for (const p of e.permits || []) {
      add(p.docs[0].url, p.docs[0].form ?? null)
      if (p.page_url) add(p.page_url, p.page_form ?? null)
      for (const c of p.covers || []) add(c.doc)
    }
    for (const a of e.attach || []) { if (a.page_url) add(a.page_url); for (const c of a.covers || []) add(c.doc) }
  }
  return out
}
/** Cache key of a URL fetched with a form (the agency's search form). */
export const formKey = (url, form) => (form ? `${url} POST ${new URLSearchParams(form).toString()}` : url)

/**
 * The text checks the import makes, without a database: each permit's number and holder words in its main document, each
 * dock quote in its document. Returns problem strings (empty = all pass).
 */
export function checkTexts(data, docs) {
  const out = []
  const text = (u, f = null) => docText(docs.get(formKey(u, f)))
  for (const e of data.entries || []) {
    for (const p of e.permits || []) {
      const k = `${e.terminal} ${p.number ?? p.key}`
      const t = text(p.docs[0].url, p.docs[0].form ?? null)
      if (!t) { out.push(`${k}: main document not cached`); continue }
      if (p.number && !oneLine(t).includes(p.number)) out.push(`${k}: number not in the main document`)
      for (const w of p.holder_words || [p.holder]) if (!quoteIn(t, w)) out.push(`${k}: "${w}" not in the main document`)
      for (const c of p.covers || []) if (!quoteIn(text(c.doc), c.says)) out.push(`${k}: quote not found: "${c.says}"`)
    }
    for (const a of e.attach || []) for (const c of a.covers || []) if (!quoteIn(text(c.doc), c.says)) out.push(`${e.terminal} ${a.permit.key}: quote not found: "${c.says}"`)
  }
  return out
}

// ── Import ────────────────────────────────────────────────────────────────────

async function storeDoc(c, S, sourceId, d, runId) {
  const key = formKey(d.url, d.form ? Object.fromEntries(new URLSearchParams(d.form)) : null)
  const ent = await findOrCreateEntity(c, S, { sourceId, kind: 'air_agency_document', anchor: decodeURI(key) })
  const isHtml = /html/i.test(d.content_type || '')
  const r = await upsertRecord(c, S, { sourceId, entityId: ent.id,
    payload: { url: d.url, ...(d.form ? { form: d.form } : {}), bytes: d.bytes, sha256: d.sha256, content_type: d.content_type,
      text: isHtml ? htmlText(d.text) : d.text, ...(isHtml ? { html: d.text } : {}), ...(d.ocr ? { ocr: d.ocr } : {}) },
    datasetVersion: d.retrieved_at?.slice(0, 10) ?? null, retrievalUrl: d.url, runId })
  return { id: Number(r.id), created: r.created }
}

/**
 * docs = Map(cache key → cached document) (formKey(url, form)). Imports every entry of the data file: one search record per
 * terminal + agency; permits (number checked in the main document's text, holder name too) with their documents, held by the
 * terminal's facility; documents and dock quotes added to an EPA-listed permit (attach); dock quotes (checked against the
 * stored text). Anything that fails a check is reported and not stored. Idempotent.
 */
export async function importWaAir(c, S, data, docs, { runId = null } = {}) {
  const errs = validateAirData(data)
  if (errs.length) throw new Error(`wa air data invalid:\n  ${errs.join('\n  ')}`)
  const stats = { searches: 0, permits: 0, attached: 0, documents: 0, coverage: 0, recordsCreated: 0, problems: [] }
  await ensureAirSources(c, S)
  const recs = new Map()   // cache key → source record id
  const record = async (sourceId, url, form = null) => {
    const k = formKey(url, form)
    if (recs.has(k)) return recs.get(k)
    const d = docs.get(k)
    if (!d) return null
    const r = await storeDoc(c, S, sourceId, d, runId)
    stats.recordsCreated += r.created ? 1 : 0
    recs.set(k, r.id)
    return r.id
  }
  const textOf = (url, form = null) => docText(docs.get(formKey(url, form)))
  const addDoc = async (sourceId, d, recId, link) => {
    const { rows: [doc] } = await c.query(
      `INSERT INTO ${S}.documents (source_id, url, title, doc_type, description, doc_date, source_record_id, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, doc_type = EXCLUDED.doc_type, description = EXCLUDED.description,
         doc_date = EXCLUDED.doc_date, source_record_id = EXCLUDED.source_record_id, status = 'listed', detail = EXCLUDED.detail, last_seen_at = now()
       RETURNING id`,
      [sourceId, d.url, d.title, d.type ?? null, d.description ?? null, d.date ?? null, recId, { agency_doc: true, ...(d.ocr ? { ocr: true } : {}) }])
    await c.query(`INSERT INTO ${S}.document_links (document_id, permit_id, method, detail) VALUES ($1,$2,'wa_air_curated',$3)
                   ON CONFLICT (document_id, permit_id) WHERE permit_id IS NOT NULL DO UPDATE SET detail = EXCLUDED.detail, last_seen_at = now()`,
      [doc.id, link.permitId, link.detail ?? {}])
    stats.documents++
  }
  const cover = async (permitId, entryRecId, cv, docTitle, f) => {
    const text = textOf(cv.doc)
    if (!text) { stats.problems.push(`${f}: quoted document not cached: ${cv.doc}`); return }
    if (!quoteIn(text, cv.says)) { stats.problems.push(`${f}: quote not found in ${cv.doc}: "${cv.says}"`); return }
    const { rows: [t] } = await c.query(`SELECT id FROM ${S}.terminals WHERE key = $1`, [cv.terminal])
    if (!t) { stats.problems.push(`${f}: terminal ${cv.terminal} not in the database`); return }
    await c.query(
      `INSERT INTO ${S}.permit_terminal_coverage (permit_id, terminal_id, entry_source_record_id, detail) VALUES ($1,$2,$3,$4)
       ON CONFLICT (permit_id, terminal_id) DO UPDATE SET entry_source_record_id = EXCLUDED.entry_source_record_id, detail = EXCLUDED.detail,
         status = 'active', last_seen_at = now()`,
      [permitId, t.id, entryRecId, { doc_url: cv.doc, doc_title: cv.doc_title ?? docTitle, where: cv.where, says: cv.says }])
    stats.coverage++
  }

  for (const e of data.entries) {
    const ag = AGENCIES[e.agency]
    const sid = ag.source.id
    const tag = `${e.terminal} ${ag.system}`
    // The search itself (what was searched, when, what was found): evidence keyed by terminal + agency, shown as "none found".
    const searched = e.searched.map((x) => data.searches[x])
    const sEnt = await findOrCreateEntity(c, S, { sourceId: sid, kind: 'air_agency_search', anchor: `${e.terminal}:${e.agency}` })
    const sRec = await upsertRecord(c, S, { sourceId: sid, entityId: sEnt.id, datasetVersion: data.version, retrievalUrl: null, runId,
      payload: { terminal: e.terminal, agency: e.agency, agency_name: ag.name, searched: searched.map(({ title, short, url, date }) => ({ title, short: short ?? null, url, date })),
        result: (e.permits || []).length ? 'found' : 'none found', none: e.none ?? null, entry: e } })
    stats.recordsCreated += sRec.created ? 1 : 0
    stats.searches++
    const searchRec = Number(sRec.id)
    // The facility that holds the terminal's permits: named, or the one the terminal is linked to (owned_by first).
    const { rows: [fac] } = e.facility
      ? await c.query(`SELECT id FROM ${S}.facilities WHERE key = $1`, [e.facility])
      : await c.query(`SELECT f.id FROM ${S}.terminal_facilities tf JOIN ${S}.terminals t ON t.id = tf.terminal_id
                        JOIN ${S}.facilities f ON f.id = tf.facility_id
                       WHERE t.key = $1 AND tf.status = 'active' AND f.list_status = 'listed' ORDER BY (tf.relation = 'owned_by') DESC, f.id LIMIT 1`, [e.terminal])
    if (!fac && ((e.permits || []).length || (e.attach || []).length)) stats.problems.push(`${tag}: no facility for this terminal yet (${e.facility ?? 'via terminal_facilities'}); its permits are not stored`)

    for (const p of fac ? e.permits || [] : []) {
      const key = p.number ?? p.key
      const main = p.docs[0]
      const mainRec = await record(sid, main.url, main.form ?? null)
      if (!mainRec) { stats.problems.push(`${tag} ${key}: main document not cached: ${main.url}`); continue }
      const text = textOf(main.url, main.form ?? null)
      if (p.number && !oneLine(text).includes(p.number)) { stats.problems.push(`${tag} ${key}: number not in ${main.url}`); continue }
      if (!(p.holder_words || [p.holder]).every((w) => quoteIn(text, w))) { stats.problems.push(`${tag} ${key}: holder "${(p.holder_words || [p.holder]).join(' / ')}" not in ${main.url}`); continue }
      const pageRec = p.page_url ? await record(sid, p.page_url, p.page_form ?? null) : null
      if (p.page_url && !pageRec) { stats.problems.push(`${tag} ${key}: listing page not cached: ${p.page_url}`); continue }
      const { rows: [pr] } = await c.query(
        `INSERT INTO ${S}.permits (epa_system, permit_key, statute, name, universe, areas, expires, program_status, frs_ids, source_record_id, detail)
         VALUES ($1,$2,'WA air',$3,$4,NULL,$5,$6,'{}',$7,$8)
         ON CONFLICT (epa_system, permit_key) DO UPDATE SET statute = EXCLUDED.statute, name = EXCLUDED.name, universe = EXCLUDED.universe,
           expires = EXCLUDED.expires, program_status = EXCLUDED.program_status, source_record_id = EXCLUDED.source_record_id,
           detail = ${S}.permits.detail || EXCLUDED.detail, last_seen_at = now()
         RETURNING id`,
        [ag.system, key, p.holder, p.kind, p.expires ?? null, p.status, mainRec,
          { wa_air: { agency: e.agency, agency_name: ag.name, label: p.label, holder: p.holder, address: p.address, registration: p.registration ?? null,
            source_class: p.source_class ?? null, issued: p.issued ?? null, what: p.what ?? null, status_note: p.status_note ?? null,
            replaced_by: p.replaced_by ?? null, page_url: p.page_url ?? null, main_url: main.url, why: p.why, search_record_id: searchRec } }])
      await c.query(
        `INSERT INTO ${S}.facility_permits (facility_id, permit_id, method, source_record_id) VALUES ($1,$2,'wa_air_curated',$3)
         ON CONFLICT (facility_id, permit_id) DO UPDATE SET source_record_id = EXCLUDED.source_record_id, last_seen_at = now()`,
        [fac.id, pr.id, mainRec])
      stats.permits++
      for (const [i, d] of p.docs.entries()) {
        const own = await record(sid, d.url, d.form ?? null)   // a file we read; otherwise evidenced by the listing page that links it
        const rec = own ?? pageRec ?? mainRec
        await addDoc(sid, { ...d, date: d.date ?? (i === 0 ? p.issued ?? null : null), ocr: docs.get(formKey(d.url, d.form ?? null))?.ocr },
          rec, { permitId: pr.id, detail: { permit: key, read: Boolean(own) } })
      }
      const { rows: [{ entry_source_record_id: facEntry }] } = await c.query(`SELECT entry_source_record_id FROM ${S}.facilities WHERE id = $1`, [fac.id])
      for (const cv of p.covers || []) await cover(pr.id, facEntry, cv, p.docs.find((d) => d.url === cv.doc)?.title ?? p.label, `${tag} ${key}`)
    }
    // Documents and dock quotes for a permit EPA already lists (e.g. a Title V permit's ICIS-Air record).
    for (const a of fac ? e.attach || [] : []) {
      const { rows: [pr] } = await c.query(`SELECT id FROM ${S}.permits WHERE epa_system = $1 AND permit_key = $2`, [a.permit.system, a.permit.key])
      if (!pr) { stats.problems.push(`${tag}: ${a.permit.system} ${a.permit.key} not among the permits (run ships:import-facilities first)`); continue }
      const pageRec = a.page_url ? await record(sid, a.page_url) : null
      for (const d of a.docs || []) {
        const own = await record(sid, d.url)
        const rec = own ?? pageRec
        if (!rec) { stats.problems.push(`${tag}: ${d.url}: neither the file nor its listing page is cached`); continue }
        await addDoc(sid, d, rec, { permitId: pr.id, detail: { attach: a.permit.key, read: Boolean(own) } })
      }
      const { rows: [{ entry_source_record_id: facEntry }] } = await c.query(`SELECT entry_source_record_id FROM ${S}.facilities WHERE id = $1`, [fac.id])
      for (const cv of a.covers || []) await cover(pr.id, facEntry, cv, (a.docs || []).find((d) => d.url === cv.doc)?.title ?? a.permit.key, `${tag} ${a.permit.key}`)
      stats.attached++
    }
  }
  return stats
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** The agency searches recorded for one terminal: [{ agency, agencyName, result, none, searched: [{ title, url, date }], recordId }]. */
export async function airSearchesFor(q, S, terminalKey) {
  const rows = await q(`SELECT DISTINCT ON (se.id) se.entity_key, sr.id, sr.payload FROM ${S}.source_entities se
                          JOIN ${S}.source_records sr ON sr.source_entity_id = se.id
                         WHERE se.entity_kind = 'air_agency_search' AND se.source_id = ANY($2) AND se.entity_key LIKE $1 || ':%'
                         ORDER BY se.id, sr.id DESC`, [terminalKey, AIR_SOURCE_IDS])
  return rows.map((r) => ({ agency: r.payload.agency, agencyName: r.payload.agency_name, result: r.payload.result, none: r.payload.none,
    searched: r.payload.searched, recordId: Number(r.id) })).sort((a, b) => a.agency.localeCompare(b.agency))
}
