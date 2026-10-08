/**
 * Metro Vancouver air quality permits (GVA numbers) for BC terminal facilities. DEV 2026-10-07; sources docs/PERMITS_SOURCES_BC.md
 * (Metro Vancouver section). Rules: src/ships/CLAUDE.md.
 *
 *   evidence        one cached permit PDF (or application page) per URL: { url, retrieved_at, bytes, sha256, text } (source
 *                   'metro-vancouver-aq-permits', kind mv_aq_document, key = the URL)
 *   claim           permits (system 'MV-AQ', statute 'MV AQ', key = the GVA number); documents (the PDF / page link)
 *   interpretation  the hand-checked bc.mv entries in lib/ships/data/salish-facilities.json (holder + address checked against the
 *                   PDF text, with why); facility_permits; permit_terminal_coverage where the permit's own text names the dock
 *
 * Only URLs known from a public web search or a public application page are fetched; the permit library's listing is
 * access-controlled and never enumerated.
 */
import { createHash } from 'node:crypto'
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'

export const MV_PROGRAM = 'https://metrovancouver.org/services/environmental-regulation-enforcement/air-quality-regulatory-program'
export const MV_SOURCE = {
  id: 'metro-vancouver-aq-permits',
  name: 'Metro Vancouver air quality permits (GVRD Air Quality Management Bylaw)',
  publisher: 'Metro Vancouver',
  homepage_url: `${MV_PROGRAM}`,
  license: 'Public agency record (Metro Vancouver): cleared for EarthAtlas use by Josh 2026-10-06 (public agency records are treated as cleared; terms page not read). Credit and link.',
  license_url: null,
  commercial_use: false,
  attribution_text: 'Metro Vancouver',
  attribution_url: `${MV_PROGRAM}`,
  notes: 'Permit PDFs at …/AirQualityPermits/<file> and application pages at …/permit-applications/permit/GVA####, each found by a '
    + 'public web search or the public applications list; the permit library listing (401) is never enumerated. Text extracted with '
    + 'pdftotext -layout at fetch time and stored with the file hash.',
}

/** Cache file stem for one URL (stable across encodings of the same URL). */
export const mvCacheName = (url) => `mv-${createHash('sha1').update(decodeURI(String(url))).digest('hex').slice(0, 16)}`

/**
 * Every GVA permit number in a text, normalized to GVA + 4 digits, in order of first appearance. The permit PDFs are scans read by
 * OCR, which writes digits as look-alike letters ("GVAOO81" = GVA0081, "GVA11G7" = GVA1167): O/o → 0, I/l → 1, G → 6, only
 * inside the four characters after "GVA", and only when at least one of them is a digit.
 */
export function gvaNumbers(text) {
  const out = []
  const fix = { O: '0', o: '0', I: '1', l: '1', G: '6' }
  // GVA = a permit, GVU = an approval (a shorter-term authorization; e.g. GVU1296).
  for (const m of String(text || '').matchAll(/\bGV([AU])\s?-?([0-9OoIlG]{4})(?![0-9A-Za-z])/g)) {
    if (!/\d/.test(m[2])) continue
    const k = `GV${m[1]}${m[2].replace(/[OoIlG]/g, (ch) => fix[ch])}`
    if (!out.includes(k)) out.push(k)
  }
  return out
}

/** The readable part of a Metro Vancouver permit-application page (name, number, purpose, address, status), as one line. */
export function mvPageText(html) {
  // The page carries its rich text HTML-escaped inside the markup: strip tags, unescape &lt; &gt; &quot;, strip again.
  const s = oneLine(String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#160;|&nbsp;/g, ' ').replace(/&#58;/g, ':').replace(/&#39;|&rsquo;/g, '’').replace(/\u200b/g, ''))
  // The application's own block: name, number, "The purpose of this application …", address, status; it starts after the page's
  // no-JavaScript notice and ends at "Public Notification". A page with no application under review has no such block.
  const p = s.indexOf('The purpose of this application')
  if (p < 0) return ''
  const a = s.lastIndexOf('try again.', p)
  const b = s.indexOf('Public Notification', p)
  return s.slice(a >= 0 ? a + 10 : Math.max(0, p - 300), b > p ? b : p + 3000).trim()
}

/** A permit PDF's public URL from its file name (as the index or the site search shows it). */
export const mvFileUrl = (file) => `${MV_PROGRAM}/AirQualityPermits/${encodeURIComponent(file).replace(/%2C/g, ',').replace(/%28/g, '(').replace(/%29/g, ')')}`

/**
 * The "Current Permits and Approvals" page → its table rows: { file, url, title, date, holder, gva }. Columns as the page gives
 * them: link, URL, title, issue date (M/D/YYYY h:mm), holder. gva = the four digits the file name starts with.
 */
export function parseMvIndex(html) {
  const cell = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim()
  const out = []
  for (const m of String(html || '').matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const tds = [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((x) => x[1])
    const href = /href="([^"]*AirQualityPermits\/[^"]+)"/.exec(tds[0] || '')?.[1]
    if (!href || tds.length < 5) continue
    const file = decodeURI(href).split('AirQualityPermits/')[1]
    const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(cell(tds[3]))
    out.push({ file, url: mvFileUrl(file), title: cell(tds[2]), date: d ? `${d[3]}-${d[1].padStart(2, '0')}-${d[2].padStart(2, '0')}` : null,
      holder: cell(tds[4]) || null, gva: /^(\d{4})/.test(file) ? `GVA${file.slice(0, 4)}` : null })
  }
  return out
}

/** Collapse a PDF text excerpt to one line (for quotes and checks). */
export const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim()

/** Is `says` (a quote from the data file) in the document text, ignoring line breaks and runs of spaces? */
export const quoteIn = (text, says) => oneLine(text).toLowerCase().includes(oneLine(says).toLowerCase())

/** A bc.mv block of a BC facility entry: what it must carry. Returns error strings. */
export function validateMvBlock(f) {
  const mv = f.bc?.mv
  if (!mv) return [`${f.id}: bc.mv missing`]
  const errs = []
  if (!['in', 'outside'].includes(mv.jurisdiction)) errs.push(`${f.id}: bc.mv.jurisdiction`)
  if (mv.jurisdiction === 'outside' && !mv.why_outside) errs.push(`${f.id}: bc.mv.why_outside`)
  if (mv.jurisdiction === 'in' && !(mv.permits || []).length && !mv.none) errs.push(`${f.id}: bc.mv.permits (or bc.mv.none)`)
  for (const x of mv.left_out || []) if (!/^GV[AU]\d{4}$/.test(x.gva || '') || !x.why) errs.push(`${f.id}: mv left_out ${x.gva} needs gva + why`)
  for (const p of mv.permits || []) {
    if (!/^GV[AU]\d{4}$/.test(p.gva || '') || !p.holder || !p.address || !p.why || !p.status) errs.push(`${f.id}: mv ${p.gva} needs gva, holder, address, status, why`)
    for (const x of p.extra_docs || []) if (!x.url || !x.title) errs.push(`${f.id}: mv ${p.gva} extra document needs url + title`)
    if (!p.doc_url && !p.application_url) errs.push(`${f.id}: mv ${p.gva} needs doc_url or application_url`)
    for (const c of p.covers || []) if (!c.terminal || !c.where || !c.says) errs.push(`${f.id}: mv ${p.gva} covers entry incomplete`)
  }
  return errs
}

async function storeDoc(c, S, d, runId) {
  const ent = await findOrCreateEntity(c, S, { sourceId: MV_SOURCE.id, kind: 'mv_aq_document', anchor: decodeURI(d.url) })
  const r = await upsertRecord(c, S, { sourceId: MV_SOURCE.id, entityId: ent.id,
    payload: /html/i.test(d.content_type || '')
      ? { url: d.url, bytes: d.bytes, sha256: d.sha256, content_type: d.content_type, text: mvPageText(d.text), html: d.text }
      : { url: d.url, bytes: d.bytes, sha256: d.sha256, content_type: d.content_type, text: d.text },
    datasetVersion: d.retrieved_at?.slice(0, 10) ?? null, retrievalUrl: d.url, runId })
  return { id: Number(r.id), created: r.created }
}

/**
 * docs = Map(url → cached document). Imports the bc.mv permits of the BC entries of data.facilities. A permit whose GVA number
 * is not in its own document, or a dock quote not found in the text, is reported and not stored. Idempotent.
 */
export async function importMvPermits(c, S, data, docs, { runId = null } = {}) {
  const stats = { permits: 0, documents: 0, coverage: 0, recordsCreated: 0, problems: [] }
  await upsertSource(c, S, MV_SOURCE)
  for (const f of (data.facilities || []).filter((x) => x.country === 'CA' && x.bc?.mv?.jurisdiction === 'in')) {
    const { rows: [fac] } = await c.query(`SELECT id, entry_source_record_id FROM ${S}.facilities WHERE key = $1`, [f.id])
    if (!fac) { stats.problems.push(`${f.id}: facility not imported`); continue }
    for (const p of f.bc.mv.permits || []) {
      const urls = [p.doc_url, p.application_url, p.notice_url, ...(p.extra_docs || []).map((x) => x.url)].filter(Boolean)
      const got = urls.map((u) => [u, docs.get(u)])
      const missing = got.filter(([, d]) => !d).map(([u]) => u)
      if (missing.length) { stats.problems.push(`${f.id}: ${p.gva}: not cached: ${missing.join(', ')}`); continue }
      const main = docs.get(p.doc_url || p.application_url)
      const mainText = /html/i.test(main.content_type || '') ? mvPageText(main.text) : main.text
      // The number must be in the document's own text, or its published file name must start with it (Metro Vancouver names permit
      // files "<4 digits> - <holder> - …"; OCR of a scan can miss the number on the face page).
      const fileName = decodeURI(p.doc_url || p.application_url).split('/').pop()
      if (!gvaNumbers(`${mainText} ${fileName}`).includes(p.gva) && !fileName.startsWith(p.gva.slice(3))) { stats.problems.push(`${f.id}: ${p.gva} is not named in ${p.doc_url || p.application_url}`); continue }
      const recs = new Map()
      for (const [u, d] of got) { const r = await storeDoc(c, S, d, runId); recs.set(u, r.id); stats.recordsCreated += r.created ? 1 : 0 }
      const mainRec = recs.get(p.doc_url || p.application_url)
      const { rows: [pr] } = await c.query(
        `INSERT INTO ${S}.permits (epa_system, permit_key, statute, name, universe, areas, expires, program_status, frs_ids, source_record_id, detail)
         VALUES ('MV-AQ',$1,'MV AQ',$2,$3,NULL,$4,$5,'{}',$6,$7)
         ON CONFLICT (epa_system, permit_key) DO UPDATE SET statute = EXCLUDED.statute, name = EXCLUDED.name, universe = EXCLUDED.universe,
           expires = EXCLUDED.expires, program_status = EXCLUDED.program_status, source_record_id = EXCLUDED.source_record_id,
           detail = ${S}.permits.detail || EXCLUDED.detail, last_seen_at = now()
         RETURNING id`,
        [p.gva, p.holder, p.kind || 'Air quality permit', p.expires ?? null, p.status, mainRec,
          { mv: { holder: p.holder, address: p.address, issued: p.issued ?? null, amended: p.amended ?? null, effective: p.effective ?? null,
            authorizes: p.authorizes ?? null, doc_url: p.doc_url ?? null, application_url: p.application_url ?? null, application: p.application ?? null,
            note: p.note ?? null, why: p.why } }])
      await c.query(
        `INSERT INTO ${S}.facility_permits (facility_id, permit_id, method, source_record_id) VALUES ($1,$2,'mv_curated',$3)
         ON CONFLICT (facility_id, permit_id) DO UPDATE SET source_record_id = EXCLUDED.source_record_id, last_seen_at = now()`,
        [fac.id, pr.id, mainRec])
      stats.permits++
      // The documents: the permit PDF, the application page and its public notice.
      const docList = [[p.doc_url, p.doc_title, p.doc_type || 'Air quality permit'], [p.application_url, `Application ${p.application?.gva ?? p.gva} (Metro Vancouver)`, 'Permit application'],
        [p.notice_url, p.notice_title || 'Environmental Protection Notice', 'Permit application notice'], ...(p.extra_docs || []).map((x) => [x.url, x.title, x.type || 'Report'])]
      for (const [u, title, type] of docList) {
        if (!u) continue
        const { rows: [doc] } = await c.query(
          `INSERT INTO ${S}.documents (source_id, url, title, doc_type, description, doc_date, source_record_id, detail)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, doc_type = EXCLUDED.doc_type, description = EXCLUDED.description,
             doc_date = EXCLUDED.doc_date, source_record_id = EXCLUDED.source_record_id, status = 'listed', detail = EXCLUDED.detail, last_seen_at = now()
           RETURNING id`,
          [MV_SOURCE.id, u, title || decodeURI(u.split('/').pop()), type, null, u === p.doc_url ? (p.amended || p.issued || null) : null, recs.get(u), { gva: p.gva }])
        await c.query(`INSERT INTO ${S}.document_links (document_id, permit_id, method, detail) VALUES ($1,$2,'mv_permit_document',$3)
                       ON CONFLICT (document_id, permit_id) WHERE permit_id IS NOT NULL DO UPDATE SET detail = EXCLUDED.detail, last_seen_at = now()`,
          [doc.id, pr.id, { gva: p.gva }])
        stats.documents++
      }
      // Metro Vancouver replaces permit files in place: a document of this permit that the entry no longer names (its file is gone or
      // was superseded) is kept as evidence but marked unlisted, so it is no longer shown or linked.
      const { rowCount } = await c.query(
        `UPDATE ${S}.documents d SET status = 'unlisted', last_seen_at = now()
          WHERE d.source_id = $1 AND d.status = 'listed' AND NOT (d.url = ANY($3::text[]))
            AND d.id IN (SELECT document_id FROM ${S}.document_links WHERE permit_id = $2)`,
        [MV_SOURCE.id, pr.id, docList.map(([u]) => u).filter(Boolean)])
      stats.unlisted = (stats.unlisted || 0) + rowCount
      // The permit's own words about the dock (quote checked against the stored text).
      for (const cv of p.covers || []) {
        if (!quoteIn(mainText, cv.says)) { stats.problems.push(`${f.id}: ${p.gva}: quote not found in the document: "${cv.says}"`); continue }
        const { rows: [t] } = await c.query(`SELECT id FROM ${S}.terminals WHERE key = $1`, [cv.terminal])
        if (!t) { stats.problems.push(`${f.id}: terminal ${cv.terminal} not in the database`); continue }
        await c.query(
          `INSERT INTO ${S}.permit_terminal_coverage (permit_id, terminal_id, entry_source_record_id, detail) VALUES ($1,$2,$3,$4)
           ON CONFLICT (permit_id, terminal_id) DO UPDATE SET entry_source_record_id = EXCLUDED.entry_source_record_id, detail = EXCLUDED.detail,
             status = 'active', last_seen_at = now()`,
          [pr.id, t.id, fac.entry_source_record_id, { doc_url: p.doc_url || p.application_url, doc_title: p.doc_title ?? `Metro Vancouver air quality permit ${p.gva}`, where: cv.where, says: cv.says }])
        stats.coverage++
      }
    }
  }
  return stats
}
