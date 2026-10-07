/**
 * SEPA review per PERMIT (Lovel 2026-10-07: "the SEPA reviews that should be associated with each permit"). Rules written down in
 * docs/PERMITS_SOURCES.md §6; migration 031. Facility-level SEPA links (facility_links role 'sepa_review', lib/ships/facilities.js
 * sepaMatch) stay as they are; this adds, for each permit, which SEPA Register record(s) cover it and the evidence for each, or
 * what the permit's own documents say about SEPA, or "none found" with what was searched.
 *
 *   evidence        the SEPA Register record pages (kind sepa_record, already stored); the SEPA Register search for the permit
 *                   number (its hits stored as sepa_record); the text of the permit's fact sheet / support document / Air
 *                   Operating Permit, read for SEPA (kind document_sepa_text: the SEPA passages verbatim with page numbers, the
 *                   approval numbers an air permit lists, and the file's SHA-256; the file itself is not kept)
 *   interpretation  permit_sepa rows: kind 'review' (a SEPA record covers this permit, method = the rule that linked it, detail =
 *                   the evidence), 'statement' (the permit's own document says what SEPA did: exempt, relies on an earlier
 *                   review, or a determination not found in the Register) and 'none_found' (with what was searched).
 *                   Weaker matches (same lead agency, nothing explicit) are stored as status 'candidate' and not shown.
 *
 * Rules (each one explicit; never a guess):
 *   names_permit        the SEPA record (proposal, description, file number or document names) names the permit number.
 *   doc_cites_review    a SEPA passage of the permit's own fact sheet / support document names an identifier the SEPA record
 *                       carries (SEPA number, the lead agency's file number, an agreed-order number) AND the record's lead
 *                       agency is the agency that issues the permit (a fact sheet discussing another agency's review of another
 *                       project is not this permit's review).
 *   approval_in_permit  air permits: a SEPA record led by the air agency that issues the permit names an air approval (OAC n,
 *                       Regulatory Order RO n) and the permit's Air Operating Permit lists that approval as part of the permit.
 *   same_project        a permit (typically a construction stormwater coverage) named for a project: the project's own words
 *                       (the permit name without the company / site words, at least 3 words, numbers included) appear as one
 *                       phrase in the proposal name or description of a SEPA record already matched to the facility.
 *   register_related    the SEPA Register's own "Related" field ties a record matched to the facility to a record linked above.
 */

/** Permit systems that get a SEPA answer. RCRAInfo only when the record is a permit (Ecology lists a permit document for it). */
export const SEPA_SYSTEMS = ['ICIS-NPDES', 'WA-PARIS', 'ICIS-Air', 'RCRAInfo']
/** Systems whose number is searched for in the SEPA Register (an ICIS-Air id is EPA's own, never written on a SEPA record). */
export const SEARCHED_SYSTEMS = ['ICIS-NPDES', 'WA-PARIS', 'RCRAInfo']

/** The agency that issues a permit, from where its documents are listed, as the SEPA Register names it as lead agency. */
export const ISSUER_LEAD = {
  'wa-ecology-paris': 'WA Department of Ecology', 'wa-ecology-industrial': 'WA Department of Ecology',
  'nwcaa-aop': 'Northwest Clean Air Agency', 'pscaa-title-v': 'Puget Sound Clean Air Agency',
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

// ── Identifiers ───────────────────────────────────────────────────────────────

const PERMIT_RE = /\b(WA\d{7}|WAR\d{6}|WAD\d{9}|WAH\d{9}|WAG\d{6,7}|ST\d{7}|SO\d{7})\b/gi
const ORDER_RE = /\bDE\s*(?:No\.?\s*)?#?\s*(\d{4,6})\b/g
const APPROVAL_RE = /\b(OAC|RO)\s*(?:No\.?\s*)?#?\s*(\d{1,4})[a-z]?\b/g

/**
 * The identifiers a SEPA record carries: its own SEPA number, the lead agency's file number(s), and every permit number,
 * agreed-order number and air approval (OAC / RO) its proposal name, description or document names give. [{ id, kind, where }]
 */
export function recordIds(rec) {
  const out = []
  const add = (id, kind, where) => { if (!out.some((x) => x.id === id && x.kind === kind)) out.push({ id, kind, where }) }
  if (rec.sepa) add(String(rec.sepa), 'sepa', 'SEPA number')
  for (const f of String(rec.fileNumber || '').split(/[,;]\s*/).map((x) => x.replace(/^#/, '').trim()).filter((x) => x.length >= 5 && /\d/.test(x) && /[-A-Za-z]/.test(x))) add(f, 'file', 'lead agency file number')
  const texts = [['proposal name', rec.proposalName], ['description', rec.description], ['lead agency file number', rec.fileNumber],
    ...(rec.documents || []).map((d) => ['document name', d.name])]
  for (const [where, t] of texts) {
    const s = String(t || '')
    for (const m of s.matchAll(PERMIT_RE)) add(m[1].toUpperCase(), 'permit', where)
    for (const m of s.matchAll(ORDER_RE)) add(`DE ${m[1]}`, 'order', where)
    for (const m of s.matchAll(APPROVAL_RE)) add(`${m[1]} ${Number(m[2])}`, 'approval', where)
  }
  return out
}

/** A regex that finds one identifier in running text (spacing, "No.", "#" and an OAC revision letter tolerated). */
export function idPattern({ id, kind }) {
  if (kind === 'order') return new RegExp(`\\bDE\\s*(?:No\\.?\\s*)?#?\\s*${id.split(' ')[1]}\\b`)
  if (kind === 'approval') { const [t, n] = id.split(' '); return new RegExp(`\\b${t}\\s*(?:No\\.?\\s*)?#?\\s*0*${n}[a-z]?\\b`) }
  if (kind === 'file') return new RegExp(`(^|[^A-Za-z0-9])${esc(id).replace(/-/g, '\\s*-\\s*')}([^A-Za-z0-9]|$)`, 'i')
  return new RegExp(`\\b${esc(id)}\\b`, 'i')
}

// ── Permit documents: what they say about SEPA ───────────────────────────────

const SEPA_WORD = /\bSEPA\b|State Environmental Policy Act/
const headingLike = (l) => l.length < 95 && !/[.:;,]$/.test(l) && !/\.{4,}/.test(l)
// A SEPA section heading: optional numbering, then "State Environmental Policy Act" / "SEPA", then a few words, no sentence.
const SEPA_HEADING = /^(?:[A-Z0-9IVX]{1,5}[.)](?:[A-Z0-9]{1,3}[.)])*\s+)?(?:State Environmental Policy Act|SEPA)\b[^.;:]{0,60}$/i

/**
 * The SEPA passages of a document (pdftotext -layout pages): each paragraph naming SEPA, verbatim (whitespace squashed), with
 * its page. A paragraph that is a SEPA heading ("E. State Environmental Policy Act (SEPA) compliance") carries the section's
 * text after it (to the next heading, ≤ 1,500 characters) and is marked section: true. Tables of contents and glossary lines
 * are skipped.
 */
export function sepaPassages(pages) {
  const out = []
  ;(pages || []).forEach((page, i) => {
    const lines = String(page).split('\n').map((l) => l.trim())
    const used = new Set()
    // 1. Sections: a SEPA heading line, then the lines after it up to the next heading (≤ 1,500 characters).
    for (let k = 0; k < lines.length; k++) {
      if (!lines[k] || !SEPA_HEADING.test(lines[k]) || !headingLike(lines[k]) || /^SEPA\s+State Environmental Policy Act$/.test(lines[k])) continue
      const body = []
      let j = k + 1
      for (; j < lines.length && body.join(' ').length < 1500; j++) {
        const l = lines[j]
        if (!l) { if (body.length && /[.:]$/.test(body[body.length - 1])) { const nx = lines.slice(j + 1).find(Boolean); if (nx && isHeadingStart(nx, '.')) break } continue }
        if (body.length && isHeadingStart(l, body[body.length - 1])) break
        body.push(l)
      }
      for (let x = k; x < j; x++) used.add(x)
      if (body.length) out.push({ page: i + 1, heading: squash(lines[k]), text: squash(body.join(' ')).slice(0, 1500), section: true })
    }
    // 2. Every other paragraph that names SEPA (blank-line separated), skipping tables of contents and glossary lines.
    let para = []
    const flush = (end) => {
      const text = squash(para.map((x) => lines[x]).join(' '))
      if (para.length && !para.some((x) => used.has(x)) && SEPA_WORD.test(text) && !/\.{5,}/.test(text) && !/^SEPA\s+State Environmental Policy Act$/.test(text)) out.push({ page: i + 1, heading: null, text: text.slice(0, 1500), section: false })
      para = []
      return end
    }
    lines.forEach((l, x) => { if (l) para.push(x); else flush() })
    flush()
  })
  return out
}

/** Does a line start a new heading? Numbered ("II. Proposed Permit Limits", "3.2 Crude Unit") or a short line after a sentence. */
function isHeadingStart(line, prev) {
  if (/^(?:[A-Z]|[IVX]{1,5}|\d+)(?:[.)](?:[A-Z]|\d+))*[.)]?\s+[A-Z][^.]{0,80}$/.test(line) && /^\S*[.)]\s/.test(line)) return true
  return line.length < 60 && /^[A-Z]/.test(line) && !/[.,;:]$/.test(line) && /[.:]$/.test(String(prev || ''))
}

/** What a SEPA section says: 'exempt' | 'relies' (on an earlier review / EIS) | 'determination' | 'mention'. */
export function classifyStatement(text) {
  const t = String(text)
  if (/\bexempt/i.test(t)) return 'exempt'
  if (/\brel(y|ies|ied)\s+on\b|\badopt(s|ed|ion)?\b[^.]*\b(EIS|environmental impact statement|determination)|existing EIS/i.test(t)) return 'relies'
  if (/Determination of (Non-?)?significance|\bM?DNS\b|\bDS\b|\bEIS\b|environmental impact statement/i.test(t)) return 'determination'
  return 'mention'
}

/** A short verbatim quote: whole sentences from the start, ≤ max characters (an ellipsis marks a cut). */
export function quoteOf(text, max = 420) {
  const t = squash(text)
  if (t.length <= max) return t
  const sentences = t.split(/(?<=[.!?][”")]?)\s+(?=[A-Z(“"])/)
  let q = ''
  for (const s of sentences) { if ((q ? `${q} ${s}` : s).length > max) break; q = q ? `${q} ${s}` : s }
  return (q.trim() || t.slice(0, max)).trim() + ' …'
}

/** The air approvals (OAC n / RO n) an Air Operating Permit lists, each with the first page it appears on. */
export function approvalsListed(pages) {
  const seen = new Map()
  ;(pages || []).forEach((page, i) => {
    for (const m of String(page).matchAll(APPROVAL_RE)) {
      const id = `${m[1]} ${Number(m[2])}`
      if (!seen.has(id)) seen.set(id, i + 1)
    }
  })
  return [...seen].map(([id, page]) => ({ id, page }))
}

/**
 * The evidence payload stored for one permit document read for SEPA: what was read (URL, hash, pages) and only the parts
 * used — SEPA passages verbatim, and for an air permit the approvals it lists.
 */
export function documentSepaText(doc, fetched, { air = false } = {}) {
  return { url: doc.url, title: doc.title, source: doc.source, sha256: fetched.sha256, bytes: fetched.bytes, pages: fetched.pages?.length ?? 0,
    retrieved_at: fetched.retrieved_at, passages: sepaPassages(fetched.pages), ...(air ? { approvals: approvalsListed(fetched.pages) } : {}) }
}

// ── Which document to read per permit ────────────────────────────────────────

const NOT_FINAL = /draft|addendum|supplement|amendment|public ?notice|public review|PNOP|PNODP|response ?to ?comments|sediment|\bRE_/i
const titleDate = (t) => { const m = /(20\d\d)[-_](\d{1,2})[-_](\d{1,2})/.exec(t || ''); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '' }

/**
 * The documents of a permit that state its SEPA basis: the newest final fact sheet in PARIS (highest permit version, then date),
 * else every Ecology "support document" linked to it (the current fact sheets, from the Industrial Section page; a hazardous-waste
 * id can carry two, e.g. the dangerous waste permit and the corrective action permit); for an air permit, the Air Operating
 * Permit itself (it lists the approvals it holds and their SEPA conditions). Returns [{ doc, role }] in a fixed order.
 */
export function sepaDocsFor(permit, docs) {
  if (permit.epa_system === 'ICIS-Air') {
    const aop = docs.filter((d) => (d.source === 'nwcaa-aop' && d.type === 'AOP') || (d.source === 'pscaa-title-v' && /operating permit/i.test(d.type || '')))
      .sort((a, b) => a.url.localeCompare(b.url))[0]
    return aop ? [{ doc: aop, role: 'air_operating_permit' }] : []
  }
  const sheets = docs.filter((d) => d.source === 'wa-ecology-paris' && /^permit documents$/i.test(d.type || '') && /fact.?sheet/i.test(d.title) && !NOT_FINAL.test(d.title))
    .sort((a, b) => (Number(b.permitVersion) || 0) - (Number(a.permitVersion) || 0)
      || (titleDate(b.title) || b.date || '').localeCompare(titleDate(a.title) || a.date || '') || a.url.localeCompare(b.url))
  if (sheets.length) return [{ doc: sheets[0], role: 'fact_sheet' }]
  return docs.filter((d) => d.source === 'wa-ecology-industrial' && /support document/i.test(d.title))
    .filter((d, i, all) => all.findIndex((x) => x.url === d.url) === i).sort((a, b) => a.url.localeCompare(b.url))
    .map((d) => ({ doc: d, role: 'support_document' }))
}

// ── The rules ────────────────────────────────────────────────────────────────

const GENERIC = new Set(['THE', 'OF', 'AND', 'AT', 'FOR', 'LLC', 'INC', 'CO', 'CORP', 'CORPORATION', 'COMPANY', 'LP', 'LTD', 'REFINERY', 'REFINING',
  'MARKETING', 'PRODUCTS', 'NORTH', 'AMERICA', 'USA', 'US', 'WA', 'WASHINGTON'])
const FILLER = new Set(['PROJECT', 'FACILITY', 'SITE', 'AREA', 'PHASE', 'UPGRADE', 'NEW', 'RD', 'ROAD', 'AVE', 'AVENUE', 'ST', 'STREET'])
const tokens = (s) => String(s || '').toUpperCase().replace(/\([^)]*\)/g, ' ').replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean)

/**
 * A permit name's project words: the name without the company / site words (the facility's name, applicant words and place
 * words) and legal / generic words. Kept only when ≥ 3 words and at least one is not filler ("project", "area", ...). Else null.
 */
export function projectPhrase(permitName, facility) {
  const drop = new Set([...GENERIC, ...tokens(facility.name), ...(facility.sepa?.applicant_words || []).flatMap(tokens),
    ...(facility.sepa?.place_words || []).flatMap(tokens), ...(facility.sepa?.searches || []).flatMap((s) => tokens(s.text))])
  const t = tokens(permitName)
  // Strip the company / site words only from the start of the name ("BP CHERRY POINT REFINERY / ADVANCE MITIGATION PROJECT 5").
  let i = 0
  while (i < t.length && drop.has(t[i])) i++
  const rest = t.slice(i)
  // A project needs words of its own: not only company / site words, filler or numbers ("WEST COAST PRODUCTS LLC" is a name).
  if (rest.length < 3 || rest.every((w) => FILLER.has(w) || drop.has(w) || /^\d+$/.test(w))) return null
  return rest.join(' ')
}

const containsPhrase = (text, phrase) => ` ${tokens(text).join(' ')} `.includes(` ${phrase} `)

/**
 * Per permit, which SEPA records cover it (with evidence), what its own document says, or none found.
 *   permit   { epa_system, permit_key, name }
 *   issuer   SEPA-Register lead-agency name of the permit's issuer, or null
 *   records  [{ rec (parseSepaRecord fields), accepted (matched to the facility), record_id }] — every record the facility's
 *            searches and the permit-number search found
 *   docs     [{ doc, role, text (documentSepaText payload), record_id }] — the permit's documents read for SEPA (may be empty)
 * Returns { reviews: [{ sepa, record_id, status, method, evidence }], statements: [...], candidates: [...] }.
 */
export function matchPermitSepa({ permit, facility, issuer, records, docs = [] }) {
  const reviews = new Map()
  const add = (r, method, evidence) => {
    const k = String(r.rec.sepa)
    if (!reviews.has(k)) reviews.set(k, { sepa: k, record_id: r.record_id, methods: [], evidence: [] })
    const x = reviews.get(k)
    if (!x.methods.includes(method)) x.methods.push(method)
    x.evidence.push({ method, ...evidence })
  }
  const lead = (r) => String(r.rec.lead || '').toLowerCase()
  for (const r of records) {
    const ids = recordIds(r.rec)
    // names_permit
    const named = ids.find((x) => x.kind === 'permit' && x.id === String(permit.permit_key).toUpperCase())
    if (named) add(r, 'names_permit', { says: `The SEPA record’s ${named.where} names ${named.id}`, quote: quoteOf(sourceText(r.rec, named), 300) })
    // doc_cites_review
    if (issuer && lead(r) === issuer.toLowerCase()) {
      cite: for (const doc of docs.filter((d) => d.text?.passages?.length)) {
        for (const x of ids.filter((y) => ['sepa', 'file', 'order'].includes(y.kind))) {
          const re = idPattern(x)
          const p = doc.text.passages.find((pp) => re.test(pp.text))
          if (p) { add(r, 'doc_cites_review', { says: `${docWords(doc.role)} names ${x.id}, which the SEPA record also carries (${x.where})`, quote: quoteOf(around(p.text, re), 420),
            doc_url: doc.doc.url, doc_title: doc.doc.title, page: p.page, doc_record_id: doc.record_id }); break cite }
        }
      }
    }
    // approval_in_permit
    const doc = docs.find((d) => d.text?.approvals)
    if (permit.epa_system === 'ICIS-Air' && doc && issuer && lead(r) === issuer.toLowerCase()) {
      for (const x of ids.filter((y) => y.kind === 'approval')) {
        const hit = doc.text.approvals.find((a) => a.id === x.id)
        if (hit) { add(r, 'approval_in_permit', { says: `The SEPA record names ${x.id} (${x.where}); the Air Operating Permit lists ${x.id} as part of this permit (p. ${hit.page})`,
          doc_url: doc.doc.url, doc_title: doc.doc.title, page: hit.page, doc_record_id: doc.record_id }); break }
      }
    }
    // same_project (records already matched to the facility only). The proposal name is what the review is about; the
    // description is used only when the record has no proposal name (older records), since a later addendum's description
    // often names the earlier project it relies on.
    if (r.accepted) {
      const phrase = projectPhrase(permit.name, facility)
      const field = r.rec.proposalName ? 'proposal name' : 'description'
      const text = r.rec.proposalName || r.rec.description
      if (phrase && containsPhrase(text, phrase)) {
        add(r, 'same_project', { says: `The permit is named for the project “${phrase.toLowerCase()}”; the SEPA record’s ${field} names the same project`,
          quote: quoteOf(text, 300) })
      }
    }
  }
  // register_related: one hop, through the Register's own "Related" field, from a record linked by an explicit identifier
  // (names_permit, doc_cites_review, approval_in_permit; not from a same-project match).
  const linked = new Set([...reviews.values()].filter((x) => x.methods.some((mm) => mm !== 'same_project')).map((x) => x.sepa))
  for (const r of records.filter((x) => x.accepted && !linked.has(String(x.rec.sepa)))) {
    const rel = String(r.rec.related || '')
    const via = [...linked].find((n) => rel.includes(n) || String(records.find((y) => String(y.rec.sepa) === n)?.rec.related || '').includes(String(r.rec.sepa)))
    if (via) add(r, 'register_related', { says: `The SEPA Register lists SEPA ${r.rec.sepa} and SEPA ${via} as related records` })
  }
  // Statements: the SEPA section of the permit's fact sheet / support document, verbatim.
  const statements = []
  for (const doc of docs.filter((d) => d.text && d.role !== 'air_operating_permit')) {
    for (const p of doc.text.passages.filter((x) => x.section)) {
      statements.push({ kind: classifyStatement(p.text), heading: p.heading, quote: quoteOf(p.text, 520), page: p.page,
        doc_url: doc.doc.url, doc_title: doc.doc.title, doc_role: doc.role, doc_record_id: doc.record_id })
    }
  }
  // Candidates (kept, not shown): led by the permit's issuer and matched to the facility, but nothing ties them to this permit.
  const candidates = issuer ? records.filter((r) => r.accepted && !reviews.has(String(r.rec.sepa)) && lead(r) === issuer.toLowerCase())
    .map((r) => ({ sepa: String(r.rec.sepa), record_id: r.record_id })) : []
  return { reviews: [...reviews.values()], statements, candidates }
}

const docWords = (role) => (role === 'fact_sheet' ? 'The permit’s fact sheet' : role === 'support_document' ? 'The permit’s support document (fact sheet)' : 'The permit document')
function sourceText(rec, id) {
  if (id.where === 'description') return around(rec.description, idPattern(id))
  if (id.where === 'proposal name') return rec.proposalName
  if (id.where === 'document name') return (rec.documents || []).find((d) => idPattern(id).test(d.name))?.name ?? ''
  return rec.fileNumber
}
/** ~300 characters of text around the first match, cut at word edges. */
function around(text, re, span = 300) {
  const t = squash(text)
  const m = re.exec(t)
  if (!m) return t.slice(0, span)
  const from = Math.max(0, m.index - span / 2), to = Math.min(t.length, m.index + span / 2)
  let cut = t.slice(from, to)
  if (from > 0) cut = cut.replace(/^\S*\s/, '')   // whole words only
  if (to < t.length) cut = cut.replace(/\s\S*$/, '')
  return `${from > 0 ? '… ' : ''}${cut.trim()}${to < t.length ? ' …' : ''}`
}

/** One permit's summary for the terminal card: 'linked' | 'exempt' | 'stated' | 'none'. */
export function sepaSummary({ reviews, statements }) {
  if (reviews.length) return { status: 'linked', reviews: reviews.length }
  if (statements.some((s) => s.kind === 'exempt')) return { status: 'exempt' }
  if (statements.some((s) => s.kind === 'relies' || s.kind === 'determination')) return { status: 'stated' }
  return { status: 'none' }
}

/** Does a permit get a SEPA answer? RCRAInfo only when it has an Ecology permit document (it is then a permit, not a handler id). */
export const sepaApplies = (p, docs) => SEPA_SYSTEMS.includes(p.epa_system) && /\d/.test(p.permit_key || '')
  && (p.epa_system !== 'RCRAInfo' || docs.some((d) => d.source === 'wa-ecology-industrial'))
