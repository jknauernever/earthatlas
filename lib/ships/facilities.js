/**
 * Facilities (the plant a terminal serves) + their EPA permits / enforcement and WA SEPA reviews. Two-refinery pilot
 * (Josh 2026-10-06): docs/PERMITS_SOURCES.md, migration 022, data lib/ships/data/salish-facilities.json.
 *
 *   evidence        one ECHO Detailed Facility Report per FRS id (whole JSON, source 'epa-echo', kind echo_dfr);
 *                   one SEPA Register record per SEPA number (fields read from the record page, kind sepa_record);
 *                   the curated facility entry (kind facility_entry)
 *   claim           facilities; permits (ECHO's DFR "Permits" rows, values unchanged)
 *   interpretation  facility_links (FRS ids named in the data file; SEPA records by sepaMatch), terminal_facilities
 *
 * Contact names / phones / emails on SEPA record pages are not stored (not needed; personal data).
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'
import { documentsFor, PARIS_SOURCE, ECOLOGY_INDUSTRIAL_SOURCE, NWCAA_SOURCE, PSCAA_SOURCE } from './permitDocuments.js'
import { validateBcEntry, bcFacilityDetail, nrcedForPermit, BC_SOURCE_IDS, BC_EMA_SOURCE } from './bcPermits.js'
import { validateMvBlock, MV_SOURCE } from './metroVancouver.js'
import { cerFacilityDetail, CER_SOURCE, CER_ORDERS_SOURCE } from './cer.js'
import { terminalLand } from './dnrLeases.js'
import { airSearchesFor, AIR_SOURCE_IDS, AIR_SYSTEMS, AGENCIES as WA_AIR, agencyBySystem } from './waAirAgencies.js'
import { permitSepaFor } from './permitSepaDb.js'

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'salish-facilities.json')

export const ECHO_BASE = 'https://echodata.epa.gov/echo'
export const ECHO_DFR_PAGE = 'https://echo.epa.gov/detailed-facility-report?fid='
export const SEPA_BASE = 'https://apps.ecology.wa.gov/separ/Main/SEPA'

export const ECHO_SOURCE = {
  id: 'epa-echo',
  name: 'EPA ECHO Detailed Facility Report',
  publisher: 'US Environmental Protection Agency',
  homepage_url: 'https://echo.epa.gov/',
  license: 'US Government work (17 U.S.C. § 105)',
  license_url: null,
  commercial_use: true,
  attribution_text: 'US EPA ECHO',
  attribution_url: 'https://echo.epa.gov/',
  notes: 'dfr_rest_services.get_dfr JSON, one per FRS Registry ID; field meanings in docs/ECHO_DFR_DATA_DICTIONARY.md. '
    + 'Public agency record: cleared for EarthAtlas use by Josh 2026-10-06 (terms page not read).',
}
export const SEPA_SOURCE = {
  id: 'wa-ecology-sepa-register',
  name: 'Washington State SEPA Register',
  publisher: 'Washington State Department of Ecology',
  homepage_url: 'https://ecology.wa.gov/regulations-permits/sepa/environmental-review/sepa-register',
  license: 'Public agency record: cleared for EarthAtlas use by Josh 2026-10-06 (public agency records are treated as cleared; terms page not read). Credit and link.',
  license_url: null,
  commercial_use: false,
  attribution_text: 'WA Ecology SEPA Register',
  attribution_url: `${SEPA_BASE}/Search.aspx`,
  notes: 'Record.aspx?SEPANumber=<n> pages, fields read by lib/ships/facilities.js parseSepaRecord. Contacts not stored.',
}
export const FACILITIES_LIST_SOURCE = {
  id: 'earthatlas-facilities',
  name: 'EarthAtlas curated facility list (lib/ships/data/salish-facilities.json)',
  publisher: 'EarthAtlas',
  homepage_url: 'https://earthatlas.org/ships',
  license: 'EarthAtlas curation; each value cites its own source',
  license_url: null,
  commercial_use: false,
  attribution_text: 'EarthAtlas (curated from the cited sources)',
  attribution_url: 'https://earthatlas.org/ships',
  notes: 'Hand-reviewed: which EPA FRS ids are one site, and why; which terminal serves which facility.',
}

export async function ensureFacilitySources(c, S) {
  for (const s of [ECHO_SOURCE, SEPA_SOURCE, FACILITIES_LIST_SOURCE]) await upsertSource(c, S, s)
}

export async function loadFacilityData() { return JSON.parse(await readFile(DATA, 'utf8')) }

export function validateFacilityData(d) {
  const errs = []
  const ids = new Set()
  for (const f of d?.facilities || []) {
    if (!/^(wa|bc)-[a-z0-9-]+$/.test(f.id || '')) errs.push(`bad id ${f.id}`)
    if (ids.has(f.id)) errs.push(`duplicate id ${f.id}`)
    ids.add(f.id)
    if (!FACILITY_KINDS.includes(f.kind)) errs.push(`${f.id}: kind ${f.kind}`)
    // BC entries (country CA) have no EPA FRS id or SEPA rule: their own checks (lib/ships/bcPermits.js).
    if (f.country === 'CA') { errs.push(...validateBcEntry(f), ...validateMvBlock(f)); if (!(f.terminals || []).length) errs.push(`${f.id}: no terminals`); continue }
    if (!/^\d{12}$/.test(f.frs_primary || '')) errs.push(`${f.id}: frs_primary`)
    for (const r of f.frs_related || []) if (!/^\d{12}$/.test(r.id) || !r.why) errs.push(`${f.id}: related ${r.id}`)
    if (!(f.terminals || []).length) errs.push(`${f.id}: no terminals`)
    for (const t of terminalsOf(f)) {
      if (!['serves', 'owned_by'].includes(t.relation)) errs.push(`${f.id}: terminal ${t.key} relation ${t.relation}`)
      if (t.relation === 'owned_by' && (!t.source_url || !t.says)) errs.push(`${f.id}: terminal ${t.key} owned_by needs source_url + says`)
    }
    for (const cv of f.coverage || []) if (!cv.terminal || !cv.permit?.system || !cv.permit?.key || !cv.doc_url || !cv.where || !cv.says) errs.push(`${f.id}: coverage entry incomplete`)
    if (!f.sepa?.county || !(f.sepa?.applicant_words || []).length || !(f.sepa?.place_words || []).length) errs.push(`${f.id}: sepa rule`)
    if (f.air_agency != null && !AIR_AGENCIES[f.air_agency]) errs.push(`${f.id}: air_agency ${f.air_agency}`)
  }
  for (const n of d?.no_facility || []) {
    if (!/^wa-[a-z0-9-]+$/.test(n.terminal || '')) errs.push(`no_facility: bad terminal ${n.terminal}`)
    if (!n.says || !(n.searched || []).length) errs.push(`no_facility ${n.terminal}: says + searched needed`)
    if (n.air_agency != null && !AIR_AGENCIES[n.air_agency]) errs.push(`no_facility ${n.terminal}: air_agency ${n.air_agency}`)
    if ((d.facilities || []).some((f) => terminalsOf(f).some((t) => t.key === n.terminal))) errs.push(`no_facility ${n.terminal}: a facility entry names it`)
  }
  return errs
}

/** Washington's air agencies (which one issues a site's air permits depends on the county; Ecology covers the rest). */
export const AIR_AGENCIES = {
  NWCAA: { name: 'Northwest Clean Air Agency', url: 'https://nwcleanairwa.gov/' },
  PSCAA: { name: 'Puget Sound Clean Air Agency', url: 'https://pscleanair.gov/' },
  ORCAA: { name: 'Olympic Region Clean Air Agency', url: 'https://www.orcaa.org/' },
  SWCAA: { name: 'Southwest Clean Air Agency', url: 'https://www.swcleanair.gov/' },
}

export const FACILITY_KINDS = ['refinery', 'logistics_terminal', 'crude_terminal', 'product_terminal', 'bunkering_terminal', 'fuel_dock',
  'military_fuel_pier', 'lng_terminal', 'lpg_terminal', 'coal_terminal', 'chemical_terminal', 'grain_terminal', 'dry_bulk_terminal',
  'cement_terminal', 'scrap_metal_terminal', 'forest_products_terminal', 'other_bulk_terminal',   // migration 026
  'container_terminal', 'cruise_terminal', 'roro_terminal', 'general_cargo_terminal']   // migration 032
/** The terminals a facility entry names, as { key, relation, source_url?, says? } (a bare key = 'serves'). */
export const terminalsOf = (f) => (f.terminals || []).map((t) => (typeof t === 'string' ? { key: t, relation: 'serves' } : t))

/** Every FRS id the data file names (primary first), for fetching. BC entries have none. */
export const frsIdsOf = (f) => (f.frs_primary ? [f.frs_primary, ...(f.frs_related || []).map((r) => r.id)] : [])

// ── ECHO ──────────────────────────────────────────────────────────────────────

export const dfrUrl = (frs) => `${ECHO_BASE}/dfr_rest_services.get_dfr?output=JSON&p_id=${frs}`

const usDate = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim()); return m ? `${m[3]}-${m[1]}-${m[2]}` : null }

/** The DFR "Permits" rows (program records under one FRS id), values unchanged except ExpDate → ISO date. */
export function dfrPermits(body) {
  const r = body?.Results
  if (!r || r.Message !== 'Success') return { error: `ECHO DFR not a success: ${r?.Message ?? 'no Results'}` }
  const rows = (r.Permits || []).filter((p) => p.EPASystem && p.SourceID)
  const frsRow = rows.find((p) => p.EPASystem === 'FRS')
  return {
    frs: String(r.RegistryID || frsRow?.SourceID || ''),
    name: frsRow?.FacilityName ?? null,
    lat: frsRow?.Latitude != null ? Number(frsRow.Latitude) : null,
    lon: frsRow?.Longitude != null ? Number(frsRow.Longitude) : null,
    permits: rows.filter((p) => p.EPASystem !== 'FRS').map((p) => ({
      epa_system: p.EPASystem, permit_key: String(p.SourceID), statute: p.Statute || null, name: p.FacilityName ?? null,
      universe: p.Universe || null, areas: p.Areas || null, expires: usDate(p.ExpDate), program_status: p.FacilityStatus || null,
    })),
  }
}

/** Notices (informal) + formal actions from one DFR, as ECHO lists them. */
export function dfrEnforcement(body) {
  const r = body?.Results || {}
  const notices = (r.Notices?.Notice || []).map((n) => ({ kind: 'notice', statute: n.Statute, system: n.EPASystem, permit_key: n.SourceID,
    type: n.ActionType, agency: n.LeadAgency, date: usDate(n.NoticeDate), id: n.EnfIdentifier || null }))
  const formal = (r.FormalActions?.Action || []).map((a) => ({ kind: 'formal', statute: a.Statute, permit_key: a.SourceID,
    type: a.ActionType, agency: a.LeadAgency, date: usDate(a.ActionDate), penalty: a.PenaltyAmount ?? null,
    penaltyNote: a.PenaltyDesc ?? null }))
  const window = (x) => (x?.ProgramDates || []).map((p) => ({ program: p.Program, from: usDate(p.StartDate), to: usDate(p.EndDate) }))
  return { notices, formal, windows: { notices: window(r.Notices), formal: window(r.FormalActions) } }
}

// ── SEPA Register ─────────────────────────────────────────────────────────────

export const sepaSearchUrl = (field, text, page = 1) =>
  `${SEPA_BASE}/Search.aspx?SearchFields=${encodeURIComponent(field)}&SearchText=${encodeURIComponent(text)}&PageSize=50&Page=${page}`
export const sepaRecordUrl = (n) => `${SEPA_BASE}/Record.aspx?SEPANumber=${n}`

const decode = (s) => String(s ?? '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&#x27;|&rsquo;/g, '’').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
const clean = (s) => decode(s).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')

/** One page of search results: [{ sepa, county, type, issued, proposalName, fileNumber }] + the last page number. */
export function parseSepaSearch(html) {
  const rows = []
  for (const tr of String(html).match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const n = /Record\.aspx\?SEPANumber=(\d+)/.exec(tr)
    if (!n) continue
    const field = (label) => { const m = new RegExp(`<strong>${label}:?\\s*</strong>\\s*</span>([\\s\\S]*?)(?:<span>|</small>)`).exec(tr); return m ? clean(m[1]).replace(/,\s*$/, '').trim() : null }
    const name = /<strong>Proposal Name:\s*<\/strong><\/span>([\s\S]*?)<\/p>/.exec(tr)
    rows.push({
      sepa: n[1],
      lead: clean((/SEPANumber=\d+"[^>]*>\d+ - ([^<]*)</.exec(tr) || [])[1] || '') || null,
      issued: usDate((/Issued\s+(\d{2}\/\d{2}\/\d{4})/.exec(tr) || [])[1]),
      proposalName: name ? clean(name[1]) : null,
      type: field('Type'), county: field('County'), fileNumber: field('Lead Agency File Number'),
    })
  }
  const pages = [...String(html).matchAll(/[?&]Page=(\d+)"/g)].map((m) => Number(m[1]))
  return { rows, lastPage: pages.length ? Math.max(...pages) : 1 }
}

/** The fields of one record page. Contacts are left out on purpose. */
export function parseSepaRecord(html) {
  const s = String(html)
  const span = (id) => { const m = new RegExp(`id="MainContent_${id}"[^>]*>([\\s\\S]*?)</span>`).exec(s); return m ? clean(m[1]) : null }
  const sepa = span('lblSepaNumber')
  if (!sepa) return { error: 'no SEPA number on the page' }
  const location = span('lblLocation')
  const parcels = /Parcel:\s*([^\n]*)/.exec(location || '')
  const docs = [...s.matchAll(/href="(Document\/DocumentOpenHandler\.ashx\?DocumentId=(\d+))"[^>]*>([\s\S]*?)<\/a>\s*(?:<span class="text-muted">\(([^)]*)\)<\/span>)?/g)]
    .map((m) => ({ id: m[2], name: clean(m[3]), size: m[4] ?? null, url: `${SEPA_BASE}/${m[1]}` }))
  return {
    sepa, lead: span('lblLeadAgency'), fileNumber: span('lblLeadAgencyFileNumber') || null, county: span('lblCounty'),
    region: span('lblRegion'), type: span('lblDocumentType'), issued: usDate(span('lblIssuedDate')), commentsDue: usDate(span('lblCommentsDueDate')),
    proposalName: span('lblProposalName') || null, description: span('lblProposalDescription') || null, related: span('lblRelated') || null,
    location, parcels: parcels ? parcels[1].split(/[,;]\s*/).map((p) => p.trim()).filter(Boolean) : [],
    applicant: span('lblApplicant') || null, documents: docs,
  }
}

const has = (text, word) => new RegExp(`(^|[^A-Za-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i').test(text || '')

/**
 * Does a SEPA record belong to the facility? accepted only when all three hold: the county matches, the applicant names
 * one of applicant_words, and the proposal name / description / location / applicant line names one of place_words
 * (an applicant line such as "BP Cherry Point Refinery" names the site). Anything else found
 * by the facility's searches is a candidate (kept, not shown). Returns { status, why }.
 */
export function sepaMatch(f, rec) {
  const rule = f.sepa
  const county = String(rec.county || '').toUpperCase() === rule.county
  const applicant = rule.applicant_words.find((w) => has(rec.applicant, w)) || null
  const text = [rec.proposalName, rec.description, rec.location, rec.applicant].join('\n')
  const place = rule.place_words.find((w) => has(text, w)) || null
  return { status: county && applicant && place ? 'accepted' : 'candidate',
    why: { county: county ? rule.county : null, applicant_word: applicant, place_word: place } }
}

// ── Import ────────────────────────────────────────────────────────────────────

async function storeRecord(c, S, { sourceId, kind, key, payload, url, runId, version = null }) {
  const ent = await findOrCreateEntity(c, S, { sourceId, kind, anchor: key })
  const r = await upsertRecord(c, S, { sourceId, entityId: ent.id, payload, datasetVersion: version, retrievalUrl: url, runId })
  return { id: Number(r.id), created: r.created }
}

/**
 * raw = { dfr: Map(frs → { url, retrieved_at, body }), sepa: Map(sepaNumber → { url, retrieved_at, html }),
 *         sepaHits: Map(facilityId → [{ sepa, search }]) , ctRecordIds: Map(ctId → source_record_id) }
 */
export async function importFacilities(c, S, data, raw, { runId = null, partial = false } = {}) {
  const errs = validateFacilityData(data)
  if (errs.length) throw new Error(`facility data invalid:\n  ${errs.join('\n  ')}`)
  const stats = { facilities: 0, frsRecords: 0, permits: 0, sepaRecords: 0, sepaAccepted: 0, sepaCandidates: 0, recordsCreated: 0, problems: [] }
  // Washington (EPA FRS / SEPA) entries only; BC entries are imported by lib/ships/bcPermits.js importBcFacilities.
  const usFacilities = data.facilities.filter((f) => f.country !== 'CA')
  for (const f of usFacilities) {
    const entry = await storeRecord(c, S, { sourceId: FACILITIES_LIST_SOURCE.id, kind: 'facility_entry', key: f.id, payload: f,
      url: null, runId, version: data.version })
    stats.recordsCreated += entry.created ? 1 : 0
    // The primary DFR gives the display point; the name and kind are the curated entry's.
    const prim = raw.dfr.get(f.frs_primary)
    if (!prim) throw new Error(`${f.id}: DFR for primary FRS ${f.frs_primary} missing`)
    const pm = dfrPermits(prim.body)
    if (pm.error) throw new Error(`${f.id}: ${pm.error}`)
    const { rows: [fac] } = await c.query(
      `INSERT INTO ${S}.facilities (key, name, kind, country, admin_area, lat, lon, entry_source_record_id, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, country = EXCLUDED.country,
         admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lon = EXCLUDED.lon, list_status = 'listed',
         entry_source_record_id = EXCLUDED.entry_source_record_id, detail = EXCLUDED.detail, updated_at = now()
       RETURNING id`,
      [f.id, f.name, f.kind, f.country, f.admin_area ?? null, pm.lat, pm.lon, entry.id,
        { frs_left_out: f.frs_left_out || [], point_from: `EPA FRS ${f.frs_primary}`, ...(f.air_agency ? { air_agency: f.air_agency } : {}) }])
    stats.facilities++
    const link = (role, sourceId, key, recId, status, method, detail = {}) => c.query(
      `INSERT INTO ${S}.facility_links (facility_id, role, source_id, entity_key, source_record_id, status, method, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (facility_id, role, source_id, entity_key) DO UPDATE SET source_record_id = EXCLUDED.source_record_id,
         status = CASE WHEN ${S}.facility_links.status = 'retired' THEN 'retired' ELSE EXCLUDED.status END,
         method = EXCLUDED.method, detail = EXCLUDED.detail, last_seen_at = now()`,
      [fac.id, role, sourceId, String(key), recId, status, method, detail])

    for (const frs of frsIdsOf(f)) {
      const d = raw.dfr.get(frs)
      if (!d) { stats.problems.push(`${f.id}: DFR for FRS ${frs} not fetched`); continue }
      const m = dfrPermits(d.body)
      if (m.error) { stats.problems.push(`${f.id}: FRS ${frs}: ${m.error}`); continue }
      const rec = await storeRecord(c, S, { sourceId: ECHO_SOURCE.id, kind: 'echo_dfr', key: frs, payload: d.body, url: d.url, runId,
        version: d.retrieved_at?.slice(0, 10) ?? null })
      stats.recordsCreated += rec.created ? 1 : 0
      stats.frsRecords++
      const primary = frs === f.frs_primary
      await link(primary ? 'epa_frs_primary' : 'epa_frs_related', ECHO_SOURCE.id, frs, rec.id, 'accepted', 'curated',
        primary ? {} : { why: (f.frs_related || []).find((r) => r.id === frs)?.why ?? null })
      for (const p of m.permits) {
        await c.query(
          `INSERT INTO ${S}.permits (epa_system, permit_key, statute, name, universe, areas, expires, program_status, frs_ids, source_record_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,ARRAY[$9::text],$10)
           ON CONFLICT (epa_system, permit_key) DO UPDATE SET statute = EXCLUDED.statute, name = EXCLUDED.name,
             universe = EXCLUDED.universe, areas = EXCLUDED.areas, expires = EXCLUDED.expires, program_status = EXCLUDED.program_status,
             frs_ids = (SELECT array_agg(DISTINCT x) FROM unnest(${S}.permits.frs_ids || EXCLUDED.frs_ids) x),
             source_record_id = EXCLUDED.source_record_id, last_seen_at = now()`,
          [p.epa_system, p.permit_key, p.statute, p.name, p.universe, p.areas, p.expires, p.program_status, frs, rec.id])
        stats.permits++
      }
    }
    for (const ct of f.ct_refinery || []) {
      const rid = raw.ctRecordIds?.get(Number(ct)) ?? null
      if (rid == null) stats.problems.push(`${f.id}: Climate TRACE refinery ${ct} has no stored record (run ships:import-terminals first)`)
      await link('ct_refinery', 'climate-trace', ct, rid, 'accepted', 'curated')
    }
    for (const hit of raw.sepaHits.get(f.id) || []) {
      const page = raw.sepa.get(hit.sepa)
      if (!page) { stats.problems.push(`${f.id}: SEPA ${hit.sepa} record page not fetched`); continue }
      const r = parseSepaRecord(page.html)
      if (r.error) { stats.problems.push(`${f.id}: SEPA ${hit.sepa}: ${r.error}`); continue }
      const rec = await storeRecord(c, S, { sourceId: SEPA_SOURCE.id, kind: 'sepa_record', key: r.sepa, payload: r, url: page.url, runId,
        version: page.retrieved_at?.slice(0, 10) ?? null })
      stats.recordsCreated += rec.created ? 1 : 0
      stats.sepaRecords++
      const m = sepaMatch(f, r)
      await link('sepa_review', SEPA_SOURCE.id, r.sepa, rec.id, m.status, 'sepa_applicant_place', { ...m.why, searches: hit.searches })
      stats[m.status === 'accepted' ? 'sepaAccepted' : 'sepaCandidates']++
    }
    for (const t of terminalsOf(f)) {
      const { rows } = await c.query(`SELECT id FROM ${S}.terminals WHERE key = $1`, [t.key])
      if (!rows.length) { stats.problems.push(`${f.id}: terminal ${t.key} not in the database`); continue }
      await c.query(
        `INSERT INTO ${S}.terminal_facilities (terminal_id, facility_id, relation, entry_source_record_id, detail) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (terminal_id, facility_id, relation) DO UPDATE SET entry_source_record_id = EXCLUDED.entry_source_record_id,
           detail = EXCLUDED.detail, status = 'active', last_seen_at = now()`,
        [rows[0].id, fac.id, t.relation, entry.id, { source_url: t.source_url ?? null, says: t.says ?? null }])
    }
  }
  // Facilities no longer in the file are kept, marked withdrawn — only on a FULL run: a partial (--only) run holds a subset.
  // Only non-BC rows: BC facilities are withdrawn by the BC import.
  if (!partial) await c.query(`UPDATE ${S}.facilities SET list_status = 'withdrawn', updated_at = now()
                                WHERE NOT (key = ANY($1)) AND list_status = 'listed' AND country <> 'CA'`,
    [usFacilities.map((f) => f.id)])
  // Terminals checked with no facility found: the curated note (what was searched, why candidates were left out) as evidence.
  stats.noFacility = 0
  for (const n of data.no_facility || []) {
    const r = await storeRecord(c, S, { sourceId: FACILITIES_LIST_SOURCE.id, kind: 'no_facility_entry', key: n.terminal, payload: n, url: null, runId, version: data.version })
    stats.recordsCreated += r.created ? 1 : 0
    stats.noFacility++
  }
  return stats
}

// ── Read (terminal card "Permits" tab) ────────────────────────────────────────

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ?? null)

/**
 * Everything the card shows for the facilities a terminal serves: per facility, the EPA FRS records (with why), permits
 * (each with the FRS ids and DFR record it came from), enforcement (notices + formal actions, per FRS), accepted SEPA
 * records, and the sources' credits. Candidate links are not returned.
 */
export async function terminalPermits(q, S, terminalKey) {
  const [t] = await q(`SELECT id, key, name FROM ${S}.terminals WHERE key = $1`, [terminalKey])
  if (!t) return null
  // The facility that owns the terminal first (its permits are the dock operator's), then the plant(s) it serves.
  const facs = await q(`SELECT f.id, f.key, f.name, f.kind, f.country, f.admin_area, f.lat, f.lon, f.entry_source_record_id, f.detail AS fac_detail, tf.relation, tf.detail AS relation_detail
                          FROM ${S}.terminal_facilities tf JOIN ${S}.facilities f ON f.id = tf.facility_id
                         WHERE tf.terminal_id = $1 AND tf.status = 'active' AND f.list_status = 'listed'
                         ORDER BY (tf.relation = 'owned_by') DESC, f.name`, [t.id])
  const coverage = new Map((await q(`SELECT permit_id, detail FROM ${S}.permit_terminal_coverage WHERE terminal_id = $1 AND status = 'active'`, [t.id]))
    .map((r) => [Number(r.permit_id), r.detail]))
  const out = []
  for (const f of facs) {
    const links = await q(`SELECT l.role, l.entity_key, l.source_record_id, l.detail, sr.payload FROM ${S}.facility_links l
                             LEFT JOIN ${S}.source_records sr ON sr.id = l.source_record_id
                            WHERE l.facility_id = $1 AND l.status = 'accepted' ORDER BY l.role, l.entity_key`, [f.id])
    const frs = links.filter((l) => l.role.startsWith('epa_frs')).map((l) => {
      const m = dfrPermits(l.payload)
      return { id: l.entity_key, primary: l.role === 'epa_frs_primary', name: m.name ?? null, why: l.detail?.why ?? null,
        record_id: Number(l.source_record_id), url: ECHO_DFR_PAGE + l.entity_key, enforcement: dfrEnforcement(l.payload),
        cases: dfrCases(l.payload).map((x) => ({ ...x, url: ECHO_CASE_PAGE + encodeURIComponent(x.id) })) }   // the agency's case / penalty numbers
    })
    const frsIds = frs.map((x) => x.id)
    const prow = await q(`SELECT id, epa_system, permit_key, statute, name, universe, areas, expires, program_status, frs_ids, source_record_id, detail
                            FROM ${S}.permits
                           WHERE frs_ids && $1::text[] OR id IN (SELECT permit_id FROM ${S}.facility_permits WHERE facility_id = $2)
                           ORDER BY statute NULLS LAST, epa_system, permit_key`, [frsIds, f.id])
    const docs = await documentsFor(q, S, prow.map((p) => Number(p.id)), [Number(f.id)])
    const sepaBy = f.country === 'CA' ? new Map() : await permitSepaFor(q, S, prow.map((p) => Number(p.id)))   // SEPA per permit (migration 031)
    // BC facilities: NRCED records, EAO projects and why each EMA authorization is the site's (lib/ships/bcPermits.js).
    const bc = f.country === 'CA' ? await bcFacilityDetail(q, S, f.id) : null
    const cer = f.country === 'CA' ? await cerFacilityDetail(q, S, f.id) : null   // Canada Energy Regulator (lib/ships/cer.js; Westridge)
    const permits = prow.map(({ id, detail, ...p }) => ({ ...p, expires: iso(p.expires), source_record_id: Number(p.source_record_id),
      paris: detail?.paris ? { current: detail.paris.current, facilityId: detail.paris.facility_id } : null,
      ...(detail?.bc_ema ? { bcEma: { ...detail.bc_ema, ...(bc?.emaWhy.get(p.permit_key) || {}) } } : {}),
      ...(detail?.mv ? { mv: detail.mv } : {}),
      ...(detail?.wa_air ? { waAir: detail.wa_air } : {}),   // WA local clean air agency permit (lib/ships/waAirAgencies.js)
      coversTerminal: coverage.get(Number(id)) ?? null, documents: docs.byPermit.get(Number(id)) || [],
      sepa: sepaBy.has(Number(id)) ? sepaBy.get(Number(id)).summary : null }))
    const sepa = links.filter((l) => l.role === 'sepa_review').map((l) => {
      const r = l.payload || {}
      return { sepa: r.sepa, type: r.type, issued: r.issued, lead: r.lead, fileNumber: r.fileNumber, proposalName: r.proposalName,
        description: r.description, applicant: r.applicant, parcels: r.parcels || [], documents: r.documents || [],
        record_id: Number(l.source_record_id), url: sepaRecordUrl(r.sepa), why: l.detail || {} }
    }).sort((a, b) => String(b.issued).localeCompare(String(a.issued)))
    const [{ n: sepaCandidates }] = await q(`SELECT count(*)::int AS n FROM ${S}.facility_links WHERE facility_id = $1 AND role = 'sepa_review' AND status = 'candidate'`, [f.id])
    const ct = links.filter((l) => l.role === 'ct_refinery').map((l) => ({ id: l.entity_key, record_id: l.source_record_id == null ? null : Number(l.source_record_id) }))
    out.push({ key: f.key, name: f.name, kind: f.kind, country: f.country, adminArea: f.admin_area, lat: f.lat, lon: f.lon,
      relation: f.relation, relationSource: f.relation_detail?.source_url ?? null, relationSays: f.relation_detail?.says ?? null,
      entryRecordId: Number(f.entry_source_record_id), frs, permits, sepa, sepaCandidates, climateTrace: ct,
      documents: docs.byFacility.get(Number(f.id)) || [], airAgencyCode: f.fac_detail?.air_agency ?? null,
      ...(bc ? { bc: { nrced: bc.nrced, nrcedCandidates: bc.nrcedCandidates, eao: bc.eao, eaoSearches: bc.eaoSearches, eaoNone: f.fac_detail?.eao_none ?? null,
        emaNone: f.fac_detail?.ema_none ?? null, mvNone: f.fac_detail?.mv_none ?? null, mvOutside: f.fac_detail?.mv_outside ?? null } } : {}),
      ...(cer ? { cer } : {}) })
  }
  // WA local clean air agencies: what was searched for this terminal, and "none found" where nothing was.
  const airSearches = t.key.startsWith('wa-') ? await airSearchesFor(q, S, t.key) : []
  // No facility linked: the curated "none found" entry for this terminal, if it was checked (lib/ships/data/salish-facilities.json no_facility).
  let none = null
  if (!out.length) {
    const [n] = await q(`SELECT sr.id, sr.payload FROM ${S}.source_entities se
                           JOIN LATERAL (SELECT id, payload FROM ${S}.source_records WHERE source_entity_id = se.id ORDER BY id DESC LIMIT 1) sr ON true
                          WHERE se.source_id = $1 AND se.entity_kind = 'no_facility_entry' AND se.entity_key = $2`, [FACILITIES_LIST_SOURCE.id, terminalKey])
    if (n) none = { says: n.payload.says, searched: n.payload.searched, leftOut: n.payload.left_out || [], checked: n.payload.checked ?? null,
      airAgency: n.payload.air_agency ? { code: n.payload.air_agency, ...AIR_AGENCIES[n.payload.air_agency] } : null, record_id: Number(n.id) }
  }
  for (const f of out) if (f.airAgencyCode) f.airAgency = { code: f.airAgencyCode, ...AIR_AGENCIES[f.airAgencyCode] }
  const sources = await q(`SELECT id, name, publisher, homepage_url, license, license_url, commercial_use, attribution_text, attribution_url
                             FROM ${S}.sources WHERE id = ANY($1)`, [none ? [FACILITIES_LIST_SOURCE.id, ECHO_SOURCE.id, SEPA_SOURCE.id, PARIS_SOURCE.id] : out.some((f) => f.country === 'CA')
    ? [FACILITIES_LIST_SOURCE.id, ...BC_SOURCE_IDS, MV_SOURCE.id, ...(out.some((f) => f.cer) ? [CER_SOURCE.id, CER_ORDERS_SOURCE.id] : [])]
    : [ECHO_SOURCE.id, SEPA_SOURCE.id, FACILITIES_LIST_SOURCE.id, PARIS_SOURCE.id, ECOLOGY_INDUSTRIAL_SOURCE.id, NWCAA_SOURCE.id, PSCAA_SOURCE.id,
      ...AIR_SOURCE_IDS.filter((id) => airSearches.some((a) => WA_AIR[a.agency]?.source.id === id))]])
  // State aquatic land (WA DNR) and county shoreline permits at the dock itself (lib/ships/dnrLeases.js, countyShoreline.js).
  const land = await terminalLand(q, S, t.id)
  const all = out.length ? [...sources, ...land.sources] : land.sources
  return { terminal: { key: t.key, name: t.name }, facilities: out, ...(none ? { none } : {}), land: land.records,
    sources: all.filter((x, i, xs) => xs.findIndex((y) => y.attribution_text === x.attribution_text) === i), airSearches }
}

// ── Read (the permit page, /ships/permit/<key>) ───────────────────────────────

// Which agency's listings say it issued the permit (by where its documents are listed), and its name in the SEPA Register.
const ISSUER = {
  'wa-ecology-paris': { name: 'Washington State Department of Ecology', sepaLead: 'WA Department of Ecology' },
  'nwcaa-aop': { name: 'Northwest Clean Air Agency', sepaLead: 'Northwest Clean Air Agency' },
  'pscaa-title-v': { name: 'Puget Sound Clean Air Agency', sepaLead: 'Puget Sound Clean Air Agency' },
  ...Object.fromEntries(Object.values(WA_AIR).map((a) => [a.source.id, { name: a.name, sepaLead: a.name }])),
  'wa-ecology-industrial': { name: 'Washington State Department of Ecology', sepaLead: 'WA Department of Ecology' },
}

export const ECHO_CASE_PAGE = 'https://echo.epa.gov/enforcement-case-report?id='

/** ECHO "CaseFormalActions" (cases EPA's systems hold, incl. state / local ones): id, the agency's case name, date, permit. */
export function dfrCases(body) {
  return (body?.Results?.CaseFormalActions?.Action || []).map((a) => ({
    id: a.CaseID, name: a.CaseName || a.ActivityName || null, type: a.CaseType || null, lead: a.LeadAgency || null,
    date: usDate(a.IssueDate), permit_key: String(a.SourceID || '').split('/').pop(), status: a.CaseStatus ?? null,
  })).filter((c) => c.id)
}

/**
 * The agency's own enforcement documents (PARIS "Enforcement Documents": penalty notices, agreed orders, NOVs, warning
 * letters) joined to ECHO's rows for the same permit by date: PARIS states "Civil Penalty Issued: 05/14/2025 Docket: 23528"
 * or the file name carries the date. A document with no ECHO row on its date becomes its own row (e.g. older than
 * ECHO's five-year window), marked as from WA Ecology.
 */
// What an enforcement document is, from words in its file name when PARIS gives no description.
const docWhat = (t) => {
  const x = String(t || '').replace(/[_-]/g, ' ')
  return /warning ?letter/i.test(x) ? 'Warning letter' : /notice ?of ?penalty|\bNOP\d*/i.test(x) ? 'Notice of penalty'
    : /\bNOV\d*|notice ?of ?violation/i.test(x) ? 'Notice of violation' : /agreed ?order/i.test(x) ? 'Agreed order'
    : /noncompliance/i.test(x) ? 'Noncompliance notification' : /not ?conducted/i.test(x) ? 'Warning: analysis not conducted' : 'Ecology enforcement letter'
}

export function joinEnforcementDocs(rows, docs) {
  const enfDocs = docs.filter((d) => /^enforcement documents$/i.test(d.type || '')).map((d) => {
    const issued = /Issued:\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(d.description || '')?.[1]
    const fname = /(20\d\d|19\d\d)[-_](\d{1,2})[-_](\d{1,2})/.exec(d.title || '')
    const date = issued ? usDate(issued) : fname ? `${fname[1]}-${fname[2].padStart(2, '0')}-${fname[3].padStart(2, '0')}` : null
    return { doc: d, date, docket: /Docket:\s*(\S+)/.exec(d.description || '')?.[1] ?? null,
      what: (d.description || '').replace(/\s*Issued:.*$/, '').trim() || docWhat(d.title) }
  })
  const used = new Set()
  const out = rows.map((r) => {
    const mine = enfDocs.filter((e) => e.date && e.date === r.date)
    mine.forEach((e) => used.add(e.doc.id))
    return { ...r, documents: mine.map((e) => ({ title: e.doc.title, url: e.doc.url, what: e.what, docket: e.docket, record_id: e.doc.record_id })) }
  })
  for (const e of enfDocs) {
    if (used.has(e.doc.id)) continue
    out.push({ kind: 'agency', source: 'paris', date: e.date, type: e.what || 'Enforcement document', agency: 'State', statute: 'CWA',
      documents: [{ title: e.doc.title, url: e.doc.url, what: e.what, docket: e.docket, record_id: e.doc.record_id }] })
  }
  return out
}

const looseDate = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '')); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null }
const VIOLATION_WORDS = (v) => [v.parameter, v.value != null ? `${v.value}${v.units && !/standard units/i.test(v.units) ? ` ${v.units}` : ''}` : null,
  v.max_limit != null ? `limit ${v.max_limit}` : v.min_limit != null ? `minimum ${v.min_limit}` : null, v.point ? `at ${v.point}` : null].filter(Boolean).join(' · ')

/**
 * Adds WA Ecology's own detail (PARIS facility pages) to a permit's enforcement rows:
 *   - outcome: PARIS's enforcement entry on the same date (e.g. "No enforcement action necessary"), facility-wide in PARIS;
 *   - violations: for a notice, the violations PARIS recorded for this permit after the previous row and up to this one
 *     (an EarthAtlas grouping by date; PARIS doesn't say which violations a review covered);
 *   - inspections become their own rows, with the inspection report when a document of that date is listed.
 * Returns the rows newest first and every violation of the permit (newest first).
 */
export function withParisDetail(rows, parisPages, key, docs) {
  const vio = parisPages.flatMap((p) => (p.violations || []).filter((v) => v.permit === key).map((v) => ({ ...v, words: VIOLATION_WORDS(v), record_id: p.recordId })))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  const outcomes = parisPages.flatMap((p) => (p.enforcements || []).map((e) => ({ ...e, record_id: p.recordId })))
  const inspDocs = docs.filter((d) => /inspection/i.test(d.type || ''))
  const insp = parisPages.flatMap((p) => (p.inspections || []).filter((i) => i.permit === key).map((i) => {
    const date = i.start || i.scheduled
    const reps = inspDocs.filter((d) => looseDate(/Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(d.description || '')?.[1]) === date)
    return { kind: 'inspection', source: 'paris', date, type: i.type, agency: 'State', statute: 'CWA', status: i.status,
      announced: i.announced, inspectionId: i.id, record_id: p.recordId,
      documents: reps.map((d) => ({ title: d.title, url: d.url, what: 'Inspection report', docket: null, record_id: d.record_id })) }
  }))
  // PARIS's inspections grid lists only recent inspections; every inspection REPORT names its inspection ("Compliance
  // Inspection-With Sampling Date: 06/03/2014"), so each report without a grid row becomes an inspection row of its own.
  const gridDates = new Set(insp.map((i) => i.date))
  const byDate = new Map()
  for (const d of inspDocs) {
    const m = /^(.*?)\s*Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(d.description || '')
    const date = m && looseDate(m[2])
    if (!date || gridDates.has(date)) continue
    if (!byDate.has(date)) byDate.set(date, { kind: 'inspection', source: 'paris', date, type: m[1] || 'Inspection', agency: 'State', statute: 'CWA',
      record_id: d.record_id, documents: [] })
    byDate.get(date).documents.push({ title: d.title, url: d.url, what: 'Inspection report', docket: null, record_id: d.record_id })
  }
  const all = [...rows, ...insp, ...byDate.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  const dated = all.filter((r) => r.kind !== 'inspection').map((r) => r.date).filter(Boolean).sort()
  for (const r of all) {
    const o = outcomes.filter((e) => e.date === r.date)
    if (o.length && r.kind !== 'inspection') r.outcome = o.map((e) => e.type).join('; '), r.outcomeRecord = o[0].record_id
    if (r.kind === 'notice' && r.date) {
      const prev = dated.filter((d) => d < r.date).pop() ?? null
      r.violations = vio.filter((v) => v.date && v.date <= r.date && (!prev || v.date > prev))
      r.violationsSince = prev
    }
  }
  return { rows: all, violations: vio }
}

/**
 * One permit, readable: ECHO's values, the facilities it sits under (and the terminals they serve), every listed document,
 * the agency listings those came from (NWCAA's row gives the air permit's date, status and reported emissions), ECHO
 * enforcement recorded against this permit id, and the facility's SEPA reviews led by the agency that lists the permit's
 * documents (same agency; which permit each review covered is not confirmed). `system` picks one when an id repeats.
 */
export async function permitPage(q, S, key, system = null) {
  const rows = await q(`SELECT * FROM ${S}.permits WHERE permit_key = $1 ${system ? 'AND epa_system = $2' : ''} ORDER BY epa_system`,
    system ? [key, system] : [key])
  if (!rows.length) return null
  if (rows.length > 1) return { ambiguous: rows.map((r) => ({ system: r.epa_system, name: r.name })) }
  const p = rows[0]
  // The facilities that hold it: by an accepted EPA FRS link, or listed as holder (facility_permits) — the latter needs no link row.
  const facs = await q(`SELECT f.id, f.key, f.name, f.admin_area, f.lat, f.lon FROM ${S}.facilities f
                         WHERE f.list_status = 'listed' AND (f.id IN (SELECT l.facility_id FROM ${S}.facility_links l
                                 WHERE l.role IN ('epa_frs_primary', 'epa_frs_related') AND l.status = 'accepted' AND l.entity_key = ANY($1::text[]))
                            OR f.id IN (SELECT facility_id FROM ${S}.facility_permits WHERE permit_id = $2))`, [p.frs_ids, p.id])
  const facilities = []
  for (const f of facs) {
    const terminals = await q(`SELECT t.key, t.name FROM ${S}.terminal_facilities tf JOIN ${S}.terminals t ON t.id = tf.terminal_id
                                WHERE tf.facility_id = $1 AND tf.status = 'active' ORDER BY t.name`, [f.id])
    facilities.push({ key: f.key, name: f.name, adminArea: f.admin_area, lat: f.lat, lon: f.lon, terminals })
  }
  const docs = (await documentsFor(q, S, [Number(p.id)], [])).byPermit.get(Number(p.id)) || []
  const listingIds = [...new Set(docs.map((d) => d.record_id))]
  const listings = listingIds.length ? await q(`SELECT sr.id, sr.source_id, sr.payload, sr.retrieval_url, sr.last_retrieved_at
                                                  FROM ${S}.source_records sr WHERE sr.id = ANY($1::bigint[])`, [listingIds]) : []
  const nwcaa = listings.find((l) => l.source_id === 'nwcaa-aop')
  // ECHO enforcement recorded against this permit id, from every DFR it is listed in.
  const dfrs = await q(`SELECT se.entity_key AS frs, sr.id, sr.payload FROM ${S}.source_entities se
                          JOIN LATERAL (SELECT id, payload FROM ${S}.source_records WHERE source_entity_id = se.id ORDER BY id DESC LIMIT 1) sr ON true
                         WHERE se.source_id = 'epa-echo' AND se.entity_kind = 'echo_dfr' AND se.entity_key = ANY($1::text[])`, [p.frs_ids])
  const echoRows = dfrs.flatMap((d) => {
    const e = dfrEnforcement(d.payload)
    const cases = dfrCases(d.payload).filter((c) => c.permit_key === key)
    return [...e.formal, ...e.notices].filter((x) => x.permit_key === key).map((x) => {
      // A formal action's ECHO case (same permit, same date): its case report page and the agency's own case name.
      const cs = x.kind === 'formal' ? cases.find((c) => c.date === x.date) : null
      return { ...x, frs: d.frs, record_id: Number(d.id), source: 'echo',
        case: cs ? { id: cs.id, name: cs.name, status: cs.status, type: cs.type, url: ECHO_CASE_PAGE + encodeURIComponent(cs.id) } : null }
    })
  })
  // PARIS facility pages (violations, enforcement outcomes, inspections) for the facilities that hold this permit.
  const paris = facs.length ? await q(`SELECT l.source_record_id AS id, sr.payload FROM ${S}.facility_links l
                                         JOIN ${S}.source_records sr ON sr.id = l.source_record_id
                                        WHERE l.facility_id = ANY($1::bigint[]) AND l.role = 'paris_facility' AND l.status = 'accepted'`,
    [facs.map((f) => f.id)]) : []
  const bcEma = p.epa_system === 'BC-EMA'
  const mv = p.epa_system === 'MV-AQ'   // Metro Vancouver air quality permit (lib/ships/metroVancouver.js): no enforcement source read yet
  // WA local clean air agency permit (lib/ships/waAirAgencies.js): the agency's enforcement reaches ECHO under the site's ICIS-Air
  // record (its id starts with the agency's code), not under the order's number — point there instead.
  const waAir = AIR_SYSTEMS.includes(p.epa_system) ? agencyBySystem(p.epa_system) : null
  const enforcementOn = waAir?.icis && facs.length
    ? (await q(`SELECT DISTINCT p2.epa_system AS system, p2.permit_key AS key FROM ${S}.permits p2 JOIN ${S}.facility_links l ON p2.frs_ids && ARRAY[l.entity_key]
                 WHERE l.facility_id = ANY($1::bigint[]) AND l.role IN ('epa_frs_primary', 'epa_frs_related') AND l.status = 'accepted'
                   AND p2.epa_system = 'ICIS-Air' AND p2.permit_key LIKE $2 || '%' ORDER BY 2`, [facs.map((f) => f.id), waAir.icis]))
    : []
  const { rows: enforcement, violations } = mv || waAir ? { rows: [], violations: [] } : bcEma
    ? { rows: await nrcedForPermit(q, S, facs.map((f) => f.id), key), violations: [] }   // BC: NRCED records that name this authorization
    : withParisDetail(joinEnforcementDocs(echoRows, docs), paris.map((r) => ({ recordId: Number(r.id), ...r.payload })), key, docs)
  const window = dfrs.length ? dfrEnforcement(dfrs[0].payload).windows : null
  const issuerSrc = docs.map((d) => d.source).find((s) => ISSUER[s])
  const issuer = issuerSrc ? ISSUER[issuerSrc] : null
  let sepa = []
  if (issuer && facs.length) {
    const links = await q(`SELECT l.source_record_id, sr.payload FROM ${S}.facility_links l JOIN ${S}.source_records sr ON sr.id = l.source_record_id
                            WHERE l.facility_id = ANY($1::bigint[]) AND l.role = 'sepa_review' AND l.status = 'accepted'`, [facs.map((f) => f.id)])
    sepa = links.map((l) => ({ ...l.payload, record_id: Number(l.source_record_id), url: sepaRecordUrl(l.payload.sepa) }))
      .filter((r) => String(r.lead || '').toLowerCase() === issuer.sepaLead.toLowerCase())
      .sort((a, b) => String(b.issued).localeCompare(String(a.issued)))
  }
  // SEPA per permit (lib/ships/permitSepa.js): the reviews that cover this permit with their evidence, what its own documents say, or
  // none found with what was searched. null when the permit gets no SEPA answer (a reporting id, a BC authorization).
  const sepaPermit = (bcEma || mv) ? null : (await permitSepaFor(q, S, [Number(p.id)])).get(Number(p.id)) ?? null
  const srcIds = waAir ? [waAir.source.id, FACILITIES_LIST_SOURCE.id, ...(sepa.length ? [SEPA_SOURCE.id] : [])]
    : mv ? [MV_SOURCE.id, FACILITIES_LIST_SOURCE.id] : bcEma ? [BC_EMA_SOURCE.id, FACILITIES_LIST_SOURCE.id, ...new Set([...docs.map((d) => d.source), ...(enforcement.length ? ['bc-nrced'] : [])])]
    : [ECHO_SOURCE.id, SEPA_SOURCE.id, FACILITIES_LIST_SOURCE.id, ...new Set(docs.map((d) => d.source))]
  const sources = await q(`SELECT id, name, publisher, homepage_url, license, license_url, commercial_use, attribution_text, attribution_url
                             FROM ${S}.sources WHERE id = ANY($1)`, [srcIds])
  return {
    permit: { system: p.epa_system, key: p.permit_key, statute: p.statute, name: p.name, universe: p.universe, areas: p.areas,
      expires: iso(p.expires), status: p.program_status, frsIds: p.frs_ids, recordId: Number(p.source_record_id),
      echoUrl: p.frs_ids[0] ? ECHO_DFR_PAGE + p.frs_ids[0] : null, paris: p.detail?.paris ?? null,
      ...(bcEma ? { bcEma: p.detail?.bc_ema ?? null, registerUrl: BC_EMA_SOURCE.homepage_url } : {}),
      ...(mv ? { mv: p.detail?.mv ?? null } : {}),
      ...(waAir ? { waAir: p.detail?.wa_air ?? null, enforcementOn } : {}) },
    coverage: (await q(`SELECT t.key, t.name, c.detail FROM ${S}.permit_terminal_coverage c JOIN ${S}.terminals t ON t.id = c.terminal_id
                         WHERE c.permit_id = $1 AND c.status = 'active' ORDER BY t.name`, [p.id])).map((r) => ({ key: r.key, name: r.name, ...r.detail })),
    issuer: waAir ? waAir.name : mv ? 'Metro Vancouver' : bcEma ? null : issuer?.name ?? null, facilities, documents: docs,   // BC: the register doesn't name the issuing office
    listings: listings.map((l) => ({ id: Number(l.id), source: l.source_id, url: l.retrieval_url, checked: iso(l.last_retrieved_at),
      total: l.payload?.total ?? null }))
      // BC: each NRCED record is its own stored record but several come from one search: list each search once.
      .filter((l, i, all) => !(bcEma || mv || waAir) || all.findIndex((x) => x.url === l.url) === i),
    air: nwcaa ? { permitDate: nwcaa.payload.permit_date, status: nwcaa.payload.permit_status, emissions: nwcaa.payload.emissions_tpy,
      aop: docs.find((d) => d.source === 'nwcaa-aop')?.description?.match(/Air Operating Permit (\S+);/)?.[1] ?? null, recordId: Number(nwcaa.id) } : null,
    enforcement, violations, enforcementWindow: window, sepa, sepaLead: issuer?.sepaLead ?? null, sepaPermit, sources,
  }
}

/**
 * Permit ↔ terminal coverage from the data file (a permit document says the permit covers the dock: doc, where, words).
 * Run after the permits exist (ECHO + PARIS). An entry whose permit or terminal is missing is reported, not stored.
 */
export async function importCoverage(c, S, data) {
  const stats = { coverage: 0, holderLinks: 0, problems: [] }
  for (const f of data.facilities) {
    const { rows: [entry] } = await c.query(`SELECT id, entry_source_record_id FROM ${S}.facilities WHERE key = $1`, [f.id])
    if (!entry) continue
    entry.id = entry.entry_source_record_id
    // permit_holder_names: a permit listed under another facility whose holder (ECHO name / PARIS water-quality name) is this
    // facility's company also belongs here (e.g. TLO's stormwater permit WAR302760 sits on the refinery's records).
    for (const word of f.permit_holder_names || []) {
      const { rows: hits } = await c.query(
        `SELECT id, source_record_id FROM ${S}.permits WHERE upper(name) LIKE '%' || upper($1) || '%'
            OR upper(coalesce(detail->'paris'->'current'->>'name', '')) LIKE '%' || upper($1) || '%'`, [word])
      for (const h of hits) {
        const { rows: [fid] } = await c.query(`SELECT id FROM ${S}.facilities WHERE key = $1`, [f.id])
        await c.query(
          `INSERT INTO ${S}.facility_permits (facility_id, permit_id, method, source_record_id) VALUES ($1,$2,'holder_name',$3)
           ON CONFLICT (facility_id, permit_id) DO UPDATE SET last_seen_at = now()`, [fid.id, h.id, h.source_record_id])
        stats.holderLinks++
      }
    }
    for (const cv of f.coverage || []) {
      const { rows: [p] } = await c.query(`SELECT id FROM ${S}.permits WHERE epa_system = $1 AND permit_key = $2`, [cv.permit.system, cv.permit.key])
      const { rows: [t] } = await c.query(`SELECT id FROM ${S}.terminals WHERE key = $1`, [cv.terminal])
      if (!p || !t) { stats.problems.push(`${f.id}: coverage ${cv.permit.system} ${cv.permit.key} → ${cv.terminal}: ${!p ? 'permit' : 'terminal'} not in the database`); continue }
      await c.query(
        `INSERT INTO ${S}.permit_terminal_coverage (permit_id, terminal_id, entry_source_record_id, detail) VALUES ($1,$2,$3,$4)
         ON CONFLICT (permit_id, terminal_id) DO UPDATE SET entry_source_record_id = EXCLUDED.entry_source_record_id, detail = EXCLUDED.detail,
           status = 'active', last_seen_at = now()`,
        [p.id, t.id, entry.id, { doc_url: cv.doc_url, doc_title: cv.doc_title ?? null, where: cv.where, says: cv.says }])
      stats.coverage++
    }
  }
  return stats
}
