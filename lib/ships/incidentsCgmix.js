/**
 * USCG CGMIX incident mappers (pure; no I/O). docs/SHIP_INCIDENT_SOURCES.md §1–2, §13.
 *
 *   IIR   Incident Investigation Reports: one event per closed investigation (ActivityId).
 *         Payload = every stored IIR result string as received (title, summary, involved
 *         vessels, water segments, personal-casualty summary, vessel status, brief).
 *         getIIRInvolvedParties (people) is never requested.
 *   PSIX  per activity: operational controls (COTP orders, letters of deviation, …) and
 *         port-state-control exam deficiencies. Payload = the result string as received plus
 *         a clearly labelled `context` copied from our stored PSIX vessel record (which PSIX
 *         vessel listed the activity, its start time and port).
 *
 * Time: CGMIX timestamps carry -04:00/-05:00 but the wall clock is UTC (verified on IIR,
 * §1); the raw string is kept in time_raw and time_quality says how it was read.
 * Privacy: narratives (IIR brief, deficiency descriptions) are stored as evidence and in
 * incident_events.narrative, flagged detail.narrative.display = false; queries never return
 * them and getIncidentRecord blanks them. Casualties are counts only.
 */
import { parseDataset, PSIX_SOURCE } from './psix.js'
import { has } from './registry.js'
import { normImo, normName } from './normalize.js'
import { typesFromText, roleFromText, cgmixUtc } from './incidents.js'

export const IIR_SOURCE = {
  id: 'uscg-cgmix-iir',
  name: 'USCG Incident Investigation Reports (IIR)',
  publisher: 'U.S. Coast Guard (MISLE data via the Coast Guard Maritime Information Exchange, CGMIX)',
  homepage_url: 'https://cgmix.uscg.mil/IIR/Default.aspx',
  license: 'U.S. Government work (public domain, 17 U.S.C. § 105); no licence stated on CGMIX',
  license_url: 'https://cgmix.uscg.mil/IIR/Default.aspx',
  commercial_use: true,
  attribution_text: 'U.S. Coast Guard Incident Investigation Reports (CGMIX)',
  attribution_url: 'https://cgmix.uscg.mil/IIR/IIRSearch.aspx',
  notes: 'CGMIX IIRData XML web service (https://cgmix.uscg.mil/xml/IIRData.asmx). Reportable marine casualties (46 CFR 4.05) CLOSED after Oct 2002; open investigations are not published. Reports are redacted by USCG (Privacy Act/HIPAA). Times carry a US-Eastern offset but are UTC wall-clock (verified). Involved parties are never requested; narratives are stored as evidence only and not displayed. No deep links: the IIR search page is a form.',
}
export const IIR_ENTITY_KIND = 'iir_activity'
export const PSIX_OPCONTROL_KIND = 'psix_opcontrol'
export const PSIX_DEFICIENCY_KIND = 'psix_deficiencies'
export { PSIX_SOURCE }

const IIR_SEARCH = 'https://cgmix.uscg.mil/IIR/IIRSearch.aspx'
const PSIX_HOME = 'https://cgmix.uscg.mil/psix/'
const NARRATIVE_FLAG = { display: false, reason: 'narrative may name or describe people; stored as evidence only' }
const TIME_Q = 'utc_mislabelled_offset'
const blank = (v) => !has(v) || /^N\/?A$/i.test(String(v).trim())
const uniq = (a) => [...new Set(a.filter((x) => !blank(x)).map((x) => String(x).trim()))]
const num = (v) => (has(v) && Number.isFinite(Number(v)) ? Number(v) : null)
const bool = (v) => String(v).trim().toLowerCase() === 'true'

function point(lat, lon) {
  const la = num(lat), lo = num(lon)
  if (la == null || lo == null || Math.abs(la) > 90 || Math.abs(lo) > 180 || (la === 0 && lo === 0)) return null
  return { lat: la, lon: lo }
}

/** IIR primary id: an IMO (foreign) or a USCG official number (US); the source does not say which. */
function primaryId(raw) {
  const s = String(raw ?? '').trim()
  if (blank(s)) return {}
  const imo = normImo(s)
  const out = { official_number_raw: s, official_number_scheme: /^\d{1,8}$/.test(s) ? 'us_official_number' : null }
  if (imo.valid && /^\d{7}$/.test(s)) out.imo_raw = s
  return out
}

/** Payload { activity_id, retrieved_at, responses: {op: xml} } → mapped event (or null when IIR has nothing). */
export function mapIir(payload) {
  const id = String(payload.activity_id)
  const R = Object.fromEntries(Object.entries(payload.responses || {}).map(([k, v]) => [k, parseDataset(v)]))
  const titles = R.title || []
  if (!titles.length && !(R.vessels || []).length) return null
  const t0 = titles[0] || {}
  const vessels = []
  for (const v of R.vessels || []) if (!vessels.some((x) => x.MISLEVesselId === v.MISLEVesselId && x.Name === v.Name)) vessels.push(v)
  const names = uniq(vessels.map((v) => v.Name).concat(titles.map((t) => t.Name)))
  const subtypes = uniq(titles.map((t) => t.IncidentSubTypeLookupName))
  const summary = R.summary || []
  const involves = uniq(summary.map((s) => s.IncidentInvolvesLookupName))
  const classification = uniq(summary.map((s) => s.UnitedStatesMarineCasualtyClassificationLookupName))
  const serious = summary.some((s) => bool(s.IsSeriousMarineIncident))
  const board = summary.some((s) => bool(s.IsMarineBoardConvened))
  const damage = uniq((R.status || []).map((s) => s.VesselDamageStatusLookupName))

  // Personal casualties: counts only. A status row with a zero count means "reported, count not given".
  let deaths = null, injuries = null, missing = null
  const reported = { injury: false, death: false, missing: false }
  let atRisk = null
  for (const r of R.casualties || []) {
    const st = String(r.CasualtyStatusLookupName || ''), n = num(r.TotalPeopleAtRisk)
    const k = /dead|deceas|fatal|death|died/i.test(st) ? 'death' : /missing/i.test(st) ? 'missing' : /\binjur/i.test(st) && !/not injured/i.test(st) ? 'injury' : null
    if (!k) { if (/at risk/i.test(st) && !/not at risk/i.test(st) && n != null) atRisk = (atRisk || 0) + n; continue }
    reported[k] = true
    if (n > 0) {
      if (k === 'death') deaths = (deaths || 0) + n
      if (k === 'injury') injuries = (injuries || 0) + n
      if (k === 'missing') missing = (missing || 0) + n
    }
  }
  const title = t0.Title || null
  let titleType = title || ''
  for (const n of names) titleType = titleType.split(n).join(' ')
  const types = typesFromText(...subtypes, titleType)
  const kinds = []
  if (involves.some((x) => /marine casualty/i.test(x)) || !involves.length) kinds.push('casualty')
  if (involves.some((x) => /discharge|pollution|release/i.test(x)) || subtypes.some((x) => /pollution/i.test(x))) kinds.push('pollution')
  if (reported.injury || reported.death || reported.missing || subtypes.some((x) => /injur|life/i.test(x))) kinds.push('injury')
  if (involves.some((x) => /offense|violation/i.test(x))) kinds.push('violation')
  if (!kinds.length) kinds.push('casualty')

  const major = classification.some((c) => /major/i.test(c)) || deaths > 0 || reported.death || damage.some((d) => /total loss|actual total|constructive/i.test(d))
  const severity_rank = major ? 3 : classification.some((c) => /significant/i.test(c)) || serious ? 2 : 1
  const severity_raw = [...classification, ...(serious ? ['Serious Marine Incident'] : []), ...(board ? ['Marine Board convened'] : [])].join(' · ') || null

  const timeRaw = t0.StartDtTm || (R.brief || [])[0]?.StartDtTm || null
  const at = cgmixUtc(timeRaw)
  const w = (R.water || []).find((x) => point(x.Latitude, x.Longitude)) || (R.water || [])[0] || {}
  const p = point(w.Latitude, w.Longitude)
  const loc = uniq([w.Description, w.WaterwayName]).join(', ') || null
  const narrative = uniq((R.brief || []).map((b) => b.IncidentBrief)).join('\n\n') || null

  const refs = []
  const seen = new Set()
  for (const v of vessels) {
    const key = v.MISLEVesselId ? `misle:${v.MISLEVesselId}` : `name:${normName(v.Name)}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ ref_key: key, role_raw: v.VesselRoleLookupName || null, role: roleFromText(v.VesselRoleLookupName),
      name_raw: v.Name || null, uscg_vessel_id: v.MISLEVesselId || null, ...primaryId(v.PrimaryVesselIdentificationNumber),
      detail: { primary_id_type: 'unstated', primary_id_raw: v.PrimaryVesselIdentificationNumber ?? null } })
  }
  return {
    source: IIR_SOURCE, entityKind: IIR_ENTITY_KIND, key: id, payload,
    datasetVersion: `retrieved:${String(payload.retrieved_at).slice(0, 10)}`,
    event: {
      event_kinds: kinds, event_types: types, event_type_raw: subtypes.join(' · ') || null, title,
      occurred_from: at, occurred_to: at, period_kind: at ? 'observed' : 'unknown', time_raw: timeRaw,
      time_quality: at ? TIME_Q : 'missing',
      lat: p?.lat ?? null, lon: p?.lon ?? null, location_text: loc, position_quality: p ? 'source_point' : null,
      severity_raw, severity_rank, deaths, injuries, missing,
      material: null, quantity: null, quantity_unit: null, quantity_to_water: null,
      narrative, report_url: IIR_SEARCH, report_ref: `IIR activity ${id}`, evidence_class: 'official_investigation',
      detail: { title_display: false, narrative: NARRATIVE_FLAG, classification, serious_marine_incident: serious,
        marine_board: board, level_of_investigation: uniq(summary.map((s) => s.LevelOfInvestigationLookupName)),
        imo_incident_type: uniq(summary.map((s) => s.InternationalMaritimeOrganizationIncidentTypeLookupName)),
        involves, subtypes, vessel_damage_status: damage, people_at_risk: atRisk,
        injury_reported: reported.injury, death_reported: reported.death, missing_reported: reported.missing,
        time_note: 'CGMIX StartDtTm carries a US-Eastern offset but is UTC wall-clock (docs/SHIP_INCIDENT_SOURCES.md §1)',
        link_note: 'CGMIX has no per-report URL; search the IIR page for this activity or vessel name' },
    },
    refs,
  }
}

const opType = (t) => (/detain|detention/i.test(t) ? 'detention' : /COTP Order/i.test(t) ? 'cotp_order'
  : /letter of deviation/i.test(t) ? 'letter_of_deviation' : /no sail|hold/i.test(t) ? 'hold' : 'operational_control')

/**
 * PSIX operational control(s) of one activity. Payload { activity_id, retrieved_at, xml,
 * context: { psix_vessel_id, vessel_name, case_start_raw, port } }. Never labelled a detention
 * unless the source's own type says so (docs §2).
 */
export function mapPsixOpControl(payload) {
  const id = String(payload.activity_id)
  const rows = parseDataset(payload.xml)
  if (!rows.length) return null
  const ctx = payload.context || {}
  const imposed = rows.map((r) => r.ImposedDtTm).filter(Boolean).sort()[0] || null
  const removed = rows.every((r) => has(r.RemovedDtTm)) ? rows.map((r) => r.RemovedDtTm).sort().at(-1) : null
  const from = cgmixUtc(imposed), to = cgmixUtc(removed)
  const types = uniq(rows.map((r) => r.TypeLookupName))
  const imoReportable = rows.some((r) => bool(r.IsInternationalMaritimeOrganizationReportable))
  return {
    source: PSIX_SOURCE, entityKind: PSIX_OPCONTROL_KIND, key: id, payload,
    datasetVersion: `retrieved:${String(payload.retrieved_at).slice(0, 10)}`,
    event: {
      event_kinds: ['operational_control'], event_types: uniq(types.map(opType)), event_type_raw: types.join(' · ') || null, title: null,
      occurred_from: from, occurred_to: to && from && to > from ? to : null, period_kind: from ? 'validity' : 'unknown',
      time_raw: [imposed, removed].filter(Boolean).join(' → ') || null,
      time_quality: from ? 'cgmix_offset_read_as_utc_unverified_for_psix' : 'missing',
      lat: null, lon: null, location_text: uniq([...rows.map((r) => r.UnitName), ctx.port]).join(', ') || null, position_quality: null,
      severity_raw: uniq(rows.map((r) => r.ReasonLookupName)).join(' · ') || null, severity_rank: 1,
      deaths: null, injuries: null, missing: null, material: null, quantity: null, quantity_unit: null, quantity_to_water: null,
      narrative: null, report_url: PSIX_HOME, report_ref: `PSIX vessel ${ctx.psix_vessel_id}, activity ${id}`, evidence_class: 'official_record',
      detail: { controls: rows.map((r) => ({ type: r.TypeLookupName ?? null, category: r.CategoryLookupName ?? null, reason: r.ReasonLookupName ?? null,
        unit: r.UnitName ?? null, imposed_raw: r.ImposedDtTm ?? null, removed_raw: r.RemovedDtTm ?? null,
        imo_reportable: bool(r.IsInternationalMaritimeOrganizationReportable) })),
        imo_reportable: imoReportable, still_imposed: !removed,
        note: 'An operational control is not a detention unless its type says so. IMO-reportable = the source flag IsInternationalMaritimeOrganizationReportable (UNVERIFIED that it equals a detention).' },
    },
    refs: [{ ref_key: `misle:${ctx.psix_vessel_id}`, role_raw: 'vessel under the operational control', role: 'subject',
      name_raw: ctx.vessel_name ?? null, uscg_vessel_id: ctx.psix_vessel_id ?? null, detail: { via: 'PSIX vessel cases listing' } }],
  }
}

/** PSIX deficiencies found in one exam (≥ 1 row; an exam with none is not an event). */
export function mapPsixDeficiencies(payload) {
  const id = String(payload.activity_id)
  const rows = parseDataset(payload.xml)
  if (!rows.length) return null
  const ctx = payload.context || {}
  const at = cgmixUtc(ctx.case_start_raw)
  const detained = rows.some((r) => /^\s*30\b|detain/i.test(r.ActionLookupName || ''))
  const vid = rows.find((r) => r.VesselId)?.VesselId || ctx.psix_vessel_id
  const systems = uniq(rows.map((r) => r.SystemLookupName))
  return {
    source: PSIX_SOURCE, entityKind: PSIX_DEFICIENCY_KIND, key: id, payload,
    datasetVersion: `retrieved:${String(payload.retrieved_at).slice(0, 10)}`,
    event: {
      event_kinds: ['psc_deficiency'], event_types: detained ? ['psc_deficiency', 'detention'] : ['psc_deficiency'],
      event_type_raw: `${rows.length} deficienc${rows.length === 1 ? 'y' : 'ies'}: ${systems.join(' · ')}`, title: null,
      occurred_from: at, occurred_to: at, period_kind: at ? 'observed' : 'unknown', time_raw: ctx.case_start_raw ?? null,
      time_quality: at ? 'cgmix_offset_read_as_utc_unverified_for_psix' : 'missing',
      lat: null, lon: null, location_text: ctx.port ?? null, position_quality: null,
      severity_raw: detained ? 'deficiency action code 30 (ship detained), as stated by the source' : null, severity_rank: detained ? 2 : 0,
      deaths: null, injuries: null, missing: null, material: null, quantity: null, quantity_unit: null, quantity_to_water: null,
      narrative: rows.map((r) => r.Description).filter(Boolean).join('\n\n') || null,
      report_url: PSIX_HOME, report_ref: `PSIX vessel ${vid}, activity ${id}`, evidence_class: 'official_record',
      detail: { narrative: NARRATIVE_FLAG, count: rows.length, unresolved: rows.filter((r) => !bool(r.IsResolved)).length,
        port_state_control_exam: ctx.port_state_control_exam ?? null, detention_action_code: detained,
        deficiencies: rows.map((r) => ({ system: r.SystemLookupName ?? null, subsystem: blank(r.SubSystemLookupName) ? null : r.SubSystemLookupName,
          component: r.SystemComponentLookupName ?? null, cause: r.FailureCauseLookupName ?? null, action: r.ActionLookupName ?? null,
          action_code: r.ActionCodeLookupName ?? null, resolved: bool(r.IsResolved), resolved_raw: r.ResolutionDtTm ?? null })) },
    },
    refs: [{ ref_key: `misle:${vid}`, role_raw: 'examined vessel', role: 'subject', name_raw: ctx.vessel_name ?? null,
      uscg_vessel_id: vid ?? null, detail: { via: 'PSIX vessel deficiencies' } }],
  }
}
