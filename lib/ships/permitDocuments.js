/**
 * The documents behind each permit (layer 1: a list with links, nothing downloaded; Josh 2026-10-06). Migration 023;
 * sources in docs/PERMITS_SOURCES.md §5. Three listings, each stored as evidence (fields parsed from the page):
 *   - WA Ecology PARIS PermitDocumentSearch, per permit number (NPDES individual permits + stormwater coverages): every page.
 *   - WA Ecology Industrial Section facility page (current permits, support documents, penalty letters, related pages).
 *   - NWCAA Air Operating Permits page, the facility's row (AOP, Statement of Basis, OACs, Orders, PSDs, ...).
 * Which permit a document belongs to: PARIS by permit number; Ecology page by its "Permit information" labels
 * (wastewater → the facility's individual NPDES permit, hazardous / dangerous waste → the RCRA id the data file names); NWCAA by the
 * facility's location name → the ICIS-Air id named in the data file. Anything else on those pages is linked to the facility.
 */
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'

export const PARIS_BASE = 'https://apps.ecology.wa.gov/paris'
export const ECOLOGY_INDUSTRIAL_BASE = 'https://ecology.wa.gov/regulations-permits/permits-certifications/industrial-facilities-permits'
export const NWCAA_AOP_URL = 'https://nwcleanairwa.gov/resources/aop-page/'

export const PARIS_SOURCE = {
  id: 'wa-ecology-paris', name: 'WA Ecology PARIS (Water Quality Permitting and Reporting Information System)',
  publisher: 'Washington State Department of Ecology', homepage_url: `${PARIS_BASE}/PermitLookup.aspx`,
  license: 'Public agency record: cleared for EarthAtlas use by Josh 2026-10-06 (public agency records are treated as cleared; terms page not read). Credit and link.', license_url: null,
  commercial_use: false, attribution_text: 'WA Ecology PARIS', attribution_url: `${PARIS_BASE}/PermitLookup.aspx`,
  notes: 'PermitDocumentSearch.aspx?PermitNumber=<n>, every page (RadGrid postback). Document list only; files not downloaded.',
}
export const ECOLOGY_INDUSTRIAL_SOURCE = {
  id: 'wa-ecology-industrial', name: 'WA Ecology Industrial Section facility pages',
  publisher: 'Washington State Department of Ecology', homepage_url: ECOLOGY_INDUSTRIAL_BASE,
  license: 'Public agency record: cleared for EarthAtlas use by Josh 2026-10-06 (public agency records are treated as cleared; terms page not read). Credit and link.', license_url: null,
  commercial_use: false, attribution_text: 'WA Ecology Industrial Section', attribution_url: ECOLOGY_INDUSTRIAL_BASE,
  notes: 'One page per facility; the document links and the section / label each sits under.',
}
export const NWCAA_SOURCE = {
  id: 'nwcaa-aop', name: 'Northwest Clean Air Agency — Air Operating Permits',
  publisher: 'Northwest Clean Air Agency', homepage_url: NWCAA_AOP_URL,
  license: 'Public agency record: cleared for EarthAtlas use by Josh 2026-10-06 (public agency records are treated as cleared; terms page not read). Credit and link.', license_url: null,
  commercial_use: false, attribution_text: 'Northwest Clean Air Agency', attribution_url: NWCAA_AOP_URL,
  notes: 'One row per facility: permit date, status, emissions (t/yr) and the permit files. Contact names not stored.',
}
export async function ensureDocumentSources(c, S) {
  for (const s of [PARIS_SOURCE, ECOLOGY_INDUSTRIAL_SOURCE, NWCAA_SOURCE]) await upsertSource(c, S, s)
}

const decode = (s) => String(s ?? '')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, '’').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/\s+/g, ' ').trim()
const usDate = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim()); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null }

// ── PARIS ─────────────────────────────────────────────────────────────────────

export const parisDocsUrl = (permit) => `${PARIS_BASE}/PermitDocumentSearch.aspx?PermitNumber=${encodeURIComponent(permit)}`

const PARIS_COLS = ['facility', 'wq_name', 'permit', 'permit_status', 'permit_type', 'permit_version', 'city', 'county', 'public_notice_date', 'doc_type', 'document', 'program', 'description', 'region']

/** One PARIS document page: rows (one per document), the total the pager states, and the postback target of each page link. */
export function parseParisDocs(html) {
  const s = String(html)
  const rows = []
  for (const tr of s.match(/<tr class="rg(?:Alt)?Row"[\s\S]*?<\/tr>/g) || []) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1])
    if (cells.length < PARIS_COLS.length) continue
    const id = /DownloadDocument\.aspx\?id=(\d+)/.exec(tr)
    if (!id) continue
    const r = Object.fromEntries(PARIS_COLS.map((k, i) => [k, decode(cells[i])]))
    const bytes = /[?&;]bytes=(\d+)/.exec(tr)
    rows.push({
      doc_id: id[1], title: decode(/hyplnkdocument"[^>]*>([\s\S]*?)<\/a>/.exec(tr)?.[1] ?? r.document), permit: r.permit,
      permit_status: r.permit_status, permit_type: r.permit_type, permit_version: r.permit_version || null,
      public_notice_date: usDate(r.public_notice_date), doc_type: r.doc_type || null, description: r.description || null,
      size_bytes: bytes ? Number(bytes[1]) : null, url: `${PARIS_BASE}/DownloadDocument.aspx?id=${id[1]}`,
    })
  }
  const total = /<strong>(\d+)<\/strong>\s*items in/.exec(s)
  const pages = [...s.matchAll(/__doPostBack\(&#39;([^&]*RadGridPermitSearchResults\$ctl00\$ctl03\$ctl01\$ctl\d+)&#39;,&#39;&#39;\)"[^>]*>(?:<span>)?(\d+)/g)]
    .map((m) => ({ target: m[1], page: Number(m[2]) }))
  return { rows, total: total ? Number(total[1]) : rows.length, pages }
}

/** The form fields to post back for another page of the same grid. */
export function parisPostbackFields(html, target) {
  const f = {}
  for (const tag of String(html).match(/<input[^>]*>/g) || []) {
    const n = /name="([^"]+)"/.exec(tag)
    const t = /type="([^"]+)"/.exec(tag)?.[1]
    if (!n || ['submit', 'button', 'image', 'checkbox', 'radio'].includes(t)) continue
    f[n[1]] = (/value="([^"]*)"/.exec(tag)?.[1] ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  }
  f.__EVENTTARGET = target
  f.__EVENTARGUMENT = ''
  return f
}

// ── Ecology Industrial Section facility page ─────────────────────────────────

const DOC_URL = /fortress\.wa\.gov\/ecy|apps\.ecology\.wa\.gov\/(publications|cleanupsearch|paris)|\.pdf(\?|$)/i
// Site navigation that matches DOC_URL but is not about this facility.
const NAV_URL = /industrial\/Default\.aspx$|paris\/PermitLookup\.aspx$/i

/**
 * Document links on a facility page, in page order, each with the section it sits under (the h2/h3 or accordion title)
 * and, for a nested link such as "Support document", the label of the item it is nested in.
 */
export function parseEcologyPage(html) {
  const s = String(html)
  const start = Math.max(0, s.indexOf('<main'))
  const body = s.slice(start)
  const links = []
  let section = null
  const parents = [] // label of the first link in each open <li>
  const re = /<(h[23])[^>]*>([\s\S]*?)<\/\1>|<button[^>]*accordion-title[^>]*>([\s\S]*?)<\/button>|<li[^>]*>|<\/li>|<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  for (const m of body.matchAll(re)) {
    if (m[1]) { section = decode(m[2]); continue }
    if (m[3] != null) { section = decode(m[3]); continue }
    if (m[0].startsWith('<li')) { parents.push(null); continue }
    if (m[0] === '</li>') { parents.pop(); continue }
    const url = m[4].startsWith('/') ? `https://ecology.wa.gov${m[4]}` : m[4]
    const label = decode(m[5])
    if (!DOC_URL.test(url) || NAV_URL.test(url) || !label) continue
    const parent = parents.length > 1 ? parents.slice(0, -1).reverse().find(Boolean) ?? null : null
    if (parents.length && parents[parents.length - 1] == null) parents[parents.length - 1] = label
    if (!links.some((l) => l.url === url)) links.push({ url, label, section, parent })
  }
  return links
}

/** Which permit an Ecology page link belongs to: 'npdes' / 'rcra' (Permit information section) or null (the facility). */
export function ecologyPermitKind(link) {
  if (!/permit information/i.test(link.section || '')) return null
  const label = /support document/i.test(link.label) && link.parent ? link.parent : link.label
  if (/wastewater|water quality|npdes/i.test(label)) return 'npdes'
  if (/hazardous|dangerous/i.test(label)) return 'rcra'
  return null
}

// ── NWCAA Air Operating Permits page ─────────────────────────────────────────

const NWCAA_FILE_WORDS = {
  AOP: 'Air Operating Permit (Title V)', SOB: 'Statement of Basis', OACs: 'Orders of Approval to Construct (new source review)',
  Orders: 'Orders', PSDs: 'PSD permits (Prevention of Significant Deterioration)', MISC: 'Miscellaneous', BART: 'Best Available Retrofit Technology',
  CD: 'Consent decree', 'Renewal Application': 'Renewal application',
}

/** The row whose first cell is `location`: permit date, status, emissions and files. Contact name not kept. */
export function parseNwcaaRow(html, location) {
  const s = String(html)
  for (const tr of s.match(/<tr>[\s\S]*?<\/tr>/g) || []) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1])
    if (cells.length < 11 || decode(cells[0]) !== location) continue
    const n = (x) => { const v = Number(decode(x).replace(/,/g, '')); return Number.isFinite(v) ? v : null }
    return {
      location, permit_date: decode(cells[1]), permit_status: decode(cells[2]),
      emissions_tpy: { pm10: n(cells[4]), so2: n(cells[5]), no2: n(cells[6]), voc: n(cells[7]), co: n(cells[8]), co2: n(cells[9]) },
      files: [...cells[10].matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ url: m[1], label: decode(m[2]), what: NWCAA_FILE_WORDS[decode(m[2])] ?? null })),
    }
  }
  return null
}

const monthDate = (s) => { const d = new Date(`${String(s).replace(/\./g, '')} UTC`); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) }

// ── Import ────────────────────────────────────────────────────────────────────

async function storeListing(c, S, { sourceId, kind, key, payload, url, runId, version }) {
  const ent = await findOrCreateEntity(c, S, { sourceId, kind, anchor: key })
  const r = await upsertRecord(c, S, { sourceId, entityId: ent.id, payload, datasetVersion: version, retrievalUrl: url, runId })
  return { id: Number(r.id), created: r.created }
}

async function upsertDocument(c, S, d) {
  const { rows: [r] } = await c.query(
    `INSERT INTO ${S}.documents (source_id, url, title, doc_type, description, doc_date, size_bytes, source_record_id, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, doc_type = EXCLUDED.doc_type, description = EXCLUDED.description,
       doc_date = EXCLUDED.doc_date, size_bytes = EXCLUDED.size_bytes, source_record_id = EXCLUDED.source_record_id,
       detail = EXCLUDED.detail, status = 'listed', last_seen_at = now()
     RETURNING id`,
    [d.source_id, d.url, d.title, d.doc_type ?? null, d.description ?? null, d.doc_date ?? null, d.size_bytes ?? null, d.source_record_id, d.detail ?? {}])
  return Number(r.id)
}
async function linkDocument(c, S, docId, { permitId = null, facilityId = null, method, detail = {} }) {
  const conflict = permitId != null ? '(document_id, permit_id) WHERE permit_id IS NOT NULL' : '(document_id, facility_id) WHERE facility_id IS NOT NULL'
  await c.query(
    `INSERT INTO ${S}.document_links (document_id, permit_id, facility_id, method, detail) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT ${conflict} DO UPDATE SET method = EXCLUDED.method, detail = EXCLUDED.detail, last_seen_at = now()`,
    [docId, permitId, facilityId, method, detail])
}

/**
 * raw = { paris: Map(permitNumber → { url, retrieved_at, rows, total }), ecology: Map(slug → { url, retrieved_at, links }),
 *         nwcaa: { url, retrieved_at, rows: Map(location → row) } }
 * Facilities and permits must already be imported (importFacilities).
 */
export async function importPermitDocuments(c, S, data, raw, { runId = null } = {}) {
  const stats = { listings: 0, documents: 0, links: 0, problems: [] }
  const permitId = async (system, key) => (await c.query(`SELECT id FROM ${S}.permits WHERE epa_system = $1 AND permit_key = $2`, [system, key])).rows[0]?.id ?? null
  for (const f of data.facilities) {
    const { rows: [fac] } = await c.query(`SELECT id FROM ${S}.facilities WHERE key = $1`, [f.id])
    if (!fac) { stats.problems.push(`${f.id}: facility not imported`); continue }
    const { rows: permits } = await c.query(
      `SELECT id, epa_system, permit_key, universe FROM ${S}.permits WHERE frs_ids && $1::text[]`, [[f.frs_primary, ...(f.frs_related || []).map((r) => r.id)]])
    // PARIS: every NPDES permit / coverage ECHO lists for the facility.
    for (const p of permits.filter((x) => x.epa_system === 'ICIS-NPDES')) {
      const page = raw.paris.get(p.permit_key)
      if (!page) { if (!raw.parisCovered?.has(p.permit_key)) stats.problems.push(`${f.id}: PARIS ${p.permit_key} not fetched`); continue }
      if (page.rows.length !== page.total) stats.problems.push(`${f.id}: PARIS ${p.permit_key}: ${page.rows.length} of ${page.total} documents read`)
      const rec = await storeListing(c, S, { sourceId: PARIS_SOURCE.id, kind: 'paris_permit_documents', key: p.permit_key,
        payload: { permit: p.permit_key, total: page.total, rows: page.rows }, url: page.url, runId, version: page.retrieved_at?.slice(0, 10) })
      stats.listings++
      for (const r of page.rows) {
        if (r.permit !== p.permit_key) continue
        const id = await upsertDocument(c, S, { source_id: PARIS_SOURCE.id, url: r.url, title: r.title, doc_type: r.doc_type,
          description: r.description, doc_date: r.public_notice_date, size_bytes: r.size_bytes, source_record_id: rec.id,
          detail: { permit_status: r.permit_status, permit_version: r.permit_version, permit_type: r.permit_type } })
        await linkDocument(c, S, id, { permitId: p.id, method: 'paris_permit_number' })
        stats.documents++; stats.links++
      }
    }
    // Ecology Industrial Section page.
    const eco = f.documents?.ecology_page && raw.ecology.get(f.documents.ecology_page)
    if (f.documents?.ecology_page && !eco) stats.problems.push(`${f.id}: Ecology page ${f.documents.ecology_page} not fetched`)
    if (eco) {
      const rec = await storeListing(c, S, { sourceId: ECOLOGY_INDUSTRIAL_SOURCE.id, kind: 'ecology_facility_page', key: f.documents.ecology_page,
        payload: { slug: f.documents.ecology_page, links: eco.links }, url: eco.url, runId, version: eco.retrieved_at?.slice(0, 10) })
      stats.listings++
      // The facility's individual water permit: EPA's NPDES one, or else a state individual permit listed on its PARIS page.
      const { rows: statePermits } = await c.query(`SELECT p.id, p.epa_system, p.permit_key, p.universe FROM ${S}.facility_permits fp
                                                     JOIN ${S}.permits p ON p.id = fp.permit_id WHERE fp.facility_id = $1 AND p.epa_system = 'WA-PARIS'`, [fac.id])
      const npdes = permits.find((x) => x.epa_system === 'ICIS-NPDES' && /Individual Permit/i.test(x.universe || ''))
        ?? statePermits.find((x) => /\bIP\b/.test(x.universe || ''))
      const rcra = permits.find((x) => x.epa_system === 'RCRAInfo' && x.permit_key === f.documents.rcra)
      for (const l of eco.links) {
        const title = /support document/i.test(l.label) && l.parent ? `${l.parent}: support document` : l.label
        const kind = ecologyPermitKind(l)
        const id = await upsertDocument(c, S, { source_id: ECOLOGY_INDUSTRIAL_SOURCE.id, url: l.url, title, doc_type: l.section,
          description: kind ? `Current version, linked from Ecology’s ${f.documents.ecology_page} page` : l.section,
          source_record_id: rec.id, detail: { label: l.label, parent: l.parent, section: l.section } })
        const target = kind === 'npdes' ? npdes : kind === 'rcra' ? rcra : null
        if (kind && !target) stats.problems.push(`${f.id}: Ecology page "${l.label}" names a ${kind} permit not found for this facility; linked to the facility`)
        await linkDocument(c, S, id, target ? { permitId: target.id, method: 'ecology_page_section', detail: { kind } }
          : { facilityId: fac.id, method: 'ecology_page_other' })
        stats.documents++; stats.links++
      }
    }
    // NWCAA: the facility's row → the ICIS-Air record named in the data file.
    const nw = f.documents?.nwcaa
    if (nw) {
      const row = raw.nwcaa?.rows.get(nw.location)
      if (!row) { stats.problems.push(`${f.id}: NWCAA row "${nw.location}" not found`) } else {
        const rec = await storeListing(c, S, { sourceId: NWCAA_SOURCE.id, kind: 'nwcaa_aop_row', key: nw.location, payload: row,
          url: raw.nwcaa.url, runId, version: raw.nwcaa.retrieved_at?.slice(0, 10) })
        stats.listings++
        const pid = await permitId('ICIS-Air', nw.icis_air)
        if (!pid) stats.problems.push(`${f.id}: ICIS-Air ${nw.icis_air} not among the permits; NWCAA files linked to the facility`)
        for (const file of row.files) {
          const id = await upsertDocument(c, S, { source_id: NWCAA_SOURCE.id, url: file.url, title: file.what ? `${file.what} (${file.label})` : file.label,
            doc_type: file.label, description: file.label === 'AOP' ? `Air Operating Permit ${nw.aop}; permit date ${row.permit_date}; ${row.permit_status}` : null,
            doc_date: file.label === 'AOP' ? monthDate(row.permit_date) : null, source_record_id: rec.id, detail: { aop: nw.aop } })
          await linkDocument(c, S, id, pid ? { permitId: pid, method: 'nwcaa_location', detail: { location: nw.location, aop: nw.aop } }
            : { facilityId: fac.id, method: 'nwcaa_location', detail: { location: nw.location } })
          stats.documents++; stats.links++
        }
      }
    }
  }
  return stats
}

/** Documents for a set of permits and facilities, grouped: { byPermit: Map(permitId → docs), byFacility: Map(facilityId → docs) }. */
export async function documentsFor(q, S, permitIds, facilityIds) {
  const rows = await q(`SELECT l.permit_id, l.facility_id, l.method, l.detail AS link_detail, d.id, d.source_id, d.url, d.title, d.doc_type,
                               d.description, d.doc_date, d.size_bytes, d.source_record_id, d.detail
                          FROM ${S}.document_links l JOIN ${S}.documents d ON d.id = l.document_id
                         WHERE d.status = 'listed' AND (l.permit_id = ANY($1::bigint[]) OR l.facility_id = ANY($2::bigint[]))
                         ORDER BY CASE WHEN d.detail->>'permit_version' ~ '^\\d+$' THEN (d.detail->>'permit_version')::int END DESC NULLS LAST,
                                  d.doc_date DESC NULLS LAST, d.title DESC`, [permitIds, facilityIds])
  const byPermit = new Map(), byFacility = new Map()
  for (const r of rows) {
    const doc = { id: Number(r.id), source: r.source_id, url: r.url, title: r.title, type: r.doc_type, description: r.description,
      date: r.doc_date instanceof Date ? r.doc_date.toISOString().slice(0, 10) : r.doc_date, size: r.size_bytes == null ? null : Number(r.size_bytes),
      record_id: Number(r.source_record_id), method: r.method, permitVersion: r.detail?.permit_version ?? null, permitStatus: r.detail?.permit_status ?? null }
    const m = r.permit_id != null ? byPermit : byFacility
    const k = Number(r.permit_id ?? r.facility_id)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(doc)
  }
  return { byPermit, byFacility }
}

// ── PARIS by facility (FacilityDetails.aspx; Josh 2026-10-06) ────────────────

export const parisFacilityUrl = (id) => `${PARIS_BASE}/FacilityDetails.aspx?FacilityId=${encodeURIComponent(id)}`
const gridRows = (s, id) => {
  const i = s.indexOf(`id="ContentPlaceHolder1_${id}"`)
  if (i < 0) return []
  const end = s.indexOf('</table>', i)
  return (s.slice(i, end).match(/<tr[\s\S]*?<\/tr>/g) || []).filter((r) => !/<th/.test(r))
}
const cellsOf = (tr) => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1])

/**
 * One FacilityDetails page: the facility's name / address / point, every permit version (issue, effective, expiration;
 * author and contact names are not kept), the current page of its documents, and the postback targets of the document
 * pager ('Page$N'). Documents are all kinds PARIS files: permit documents, inspection reports, submittals, enforcement.
 */
export function parseParisFacility(html) {
  const s = String(html)
  const span = (id) => decode(new RegExp(`id="ContentPlaceHolder1_${id}"[^>]*>([\\s\\S]*?)</span>`).exec(s)?.[1] ?? '') || null
  const permits = gridRows(s, 'GridViewPermits').map(cellsOf).filter((c) => c.length >= 11).map((c) => ({
    wq_name: decode(c[0]), type: decode(c[1]), permit: decode(c[2]), version: decode(c[3]), status: decode(c[4]), sub_status: decode(c[5]),
    facility_status: decode(c[6]), issued: usDate(decode(c[8])), effective: usDate(decode(c[9])), expires: usDate(decode(c[10])),
  }))
  const documents = gridRows(s, 'GridViewDocuments').map((tr) => {
    const c = cellsOf(tr)
    const id = /DownloadDocument\.aspx\?id=(\d+)/.exec(tr)
    if (!id || c.length < 8) return null
    return { doc_id: id[1], permit: decode(c[0]), permit_status: decode(c[1]), permit_type: decode(c[2]), permit_version: decode(c[3]) || null,
      title: decode(/DownloadDocument[^>]*>([\s\S]*?)<\/a>/.exec(c[4])?.[1] ?? ''), doc_type: decode(c[5]) || null,
      public_notice: decode(c[6]) || null, description: decode(c[7]) || null, url: `${PARIS_BASE}/DownloadDocument.aspx?id=${id[1]}` }
  }).filter(Boolean)
  const pagerOf = (grid) => [...s.matchAll(new RegExp(`__doPostBack\\(&#39;(ctl00\\$ContentPlaceHolder1\\$${grid})&#39;,&#39;Page\\$(\\d+)&#39;\\)`, 'g'))]
    .map((m) => ({ target: m[1], arg: `Page$${m[2]}`, page: Number(m[2]) }))
  const pages = pagerOf('GridViewDocuments')
  const lat = /"LatitudeDecimal":(-?[\d.]+)/.exec(s), lon = /"LongitudeDecimal":(-?[\d.]+)/.exec(s)
  return { name: span('lblFacilityNameHeader'), address: span('lblAddressValue'), lat: lat ? Number(lat[1]) : null,
    lon: lon ? Number(lon[1]) : null, permits, documents, pages,
    violations: parseParisViolations(s), violationPages: pagerOf('GridViewViolations'),
    enforcements: parseParisEnforcements(s), inspections: parseParisInspections(s) }
}

const num = (x) => { const v = Number(String(x).replace(/,/g, '')); return x !== '' && Number.isFinite(v) ? v : null }

/** PARIS violations grid (one page): what was exceeded or missed, when, the value and the limit, and whether it was addressed. */
export function parseParisViolations(html) {
  return gridRows(String(html), 'GridViewViolations').map(cellsOf).filter((c) => c.length >= 18).map((c) => {
    const v = c.map(decode)
    return { permit: v[0], violation: v[1], date: usDate(v[2]), parameter: v[3] || null, units: v[4] || null, fraction: v[5] || null,
      addressed: v[6] || null, point: v[7] || null, value: num(v[8]), benchmark_min: num(v[9]), benchmark_max: num(v[10]), design: num(v[11]),
      min_limit: num(v[12]), category: v[13] || null, max_limit: num(v[14]), event: v[15] || null, due: usDate(v[16]), complied: usDate(v[17]) }
  })
}
/** PARIS enforcement grid: action type, status, issued date (facility-wide; PARIS gives no permit number here). */
export function parseParisEnforcements(html) {
  return gridRows(String(html), 'GridViewEnforcements').map(cellsOf).filter((c) => c.length >= 3)
    .map((c) => ({ type: decode(c[0]), status: decode(c[1]) || null, date: usDate(decode(c[2])) }))
}
/** PARIS inspections grid: permit, type, status, announced, dates, PARIS inspection id. Inspector and staff names not kept. */
export function parseParisInspections(html) {
  return gridRows(String(html), 'GridViewInspections').map(cellsOf).filter((c) => c.length >= 14).map((c) => {
    const v = c.map(decode)
    return { permit: v[0], type: v[1] || null, status: v[2] || null, announced: v[3] || null, scheduled: usDate(v[4]), start: usDate(v[5]), id: v[13] || null }
  })
}

/** Form fields for a GridView page postback (target + 'Page$N'). */
export function gridPostbackFields(html, target, arg) {
  const f = parisPostbackFields(html, target)
  f.__EVENTARGUMENT = arg
  return f
}

/** The permit's newest PARIS version (highest number) and every version's dates, as listed. */
export function parisVersions(permits, permit) {
  const vs = permits.filter((p) => p.permit === permit).sort((a, b) => Number(b.version) - Number(a.version))
  // Current = the newest ACTIVE version (a draft renewal in public comment is not in force); else the newest.
  return { current: vs.find((v) => /^active$/i.test(v.status)) ?? vs[0] ?? null, draft: vs.find((v) => /^draft$/i.test(v.status)) ?? null, versions: vs.map(({ version, status, sub_status, issued, effective, expires, type, wq_name }) =>
    ({ version, status, sub_status, issued, effective, expires, type, name: wq_name })) }
}

const firstDate = (...xs) => { for (const x of xs) { const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(x || ''); if (m) return usDate(m[0]) } return null }

/**
 * PARIS by facility. raw.parisFac = Map(FacilityId → { url, retrieved_at, page: parseParisFacility() with documents from
 * every page }). For each facility's PARIS ids: store the listing, link the facility to it, give every listed permit its
 * PARIS versions (a permit ECHO doesn't list, e.g. a state-only ST permit, is added as system 'WA-PARIS'), and list every
 * document under its permit. Run after importFacilities (needs the facilities and ECHO permits).
 */
export async function importParisFacilities(c, S, data, raw, { runId = null } = {}) {
  const stats = { listings: 0, permitsAdded: 0, permitsLinked: 0, documents: 0, problems: [] }
  for (const f of data.facilities) {
    const { rows: [fac] } = await c.query(`SELECT id FROM ${S}.facilities WHERE key = $1`, [f.id])
    if (!fac) { stats.problems.push(`${f.id}: facility not imported`); continue }
    for (const pid of f.paris_facility_ids || []) {
      const got = raw.parisFac?.get(pid)
      if (!got) { stats.problems.push(`${f.id}: PARIS facility ${pid} not fetched`); continue }
      const pg = got.page
      const rec = await storeListing(c, S, { sourceId: PARIS_SOURCE.id, kind: 'paris_facility_details', key: pid,
        payload: { facility_id: pid, name: pg.name, address: pg.address, lat: pg.lat, lon: pg.lon, permits: pg.permits, documents: pg.documents,
          violations: pg.violations || [], enforcements: pg.enforcements || [], inspections: pg.inspections || [] },
        url: got.url, runId, version: got.retrieved_at?.slice(0, 10) })
      stats.listings++
      await c.query(
        `INSERT INTO ${S}.facility_links (facility_id, role, source_id, entity_key, source_record_id, status, method, detail)
         VALUES ($1,'paris_facility',$2,$3,$4,'accepted','curated',$5)
         ON CONFLICT (facility_id, role, source_id, entity_key) DO UPDATE SET source_record_id = EXCLUDED.source_record_id, detail = EXCLUDED.detail, last_seen_at = now()`,
        [fac.id, PARIS_SOURCE.id, pid, rec.id, { name: pg.name, address: pg.address }])
      const permitIds = new Map()
      for (const key of [...new Set(pg.permits.map((x) => x.permit))]) {
        const v = parisVersions(pg.permits, key)
        const paris = { facility_id: pid, current: v.current, draft: v.draft, versions: v.versions }
        const { rows: existing } = await c.query(`SELECT id FROM ${S}.permits WHERE permit_key = $1 ORDER BY epa_system`, [key])
        let id
        if (existing.length) {
          id = Number(existing[0].id)
          await c.query(`UPDATE ${S}.permits SET detail = detail || jsonb_build_object('paris', $2::jsonb), last_seen_at = now() WHERE id = $1`, [id, paris])
        } else {
          const cur = v.current
          const status = cur ? `${cur.status}${cur.sub_status && cur.sub_status !== cur.status ? ` (${cur.sub_status})` : ''}` : null
          const { rows: [r] } = await c.query(
            `INSERT INTO ${S}.permits (epa_system, permit_key, statute, name, universe, expires, program_status, frs_ids, source_record_id, detail)
             VALUES ('WA-PARIS',$1,'State',$2,$3,$4,$5,'{}',$6,$7)
             ON CONFLICT (epa_system, permit_key) DO UPDATE SET name = EXCLUDED.name, universe = EXCLUDED.universe, expires = EXCLUDED.expires,
               program_status = EXCLUDED.program_status, source_record_id = EXCLUDED.source_record_id, detail = EXCLUDED.detail, last_seen_at = now()
             RETURNING id, (xmax = 0) AS created`,
            [key, cur?.name ?? pg.name, cur?.type ?? null, cur?.expires ?? null, status, rec.id, { paris }])
          id = Number(r.id)
          if (r.created) stats.permitsAdded++
        }
        permitIds.set(key, id)
        await c.query(
          `INSERT INTO ${S}.facility_permits (facility_id, permit_id, method, source_record_id) VALUES ($1,$2,'paris_facility',$3)
           ON CONFLICT (facility_id, permit_id) DO UPDATE SET source_record_id = EXCLUDED.source_record_id, last_seen_at = now()`, [fac.id, id, rec.id])
        stats.permitsLinked++
      }
      for (const d of pg.documents) {
        const pidFor = permitIds.get(d.permit)
        const id = await upsertDocument(c, S, { source_id: PARIS_SOURCE.id, url: d.url, title: d.title, doc_type: d.doc_type,
          description: d.description, doc_date: firstDate(d.description, d.public_notice), source_record_id: rec.id,
          detail: { permit_version: d.permit_version, permit_status: d.permit_status, permit_type: d.permit_type, paris_facility_id: pid } })
        await linkDocument(c, S, id, pidFor ? { permitId: pidFor, method: 'paris_facility' } : { facilityId: fac.id, method: 'paris_facility' })
        stats.documents++
      }
    }
  }
  return stats
}
