/**
 * Canada Energy Regulator (CER) records for the Westridge Marine Terminal (facility bc-westridge-marine-terminal). DEV 2026-10-07;
 * study docs/PERMITS_SOURCES_BC.md ("Canada Energy Regulator (CER): Westridge"). Rules: src/ships/CLAUDE.md.
 *
 *   evidence        one CER open-data row (or row group) per record, from the cached CSVs in scripts/ships/facilities/cache/cer/
 *                   (source 'cer-open-data', Open Government Licence – Canada): kind cer_cva (a compliance verification activity +
 *                   its Westridge findings), cer_incident, cer_condition, cer_om, cer_contamination; and one inspection officer
 *                   order page (source 'cer-orders', kind cer_order: url, hash, html, text)
 *   claim           those records, values as CER publishes them
 *   interpretation  facility_links role 'cer_record' (migration 033), entity_key '<kind>:<id>', accepted (shown) or candidate
 *                   (kept, not shown), with the matching rule's reason in detail
 *
 * MATCHING RULE (written down; lib/ships/test/cer.test.js checks it):
 *   - A record belongs to Westridge when its OWN facility field names it: compliance activities `Facilities`, incidents and
 *     O&M and contamination `Facility Name` contain "WESTRIDGE" (CER's facility name for the terminal is "WESTRIDGE MARINE
 *     TERMINAL", or "WESTRIDGE [Westridge Delivery Line]" for the terminal's delivery line facility).
 *   - An incident with no facility name counts when Trans Mountain reported it and its own point (8 decimals) is within 300 m of
 *     the berth.
 *   - Otherwise coordinates never decide it: CER rounds compliance-activity coordinates to 0.01° (about 1 km), so a Trans Mountain
 *     activity near the terminal whose facility field does not name Westridge is kept as a hidden candidate.
 *   - A non-compliance finding of a Westridge activity is Westridge's when its `Selected Facilities` names Westridge, or is empty
 *     and the activity's only facility is Westridge. Exact duplicate rows are counted once.
 *   - A record that names Westridge only in a pipeline field ("Westridge Delivery Line" as `Pipeline Name`) or in free text is a
 *     hidden candidate: it is about the pipeline, not the dock.
 *   - Conditions (TMX, MH-052-2018, and the s.58 Westridge Delivery Line relocation) never have a facility field: a condition is
 *     shown when its text names Westridge AND its title (the condition's bold heading) names Westridge, tankers, vessels, berths,
 *     docks, the marine terminal or Burrard Inlet. Pipeline-wide conditions that merely list Westridge are hidden candidates.
 *   - Inspection officer orders (web pages, not open data) are added by hand in ORDERS below, each naming Westridge in its text.
 */
import { createHash } from 'node:crypto'
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'
import { parseCsv } from './terminals.js'

/** Cache file stem for one CER web page. */
export const cerPageName = (url) => `page-${createHash('sha1').update(String(url)).digest('hex').slice(0, 16)}`

export const CER_DATASETS = {
  cva: { file: 'compliance-activities.csv', id: '1462ab8d-ce91-49ab-8202-406877061267', title: 'CER Compliance Activities' },
  nc: { file: 'non-compliances.csv', id: '6c716550-77af-446c-a30e-e5ad7edda9e2', title: 'CER Non-Compliances' },
  incident: { file: 'pipeline-incidents-comprehensive-data.csv', id: '7dffedc4-23fa-440c-a36d-adf5a6cc09f1', title: 'CER Pipeline Incident Data' },
  condition: { file: 'conditions.csv', id: 'e8402029-2543-4300-bf6a-81a788a08f70', title: 'CER Conditions' },
  om: { file: 'operation-and-maintenance-activity.csv', id: '1c47ebcc-17fd-4954-811f-3cdd0c30bf86', title: 'CER Operations and Maintenance Activities' },
  contamination: { file: 'contamination.csv', id: '715015f0-0cf7-4dca-92d3-9b808e6efba6', title: 'CER Notice of Contamination' },
  instruments: { file: 'regulatory-instruments.csv', id: '5b137b2a-d196-44ca-96fe-e9e33f847594', title: 'CER Regulatory Instruments' },
}
export const datasetUrl = (k) => `https://open.canada.ca/data/en/dataset/${CER_DATASETS[k].id}`
export const regdocsUrl = (n) => `https://apps.cer-rec.gc.ca/REGDOCS/Item/Filing/${encodeURIComponent(n)}`

export const CER_SOURCE = {
  id: 'cer-open-data',
  name: 'Canada Energy Regulator open data (compliance activities, non-compliances, incidents, conditions, O&M, contamination)',
  publisher: 'Canada Energy Regulator',
  homepage_url: 'https://open.canada.ca/data/en/organization/cer-rec',
  license: 'Open Government Licence - Canada',
  license_url: 'https://open.canada.ca/en/open-government-licence-canada',
  commercial_use: true,
  attribution_text: 'Canada Energy Regulator',
  attribution_url: 'https://open.canada.ca/data/en/organization/cer-rec',
  notes: 'CSV files from www.cer-rec.gc.ca/open/ (datasets on open.canada.ca), downloaded once 2026-10-07; some are Windows-1252. '
    + 'One source record per matched record (row or row group), cells exactly as in the file.',
}
export const CER_ORDERS_SOURCE = {
  id: 'cer-orders',
  name: 'Canada Energy Regulator inspection officer orders',
  publisher: 'Canada Energy Regulator',
  homepage_url: 'https://www.cer-rec.gc.ca/en/safety-environment/industry-performance/reports-compliance-enforcement/',
  license: 'Public agency record (Canada Energy Regulator): cleared for EarthAtlas use by Josh 2026-10-06 (public agency records are treated as cleared; terms page not read). Credit and link.',
  license_url: null,
  commercial_use: false,
  attribution_text: 'Canada Energy Regulator',
  attribution_url: 'https://www.cer-rec.gc.ca/en/safety-environment/industry-performance/reports-compliance-enforcement/',
  notes: 'Order pages found by public web search and read once; stored with their hash. Found 2026-10-07: BL-001-2023 (+ variance, notice of measures satisfied), LH-001-2020.',
}

const ORDER_BASE = 'https://cer-rec.gc.ca/en/safety-environment/industry-performance/reports-compliance-enforcement/inspection-officer-order'
/** Inspection officer orders that name Westridge in their own text (hand-checked; the quote is checked against the stored page). */
export const ORDERS = [
  { id: 'BL-001-2023', date: '2023-11-22', cva: 'CV2324-102', url: `${ORDER_BASE}/2023/bl-001-2023/inspection-officer-order-bl-001-2023.html`,
    about: 'Safety headwear (hard hats and chin straps) for work at the Burnaby Terminal and the Westridge Marine Terminal',
    says: 'the CER observed workers operating a Utility Terrain Vehicle (UTV) at the Westridge Marine Terminal while wearing headwear with no chin straps',
    related: [
      { title: 'Variance of the order (VAR-001-BL-001-2023)', url: `${ORDER_BASE}/2023/bl-001-2023/variance-inspection-officer-order-bl-001-2023.html` },
      { title: 'Notice: measures satisfied (2024-01-09)', url: `${ORDER_BASE}/2023/bl-001-2023/notice-resume-work-measures-satisfied-bl-001-2023.html` },
    ] },
  { id: 'LH-001-2020', date: '2020-12-03', cva: null, url: `${ORDER_BASE}/2020/lh-001-2020/lh-001-2020.html`,
    about: 'COVID-19 protocol non-compliances observed at the Westridge Marine Terminal, the Burnaby Terminal and Spread 7 of the expansion project',
    says: 'Westridge Marine Terminal and related TIS with a workforce of ~230 on 1 Dec 2020', related: [] },
]

// Windows-1252 bytes 0x80–0x9F (Node's 'windows-1252' decoder reads them as Latin-1 control characters).
const CP1252 = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹',
  0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š',
  0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' }
export const decodeCp1252 = (buf) => Buffer.from(buf).toString('latin1').replace(/[\u0080-\u009f]/g, (ch) => CP1252[ch.charCodeAt(0)] ?? ch)

/** A cached CSV file (UTF-8 or Windows-1252) → row objects keyed by header (BOM and stray spaces in names removed). */
export function readCerCsv(buf) {
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { text = decodeCp1252(buf) }
  text = text.replace(/^\uFEFF/, '')
  return parseCsv(text).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/ /g, ' ').trim(), v])))
}

const W = /westridge/i
const usDate = (s) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || '').trim())
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  const y = /^(\d{4})[/-](\d{2})[/-](\d{2})/.exec(String(s || '').trim())
  return y ? `${y[1]}-${y[2]}-${y[3]}` : null
}
const decodeHtml = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&rsquo;|&#39;|&lsquo;/g, '’').replace(/&ldquo;|&rdquo;|&quot;/g, '"').replace(/&ndash;/g, '–')
  .replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
export const plain = (s) => decodeHtml(s).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
/** The condition's title: its first bold heading, as plain text. */
export const conditionTitle = (html) => { const m = /^\s*<strong>([\s\S]*?)<\/strong>/i.exec(String(html || '')); return m ? plain(m[1]) : '' }
const TERMINAL_WORDS = /westridge|\btankers?\b|\bvessels?\b|\bberths?\b|\bdocks?\b|marine terminal|burrard inlet/i

// ── Matching ──────────────────────────────────────────────────────────────────

/** A compliance activity: 'accepted' when Facilities names Westridge; a Trans Mountain activity within 1.5 km (rounded coordinates) → 'candidate'. */
export function matchCva(r, berth) {
  if (W.test(r.Facilities || '')) return { status: 'accepted', why: `Facilities: "${r.Facilities}"` }
  const lat = Number(r.Latitude), lon = Number(r.Longitude)
  if (/trans mountain/i.test(r.Company || '') && Number.isFinite(lat) && Number.isFinite(lon) && berth && metres(berth, { lat, lon }) < 1500) {
    return { status: 'candidate', why: `Trans Mountain activity at ${lat}, ${lon} (coordinates rounded by CER); Facilities "${r.Facilities}" does not name Westridge` }
  }
  return null
}

/** A non-compliance row of a Westridge activity: is it Westridge's (see the rule)? */
export function ncIsWestridge(row, cva) {
  const sf = String(row['Selected Facilities'] || '').trim()
  if (sf) return W.test(sf)
  return /^\s*westridge[^;]*$/i.test(cva.Facilities || '')
}

/** Facility-named records (incidents, O&M, contamination): accepted by Facility Name; Westridge elsewhere in the row → candidate. */
export function matchByFacility(r) {
  if (W.test(r['Facility Name'] || '')) return { status: 'accepted', why: `Facility Name: "${r['Facility Name']}"` }
  const where = Object.entries(r).filter(([, v]) => W.test(v || '')).map(([k]) => k)
  return where.length ? { status: 'candidate', why: `names Westridge only in ${where.join(', ')}` } : null
}

/**
 * An incident: by Facility Name as above; an incident with no facility name, reported by Trans Mountain, whose own point (CER gives
 * incident points to 8 decimals) is within 300 m of the berth is also the terminal's.
 */
export function matchIncident(r, berth) {
  const m = matchByFacility(r)
  if (m?.status === 'accepted') return m
  const lat = Number(r.Latitude), lon = Number(r.Longitude)
  if (!String(r['Facility Name'] || '').trim() && /trans mountain/i.test(r.Company || '') && berth && Number.isFinite(lat) && Number.isFinite(lon)) {
    const d = metres(berth, { lat, lon })
    if (d <= 300) return { status: 'accepted', why: `Trans Mountain incident at ${lat}, ${lon}, ${Math.round(d)} m from the berth; no facility named` }
  }
  return m
}

/** A condition: accepted when its text names Westridge and its title is about the terminal; text only → candidate. */
export function matchCondition(r) {
  if (!W.test(r.Condition || '') && !Object.values(r).some((v) => W.test(v || ''))) return null
  const title = conditionTitle(r.Condition)
  if (W.test(r.Condition || '') && TERMINAL_WORDS.test(title)) return { status: 'accepted', why: `title "${title}"` }
  return { status: 'candidate', why: title ? `title "${title}" is not about the marine terminal` : 'names Westridge only in its text or project name' }
}

const R = 6371008.8, rad = Math.PI / 180
function metres(a, b) {
  const x = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

/**
 * Every matched record from the CSV rows: { kind, id, status, why, payload, dataset }. files = { cva, nc, incident, condition, om,
 * contamination, instruments } (arrays of row objects). berth = the terminal's berth point (for the candidate rule only).
 */
export function cerRecords(files, berth) {
  const out = []
  const inst = new Map((files.instruments || []).map((r) => [String(r['Regulatory Instrument Number'] || '').trim(), r]))
  const cvas = new Map()
  for (const r of files.cva || []) {
    const m = matchCva(r, berth)
    if (m) cvas.set(r['Activity Number'], { r, m })
  }
  const ncBy = new Map()
  for (const row of files.nc || []) {
    const c = cvas.get(row['Activity Number'])
    if (!c || c.m.status !== 'accepted' || !ncIsWestridge(row, c.r)) continue
    const k = JSON.stringify(row)
    if (!ncBy.has(row['Activity Number'])) ncBy.set(row['Activity Number'], new Map())
    ncBy.get(row['Activity Number']).set(k, row)                // exact duplicate rows once
  }
  for (const [id, { r, m }] of cvas) {
    const instruments = String(r['Regulatory Instruments'] || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean)
      .map((n) => ({ number: n, regdocs: inst.get(n)?.['Reg Docs Number']?.trim() || null }))
    out.push({ kind: 'cva', id, status: m.status, why: m.why, dataset: 'cva',
      payload: { activity: r, findings: [...(ncBy.get(id)?.values() || [])], instruments } })
  }
  for (const r of files.incident || []) { const m = matchIncident(r, berth); if (m) out.push({ kind: 'incident', id: r['Incident Number'], ...m, dataset: 'incident', payload: r }) }
  const om = new Map()
  for (const r of files.om || []) {
    const m = matchByFacility(r)
    if (!m) continue
    if (!om.has(r['Event Number'])) om.set(r['Event Number'], { m, rows: [] })
    const g = om.get(r['Event Number'])
    g.rows.push(r)
    if (m.status === 'accepted') g.m = m
  }
  for (const [id, g] of om) out.push({ kind: 'om', id, ...g.m, dataset: 'om', payload: { rows: g.rows } })
  for (const r of files.contamination || []) { const m = matchByFacility(r); if (m) out.push({ kind: 'contamination', id: r['Event ID'], ...m, dataset: 'contamination', payload: r }) }
  for (const r of files.condition || []) {
    const m = matchCondition(r)
    if (!m) continue
    const n = String(r['Instrument Number'] || '').trim()
    out.push({ kind: 'condition', id: `${n}#${r['Condition Number']}`, ...m, dataset: 'condition',
      payload: { ...r, regdocs: inst.get(n)?.['Reg Docs Number']?.trim() || null } })
  }
  return out
}

// ── Plain words ───────────────────────────────────────────────────────────────

const TOOL = {
  NNC: 'Notice of non-compliance', IR: 'Information request', CNC: 'Corrected on the spot', AVC: 'Assurance of voluntary compliance',
  IOO: 'Inspection officer order', AF: 'Audit finding',
}
/** "Notice of Non-compliance (NNC)" → "Notice of non-compliance". Empty → null (an observation with no compliance tool). */
export function toolWords(t) {
  const s = String(t || '').trim()
  if (!s) return null
  const code = /\(([A-Z]+)\)\s*$/.exec(s)?.[1]
  return TOOL[code] || s
}
export const cvaStatusWords = (s) => (/^closed$/i.test(s) ? 'Closed: no further action required'
  : /^final$/i.test(s) ? 'Open: company action still required' : s || null)

/** The Permits-tab row of one stored CVA payload. */
export function cvaRow(p) {
  const a = p.activity
  const findings = p.findings.filter((f) => toolWords(f['Compliance Tool Used']))
  const tools = {}
  for (const f of findings) { const t = toolWords(f['Compliance Tool Used']); tools[t] = (tools[t] || 0) + 1 }
  return {
    id: a['Activity Number'], type: a['Activity Type'] || null, disciplines: a.Disciplines || null, start: usDate(a['Start Date']), end: usDate(a['End Date']),
    status: cvaStatusWords(a.Status), statusRaw: a.Status || null, facilities: a.Facilities || null, observations: p.findings.length - findings.length,
    tools, findings: findings.map((f) => ({ date: usDate(f.Date), theme: f.Theme || null, category: f.Categories || null, sub: f['Sub-Categories'] || null,
      tool: toolWords(f['Compliance Tool Used']), repeated: /^yes$/i.test(f['Is This A Repeated Non-Compliance?'] || ''), due: usDate(f['Due Date']),
      closed: usDate(f['Date Closed']), source: f['Source of Requirement'] || null, enforcement: /^yes$/i.test(f['Referred To Enforcement'] || '') }))
      .sort((x, y) => String(x.date).localeCompare(String(y.date))),
    instruments: p.instruments.map((i) => ({ ...i, url: i.regdocs ? regdocsUrl(i.regdocs) : null })),
  }
}
const INCIDENT_WORDS = { 'Serious Injury (as defined in the OPR)': 'Serious injury', 'Adverse Environmental Effects': 'Harm to the environment (adverse environmental effects)' }
export const incidentTypeWords = (t) => String(t || '').split(/[;,]\s*/).filter(Boolean).map((x) => INCIDENT_WORDS[x] || x).join(', ')
export function incidentRow(r) {
  return { id: r['Incident Number'], date: usDate(r['Occurrence Date and Time']) || usDate(r['Reported Date']), reported: usDate(r['Reported Date']),
    type: incidentTypeWords(r['Incident Types']), what: r['What happened category'] || null, why: r['Why it happened category'] || null,
    status: r.Status || null, closed: usDate(r['Closed Date']), substance: r.Substance && !/not applicable/i.test(r.Substance) ? r.Substance : null,
    volume: r['Approximate Volume Released (m3)'] || null }
}
export function omRow(p) {
  const r = p.rows[0]
  return { id: r['Event Number'], circumstances: [...new Set(p.rows.map((x) => String(x['Circumstance(s)'] || '').trim()).filter(Boolean))],
    start: usDate(r['Commencement Date']), end: usDate(r['Completion Date']), facility: r['Facility Name'] || null }
}
export function contaminationRow(r) {
  return { id: r['Event ID'], description: r['Contaminated Site Description'] || null, status: r['Site Status'] || null,
    contaminants: [r['Contaminants at the Site'], r['Other Contaminants Not Shown In List']].filter((x) => x && !/not specified/i.test(x)).join('; ') || null,
    submitted: usDate(r['Final Submission Date']), actionsTaken: r['Summary of Actions Taken to Mitigate Contamination'] || null,
    actionsPlanned: r['Summary of Actions Planned to Mitigate Contamination'] || null }
}
export function conditionRow(p) {
  const text = plain(p.Condition)
  const title = conditionTitle(p.Condition)
  return { id: `${p['Instrument Number']} #${p['Condition Number']}`, instrument: p['Instrument Number'], number: p['Condition Number'], title,
    project: p['Short Project Name'] || p['Project Name'] || null, status: p['Condition Status'] || null, phase: p['Condition Phase'] || null,
    quote: ((q) => q.slice(0, 420) + (q.length > 420 ? '…' : ''))(text.startsWith(`${title}\n`) ? text.slice(title.length).trim() : text),
    regdocs: p.regdocs ? regdocsUrl(p.regdocs) : null }
}

/** Order page HTML → its readable text (the <main> block). */
export function orderText(html) {
  const m = /<main[\s\S]*?<\/main>/i.exec(String(html || ''))
  return plain(String(m ? m[0] : html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')).replace(/\s+/g, ' ')
}

// ── Import ────────────────────────────────────────────────────────────────────

export async function ensureCerSources(c, S) { for (const s of [CER_SOURCE, CER_ORDERS_SOURCE]) await upsertSource(c, S, s) }

async function store(c, S, sourceId, kind, key, payload, url, version, runId) {
  const ent = await findOrCreateEntity(c, S, { sourceId, kind, anchor: key })
  const r = await upsertRecord(c, S, { sourceId, entityId: ent.id, payload, datasetVersion: version, retrievalUrl: url, runId })
  return { id: Number(r.id), created: r.created }
}

/**
 * records = cerRecords(...); pages = Map(url → cached page). Links every record to the facility (accepted / candidate) and stores
 * each order (with its related pages) when its quote is found in the page text. Idempotent.
 */
export async function importCer(c, S, facilityKey, records, pages, { version = null, runId = null } = {}) {
  const stats = { accepted: {}, candidates: {}, orders: 0, recordsCreated: 0, problems: [] }
  const { rows: [fac] } = await c.query(`SELECT id FROM ${S}.facilities WHERE key = $1`, [facilityKey])
  if (!fac) { stats.problems.push(`facility ${facilityKey} not imported`); return stats }
  const link = (key, recId, status, detail) => c.query(
    `INSERT INTO ${S}.facility_links (facility_id, role, source_id, entity_key, source_record_id, status, method, detail)
     VALUES ($1,'cer_record',$2,$3,$4,$5,'cer_rule',$6)
     ON CONFLICT (facility_id, role, source_id, entity_key) DO UPDATE SET source_record_id = EXCLUDED.source_record_id,
       status = CASE WHEN ${S}.facility_links.status = 'retired' THEN 'retired' ELSE EXCLUDED.status END, detail = EXCLUDED.detail, last_seen_at = now()`,
    [fac.id, key.startsWith('order:') ? CER_ORDERS_SOURCE.id : CER_SOURCE.id, key, recId, status, detail])
  for (const r of records) {
    const rec = await store(c, S, CER_SOURCE.id, `cer_${r.kind}`, r.id, r.payload,
      `https://www.cer-rec.gc.ca/open/${{ cva: 'compliance', incident: 'incident', condition: 'conditions', om: 'operations', contamination: 'compliance' }[r.kind]}/${CER_DATASETS[r.dataset].file}`, version, runId)
    stats.recordsCreated += rec.created ? 1 : 0
    await link(`${r.kind}:${r.id}`, rec.id, r.status, { kind: r.kind, why: r.why, dataset: r.dataset })
    const bucket = r.status === 'accepted' ? stats.accepted : stats.candidates
    bucket[r.kind] = (bucket[r.kind] || 0) + 1
  }
  for (const o of ORDERS) {
    const pg = pages.get(o.url)
    if (!pg) { stats.problems.push(`order ${o.id}: page not cached`); continue }
    const text = orderText(pg.html)
    if (!text.toLowerCase().includes(o.says.toLowerCase())) { stats.problems.push(`order ${o.id}: quote not found in the page`); continue }
    const related = []
    for (const x of o.related) {
      const rp = pages.get(x.url)
      if (!rp) { stats.problems.push(`order ${o.id}: ${x.title} not cached`); continue }
      const rr = await store(c, S, CER_ORDERS_SOURCE.id, 'cer_order_page', x.url, { url: x.url, sha256: rp.sha256, bytes: rp.bytes, text: orderText(rp.html), html: rp.html }, x.url, rp.retrieved_at?.slice(0, 10), runId)
      stats.recordsCreated += rr.created ? 1 : 0
      related.push({ ...x, record_id: rr.id })
    }
    const rec = await store(c, S, CER_ORDERS_SOURCE.id, 'cer_order_page', o.url, { url: o.url, sha256: pg.sha256, bytes: pg.bytes, text, html: pg.html }, o.url, pg.retrieved_at?.slice(0, 10), runId)
    stats.recordsCreated += rec.created ? 1 : 0
    await link(`order:${o.id}`, rec.id, 'accepted', { kind: 'order', id: o.id, date: o.date, cva: o.cva, about: o.about, says: o.says, url: o.url, related })
    stats.orders++
  }
  return stats
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** The CER section of one facility's card: shown records by kind (newest first) and hidden-candidate counts. */
export async function cerFacilityDetail(q, S, facilityId) {
  const rows = await q(`SELECT l.entity_key, l.status, l.detail, l.source_record_id, sr.payload FROM ${S}.facility_links l
                          JOIN ${S}.source_records sr ON sr.id = l.source_record_id
                         WHERE l.facility_id = $1 AND l.role = 'cer_record'`, [facilityId])
  if (!rows.length) return null
  const ok = (k) => rows.filter((r) => r.status === 'accepted' && r.detail?.kind === k)
  const rid = (r) => Number(r.source_record_id)
  const hidden = {}
  for (const r of rows) if (r.status === 'candidate') hidden[r.detail?.kind] = (hidden[r.detail?.kind] || 0) + 1
  const byDate = (a, b) => String(b.date ?? b.start ?? '').localeCompare(String(a.date ?? a.start ?? ''))
  return {
    datasets: Object.fromEntries(Object.keys(CER_DATASETS).map((k) => [k, { url: datasetUrl(k), title: CER_DATASETS[k].title }])),
    orders: ok('order').map((r) => ({ ...r.detail, record_id: rid(r) })).sort(byDate),
    inspections: ok('cva').map((r) => ({ ...cvaRow(r.payload), record_id: rid(r) })).sort(byDate),
    incidents: ok('incident').map((r) => ({ ...incidentRow(r.payload), record_id: rid(r) })).sort(byDate),
    om: ok('om').map((r) => ({ ...omRow(r.payload), record_id: rid(r) })).sort(byDate),
    contamination: ok('contamination').map((r) => ({ ...contaminationRow(r.payload), record_id: rid(r) })),
    conditions: ok('condition').map((r) => ({ ...conditionRow(r.payload), record_id: rid(r) })).sort((a, b) => a.id.localeCompare(b.id)),
    hidden,
  }
}
