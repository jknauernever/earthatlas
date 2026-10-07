/**
 * SEPA review per permit — database side (migration 031; rules in lib/ships/permitSepa.js and docs/PERMITS_SOURCES.md §6).
 *   planPermitSepa   what to fetch: each WA facility's permits that get a SEPA answer, the one document per permit read for
 *                    SEPA, and the permit numbers searched in the SEPA Register (read-only queries)
 *   importPermitSepa evidence (document_sepa_text records, permit-search hits as sepa_record) + permit_sepa rows; idempotent;
 *                    rows a run no longer produces are set 'retired', never deleted
 *   permitSepaFor    the read side: per permit, accepted reviews (with the SEPA record's fields), statements, none-found
 */
import { findOrCreateEntity, upsertRecord } from './store.js'
import { documentsFor } from './permitDocuments.js'
import { parseSepaRecord, sepaRecordUrl, sepaSearchUrl, SEPA_SOURCE } from './facilities.js'
import { SEPA_SYSTEMS, SEARCHED_SYSTEMS, ISSUER_LEAD, sepaApplies, sepaDocsFor, documentSepaText, matchPermitSepa, sepaSummary } from './permitSepa.js'

/** The permits a facility holds (by its accepted EPA FRS ids, or listed as holder), as the terminal card lists them. */
async function facilityPermits(q, S, facilityKey) {
  const [f] = await q(`SELECT id, key FROM ${S}.facilities WHERE key = $1`, [facilityKey])
  if (!f) return null
  const frs = (await q(`SELECT entity_key FROM ${S}.facility_links WHERE facility_id = $1 AND role IN ('epa_frs_primary', 'epa_frs_related') AND status = 'accepted'`, [f.id]))
    .map((r) => r.entity_key)
  const permits = await q(`SELECT id, epa_system, permit_key, name FROM ${S}.permits
                            WHERE (frs_ids && $1::text[] OR id IN (SELECT permit_id FROM ${S}.facility_permits WHERE facility_id = $2))
                              AND epa_system = ANY($3) ORDER BY epa_system, permit_key`, [frs, f.id, SEPA_SYSTEMS])
  const docs = await documentsFor(q, S, permits.map((p) => Number(p.id)), [])
  return { id: Number(f.id), permits: permits.map((p) => ({ ...p, id: Number(p.id), documents: docs.byPermit.get(Number(p.id)) || [] }))
    .filter((p) => sepaApplies(p, p.documents)) }
}

/** [{ facility, permit, docs: [{ doc, role }], search: permit number | null }] for the WA facilities in `data`. */
export async function planPermitSepa(q, S, data) {
  const plan = []
  for (const f of data.facilities.filter((x) => x.country !== 'CA')) {
    const fp = await facilityPermits(q, S, f.id)
    if (!fp) continue
    for (const p of fp.permits) {
      plan.push({ facility: f.id, permit: p, docs: sepaDocsFor(p, p.documents), search: SEARCHED_SYSTEMS.includes(p.epa_system) ? p.permit_key : null })
    }
  }
  return plan
}

const issuerOf = (p) => {
  const pref = p.epa_system === 'ICIS-Air' ? ['nwcaa-aop', 'pscaa-title-v'] : ['wa-ecology-paris', 'wa-ecology-industrial']
  const src = pref.find((s) => p.documents.some((d) => d.source === s))
  return src ? ISSUER_LEAD[src] : null
}

async function storeRecord(c, S, { sourceId, kind, key, payload, url, runId, version }) {
  const ent = await findOrCreateEntity(c, S, { sourceId, kind, anchor: key })
  const r = await upsertRecord(c, S, { sourceId, entityId: ent.id, payload, datasetVersion: version, retrievalUrl: url, runId })
  return { id: Number(r.id), created: r.created }
}

/**
 * sraw = { docs: Map(url → permitDoc() result), permitSearch: Map(permit number → { url, hits: [SEPA number] }),
 *          sepa: Map(SEPA number → { url, retrieved_at, html }) (record pages of the permit-search hits) }
 * Run after importFacilities + documents (needs the facilities, permits, documents and facility SEPA links).
 */
export async function importPermitSepa(c, S, data, sraw, { runId = null } = {}) {
  const q = async (text, params) => (await c.query(text, params)).rows
  const stats = { permits: 0, linked: 0, exempt: 0, stated: 0, none: 0, reviews: 0, candidates: 0, statements: 0, documentsRead: 0,
    recordsCreated: 0, retired: 0, problems: [] }
  for (const f of data.facilities.filter((x) => x.country !== 'CA')) {
    const fp = await facilityPermits(q, S, f.id)
    if (!fp) { stats.problems.push(`${f.id}: facility not imported`); continue }
    const facRecords = (await q(`SELECT l.status, l.source_record_id, sr.payload FROM ${S}.facility_links l
                                   JOIN ${S}.source_records sr ON sr.id = l.source_record_id
                                  WHERE l.facility_id = $1 AND l.role = 'sepa_review' AND l.status IN ('accepted', 'candidate')`, [fp.id]))
      .map((r) => ({ rec: r.payload, accepted: r.status === 'accepted', record_id: Number(r.source_record_id) }))
    const touched = []
    for (const p of fp.permits) {
      stats.permits++
      // The permit-number search of the SEPA Register: its hits are stored as SEPA records (evidence) and checked like the rest.
      const records = [...facRecords]
      const search = sraw.permitSearch.get(p.permit_key)
      if (SEARCHED_SYSTEMS.includes(p.epa_system) && !search) stats.problems.push(`${f.id} ${p.permit_key}: SEPA Register not searched for the permit number`)
      for (const n of search?.hits || []) {
        if (records.some((r) => String(r.rec.sepa) === n)) continue
        const page = sraw.sepa.get(n)
        if (!page) { stats.problems.push(`${p.permit_key}: SEPA ${n} record page not fetched`); continue }
        const rec = parseSepaRecord(page.html)
        if (rec.error) { stats.problems.push(`${p.permit_key}: SEPA ${n}: ${rec.error}`); continue }
        const sr = await storeRecord(c, S, { sourceId: SEPA_SOURCE.id, kind: 'sepa_record', key: rec.sepa, payload: rec, url: page.url, runId,
          version: page.retrieved_at?.slice(0, 10) ?? null })
        stats.recordsCreated += sr.created ? 1 : 0
        records.push({ rec, accepted: false, record_id: sr.id })
      }
      // The permit's document, read for SEPA.
      const picks = sepaDocsFor(p, p.documents)
      const docs = []
      for (const pick of picks) {
        const got = sraw.docs.get(pick.doc.url)
        if (!got?.pages) { stats.problems.push(`${f.id} ${p.permit_key}: ${pick.role} ${got ? 'is not a PDF' : 'not fetched'} (${pick.doc.url})`); continue }
        const text = documentSepaText(pick.doc, got, { air: p.epa_system === 'ICIS-Air' })
        const dr = await storeRecord(c, S, { sourceId: pick.doc.source, kind: 'document_sepa_text', key: pick.doc.url, payload: text, url: pick.doc.url, runId,
          version: got.retrieved_at?.slice(0, 10) ?? null })
        stats.recordsCreated += dr.created ? 1 : 0
        stats.documentsRead++
        docs.push({ ...pick, text, record_id: dr.id })
      }
      const issuer = issuerOf(p)
      const m = matchPermitSepa({ permit: p, facility: f, issuer, records, docs })
      const put = async (kind, key, status, method, sepaRecordId, docRecordId, detail) => {
        const { rows: [r] } = await c.query(
          `INSERT INTO ${S}.permit_sepa (permit_id, facility_id, kind, entity_key, status, method, sepa_record_id, doc_record_id, detail)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (permit_id, facility_id, kind, entity_key) DO UPDATE SET status = EXCLUDED.status, method = EXCLUDED.method,
             sepa_record_id = EXCLUDED.sepa_record_id, doc_record_id = EXCLUDED.doc_record_id, detail = EXCLUDED.detail, last_seen_at = now()
           RETURNING id`, [p.id, fp.id, kind, key, status, method, sepaRecordId, docRecordId, detail])
        touched.push(Number(r.id))
      }
      for (const r of m.reviews) {
        await put('review', r.sepa, 'accepted', r.methods.join('+'), r.record_id, r.evidence.find((e) => e.doc_record_id)?.doc_record_id ?? null, { evidence: r.evidence })
        stats.reviews++
      }
      for (const cnd of m.candidates) {
        await put('review', cnd.sepa, 'candidate', 'same_lead_agency', cnd.record_id, null, { why: `Led by ${issuer}, the agency that issues this permit; nothing in the record or the permit’s documents ties it to this permit` })
        stats.candidates++
      }
      for (const s of m.statements) {
        await put('statement', `${s.doc_url}#p${s.page}`, 'accepted', s.kind, null, s.doc_record_id, s)
        stats.statements++
      }
      const sum = sepaSummary(m)
      stats[sum.status]++
      if (sum.status === 'none' || sum.status === 'stated') {
        await put('none_found', '', 'accepted', 'searched', null, docs[0]?.record_id ?? null, { searched: {
          register: [...(f.sepa?.searches || []).map((s) => ({ what: `${s.field}: ${s.text}`, url: sepaSearchUrl(s.field, s.text) })),
            ...(search ? [{ what: `All text: ${p.permit_key}`, url: search.url }] : [])],
          county: f.sepa?.county ?? null, records: records.length,
          documents: docs.map((d) => ({ title: d.doc.title, url: d.doc.url, role: d.role, pages: d.text.pages })),
          no_document: docs.length ? null : picks.length ? 'the permit document could not be read' : 'no fact sheet or permit document is listed for this permit' } })
      }
    }
    // Rows this run did not produce (for this facility) are retired, never deleted.
    const { rowCount } = await c.query(`UPDATE ${S}.permit_sepa SET status = 'retired', last_seen_at = now()
                                         WHERE facility_id = $1 AND status <> 'retired' AND NOT (id = ANY($2::bigint[]))`, [fp.id, touched])
    stats.retired += rowCount
  }
  return stats
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Per permit id: { summary, reviews: [SEPA record fields + evidence], statements, none } from accepted rows. Reviews and
 * statements found under several facilities (a permit two facilities hold) are listed once.
 */
export async function permitSepaFor(q, S, permitIds) {
  const out = new Map()
  if (!permitIds.length) return out
  const rows = await q(`SELECT ps.permit_id, ps.kind, ps.entity_key, ps.method, ps.sepa_record_id, ps.doc_record_id, ps.detail, sr.payload
                          FROM ${S}.permit_sepa ps LEFT JOIN ${S}.source_records sr ON sr.id = ps.sepa_record_id
                         WHERE ps.permit_id = ANY($1::bigint[]) AND ps.status = 'accepted'`, [permitIds])
  for (const r of rows) {
    const k = Number(r.permit_id)
    if (!out.has(k)) out.set(k, { reviews: [], statements: [], none: null })
    const x = out.get(k)
    if (r.kind === 'review' && !x.reviews.some((y) => y.sepa === r.entity_key)) {
      const p = r.payload || {}
      x.reviews.push({ sepa: r.entity_key, type: p.type ?? null, issued: p.issued ?? null, lead: p.lead ?? null, fileNumber: p.fileNumber ?? null,
        proposalName: p.proposalName ?? null, description: p.description ?? null, documents: p.documents || [],   // applicant left out: often a person's name
        url: sepaRecordUrl(r.entity_key), record_id: Number(r.sepa_record_id), methods: r.method.split('+'), evidence: r.detail?.evidence || [] })
    } else if (r.kind === 'statement' && !x.statements.some((y) => y.key === r.entity_key)) {
      x.statements.push({ key: r.entity_key, kind: r.method, ...r.detail, doc_record_id: r.doc_record_id == null ? null : Number(r.doc_record_id) })
    } else if (r.kind === 'none_found' && !x.none) x.none = { ...r.detail?.searched, doc_record_id: r.doc_record_id == null ? null : Number(r.doc_record_id) }
  }
  for (const x of out.values()) {
    x.reviews.sort((a, b) => String(b.issued).localeCompare(String(a.issued)))
    x.summary = sepaSummary(x)
    if (x.summary.status !== 'none' && x.summary.status !== 'stated') x.none = null
  }
  return out
}
