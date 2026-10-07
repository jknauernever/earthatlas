/**
 * County shoreline permits at a terminal's dock: Whatcom County pilot, DEV 2026-10-07 (two terminals). Sources and the county
 * catalogue: docs/PERMITS_SOURCES.md (Counties). Rules: src/ships/CLAUDE.md.
 *
 *   evidence        the SEPA Register record(s) whose lead-agency file numbers name the shoreline permit (source
 *                   'wa-ecology-sepa-register', kind sepa_record, the same records the facility import stores), and the county's
 *                   notice of application as filed in the Register (source 'whatcom-county-pds', kind county_notice, key = URL:
 *                   { url, bytes, sha256, text })
 *   claim           the notice's own words (file number, "Required Permits: …", dates) and the SEPA records' fields
 *   interpretation  terminal_land_records kind county_shoreline_permit, from the hand-checked county.shoreline entries of
 *                   lib/ships/data/wa-leases-sites.json (why the permit is this dock's)
 *
 * Whatcom County's own permit portal is not read (it refused automated access on 2026-10-07); the permit decision is shown only
 * when a public document states it.
 */
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'
import { SEPA_SOURCE, parseSepaRecord, sepaRecordUrl } from './facilities.js'

export const WHATCOM_PDS_SOURCE = {
  id: 'whatcom-county-pds',
  name: 'Whatcom County Planning & Development Services (shoreline permit notices, as filed in the WA SEPA Register)',
  publisher: 'Whatcom County Planning & Development Services',
  homepage_url: 'https://www.whatcomcounty.us/358/Planning-Development-Services',
  license: 'Public agency record (Whatcom County): cleared for EarthAtlas use by Josh 2026-10-06 (public agency records are treated as cleared; terms page not read). Credit and link.',
  license_url: null,
  commercial_use: false,
  attribution_text: 'Whatcom County PDS',
  attribution_url: 'https://www.whatcomcounty.us/358/Planning-Development-Services',
  notes: 'Notices of application read from the copies the county filed in Ecology\'s SEPA Register (DocumentOpenHandler links); text extracted '
    + 'with pdftotext -layout at fetch time and stored with the file hash. The county\'s Civic Access portal is not read.',
}

const one = (s) => String(s || '').replace(/\s+/g, ' ').trim()
/** Is `says` in the text, ignoring line breaks and runs of spaces? */
export const quoteIn = (text, says) => one(text).toLowerCase().includes(one(says).toLowerCase())
/** Does a SEPA lead-agency file-number field name this county file (e.g. 'SEP2020-00007, SHR2020-00002')? */
export const fileNamed = (fileNumber, file) => String(fileNumber || '').toUpperCase().split(/[;,&\s]+/).includes(String(file).toUpperCase())

/** One county.shoreline entry: what it must carry. */
export function validateShorelineEntry(key, s) {
  const errs = []
  if (!/^[A-Z]{2,5}\d{4}-\d{5}$/.test(s.file || '')) errs.push(`${key}: shoreline file ${s.file}`)
  for (const k of ['type', 'project', 'notice_doc', 'says', 'why']) if (!s[k]) errs.push(`${key}: ${s.file} needs ${k}`)
  if (!(s.sepa || []).length) errs.push(`${key}: ${s.file} needs sepa record numbers`)
  return errs
}

/**
 * Resolve one entry against cached evidence → { ok, sepa: [parsed], notice, problems }. sepaPages: Map(sepaNumber → { url, retrieved_at,
 * html }); notices: Map(url → { url, bytes, sha256, text, retrieved_at }).
 */
export function resolveShoreline(key, s, sepaPages, notices) {
  const problems = []
  const sepa = []
  for (const n of s.sepa) {
    const pg = sepaPages.get(n)
    if (!pg) { problems.push(`${key}: ${s.file}: SEPA ${n} not cached`); continue }
    const r = parseSepaRecord(pg.html)
    if (r.error) { problems.push(`${key}: ${s.file}: SEPA ${n}: ${r.error}`); continue }
    if (!fileNamed(r.fileNumber, s.file)) { problems.push(`${key}: SEPA ${n} file numbers "${r.fileNumber}" do not name ${s.file}`); continue }
    sepa.push({ r, page: pg })
  }
  const notice = notices.get(s.notice_doc)
  if (!notice) problems.push(`${key}: ${s.file}: notice not cached: ${s.notice_doc}`)
  else {
    if (!one(notice.text).includes(s.file)) problems.push(`${key}: ${s.file} is not named in the notice`)
    if (!quoteIn(notice.text, s.says)) problems.push(`${key}: ${s.file}: quote not found in the notice: "${s.says}"`)
  }
  return { ok: !problems.length && sepa.length === s.sepa.length, sepa, notice, problems }
}

async function store(c, S, sourceId, kind, key, payload, url, runId, version) {
  const ent = await findOrCreateEntity(c, S, { sourceId, kind, anchor: key })
  const r = await upsertRecord(c, S, { sourceId, entityId: ent.id, payload, datasetVersion: version, retrievalUrl: url, runId })
  return { id: Number(r.id), created: r.created }
}

/** Imports the county.shoreline entries of data (wa-leases-sites.json). Nothing is stored for an entry that fails a check. Idempotent. */
export async function importCountyShoreline(c, S, data, sepaPages, notices, { runId = null, only = null } = {}) {
  const stats = { permits: 0, recordsCreated: 0, withdrawn: 0, problems: [] }
  await upsertSource(c, S, WHATCOM_PDS_SOURCE)
  await upsertSource(c, S, SEPA_SOURCE)
  for (const [key, entry] of Object.entries(data.terminals)) {
    if (only && key !== only) continue
    const list = entry.county?.shoreline || []
    const { rows: [t] } = await c.query(`SELECT id FROM ${S}.terminals WHERE key = $1`, [key])
    if (!t) { if (list.length) stats.problems.push(`${key}: terminal not in the database`); continue }
    const keep = []
    for (const s of list) {
      const r = resolveShoreline(key, s, sepaPages, notices)
      stats.problems.push(...r.problems)
      if (!r.ok) continue
      const nrec = await store(c, S, WHATCOM_PDS_SOURCE.id, 'county_notice', s.notice_doc,
        { url: r.notice.url, bytes: r.notice.bytes, sha256: r.notice.sha256, text: r.notice.text }, s.notice_doc, runId, r.notice.retrieved_at?.slice(0, 10) ?? null)
      stats.recordsCreated += nrec.created ? 1 : 0
      const sepa = []
      for (const x of r.sepa) {
        const rec = await store(c, S, SEPA_SOURCE.id, 'sepa_record', x.r.sepa, x.r, x.page.url, runId, x.page.retrieved_at?.slice(0, 10) ?? null)
        stats.recordsCreated += rec.created ? 1 : 0
        sepa.push({ sepa: x.r.sepa, type: x.r.type, issued: x.r.issued, lead: x.r.lead, fileNumber: x.r.fileNumber, url: sepaRecordUrl(x.r.sepa), record_id: rec.id })
      }
      sepa.sort((a, b) => String(a.issued).localeCompare(String(b.issued)))
      await c.query(
        `INSERT INTO ${S}.terminal_land_records (terminal_id, kind, record_key, source_record_id, detail) VALUES ($1,'county_shoreline_permit',$2,$3,$4)
         ON CONFLICT (terminal_id, kind, record_key) DO UPDATE SET source_record_id = EXCLUDED.source_record_id, detail = EXCLUDED.detail,
           status = 'accepted', last_seen_at = now()`,
        [t.id, s.file, nrec.id, { file: s.file, type: s.type, project: s.project, county: entry.county.county, submitted: s.submitted ?? null,
          noticeDate: s.notice_date ?? null, decision: s.decision ?? null, noticeUrl: s.notice_doc, says: s.says, sepa, why: s.why,
          source_ids: [WHATCOM_PDS_SOURCE.id, SEPA_SOURCE.id] }])
      keep.push(s.file)
      stats.permits++
    }
    const { rowCount } = await c.query(
      `UPDATE ${S}.terminal_land_records SET status = 'withdrawn', last_seen_at = now()
        WHERE terminal_id = $1 AND kind = 'county_shoreline_permit' AND status = 'accepted' AND NOT (record_key = ANY($2))`, [t.id, keep])
    stats.withdrawn += rowCount
  }
  return stats
}
