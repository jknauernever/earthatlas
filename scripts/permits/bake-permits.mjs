#!/usr/bin/env node
// /permits (EarthAtlas PermitTracker) bake: Clean Water Act permits and related actions, San Juan County, WA.
//
//   node scripts/permits/bake-permits.mjs
//
// Inputs
//   1. data/permits/curated.json — hand-compiled projects (Corps 404/Section 10, Ecology 401/CZM, county, town,
//      NOAA), unmapped actions and per-permit NPDES notes. Every value carries a `src` key into its `docs` table.
//   2. EPA ECHO NPDES outfalls (ArcGIS feature service, live): every NPDES permit with a point in the county.
//   3. EPA ECHO facilities (ArcGIS map service, live): 13-quarter compliance, actions and penalties per permit.
//   4. Ecology Water Quality Assessment, Category 5 / 303(d) polygons (live), clipped to the county bounding box.
//   5. DOH Commercial Shellfish Growing Areas (live), San Juan region.
//
// Outputs (public/permits-data/; not public/permits, which would shadow the /permits route in vite dev)
//   permits.json          projects, npdes, unmapped, docs (readable links only), meta (counts, bake time)
//   records/<key>.json    each Record doc's payload exactly as received + what it says, for /permits/source/<key>
//   wq303d.geojson        Category 5 polygons with listing number, parameter, waterbody
//   shellfish.geojson     growing areas with class, reason, acres, last update
//
// Nothing is estimated: a value the services do not return is left out, never filled in.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const CURATED = 'data/permits/curated.json'
const OUT_DIR = 'public/permits-data'
const BBOX = [-123.25, 48.4, -122.75, 48.8] // San Juan County (W, S, E, N); same box as the Corps ORM search
const UA = { 'User-Agent': 'EarthAtlas PermitTracker bake (https://earthatlas.org/permits)' }

export const SERVICES = {
  echoOutfalls: 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/ArcGIS/rest/services/ECHO_NPDES_Facilities_Outfalls/FeatureServer/0',
  echoFacilities: 'https://echogeo.epa.gov/arcgis/rest/services/ECHO/Facilities/MapServer/0',
  wq303d: 'https://gis.ecology.wa.gov/serverext/rest/services/Authoritative/WQ/FeatureServer/4',
  shellfish: 'https://services8.arcgis.com/rGGrs6HCnw87OFOT/ArcGIS/rest/services/Commercial_Shellfish_Growing_Areas/FeatureServer/0',
}

async function query(layer, params) {
  const out = []
  for (let offset = 0; ; ) {
    const p = new URLSearchParams({ outFields: '*', outSR: '4326', f: 'json', ...params })
    if (offset) p.set('resultOffset', String(offset))
    const res = await fetch(`${layer}/query?${p}`, { headers: UA })
    if (!res.ok) throw new Error(`${layer} → HTTP ${res.status}`)
    const j = await res.json()
    if (j.error) throw new Error(`${layer} → ${JSON.stringify(j.error)}`)
    out.push(...j.features)
    if (!j.exceededTransferLimit || !j.features.length) return out
    offset += j.features.length
  }
}
async function queryGeojson(layer, params) {
  const p = new URLSearchParams({ outFields: '*', outSR: '4326', f: 'geojson', ...params })
  const res = await fetch(`${layer}/query?${p}`, { headers: UA })
  if (!res.ok) throw new Error(`${layer} → HTTP ${res.status}`)
  const j = await res.json()
  if (j.error) throw new Error(`${layer} → ${JSON.stringify(j.error)}`)
  if (j.properties?.exceededTransferLimit) throw new Error(`${layer} → truncated; add paging`)
  return j
}

const ymd = (v) => (v == null || v === '' ? null : typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : String(v).slice(0, 10))

// Kind of permit, from the number's prefix and EPA's NAICS codes only (no lookups, no guesses).
function permitKind(id, naics) {
  const n = String(naics || '')
  if (/^WA00/.test(id)) return 'Individual wastewater permit'
  if (/^WAR/.test(id)) return 'Stormwater general permit coverage'
  if (/\b(2123\d\d|3273\d\d|327999|324121)\b/.test(n)) return 'Sand, gravel and concrete general permit coverage'
  if (/^WAG03/.test(id) || /\b(3366\d\d|811490|488390)\b/.test(n)) return 'Boatyard general permit coverage'
  return 'General permit coverage'
}

// ECHO's 13-quarter string, one letter per quarter, oldest first: V violation, S significant violation, _ none,
// U undetermined. ECHO reports compliance per facility (FRS id), and one facility can hold several permits, so the
// text names the permits it covers.
function complianceText(f) {
  if (!f) return null
  const q = (f.CWA_13QTRS_COMPL_STATUS || '').trimEnd()
  const v = (q.match(/[VS]/g) || []).length
  const ids = String(f.NPDES_IDS || '').split(/[\s,]+/).filter(Boolean)
  const parts = ids.length > 1 ? [`Facility record covering ${ids.join(', ')}`] : []
  if (f.CWA_CURR_COMPLIANCE_STATUS) parts.push(`Current status: ${f.CWA_CURR_COMPLIANCE_STATUS}`)
  if (q) parts.push(`${v} of the last ${q.length} quarters with a violation identified`)
  if (f.CWA_13QTRS_EFFLNT_EXCEEDANCES != null) parts.push(`${f.CWA_13QTRS_EFFLNT_EXCEEDANCES} effluent limit exceedances`)
  if (f.CWA_FORMAL_ACTION_COUNT != null) parts.push(`${f.CWA_FORMAL_ACTION_COUNT} formal actions`)
  if (f.CWA_PENALTIES) parts.push(`penalties $${Number(f.CWA_PENALTIES).toLocaleString('en-US')}`)
  return parts.join('; ')
}
function complianceClass(f, status) {
  if (f?.CWA_CURR_SNC_FLAG === 'Y') return 'bad'
  if (/violation/i.test(f?.CWA_CURR_COMPLIANCE_STATUS || '') && !/no violation/i.test(f.CWA_CURR_COMPLIANCE_STATUS)) return 'warn'
  if (/[VS]/.test(f?.CWA_13QTRS_COMPL_STATUS || '')) return 'warn'
  return status === 'Admin Continued' ? 'warn' : 'ok'
}

// ─── Readable sources (Josh 2026-10-13: no source link may open raw JSON or an ArcGIS query) ─────────────────────
// A doc is { title, agency, kind: 'PDF'|'Page'|'Record', url?, record?, api?, look_up?, about? }. `url` is always a
// page a person can read. A Record doc is a data service: the bake stores its payload exactly as received in
// public/permits-data/records/<key>.json, which /permits/source/<key> shows readably (kicker, publisher, licence, what it
// says, raw toggle), like /ships/source/<id>.
const US_GOV = { text: 'U.S. Government work, public domain (17 U.S.C. § 105)', href: 'https://www.law.cornell.edu/uscode/text/17/105' }
const LICENCE = {
  corps: US_GOV, epa: US_GOV, census: US_GOV, noaa: US_GOV,
  ecology: { text: 'Use allowed with credit and a link; commercial and political use prohibited', href: 'https://ecology.wa.gov/About-us/Accountability-transparency/Website-information/Copyright-information' },
  doh: { text: 'Public agency record; terms not read' }, wsdot: { text: 'Public agency record; terms not read' },
}
// Short name for "the data exactly as <sender> sent it".
const SENDER = { corps: 'the Army Corps', epa: 'EPA ECHO', census: 'the Census Bureau', wsdot: 'WSDOT', doh: 'the Department of Health', ecology: 'Ecology' }
// Where a person can go to find a Record doc's data themselves.
const HOME = {
  census: { label: 'the Census Bureau geocoder', href: 'https://geocoding.geo.census.gov/geocoder/' },
  wsdot: { label: 'Washington State Ferries', href: 'https://wsdot.wa.gov/travel/washington-state-ferries' },
  doh: { label: 'DOH shellfish growing area reports', href: 'https://doh.wa.gov/bs/node/5891' },
  epa: { label: 'EPA ECHO facility search', href: 'https://echo.epa.gov/facilities/facility-search' },
}
const echoDfr = (frs) => `https://echo.epa.gov/detailed-facility-report?fid=${frs}`
const parisDocs = (permit) => `https://apps.ecology.wa.gov/paris/PermitDocumentSearch.aspx?PermitNumber=${permit}`
const wqListing = (n) => `https://apps.ecology.wa.gov/ApprovedWQA/ApprovedPages/ViewApprovedListing.aspx?ListingId=${n}`
const wqMap = (n) => `https://apps.ecology.wa.gov/waterqualityatlas/wqa/map?lstid=${n}`
const DOH_REPORTS = 'https://doh.wa.gov/bs/node/5891'
const outfallApi = (id) => `${SERVICES.echoOutfalls}/query?where=external_permit_nmbr%3D%27${id}%27&outFields=*&f=json`
const facilityApi = (frs) => `${SERVICES.echoFacilities}/query?where=REGISTRY_ID%3D%27${frs}%27&outFields=*&f=json`
const shellApi = (id) => `${SERVICES.shellfish}/query?where=GrowingAreaID%3D${id}&outFields=*&returnGeometry=false&f=json`

const rowsOf = (pairs) => pairs.filter(([, v]) => v != null && v !== '').map(([label, value]) => ({ label, value: String(value) }))
// The Corps feed writes dates three ways (08/06/2026, 14-OCT-2025, 20260806); all become YYYY-MM-DD.
const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' }
const usDate = (v) => {
  let m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(v || '')
  if (m) return `${m[3]}-${m[1]}-${m[2]}`
  m = /^(\d\d)-([A-Z]{3})-(\d{4})$/.exec(v || '')
  return m && MON[m[2]] ? `${m[3]}-${MON[m[2]]}-${m[1]}` : v
}

// What each kind of record says, as label/value rows (the source's own values; nothing derived).
const ORM_FIELDS = [['projectName', 'Project'], ['applicant', 'Applicant'], ['identifier', 'Corps file number'], ['permitType', 'Permit type'],
  ['actionTaken', 'Decision'], ['displayDate', 'Decision date'], ['publicNoticeDate', 'Public notice'], ['pnDate', 'Public notice'],
  ['finalEaPublicationDate', 'Final environmental assessment published'], ['ormPendingOrFinal', 'Stage'], ['district', 'Corps office'],
  ['requestName', 'Request'], ['status', 'Status'], ['civilWorksProjects', 'Corps civil-works project'], ['locationName', 'Location'], ['locationDesc', 'Location description'],
  ['reviewCategory', 'Review category'], ['regulatoryPermitId', 'Linked Corps permit file'], ['jdType', 'Determination type'], ['fundingSource', 'Funding'],
  ['dateReceived', 'Application received'], ['initialSubmissionDate', 'Request submitted'], ['beginDate', 'Emergency action began'], ['event', 'Emergency']]
const ORM_SUB = { efh: 'Essential Fish Habitat consultation', esa: 'Endangered Species Act consultation', s106Nhpa: 'Historic preservation review (Section 106)',
  wqc401: 'Water quality certification (§401)', czm: 'Coastal Zone consistency' }
function ormRows(payload) {
  const seen = new Set(), rows = []
  const add = (label, value) => { const k = `${label}\u0000${value}`; if (value && !seen.has(k)) { seen.add(k); rows.push({ label, value: String(value) }) } }
  for (const f of payload?.results?.features || []) {
    const p = f.properties
    for (const [k, label] of ORM_FIELDS) add(label, /Date$/i.test(k) ? usDate(p[k]) : p[k])
    for (const [k, list] of Object.entries(p.subactions || {})) for (const x of list) {
      const who = x.agency || x.agencyNotified
      const what = x.closureMethod || x.effectsDetermination || x.status || x.decision
      add(ORM_SUB[k] || k, [who, x.consultationType && `${x.consultationType.toLowerCase()} consultation`, what].filter(Boolean).join(': ') +
        (x.beginDate ? ` (${x.beginDate}${x.endDate ? ` to ${x.endDate}` : ''})` : ''))
    }
  }
  return rows
}
function censusRows(payload) {
  const m = payload?.result?.addressMatches?.[0]
  return rowsOf([['Address searched', payload?.result?.input?.address?.address], ['Matched address', m?.matchedAddress ?? 'No match'],
    ['Coordinates', m && `${m.coordinates.y.toFixed(5)}, ${m.coordinates.x.toFixed(5)}`]])
}
function wsdotRows(payload, doc) {
  const name = String(doc.title).split(': ').pop()
  const t = (Array.isArray(payload) ? payload : []).find((x) => x.TerminalName === name)
  return t ? rowsOf([['Terminal', t.TerminalName], ['Address', [t.AddressLineOne, t.City, t.State, t.ZipCode].filter(Boolean).join(', ')],
    ['Coordinates', `${t.Latitude}, ${t.Longitude}`]]) : [{ label: 'Terminal', value: `${name}: not in the list` }]
}
function outfallRows(rows) {
  const a = rows[0] || {}
  const recv = [...new Set(rows.map((r) => r.state_water_body_name).filter((w) => w && w !== 'None'))]
  return rowsOf([['Permit number', a.external_permit_nmbr], ['Facility', a.facility_name], ['Permittee', a.permit_name],
    ['Status (EPA’s term)', a.permit_status_desc], ['Effective', ymd(a.permit_effective_date)], ['Expires', ymd(a.permit_expiration_date)],
    ['Receiving water', recv.join('; ')], ['Outfalls / permitted features', rows.map((r) => r.perm_feature_nmbr).join(', ')],
    ['Industry codes (NAICS)', a.naics_codes]])
}
function facilityRows(f) {
  return rowsOf([['Facility', f.FAC_NAME], ['EPA facility id (FRS)', f.REGISTRY_ID], ['Permits under this facility', f.NPDES_IDS],
    ['Current Clean Water Act compliance', f.CWA_CURR_COMPLIANCE_STATUS], ['Significant noncompliance now', f.CWA_CURR_SNC_FLAG === 'Y' ? 'Yes' : f.CWA_CURR_SNC_FLAG === 'N' ? 'No' : null],
    ['Last 13 quarters (oldest first; V = violation, S = significant, _ = none)', (f.CWA_13QTRS_COMPL_STATUS || '').trimEnd()],
    ['Effluent limit exceedances, 13 quarters', f.CWA_13QTRS_EFFLNT_EXCEEDANCES], ['Formal enforcement actions', f.CWA_FORMAL_ACTION_COUNT],
    ['Penalties', f.CWA_PENALTIES ? `$${Number(f.CWA_PENALTIES).toLocaleString('en-US')}` : null], ['Last penalty', ymd(f.CWA_LAST_PENALTY_DATE)],
    ['Days since last inspection (at ECHO’s last refresh)', f.CWA_DAYS_LAST_INSPECTION]])
}
function shellRows(features) {
  const a = features[0]?.attributes || {}
  return rowsOf([['Growing area', a.NAME], ...features.map(({ attributes: x }) =>
    [`Classification${features.length > 1 ? ' (one part of the area)' : ''}`, `${x.CLASS}${x.Reason && x.Reason !== 'None' ? `, reason: ${x.Reason}` : ''}${x.ACRES != null ? `, ${Math.round(x.ACRES).toLocaleString('en-US')} acres` : ''}`]),
  ['Layer last updated', ymd(a.Updated)]])
}


// ─── Violations and enforcement, per permit, from EPA's Detailed Facility Report (one request per EPA facility) ───
// ECHO's DFR web service: https://echodata.epa.gov/echo/dfr_rest_services.get_dfr?output=JSON&p_id=<FRS id>, no key.
// It reports by facility; every row carries the permit it belongs to (SourceID), so each map record shows only its own.
const dfrApi = (frs) => `https://echodata.epa.gov/echo/dfr_rest_services.get_dfr?output=JSON&p_id=${frs}`
const mdy = (v) => { const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(v || ''); return m ? `${m[3]}-${m[1]}-${m[2]}` : null }
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthName = (iso) => `${MONTH[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`
// EPA's schedule-violation texts in plain words; EPA's own code and text stay on hover.
const SCHEDULE_WORDS = {
  'Schedule Event unachieved and not reported': 'not done and not reported',
  'Schedule Event achieved late but reported': 'done late',
  'Schedule Event achieved late and not reported': 'done late, not reported',
}
const LEAD = { State: 'ecology', EPA: 'epa' }
const sentence = (t) => { const x = String(t || '').toLowerCase(); return x.charAt(0).toUpperCase() + x.slice(1) }
const tidyAction = (t) => sentence(String(t || '').replace(/^Base Program - /, '').replace(/\/\s*/g, ' or '))
const EVENT_WORDS = { 'Other (See Comments)': 'Other deadline' }
const rowsFor = (section, permit, key = 'Status') => (section?.Sources || []).flatMap((s) => s[key] || []).filter((x) => x.SourceID === permit)

function violationsOf(dfr, permit, srcKey) {
  const R = dfr?.Results || {}
  const events = [], facts = []
  // Missed or late deadlines (reports, applications, compliance schedules).
  for (const v of rowsFor(R.CWAPSComplianceNew, permit, 'Violations')) {
    const d = mdy(v.ScheduleDate || v.VioStartDate)
    if (!d) continue
    events.push({ date: d, agency: 'epa', src: srcKey, title: `EPA: ${v.ViolationCode}, ${v.ViolationDesc}`,
      event: `${EVENT_WORDS[v.ScheduleEventDesc] || sentence(v.ScheduleEventDesc || 'Deadline')} due: ${SCHEDULE_WORDS[v.ViolationDesc] || v.ViolationDesc}` })
  }
  // Effluent limit exceedances, by month. ECHO's value is the percent over the limit, or "LIMIT VIOLATION".
  const H = R.CWAEffluentComplianceEXP?.Header || {}
  for (const p of rowsFor(R.CWAEffluentComplianceEXP, permit, 'Parameters')) {
    for (let n = 1; n <= 39; n++) {
      const val = p[`Mnth${n}Value`]
      if (!val || !/%|VIOLATION/i.test(val)) continue
      const d = mdy(H[`Mnth${n}Start`])
      if (!d) continue
      const pct = /(\d+(?:\.\d+)?%)/.exec(val)?.[1]
      events.push({ date: d, agency: 'epa', src: srcKey, title: `EPA: ${p.ParameterName}, ${p.DischargePoint}, ${p.MeasurementType}: ${val}`,
        event: `${p.ParameterName} over its permit limit in ${monthName(d)}${pct ? ` (by ${pct})` : ''}, outfall ${String(p.DischargePoint).split(' ')[0]}` })
    }
  }
  // Monitoring reports (DMRs) missing or late, counted per quarter.
  const QH = R.CWA3YrD80D90Counts?.Header || {}
  for (const x of rowsFor(R.CWA3YrD80D90Counts, permit)) {
    for (let n = 1; n <= 13; n++) {
      const c = Number(x[`Qtr${n}Count`])
      const a = mdy(QH[`Qtr${n}Start`]), b = mdy(QH[`Qtr${n}End`])
      if (!c || !a) continue
      const what = x.MissingLate === 'LATE' ? 'filed late' : 'not received'
      events.push({ date: a, agency: 'epa', src: srcKey, title: `EPA: ${x.MissingLate} DMRs, ${QH[`Qtr${n}Start`]} to ${QH[`Qtr${n}End`]}`,
        event: `${c} monitoring report${c === 1 ? '' : 's'} ${what}, ${monthName(a)} to ${monthName(b || a)}` })
    }
  }
  // Informal actions (warning letters, enforcement reviews) and formal actions.
  for (const x of (R.Notices?.Notice || []).filter((n) => n.SourceID === permit)) {
    const d = mdy(x.NoticeDate)
    if (d) events.push({ date: d, agency: LEAD[x.LeadAgency] || 'epa', src: srcKey, title: `EPA: ${x.ActionType} (${x.EnfIdentifier}), lead agency ${x.LeadAgency}`,
      event: tidyAction(x.ActionType) })
  }
  for (const sec of ['FormalActions', 'ICISFormalActions', 'CaseFormalActions']) {
    const list = Object.values(R[sec] || {}).find(Array.isArray) || []
    for (const x of list.filter((f) => !f.SourceID || f.SourceID === permit)) {
      const dk = Object.keys(x).find((k) => /Date/.test(k) && mdy(x[k]))
      const pk = Object.keys(x).find((k) => /Penalt/i.test(k) && x[k] && x[k] !== '$0')
      if (!dk) { console.warn(`  ${permit}: ${sec} row without a date: ${Object.keys(x).join(',')}`); continue }
      events.push({ date: mdy(x[dk]), agency: LEAD[x.LeadAgency] || 'epa', src: srcKey, title: `EPA ${sec}: ${JSON.stringify(x)}`,
        event: `Formal enforcement: ${tidyAction(x.ActionType || x.EnfType || x.TypeOfAction || 'action')}${pk ? `, penalty ${x[pk]}` : ''}` })
    }
  }
  // Where the permit stands now, and inspections.
  const q = rowsFor(R.CWA3YrCompliance, permit)[0]
  if (q) {
    const st = Array.from({ length: 13 }, (_, i) => q[`Qtr${i + 1}Status`]).filter((v) => v != null && v !== '')
    if (st.length) {
      facts.push({ label: 'EPA’s status now', value: st[st.length - 1], src: srcKey })
      facts.push({ label: 'Quarters with a violation', value: `${st.filter((v) => /^violation/i.test(v) || /significant/i.test(v)).length} of the last ${st.length}`, src: srcKey })
    }
  }
  const rnc = rowsFor(R.CWARNCCompliance, permit)[0]
  const rncNow = rnc && Array.from({ length: 12 }, (_, i) => rnc[`Qtr${12 - i}Status`]).find((v) => v)
  if (rncNow) facts.push({ label: 'Kind of noncompliance (EPA)', value: rncNow, src: srcKey })
  const ins = (R.InspectionEnforcementSummary?.Source || []).find((x) => x.SourceID === permit)
  if (ins) {
    // The permit's own last inspection (EPA counts 5 years); else the facility's, which can be older.
    const facLast = mdy(R.EnforcementComplianceSummaries?.Summaries?.find((x) => x.Statute === 'CWA')?.LastInspection)
    facts.push({ label: 'Last inspection', value: mdy(ins.DateLastInspection) || (facLast ? `${facLast} (at the facility)` : 'None on record'), src: srcKey })
    const from = mdy(R.InspectionEnforcementSummary?.ProgramDates?.[0]?.StartDate)
    if (from) facts.push({ label: `Last 5 years (from ${from})`, value: `${ins.InspectionCount || 0} inspections, ${ins.FormalEnfActCount || 0} formal enforcement actions, penalties ${ins.TotalPenalties || '$0'}`, src: srcKey })
  }
  const nowStatus = facts[0]?.value || ''
  const cls = /significant/i.test(nowStatus) ? 'bad' : /^violation/i.test(nowStatus) ? 'warn' : /undetermined/i.test(nowStatus) ? 'n' : 'ok'
  return { events: events.sort((a, b) => a.date.localeCompare(b.date)), facts, cls }
}
function dfrRows(dfr, facName) {
  const R = dfr?.Results || {}
  const s = R.EnforcementComplianceSummaries?.Summaries?.find((x) => x.Statute === 'CWA') || {}
  return rowsOf([['Facility', facName], ['EPA facility id (FRS)', R.RegistryID],
    ['Permits under this facility', (R.InspectionEnforcementSummary?.Source || []).map((x) => x.SourceID).join(', ')],
    ['Clean Water Act status now', s.CurrentStatus], ['Quarters in noncompliance (3 years)', s.QtrsInNC], ['Quarters in significant noncompliance', s.QtrsInSNC],
    ['Inspections (5 years)', s.Inspections], ['Last inspection', mdy(s.LastInspection)], ['Informal actions', s.InformalActions],
    ['Formal actions', s.FormalActions], ['Penalties', s.TotalPenalties], ['ICIS-NPDES data as of', R.SystemExtractDates?.Dates?.find((d) => d.EPASystem === 'ICIS-NPDES')?.SystemExtractDate]])
}

// ─── Army Corps: every action the public permit feed (ORM2) holds in the county box, all years and categories ───
// The feed ignores its bbox parameter and caps results at 5,000, so it is read by district (Seattle, org:NWS, under
// 5,000 records) and filtered to the box here. Records hand-compiled in curated.json (same Corps number) are skipped.
// The feed holds individual permits, Letters of Permission, emergency actions, jurisdictional determinations,
// environmental assessments, Section 408 requests and WSDOT-funded (WRDA 214) verifications; it does not hold most
// Nationwide or General Permit verifications.
const ORM_API = 'https://permits.ops.usace.army.mil/orm-public-api'
const ormSearch = `${ORM_API}/permits/search?da=true&max=5000&q=org:NWS`
const ormBase = (id) => String(id).replace(/-(TTR|DOT)$/, '')
const ormYmd = (v) => (/^\d{8}$/.test(v || '') ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : (v && v !== 'N/A' ? usDate(v) : null))
const ORM_TYPE = { s408: 'Section 408 permission request', jds: 'Approved jurisdictional determination', nepa_ea: 'Environmental assessment', emergency: 'Emergency action' }
const sentenceCase = (t) => { const x = String(t || '').toLowerCase(); return x.charAt(0).toUpperCase() + x.slice(1) }

function corpsRecords(features, curatedNumbers, docs, raw) {
  const groups = new Map()
  for (const f of features) {
    const [lon, lat] = f.geometry?.coordinates || []
    if (lon == null || lon < BBOX[0] || lon > BBOX[2] || lat < BBOX[1] || lat > BBOX[3]) continue
    const n = ormBase(f.properties.identifier)
    if (curatedNumbers.has(n)) continue
    if (!groups.has(n)) groups.set(n, [])
    groups.get(n).push(f)
  }
  const out = []
  for (const [n, fs] of groups) {
    const ps = fs.map((f) => f.properties)
    const p = ps.find((x) => x.vtype === 'issued' || x.vtype === 'wrda') || ps[0]
    const key = `orm-${n}`
    docs[key] = { title: `Army Corps permit database: ${p.identifier}`, agency: 'corps', kind: 'Record', record: true,
      url: `https://permits.ops.usace.army.mil/orm-public?q=${encodeURIComponent(p.identifier)}`, look_up: p.identifier }
    raw.set(key, { api: `${ORM_API}/permits/search?sa=true&q=identifier:%22${encodeURIComponent(p.identifier)}%22`,
      payload: { results: { type: 'FeatureCollection', features: fs } }, rows: ormRows({ results: { features: fs } }) })
    const decision = p.actionTaken || p.status || (p.vtype === 'pending' ? null : p.pendingOrFinal)
    const label = p.vtype === 'pending' ? 'Corps review pending'
      : p.vtype === 'nepa_ea' ? `Environmental assessment ${String(p.pendingOrFinal || p.ormPendingOrFinal || '').toLowerCase()}`.trim()
      : p.vtype === 'jds' ? 'Jurisdictional determination issued'
      : p.vtype === 'emergency' ? `Emergency action ${String(p.status || '').toLowerCase()}`.trim()
      : sentenceCase(decision || 'Decided')
    const cls = p.vtype === 'pending' || /progress|pending/i.test(label) ? 'warn' : /denied/i.test(label) ? 'bad' : /withdrawn/i.test(label) ? 'n' : 'ok'
    const trail = []
    const ev = (date, event) => { if (date && !trail.some((t) => t.date === date && t.event === event)) trail.push({ date, agency: 'corps', event, src: key }) }
    for (const x of ps) {
      ev(ormYmd(x.dateReceived), 'Application received')
      ev(ormYmd(x.initialSubmissionDate), 'Request submitted')
      ev(ormYmd(x.publicNoticeDate) || ormYmd(x.pnDate), 'Public notice')
      ev(ormYmd(x.beginDate), `Emergency action began${x.event ? `: ${x.event}` : ''}`)
      ev(ormYmd(x.finalEaPublicationDate), 'Final environmental assessment published')
      if (x.vtype !== 'nepa_ea' && x.vtype !== 'pending') ev(ormYmd(x.vdate), sentenceCase(x.actionTaken || x.status || ORM_TYPE[x.vtype] || 'Decision'))
    }
    if (p.ajdUrl) docs[`${key}-ajd`] = { title: `Army Corps approved jurisdictional determination, ${n}`, agency: 'corps', kind: 'PDF', url: p.ajdUrl }
    const [lon, lat] = fs[0].geometry.coordinates
    out.push({
      id: key, layer: 'structures', county: 'San Juan',
      name: p.projectName || p.requestName || p.identifier,
      applicant: p.applicant || p.projectName?.split(' (')[0] || 'Not stated in the record',
      type: p.permitType ? (p.vtype === 'wrda' ? `${p.permitType} verification` : p.permitType) : ORM_TYPE[p.vtype] || 'Corps action',
      lat, lon, approx: false,
      position: { text: 'Position: the Army Corps database’s own point for this action.', src: key },
      refs: [{ label: p.identifier, src: key }, ...(p.ajdUrl ? [{ label: `${n}: approved jurisdictional determination`, src: `${key}-ajd` }] : [])],
      status: { label, cls, src: key },
      // The feed has no description for most actions; the popup then shows only its title, never a repeat of it.
      ...((t) => (t ? { summary: { text: t, src: key } } : {}))([p.locationName && `At ${p.locationName}.`, p.locationDesc,
        p.regulatoryPermitId && `Linked Corps permit file: ${p.regulatoryPermitId}.`].filter(Boolean).join(' ')),
      facts: [], trail: trail.sort((a, b) => a.date.localeCompare(b.date)), joins: [], source: 'orm-feed', corpsKind: p.vtype,
      ...(p.civilWorksProjects ? { civilWorks: p.civilWorksProjects } : {}),
    })
  }
  return out
}

// ─── The same dock in /sanjuan-docks (county SmartGov + pre-SmartGov permits and WDFW HPAs by parcel) ───
// A record is joined to a dock site only when both agree: the site lies within 300 m AND its permits name the same
// applicant (the record's surname or company word, or two shared name words). Position alone never joins.
const DOCKS = 'public/hpa/san-juan-docks.geojson'
const NAME_STOP = new Set('LLC INC CO CORP COMPANY TRUST TRUSTEE TRUSTEES AND THE FAMILY LIVING REVOCABLE ESTATE PROPERTIES PROPERTY ASSOCIATION OWNERS HOMEOWNERS COMMUNITY CLUB COUNTY SAN JUAN WASHINGTON STATE PORT FRIDAY HARBOR ISLAND ISLANDS ORCAS LOPEZ SHAW PARKS RECREATION COMMISSION PUBLIC WORKS DEPARTMENT CITY TOWN MARINA RESORT DOCK FLOAT PIER RAMP BUOY MOORING REPLACEMENT REPAIR PROJECT NEW JOINT USE'.split(' '))
const nameWords = (...xs) => new Set(xs.join(' ').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !NAME_STOP.has(w)))
const metres = (a, b) => { const k = Math.PI / 180, x = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * k), y = b[1] - a[1]; return Math.round(Math.hypot(x, y) * k * 6371000) }
const DOCK_AGENCY = (src) => (/WDFW/.test(src) ? 'wdfw' : 'county')
function joinDocks(records, docs) {
  if (!existsSync(DOCKS)) { console.warn(`  ${DOCKS} missing: no dock joins`); return 0 }
  const sites = JSON.parse(readFileSync(DOCKS, 'utf8')).features
  let n = 0
  for (const r of records) {
    if (r.layer === 'npdes') continue
    const words = nameWords(r.applicant || '', String(r.name || '').split(' (')[0])
    if (!words.size) continue
    // The key name: the Corps files people as "Surname, First (project)", so its first word; for hand-compiled
    // records, the applicant's last word. One shared word joins only when it is this key; otherwise two must match.
    const keyOf = (t, last) => { const w = String(t).toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((x) => x.length >= 3 && !NAME_STOP.has(x)); return last ? w[w.length - 1] : w[0] }
    const key = r.source === 'orm-feed' ? keyOf(String(r.name).split(' (')[0]) : keyOf(String(r.applicant || '').split(/[-,]/)[0], true)
    const hits = []
    for (const s of sites) {
      const m = metres([r.lon, r.lat], s.geometry.coordinates)
      if (m > 300) continue
      const ps = s.properties.permits
      const siteWords = new Set(ps.flatMap((x) => String(x.applicant || '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/)))
      const shared = [...nameWords(...ps.map((x) => x.applicant || ''))].filter((w) => words.has(w))
      if ((key && siteWords.has(key)) || shared.length >= 2) hits.push({ s, m, shared: key && siteWords.has(key) && !shared.includes(key) ? [key, ...shared] : shared })
    }
    if (!hits.length) continue
    hits.sort((a, b) => a.m - b.m)
    r.docks = hits.slice(0, 2).map(({ s, m, shared }) => {
      const key = `docks-${s.properties.site_id}`
      docs[key] = { title: `EarthAtlas Docks: county and WDFW permits at this dock`, agency: 'earthatlas', kind: 'Page', url: `/sanjuan-docks?p=${s.properties.site_id}` }
      return {
        src: key, m, shared, site: s.properties.site_id,
        permits: s.properties.permits.map((x) => ({
          date: x.issued || x.submitted || null, agency: DOCK_AGENCY(x.source), number: x.permit_number,
          what: [x.project_name, x.additional_description, x.permit_type && `(${String(x.permit_type).toLowerCase()})`].filter(Boolean).join(' ') || 'No description in the record',
          status: x.status || null, applicant: x.applicant || null,
        })).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
      }
    })
    n++
  }
  return n
}

// ─── Ecology's documents for a permit (PARIS document search: a plain GET returns the permit's rows) ───
// Columns: … Permit Version, City, County, Public Notice Date, DocumentType, Document Name, AdministrativeRegion, Description.
const decodeHtml = (t) => String(t).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim()
function docDate(name, desc, pn) {
  let m = /(20\d\d|19\d\d)-(\d\d)-(\d\d)/.exec(name) || /(20\d\d|19\d\d)(\d\d)(\d\d)/.exec(name)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /processed on (\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(desc) || /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(pn || '')
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
}
// Ecology's automatic notices name their report by code ("ISGPPermitCoverageLtrEmail"); shown as Ecology wrote it, spaced out.
const spaceCode = (c) => c.replace(/^ISGP|^CSWGP|^BYGP/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/(\d{4})([A-Z])/, '$1 $2').trim()
function parisRows(h, permit) {
  const out = []
  for (const r of h.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
    const id = /DownloadDocument\.aspx\?id=(\d+)/.exec(r)?.[1]
    if (!id) continue
    const c = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => decodeHtml(x[1]))
    if (c[2] !== permit) continue
    const name = c[10].split('\n')[0].trim(), desc = c[12] || ''
    const auto = /^Auto-generated document for report [^(]*\(([^)]*)\)/.exec(desc)
    out.push({ id, version: c[5], status: c[3], date: docDate(name, desc, c[8]), name,
      what: auto ? `Automatic Ecology notice${auto[1] ? `: ${spaceCode(auto[1])}` : ''}` : desc || name,
      factSheet: /fact ?sheet|_FS_/i.test(`${name} ${desc}`),
      url: `https://apps.ecology.wa.gov/paris/DownloadDocument.aspx?id=${id}` })
  }
  return out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
}
async function parisDocsOf(permit) {
  try {
    const res = await fetch(parisDocs(permit), { headers: UA })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return parisRows(await res.text(), permit)
  } catch (e) { console.warn(`  PARIS ${permit}: ${e.message}`); return null }
}

async function getJson(url) {
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
// Every place a record cites a doc, in words, for the source page's "Used on the map for" list.
function usesOf(records, unmapped) {
  const uses = new Map()
  const add = (key, r, what) => { if (!key) return; if (!uses.has(key)) uses.set(key, []); uses.get(key).push({ id: r.id || null, name: r.name, what }) }
  for (const r of records) {
    add(r.summary?.src, r, 'Description of the work')
    add(r.status?.src, r, 'Status')
    add(r.window?.src, r, 'In-water work window')
    add(r.position?.src, r, 'Position on the map')
    add(r.note?.src, r, 'Note')
    for (const f of r.facts || []) add(f.src, r, f.label)
    for (const x of r.refs || []) add(x.src, r, `Number ${x.label}`)
    for (const t of r.trail || []) add(t.src, r, `${t.date}: ${t.event}`)
    for (const f of r.flags || []) for (const k of f.srcs) add(k, r, 'A disagreement between sources')
  }
  for (const u of unmapped) add(u.src, u, u.summary)
  return uses
}

async function main() {
  const curated = JSON.parse(readFileSync(CURATED, 'utf8'))
  const docs = { ...curated.docs }
  const tags = curated.agency_tags
  const raw = new Map() // doc key → { payload, api, rows }

  // ── NPDES: one record per permit (outfalls are points; the first outfall with a sane position wins) ──
  const outfalls = await query(SERVICES.echoOutfalls, {
    where: "fac_county_name LIKE 'San Juan%' AND state_code='WA'", returnGeometry: 'false',
  })
  const facilities = await query(SERVICES.echoFacilities, {
    where: "NPDES_FLAG='Y' AND FAC_STATE='WA' AND FAC_COUNTY LIKE 'SAN JUAN%'", returnGeometry: 'false',
  })
  const facByPermit = new Map()
  for (const { attributes: a } of facilities) {
    for (const id of String(a.NPDES_IDS || '').split(/[\s,]+/).filter(Boolean)) facByPermit.set(id, a)
  }
  const inBox = (lat, lon) => lon >= BBOX[0] && lon <= BBOX[2] && lat >= BBOX[1] && lat <= BBOX[3]
  const permits = new Map()
  for (const { attributes: a } of outfalls) {
    if (a.permit_status_desc === 'Terminated' || a.permit_termination_date) continue
    const id = a.external_permit_nmbr
    const p = permits.get(id) || {
      permit: id, facility: a.facility_name, permittee: a.permit_name, status: a.permit_status_desc,
      effective: ymd(a.permit_effective_date), expires: ymd(a.permit_expiration_date),
      kind: permitKind(id, a.naics_codes), naics: a.naics_codes || null,
      receiving: new Set(), outfalls: [], rows: [], lat: null, lon: null,
    }
    // ECHO writes the literal string "None" where no receiving water is recorded.
    if (a.state_water_body_name && a.state_water_body_name !== 'None') p.receiving.add(a.state_water_body_name)
    p.outfalls.push(a.perm_feature_nmbr)
    p.rows.push(a)
    if (p.lat == null && inBox(a.latitude83, a.longitude83)) { p.lat = a.latitude83; p.lon = a.longitude83; p.latlongType = a.latlong_type }
    permits.set(id, p)
  }

  // `--dfr-only=<FRS>,<FRS>` limits the per-facility reads (testing); the rest fall back to the facility layer's summary.
  const dfrOnly = process.argv.find((a) => a.startsWith('--dfr-only='))?.slice(11).split(',')
  const dfrs = new Map()
  const dfrOf = async (frs) => {
    if (dfrOnly && !dfrOnly.includes(frs)) return null
    if (!dfrs.has(frs)) {
      try { const j = await getJson(dfrApi(frs)); dfrs.set(frs, j?.Results?.Message === 'Success' || j?.Results ? j : null) } catch (e) { console.warn(`  DFR ${frs}: ${e.message}`); dfrs.set(frs, null) }
    }
    return dfrs.get(frs)
  }

  const npdes = []
  for (const p of permits.values()) {
    const c = curated.npdes_curated[p.permit] || {}
    const fac = facByPermit.get(p.permit)
    const key = `echo-${p.permit}`
    const paris = `ecy-paris-${p.permit}`
    // The permit's readable page: ECHO's facility report (it lists the permit) where EPA ties it to a facility,
    // else Ecology's document list for the permit.
    docs[key] = { title: `EPA ECHO: ${p.kind.toLowerCase()} ${p.permit}`, agency: 'epa', kind: 'Record', record: true,
      url: fac ? echoDfr(fac.REGISTRY_ID) : parisDocs(p.permit), look_up: p.permit }
    raw.set(key, { api: outfallApi(p.permit), payload: { features: p.rows.map((attributes) => ({ attributes })) }, rows: outfallRows(p.rows) })
    docs[paris] = { title: `Ecology permit documents: ${p.permit}`, agency: 'ecology', kind: 'Page', url: parisDocs(p.permit) }
    const ecyDocs = await parisDocsOf(p.permit)
    let fkey = null
    if (fac) {
      fkey = `echo-frs-${fac.REGISTRY_ID}`
      const dfr = await dfrOf(fac.REGISTRY_ID)
      docs[fkey] = { title: `EPA ECHO ${dfr ? 'violations and enforcement' : 'facility compliance'}: ${fac.FAC_NAME}`, agency: 'epa', kind: 'Record', record: true, url: echoDfr(fac.REGISTRY_ID), look_up: fac.REGISTRY_ID }
      raw.set(fkey, dfr ? { api: dfrApi(fac.REGISTRY_ID), payload: dfr, rows: dfrRows(dfr, fac.FAC_NAME), dfr }
        : { api: facilityApi(fac.REGISTRY_ID), payload: { features: [{ attributes: fac }] }, rows: facilityRows(fac) })
    }
    const vio = fkey && raw.get(fkey).dfr ? violationsOf(raw.get(fkey).dfr, p.permit, fkey) : null
    let position
    if (c.pos) position = { lat: c.pos.lat, lon: c.pos.lon, text: c.pos.text, src: c.pos.src }
    else if (p.lat != null) position = { lat: p.lat, lon: p.lon, text: `Position: EPA ECHO's ${String(p.latlongType || 'permit').toLowerCase()} point for this permit.`, src: key }
    else if (fac && inBox(fac.FAC_LAT, fac.FAC_LONG)) position = { lat: fac.FAC_LAT, lon: fac.FAC_LONG, text: "Position: EPA ECHO's facility point (no usable outfall point).", src: fkey }
    else { console.warn(`  ${p.permit}: no position in the county, left off the map`); continue }
    const facts = [
      { label: 'Permit expires', value: p.expires || 'Not stated', src: key },
      ...(p.receiving.size ? [{ label: 'Receiving water', value: [...p.receiving].join('; '), src: key }] : []),
      { label: 'Outfalls / permitted features', value: p.outfalls.join(', '), src: key },
    ]
    const dfrNaics = fkey && raw.get(fkey).dfr?.Results?.NAICS?.Sources?.flatMap((x) => x.NAICSCodes || []).filter((x) => x.SourceID === p.permit)
    if (dfrNaics?.length) facts.push({ label: 'What the facility does (EPA industry codes)', value: [...new Set(dfrNaics.map((x) => x.NAICSDesc))].join('; '), src: fkey })
    if (vio) facts.push(...vio.facts)
    else {
      const comp = complianceText(fac)
      if (comp) facts.push({ label: 'Compliance (ECHO facility, last 13 quarters)', value: comp, src: fkey })
      if (fac?.CWA_DAYS_LAST_INSPECTION != null) facts.push({ label: 'Last inspection', value: `${fac.CWA_DAYS_LAST_INSPECTION} days before ECHO's last refresh`, src: fkey })
    }
    npdes.push({
      id: c.id || `npdes-${p.permit}`, layer: 'npdes', county: 'San Juan',
      name: c.name || p.facility, applicant: p.permittee || p.facility, type: p.kind,
      lat: position.lat, lon: position.lon, approx: false,
      position: { text: position.text, src: position.src },
      refs: [{ label: p.permit, src: key }, { label: `${p.permit}: Ecology's permit documents`, src: paris }, ...(fac ? [{ label: `EPA facility ${fac.REGISTRY_ID}`, src: fkey }] : [])],
      // `raw` is EPA's own term; the app shows it in plain words (src/ships/permitStatus.js) with EPA's term on hover.
      status: { raw: p.status, by: 'EPA ECHO', cls: vio ? vio.cls : complianceClass(fac, p.status), src: key },
      summary: { text: `${p.kind}, ${p.status === 'Admin Continued' ? `expired ${p.expires} and still in force until Ecology reissues it` : `effective ${p.effective} to ${p.expires}`}.`, src: key },
      facts: [...facts, ...(c.extra || [])],
      ...(c.flags ? { flags: c.flags } : {}),
      ...(c.note ? { note: c.note } : {}),
      trail: [
        ...(p.effective ? [{ date: p.effective, agency: 'epa', event: `Permit or coverage effective (${p.permit})`, src: key }] : []),
        ...(fac?.CWA_LAST_PENALTY_DATE ? [{ date: ymd(fac.CWA_LAST_PENALTY_DATE), agency: 'epa', event: `Penalty, $${Number(fac.CWA_LAST_PENALTY_AMT || 0).toLocaleString('en-US')}`, src: fkey }] : []),
        ...(p.expires ? [{ date: p.expires, agency: 'epa', event: p.status === 'Admin Continued' ? 'Permit expired; remains in force until reissued' : 'Coverage expires', src: key }] : []),
        ...(vio ? vio.events : []),
      ],
      joins: c.joins || [],
      ...(ecyDocs?.length ? { ecyDocs: { src: paris, list: ecyDocs } } : {}),
    })
  }
  npdes.sort((a, b) => a.name.localeCompare(b.name))

  // ── Army Corps: every record in the county box from the public feed ──
  const curatedNumbers = new Set(Object.keys(curated.docs).filter((k) => k.startsWith('orm-')).map((k) => k.slice(4)))
  const ormAll = await getJson(ormSearch)
  if ((ormAll.total ?? 0) >= 5000) throw new Error(`ORM feed: ${ormAll.total} Seattle District records; over the 5,000 cap, add paging`)
  const corps = corpsRecords(ormAll.results?.features || [], curatedNumbers, docs, raw)
  const projects = [...curated.projects, ...corps]
  const docked = joinDocks(projects, docs)

  // Every src must name a doc. Checked after the NPDES pass, which adds the echo-<permit> docs curated.json cites.
  const missing = new Set()
  JSON.stringify([projects, curated.unmapped, npdes], (k, v) => {
    if ((k === 'src' || k === 'complianceSrc') && typeof v === 'string' && !docs[v]) missing.add(v)
    if (k === 'srcs') v.forEach((x) => { if (!docs[x]) missing.add(x) })
    return v
  })
  if (missing.size) throw new Error(`src keys missing from docs: ${[...missing].join(', ')}`)

  // ── Receiving waters ──
  const env = { geometry: BBOX.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' }
  const wq = await queryGeojson(SERVICES.wq303d, {
    ...env, where: '1=1', outFields: 'ListingNumber,CategoryCode,ParameterName,MediumName,ListingWaterbodyName,EnvironmentTypeCode,AssessmentUnitNumber',
  })
  // Each listing links to Ecology's own page for that listing, and to it on Ecology's map.
  for (const f of wq.features) {
    const n = f.properties.ListingNumber
    f.properties.doc = `wq-${n}`
    docs[`wq-${n}`] = { title: `Ecology Water Quality Assessment, listing ${n}`, agency: 'ecology', kind: 'Page', url: wqListing(n), map: wqMap(n) }
  }
  const shell = await queryGeojson(SERVICES.shellfish, {
    where: "Region LIKE '%San Juan%'", outFields: 'NAME,CLASS,Reason,ACRES,Updated,GrowingAreaID',
  })
  // DOH's annual report for each growing area, matched by name from its reports page.
  const norm = (s) => String(s).toLowerCase().replace(/\bsoutheast\b/g, 'se').replace(/[^a-z0-9]/g, '')
  const reports = new Map()
  try {
    const html = await (await fetch(DOH_REPORTS, { headers: UA })).text()
    for (const m of html.matchAll(/<a[^>]+href="([^"]+\.pdf)"[^>]*>([^<]+)<\/a>/g)) reports.set(norm(m[2]), new URL(m[1], DOH_REPORTS).href)
  } catch (e) { console.warn(`  DOH reports page: ${e.message}`) }
  const shellIds = new Set()
  for (const f of shell.features) {
    const p = f.properties
    if (typeof p.Updated === 'number') p.Updated = ymd(p.Updated)
    p.doc = `doh-class-${p.GrowingAreaID}`
    shellIds.add(p.GrowingAreaID)
    docs[p.doc] = { title: `DOH shellfish classification: ${p.NAME}`, agency: 'doh', kind: 'Record', record: true, url: null, look_up: p.NAME }
    const pdf = reports.get(norm(p.NAME))
    if (pdf) { p.report = `doh-report-${p.GrowingAreaID}`; docs[p.report] = { title: `DOH annual growing area review: ${p.NAME}`, agency: 'doh', kind: 'PDF', url: pdf } }
    else console.warn(`  shellfish ${p.NAME}: no DOH report found`)
  }

  // ── Raw payloads for every Record doc (one request each; ECHO's came with the layer reads above) ──
  for (const id of shellIds) {
    const key = `doh-class-${id}`
    try { const j = await getJson(shellApi(id)); raw.set(key, { api: shellApi(id), payload: j, rows: shellRows(j.features || []) }) } catch (e) { console.warn(`  ${key}: ${e.message}`) }
  }
  for (const [key, d] of Object.entries(docs)) {
    if (!d.record || raw.has(key) || !d.api) continue
    try {
      const payload = await getJson(d.api)
      const rows = key.startsWith('orm-') ? ormRows(payload) : key.startsWith('census-') ? censusRows(payload) : key.startsWith('wsdot-') ? wsdotRows(payload, d) : []
      raw.set(key, { api: d.api, payload, rows })
    } catch (e) { console.warn(`  ${key}: ${e.message}`) }
  }

  // ── Every join must point at a record that exists ──
  const ids = new Set([...projects, ...npdes].map((r) => r.id).concat(curated.unmapped.map((u) => u.id).filter(Boolean)))
  for (const r of [...projects, ...npdes]) for (const j of r.joins || []) if (!ids.has(j)) console.warn(`  ${r.id}: join to unknown record ${j}`)

  mkdirSync(`${OUT_DIR}/records`, { recursive: true })
  const baked = new Date().toISOString()
  const uses = usesOf([...projects, ...npdes], curated.unmapped)
  let kept = 0
  for (const [key, d] of Object.entries(docs)) {
    if (!d.record) continue
    const file = `${OUT_DIR}/records/${key}.json`
    const r = raw.get(key)
    if (!r) {
      // A failed read never destroys the last good copy.
      if (existsSync(file)) { kept++; continue }
      console.warn(`  ${key}: no payload and no earlier copy`)
    }
    writeFileSync(file, JSON.stringify({
      key, title: d.title, agency: d.agency, publisher: tags[d.agency]?.[1] || d.agency, sender: SENDER[d.agency] || null, url: d.url || null, look_up: d.look_up || null,
      home: HOME[d.agency] || null, licence: LICENCE[d.agency] || null, retrieved: r ? baked : null, api: r?.api || d.api || null,
      rows: r?.rows || [], uses: uses.get(key) || (key.startsWith('doh-class-') ? [{ id: null, name: d.look_up, what: 'Shellfish growing area classification on the map' }] : []),
      payload: r?.payload ?? null,
    }))
  }
  // The client gets readable docs only (no service URLs).
  // Each Record doc carries what the record says (label/value rows), so the popup can show it in full.
  const clientDocs = Object.fromEntries(Object.entries(docs).map(([k, d]) => {
    const { api, ...rest } = d
    const rows = raw.get(k)?.rows
    return [k, rows?.length ? { ...rest, rows } : rest]
  }))

  const meta = {
    baked, curated: curated.compiled, county: 'San Juan County, WA', bbox: BBOX,
    counts: {
      structures: projects.filter((p) => p.layer === 'structures').length, corpsFeed: corps.length,
      local: projects.filter((p) => p.layer === 'local').length,
      npdes: npdes.length, unmapped: curated.unmapped.length,
      wq303d: wq.features.length, shellfish: shell.features.length,
    },
  }
  writeFileSync(`${OUT_DIR}/permits.json`, JSON.stringify({ meta, agencies: curated.agencies, tags, projects, npdes, unmapped: curated.unmapped, docs: clientDocs }))
  writeFileSync(`${OUT_DIR}/wq303d.geojson`, JSON.stringify(wq))
  writeFileSync(`${OUT_DIR}/shellfish.geojson`, JSON.stringify(shell))
  console.log(`dock joins: ${docked}`)
  console.log(`permits.json: ${JSON.stringify(meta.counts)}; source records ${[...raw.keys()].length} read, ${kept} kept from last bake`)
}

main().catch((e) => { console.error(e); process.exit(1) })
