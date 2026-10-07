/**
 * BC (Canada) permits and enforcement for terminal facilities. Two-terminal DEV pilot 2026-10-07 (Westridge, Westshore);
 * sources docs/PERMITS_SOURCES_BC.md, migration 027, data: the 'bc-…' entries of lib/ships/data/salish-facilities.json.
 * Same model as Washington (lib/ships/facilities.js): facility noun → terminal_facilities → permits → documents → enforcement
 * and inspections → environmental reviews. Rules: src/ships/CLAUDE.md.
 *
 *   evidence        one row of the BC EMA authorizations register (source 'bc-ema-authorizations', kind ema_authorization);
 *                   one NRCED record as the NRPTI public API returns it (source 'bc-nrced', kind nrced_record; the search
 *                   "score" is dropped: it is the search rank, not part of the record);
 *                   one BC EAO EPIC project (source 'bc-eao-epic', kind eao_project; EAO staff names / emails / phones dropped);
 *                   the curated facility entry (kind facility_entry, as for Washington)
 *   claim           facilities; permits (system 'BC-EMA', statute 'BC EMA', values as the register lists them); documents
 *                   (NRCED record files: links only)
 *   interpretation  facility_links: 'bc_ema_authorization' (hand-checked in the data file: place + company, with why),
 *                   'nrced_record' (rule nrcedMatch), 'eao_project' (hand-checked); facility_permits; terminal_facilities
 */
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'
import { FACILITIES_LIST_SOURCE } from './facilities.js'

/** The register sometimes repeats a phrase ("Chlor-Alkali Plant Chlor-Alkali Plant"): keep it once. */
const oncePhrase = (s) => { const t = String(s ?? '').trim(); const m = /^(.+?)\s+\1$/.exec(t); return m ? m[1] : t }

export const EMA_XLSX_URL = 'https://www2.gov.bc.ca/assets/gov/environment/waste-management/waste-discharge-authorization/datamart/all_ams_authorizations.xlsx'
export const EMA_CATALOGUE_URL = 'https://catalogue.data.gov.bc.ca/dataset/waste-discharge-authorizations-all-authorizations'
export const NRCED_API = 'https://nrpti-api-f00029-prod.apps.silver.devops.gov.bc.ca/api/public/search'
export const NRCED_DATASETS = 'Order,Inspection,AdministrativePenalty,AdministrativeSanction,CourtConviction,Warning,Ticket'
export const EAO_API = 'https://projects.eao.gov.bc.ca/api/public/search'
export const EAO_PROJECT_PAGE = (id) => `https://projects.eao.gov.bc.ca/p/${id}/project-details`   // EPIC's own route (its main.js)

const CLEARED = 'Public agency record (BC): cleared for EarthAtlas use by Josh 2026-10-06 (public agency records are treated as cleared; terms page not read). Credit and link.'
export const BC_EMA_SOURCE = {
  id: 'bc-ema-authorizations',
  name: 'Waste Discharge Authorizations – All Authorizations (BC Environmental Management Act)',
  publisher: 'BC Ministry of Environment and Parks',
  homepage_url: EMA_CATALOGUE_URL,
  license: 'Open Government Licence - British Columbia',
  license_url: 'https://www2.gov.bc.ca/gov/content?id=A519A56BC2BF44E4A008B33FCF527F61',
  commercial_use: true,
  attribution_text: 'BC Ministry of Environment and Parks',
  attribution_url: EMA_CATALOGUE_URL,
  notes: 'BC Data Catalogue resource all_ams_authorizations.xlsx (licence stated on the catalogue item, checked 2026-10-07). One source '
    + 'record per authorization row, cells exactly as stored. Dates are Excel serial days; longitude is listed without its minus sign.',
}
export const NRCED_SOURCE = {
  id: 'bc-nrced',
  name: 'BC Natural Resource Compliance and Enforcement Database (NRCED)',
  publisher: 'Government of British Columbia',
  homepage_url: 'https://nrced.gov.bc.ca/',
  license: CLEARED,
  license_url: null,
  commercial_use: false,
  attribution_text: 'BC NRCED',
  attribution_url: 'https://nrced.gov.bc.ca/',
  notes: `NRPTI public search API (${NRCED_API}, populate=true): one source record per NRCED record id. The search "score" field is dropped.`,
}
export const EAO_SOURCE = {
  id: 'bc-eao-epic',
  name: 'BC Environmental Assessment Office project information (EPIC)',
  publisher: 'BC Environmental Assessment Office',
  homepage_url: 'https://projects.eao.gov.bc.ca/',
  license: CLEARED,
  license_url: null,
  commercial_use: false,
  attribution_text: 'BC Environmental Assessment Office',
  attribution_url: 'https://projects.eao.gov.bc.ca/',
  notes: `EPIC public search API (${EAO_API}?dataset=Project). EAO staff names, emails and phones are dropped before storing.`,
}
export const BC_SOURCE_IDS = [BC_EMA_SOURCE.id, NRCED_SOURCE.id, EAO_SOURCE.id]

export async function ensureBcSources(c, S) {
  for (const s of [BC_EMA_SOURCE, NRCED_SOURCE, EAO_SOURCE, FACILITIES_LIST_SOURCE]) await upsertSource(c, S, s)
}

/** A BC entry of the facility data file: what it must carry. Returns error strings. */
export function validateBcEntry(f) {
  const errs = []
  if (!/^bc-[a-z0-9-]+$/.test(f.id || '')) errs.push(`bad id ${f.id}`)
  if (f.country !== 'CA') errs.push(`${f.id}: country must be CA`)
  if (!Number.isFinite(f.point?.lat) || !Number.isFinite(f.point?.lon) || !f.point?.from) errs.push(`${f.id}: point (lat, lon, from)`)
  const b = f.bc || {}
  // No accepted authorization is allowed only with an explicit "none found" note (bc.ema.none): never left silent.
  if (!Array.isArray(b.ema?.accepted) || (!b.ema.accepted.length && !b.ema.none)) errs.push(`${f.id}: bc.ema.accepted (or bc.ema.none)`)
  if (!(b.ema?.berths || []).length || b.ema.berths.some((x) => !Number.isFinite(x.lat) || !Number.isFinite(x.lon))) errs.push(`${f.id}: bc.ema.berths`)
  for (const a of [...(b.ema?.accepted || []), ...(b.ema?.left_out || [])]) if (!/^[A-Z]{0,4}\d+$/.test(String(a.id)) || !a.why) errs.push(`${f.id}: ema ${a.id} needs id + why`)
  if (!(b.nrced?.searches || []).length || !(b.nrced?.company_words || []).length || !(b.nrced?.place_words || []).length) errs.push(`${f.id}: bc.nrced rule`)
  if (!(b.eao?.searches || []).length) errs.push(`${f.id}: bc.eao.searches`)
  for (const p of [...(b.eao?.accepted || []), ...(b.eao?.candidates || [])]) if (!/^[0-9a-f]{24}$/.test(p.id || '') || !p.why) errs.push(`${f.id}: eao ${p.id} needs id + why`)
  return errs
}

// ── BC EMA authorizations register (xlsx) ────────────────────────────────────

/** Excel serial day → ISO date (1900 date system, serials after Feb 1900). '' / non-numbers → null. */
export function excelDate(v) {
  const n = Number(String(v ?? '').trim())
  if (!String(v ?? '').trim() || !Number.isFinite(n) || n < 61) return null
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10)
}

const trim = (s) => String(s ?? '').replace(/_x000D_/g, '').replace(/\s+/g, ' ').trim()

/**
 * One register row (an object keyed by the header text, as rowsToObjects gives it) → the fields EarthAtlas reads.
 * The row itself is the evidence and is stored unchanged; this is the reading of it. Longitude: the register lists west
 * longitudes without the minus sign (e.g. 122.954 for Burnaby), so a positive value is read as west.
 */
export function emaFields(o) {
  const lat = Number(o.Latitude), lonRaw = Number(o.Longitude)
  return {
    id: trim(o['Authorization Number']), type: trim(o['Authorization Type']), company: trim(o.Company),
    issued: excelDate(o['Issue Date']), expires: excelDate(o['Expiry Date']), waste: trim(o['Waste Type']) || null, state: trim(o.State) || null,
    industry: [trim(o['Primary BCENICID']), trim(o['Secondary BCENICID'])].filter(Boolean),
    regulation: trim(o['WDR Regulation']) || null, schedule: trim(o['WDR Schedule One or Two']) || null,
    regionalDistrict: trim(o['Regional District']) || null, municipality: trim(o['Nearest Municipality']) || null,
    facilityType: oncePhrase(trim(o['Facility Type - Description'])) || null, address: trim(o['Facility Address']) || null,
    lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lonRaw) ? (lonRaw > 0 ? -lonRaw : lonRaw) : null,
  }
}

/**
 * One authorization can fill several register rows (one per waste type, e.g. Air and Effluent). Its fields: the first row's,
 * with every row's waste type. rows = one row object or an array of them.
 */
export function emaFieldsAll(rows) {
  const list = Array.isArray(rows) ? rows : [rows]
  const e = emaFields(list[0])
  const wastes = [...new Set(list.map((o) => trim(o['Waste Type'])).filter(Boolean))]
  return { ...e, waste: wastes.join(', ') || null, rowCount: list.length }
}
/** The evidence payload for one authorization: the row itself, or { authorization, rows } when it has several. */
export const emaPayload = (rows) => (Array.isArray(rows) && rows.length > 1
  ? { authorization: trim(rows[0]['Authorization Number']), rows } : Array.isArray(rows) ? rows[0] : rows)

const R = 6371008.8, rad = Math.PI / 180
export const metres = (a, b) => {
  const x = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}
const hasWord = (text, w) => new RegExp(`(^|[^A-Za-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i').test(text || '')

/**
 * Authorizations to hand-check for a facility: every row within radius_m of a berth, or whose company names one of the
 * company words (anywhere in BC). Returns [{ ...fields, distance_m, near, company_word }] nearest first. Nothing is accepted
 * here: the data file names the accepted ids with their reasons.
 */
export function emaCandidates(objects, berths, companyWords, radiusM = 1000) {
  const out = []
  for (const o of objects) {
    const e = emaFields(o)
    const d = e.lat != null && e.lon != null ? Math.min(...berths.map((b) => metres(b, e))) : null
    const word = companyWords.find((w) => hasWord(e.company, w)) || null
    if ((d != null && d <= radiusM) || word) out.push({ ...e, distance_m: d == null ? null : Math.round(d), near: d != null && d <= radiusM, company_word: word })
  }
  return out.sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity))
}

// ── NRCED ─────────────────────────────────────────────────────────────────────

export const nrcedSearchUrl = (keywords, page = 0) =>
  `${NRCED_API}?dataset=${NRCED_DATASETS}&populate=true&keywords=${encodeURIComponent(keywords)}&pageSize=50&pageNum=${page}`

/** One search response → { total, records } (records without the search "score"). */
export function nrcedRecords(body) {
  const r = Array.isArray(body) ? body[0] : body
  if (!r || !Array.isArray(r.searchResults)) return { error: 'NRCED response has no searchResults' }
  const total = Number(r.meta?.[0]?.searchResultsTotal ?? r.searchResults.length)
  return { total, records: r.searchResults.map(({ score, ...rec }) => rec) }
}

/** "Authorization Number: 6819" in an NRIS inspection description (BC EMA authorization the inspection checked). */
export const nrcedAuthorization = (rec) => /Authorization Number:\s*([A-Z]{0,6}\d+)/.exec(rec?.description || '')?.[1] ?? null

/**
 * Does an NRCED record belong to the facility? accepted when the record is issued to the facility's company (company_words)
 * AND it names one of the facility's accepted EMA authorization numbers or its location names one of place_words.
 * Company only → candidate (kept, not shown). Neither → null (not stored: another party, e.g. a namesake elsewhere).
 */
export function nrcedMatch(f, rec, emaIds) {
  const rule = f.bc.nrced
  const holder = [rec.issuedTo?.companyName, rec.issuedTo?.fullName].filter(Boolean).join(' | ')
  const company = rule.company_words.find((w) => hasWord(holder, w)) || null
  const auth = nrcedAuthorization(rec)
  const authHit = auth && emaIds.includes(auth) ? auth : null
  const place = rule.place_words.find((w) => hasWord(rec.location, w)) || null
  const status = company && (authHit || place) ? 'accepted' : company ? 'candidate' : null
  return { status, why: { company_word: company, authorization: authHit, place_word: place } }
}

const AGENCY = { AGENCY_ENV: 'BC Ministry of Environment', AGENCY_EAO: 'BC Environmental Assessment Office', AGENCY_OGC: 'BC Energy Regulator' }

/** The fields the card / permit page show for one stored NRCED record. Names of people are not read (company records only). */
export function nrcedRow(rec) {
  const trigger = /Trigger or reason for inspection:\s*([^;]+)/.exec(rec.description || '')?.[1]?.trim() ?? null
  const leg = (rec.legislation || []).map((l) => [l.act, l.regulation, l.section && `s. ${l.section}${l.subSection ? `(${l.subSection})` : ''}`].filter(Boolean).join(' ')).filter(Boolean)
  return {
    id: rec._id, kind: rec.recordType || rec._schemaName, subtype: rec.recordSubtype || null, name: rec.recordName || null,
    date: rec.dateIssued ? String(rec.dateIssued).slice(0, 10) : null,
    agency: rec.author || AGENCY[rec.issuingAgency] || rec.issuingAgency || null,
    issuedTo: rec.issuedTo?.type === 'Company' ? (rec.issuedTo.companyName || rec.issuedTo.fullName || null) : null,
    location: trim(rec.location) || null, outcome: trim(rec.outcomeDescription) || null, trigger,
    authorization: nrcedAuthorization(rec), legislation: leg, project: rec.projectName || null,
    documents: (rec.documents || []).filter((d) => d && typeof d === 'object' && d.url).map((d) => ({ title: d.fileName || d.key || 'Document', url: d.url })),
  }
}

// ── BC EAO (EPIC) ─────────────────────────────────────────────────────────────

export const eaoSearchUrl = (keywords) => `${EAO_API}?dataset=Project&keywords=${encodeURIComponent(keywords)}&pageSize=50&pageNum=0`

const EAO_DROP = /Email|Phone|^CELead$|^projectLead|^responsibleEPD|^projLead$|^execProjectDirector$|^complianceLead$|^primaryContact$|^cac|^projectCAC|^addedBy$|^updatedBy$|^score$|^read$|^write$|^delete$/
/** One EPIC project with EAO staff contacts (names, emails, phones) and access lists dropped; everything else as received. */
export function eaoClean(p) {
  const out = {}
  for (const [k, v] of Object.entries(p || {})) {
    if (EAO_DROP.test(k)) continue
    if (k === 'proponent' && v && typeof v === 'object') {
      out[k] = Object.fromEntries(Object.entries(v).filter(([pk]) => !EAO_DROP.test(pk)))
    } else out[k] = v
  }
  return out
}

/** One search response → projects (cleaned). */
export function eaoProjects(body) {
  const r = Array.isArray(body) ? body[0] : body
  return (r?.searchResults || []).map(eaoClean)
}

/** The fields the card shows for one stored EPIC project. */
export function eaoRow(p) {
  return {
    id: p._id, name: p.name || null, proponent: p.proponent?.name || p.proponent?.company || null, location: trim(p.location) || null,
    decision: p.eacDecision?.name || null, decisionDate: p.decisionDate ? String(p.decisionDate).slice(0, 10) : null,
    phase: p.currentPhaseName?.name || null, act: p.legislation || null, federal: p.CEAAInvolvement?.name || null,
    federalUrl: p.CEAALink || null, description: trim(p.description) || null, url: EAO_PROJECT_PAGE(p._id),
  }
}

// ── Import ────────────────────────────────────────────────────────────────────

async function storeRecord(c, S, { sourceId, kind, key, payload, url, runId, version = null }) {
  const ent = await findOrCreateEntity(c, S, { sourceId, kind, anchor: key })
  const r = await upsertRecord(c, S, { sourceId, entityId: ent.id, payload, datasetVersion: version, retrievalUrl: url, runId })
  return { id: Number(r.id), created: r.created }
}

/**
 * raw = { ema: { url, retrieved_at, rows: Map(authorization number → register row object) },
 *         nrced: Map(facility id → [{ search, url, retrieved_at, total, records }]),
 *         eao: Map(facility id → [{ search, url, retrieved_at, projects }]) }
 * Only the BC entries (country CA) of data.facilities are imported. Idempotent.
 */
export async function importBcFacilities(c, S, data, raw, { runId = null, partial = false } = {}) {
  const facs = (data.facilities || []).filter((f) => f.country === 'CA')
  const errs = facs.flatMap(validateBcEntry)
  if (errs.length) throw new Error(`BC facility data invalid:\n  ${errs.join('\n  ')}`)
  const stats = { facilities: 0, ema: 0, nrcedAccepted: 0, nrcedCandidates: 0, nrcedIgnored: 0, eaoAccepted: 0, eaoCandidates: 0,
    documents: 0, recordsCreated: 0, problems: [] }
  const emaVersion = raw.ema?.retrieved_at?.slice(0, 10) ?? null
  for (const f of facs) {
    const entry = await storeRecord(c, S, { sourceId: FACILITIES_LIST_SOURCE.id, kind: 'facility_entry', key: f.id, payload: f, url: null, runId, version: data.version })
    stats.recordsCreated += entry.created ? 1 : 0
    const { rows: [fac] } = await c.query(
      `INSERT INTO ${S}.facilities (key, name, kind, country, admin_area, lat, lon, entry_source_record_id, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, country = EXCLUDED.country,
         admin_area = EXCLUDED.admin_area, lat = EXCLUDED.lat, lon = EXCLUDED.lon, list_status = 'listed',
         entry_source_record_id = EXCLUDED.entry_source_record_id, detail = EXCLUDED.detail, updated_at = now()
       RETURNING id`,
      [f.id, f.name, f.kind, f.country, f.admin_area ?? null, f.point.lat, f.point.lon, entry.id,
        { point_from: f.point.from, ema_left_out: f.bc.ema.left_out || [], ema_none: f.bc.ema.none ?? null, eao_none: f.bc.eao.none ?? null }])
    stats.facilities++
    const link = (role, sourceId, key, recId, status, method, detail = {}) => c.query(
      `INSERT INTO ${S}.facility_links (facility_id, role, source_id, entity_key, source_record_id, status, method, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (facility_id, role, source_id, entity_key) DO UPDATE SET source_record_id = EXCLUDED.source_record_id,
         status = CASE WHEN ${S}.facility_links.status = 'retired' THEN 'retired' ELSE EXCLUDED.status END,
         method = EXCLUDED.method, detail = EXCLUDED.detail, last_seen_at = now()`,
      [fac.id, role, sourceId, String(key), recId, status, method, detail])

    // EMA authorizations named in the entry: the register row is the evidence; the permit row holds its values.
    const permitIds = new Map()
    for (const a of f.bc.ema.accepted) {
      const row = raw.ema?.rows?.get(String(a.id))
      if (!row || (Array.isArray(row) && !row.length)) { stats.problems.push(`${f.id}: EMA authorization ${a.id} not in the register file`); continue }
      const e = emaFieldsAll(row)
      const rec = await storeRecord(c, S, { sourceId: BC_EMA_SOURCE.id, kind: 'ema_authorization', key: e.id, payload: emaPayload(row), url: raw.ema.url, runId, version: emaVersion })
      stats.recordsCreated += rec.created ? 1 : 0
      const { rows: [p] } = await c.query(
        `INSERT INTO ${S}.permits (epa_system, permit_key, statute, name, universe, areas, expires, program_status, frs_ids, source_record_id, detail)
         VALUES ('BC-EMA',$1,'BC EMA',$2,$3,$4,$5,$6,'{}',$7,$8)
         ON CONFLICT (epa_system, permit_key) DO UPDATE SET statute = EXCLUDED.statute, name = EXCLUDED.name, universe = EXCLUDED.universe,
           areas = EXCLUDED.areas, expires = EXCLUDED.expires, program_status = EXCLUDED.program_status, source_record_id = EXCLUDED.source_record_id,
           detail = ${S}.permits.detail || EXCLUDED.detail, last_seen_at = now()
         RETURNING id`,
        [e.id, e.company, e.type, e.waste, e.expires, e.state, rec.id,
          { bc_ema: { issued: e.issued, facility_type: e.facilityType, address: e.address, municipality: e.municipality,
            regional_district: e.regionalDistrict, industry: e.industry, regulation: e.regulation, schedule: e.schedule, lat: e.lat, lon: e.lon } }])
      permitIds.set(e.id, Number(p.id))
      await c.query(
        `INSERT INTO ${S}.facility_permits (facility_id, permit_id, method, source_record_id) VALUES ($1,$2,'bc_ema_curated',$3)
         ON CONFLICT (facility_id, permit_id) DO UPDATE SET source_record_id = EXCLUDED.source_record_id, last_seen_at = now()`,
        [fac.id, p.id, rec.id])
      await link('bc_ema_authorization', BC_EMA_SOURCE.id, e.id, rec.id, 'accepted', 'curated',
        { why: a.why, distance_m: e.lat != null ? Math.round(Math.min(...f.bc.ema.berths.map((b) => metres(b, e)))) : null })
      stats.ema++
    }

    // NRCED: every record the facility's searches returned, judged by nrcedMatch.
    const emaIds = f.bc.ema.accepted.map((a) => String(a.id))
    const seen = new Map()
    for (const s of raw.nrced?.get(f.id) || []) {
      for (const r of s.records) {
        if (!seen.has(r._id)) seen.set(r._id, { rec: r, searches: [], url: s.url, retrieved_at: s.retrieved_at })
        seen.get(r._id).searches.push(s.search)
      }
    }
    for (const { rec: r, searches, url, retrieved_at } of seen.values()) {
      const m = nrcedMatch(f, r, emaIds)
      if (!m.status) { stats.nrcedIgnored++; continue }
      const rec = await storeRecord(c, S, { sourceId: NRCED_SOURCE.id, kind: 'nrced_record', key: r._id, payload: r, url, runId, version: retrieved_at?.slice(0, 10) ?? null })
      stats.recordsCreated += rec.created ? 1 : 0
      await link('nrced_record', NRCED_SOURCE.id, r._id, rec.id, m.status, 'nrced_company_auth_place', { ...m.why, searches })
      stats[m.status === 'accepted' ? 'nrcedAccepted' : 'nrcedCandidates']++
      if (m.status !== 'accepted') continue
      // The record's files: linked to the EMA permit it inspected when it names one, else to the facility.
      const row = nrcedRow(r)
      for (const d of row.documents) {
        const { rows: [doc] } = await c.query(
          `INSERT INTO ${S}.documents (source_id, url, title, doc_type, description, doc_date, source_record_id, detail)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, doc_type = EXCLUDED.doc_type, description = EXCLUDED.description,
             doc_date = EXCLUDED.doc_date, source_record_id = EXCLUDED.source_record_id, status = 'listed', detail = EXCLUDED.detail, last_seen_at = now()
           RETURNING id`,
          [NRCED_SOURCE.id, d.url, d.title, row.kind, [row.outcome, row.trigger && `trigger: ${row.trigger}`].filter(Boolean).join('; ') || null,
            row.date, rec.id, { nrced_id: r._id }])
        const pid = row.authorization ? permitIds.get(row.authorization) : null
        if (pid) {
          await c.query(`INSERT INTO ${S}.document_links (document_id, permit_id, method, detail) VALUES ($1,$2,'nrced_authorization_number',$3)
                         ON CONFLICT (document_id, permit_id) WHERE permit_id IS NOT NULL DO UPDATE SET detail = EXCLUDED.detail, last_seen_at = now()`,
            [doc.id, pid, { authorization: row.authorization }])
        } else {
          await c.query(`INSERT INTO ${S}.document_links (document_id, facility_id, method, detail) VALUES ($1,$2,'nrced_facility',$3)
                         ON CONFLICT (document_id, facility_id) WHERE facility_id IS NOT NULL DO UPDATE SET detail = EXCLUDED.detail, last_seen_at = now()`,
            [doc.id, fac.id, { nrced_id: r._id }])
        }
        stats.documents++
      }
    }

    // EAO projects named in the entry (accepted = shown; candidates = kept, not shown).
    const projects = new Map()
    for (const s of raw.eao?.get(f.id) || []) for (const p of s.projects) if (!projects.has(p._id)) projects.set(p._id, { p, url: s.url, retrieved_at: s.retrieved_at })
    for (const [list, status] of [[f.bc.eao.accepted || [], 'accepted'], [f.bc.eao.candidates || [], 'candidate']]) {
      for (const a of list) {
        const got = projects.get(a.id)
        if (!got) { stats.problems.push(`${f.id}: EAO project ${a.id} not in the search results`); continue }
        const rec = await storeRecord(c, S, { sourceId: EAO_SOURCE.id, kind: 'eao_project', key: a.id, payload: got.p, url: got.url, runId, version: got.retrieved_at?.slice(0, 10) ?? null })
        stats.recordsCreated += rec.created ? 1 : 0
        await link('eao_project', EAO_SOURCE.id, a.id, rec.id, status, 'curated', { why: a.why, searches: f.bc.eao.searches })
        stats[status === 'accepted' ? 'eaoAccepted' : 'eaoCandidates']++
      }
    }

    for (const t of f.terminals || []) {
      const tk = typeof t === 'string' ? { key: t, relation: 'serves' } : t
      const { rows } = await c.query(`SELECT id FROM ${S}.terminals WHERE key = $1`, [tk.key])
      if (!rows.length) { stats.problems.push(`${f.id}: terminal ${tk.key} not in the database`); continue }
      await c.query(
        `INSERT INTO ${S}.terminal_facilities (terminal_id, facility_id, relation, entry_source_record_id, detail) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (terminal_id, facility_id, relation) DO UPDATE SET entry_source_record_id = EXCLUDED.entry_source_record_id,
           detail = EXCLUDED.detail, status = 'active', last_seen_at = now()`,
        [rows[0].id, fac.id, tk.relation, entry.id, { source_url: tk.source_url ?? null, says: tk.says ?? null }])
    }
  }
  // BC facilities no longer in the file are kept, marked withdrawn — only on a FULL run, and only BC (CA) ones.
  if (!partial) await c.query(`UPDATE ${S}.facilities SET list_status = 'withdrawn', updated_at = now()
                                WHERE country = 'CA' AND NOT (key = ANY($1)) AND list_status = 'listed'`, [facs.map((f) => f.id)])
  return stats
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** For one BC facility: accepted NRCED records (newest first), the candidate count, accepted EAO projects, EMA link reasons. */
export async function bcFacilityDetail(q, S, facilityId) {
  const links = await q(`SELECT l.role, l.entity_key, l.status, l.source_record_id, l.detail, sr.payload FROM ${S}.facility_links l
                           LEFT JOIN ${S}.source_records sr ON sr.id = l.source_record_id
                          WHERE l.facility_id = $1 AND l.role IN ('nrced_record', 'eao_project', 'bc_ema_authorization')`, [facilityId])
  const ok = (role) => links.filter((l) => l.role === role && l.status === 'accepted')
  return {
    nrced: ok('nrced_record').map((l) => ({ ...nrcedRow(l.payload || {}), record_id: Number(l.source_record_id), why: l.detail || {} }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    nrcedCandidates: links.filter((l) => l.role === 'nrced_record' && l.status === 'candidate').length,
    eao: ok('eao_project').map((l) => ({ ...eaoRow(l.payload || {}), record_id: Number(l.source_record_id), why: l.detail?.why ?? null })),
    eaoSearches: ok('eao_project')[0]?.detail?.searches ?? null,
    emaWhy: new Map(ok('bc_ema_authorization').map((l) => [l.entity_key, { why: l.detail?.why ?? null, distance_m: l.detail?.distance_m ?? null }])),
  }
}

/** NRCED records of the facilities that hold a BC EMA permit and that name that authorization: the permit page's rows. */
export async function nrcedForPermit(q, S, facilityIds, key) {
  if (!facilityIds.length) return []
  const rows = await q(`SELECT l.source_record_id, sr.payload FROM ${S}.facility_links l JOIN ${S}.source_records sr ON sr.id = l.source_record_id
                         WHERE l.facility_id = ANY($1::bigint[]) AND l.role = 'nrced_record' AND l.status = 'accepted'`, [facilityIds])
  return rows.map((r) => ({ ...nrcedRow(r.payload), record_id: Number(r.source_record_id) })).filter((r) => r.authorization === key)
    .map((r) => ({ kind: /inspection/i.test(r.kind) ? 'inspection' : 'nrced', source: 'nrced', date: r.date, type: r.trigger || r.kind,
      agency: r.agency, statute: 'BC EMA', result: r.outcome, legislation: r.legislation, record_id: r.record_id, nrcedId: r.id,
      documents: r.documents.map((d) => ({ title: d.title, url: d.url, what: /inspection/i.test(r.kind) ? 'Inspection record' : r.kind, docket: null, record_id: r.record_id })) }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
}
