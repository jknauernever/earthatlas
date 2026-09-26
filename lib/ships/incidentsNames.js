/**
 * Name-only incident sources → incidents (pure; no I/O). docs/SHIP_INCIDENT_SOURCES.md §4, §6, §13.
 *
 *   NRC           National Response Center reports (INITIAL, unvalidated). Vessel name, type,
 *                 flag and length per vessel row; no IMO / MMSI / call sign / official number.
 *   IncidentNews  NOAA OR&R incident list; the vessel appears only in the title.
 *
 * Both give names only, so every vessel link is a CANDIDATE (never accepted automatically,
 * never shown on the card). Recreational boats get no name (privacy; see incidentsEcology.js).
 * Dates are local with no zone → day precision.
 *
 * NRC privacy: the CALLS sheet's responsible-party columns (company / person, city, state,
 * ZIP) are dropped BEFORE storage; the payload keeps the SHA-256 of the original row so the
 * stored evidence stays verifiable against the public file (same rule as FCC licensees,
 * docs/VESSEL_REGISTRIES.md §Privacy). The caller's free-text description is stored as
 * evidence only (narrative, not displayed).
 */
import { normName } from './normalize.js'
import { typesFromText } from './incidents.js'
import { vesselNameFromCaseName } from './incidentsEcology.js'
import { sha256, canonicalJson } from './store.js'

export const NRC_SOURCE = {
  id: 'uscg-nrc',
  name: 'National Response Center (NRC) incident reports',
  publisher: 'U.S. Coast Guard, National Response Center',
  homepage_url: 'https://nrc.uscg.mil/',
  license: 'U.S. Government work (17 U.S.C. § 105); no licence stated',
  license_url: 'https://nrc.uscg.mil/',
  commercial_use: true,
  attribution_text: 'National Response Center (U.S. Coast Guard): initial reports',
  attribution_url: 'https://nrc.uscg.mil/',
  notes: 'Yearly FOIA workbooks https://nrc.uscg.mil/FOIAFiles/CYnn.xlsx. The NRC states they contain INITIAL incident data that has not been validated or investigated. Vessel names only → candidate links only. Responsible-party columns are dropped before storage (privacy). Dates local, zone unstated → day precision.',
}
export const NRC_ENTITY_KIND = 'nrc_report'

export const INCIDENTNEWS_SOURCE = {
  id: 'noaa-incidentnews',
  name: 'NOAA IncidentNews (Office of Response and Restoration)',
  publisher: 'NOAA Office of Response and Restoration',
  homepage_url: 'https://incidentnews.noaa.gov/',
  license: 'Public domain ("The contents are in the public domain; there is no copyright restriction.")',
  license_url: 'https://incidentnews.noaa.gov/',
  commercial_use: true,
  attribution_text: 'NOAA IncidentNews',
  attribution_url: 'https://incidentnews.noaa.gov/',
  notes: 'https://incidentnews.noaa.gov/raw/incidents.csv. Selected incidents where OR&R provided scientific support; open_date = date OR&R was notified; lat/lon may be approximate. Vessel names only in titles → candidate links only.',
}
export const INCIDENTNEWS_ENTITY_KIND = 'incidentnews_incident'

const REGNO = /\b[A-Z]{2}\s?\d{3,4}\s?[A-Z]{1,2}\b/g
const GENERIC = new Set(['UNKNOWN', 'UNK', 'NA', 'NONE', 'NOTPROVIDED', 'NOTKNOWN', 'VARIOUS', 'MULTIPLE', 'VESSEL', 'BOAT', 'BARGE', 'TUG'])
const num = (v) => (v == null || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const uniq = (a) => [...new Set(a.filter((x) => x != null && String(x).trim() !== '').map((x) => String(x).trim()))]
const CASUALTY_TYPES = ['grounding', 'fire', 'explosion', 'sinking', 'collision', 'allision', 'flooding', 'capsize']
/** pollution (a release reached water / an oil or chemical threat), casualty (by type); otherwise just a 'report'. */
const kindsOf = (pollution, types) => {
  const k = [...(pollution ? ['pollution'] : []), ...(types.some((t) => CASUALTY_TYPES.includes(t)) ? ['casualty'] : [])]
  return k.length ? k : ['report']
}
const yes = (v) => /^y/i.test(String(v ?? '').trim())

/** 'M/D/YYYY[ H:MM]' (local, no zone) → the calendar day at UTC day precision. */
export function dayOf(raw) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(raw ?? '').trim()) || null
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? '').trim())
  const [y, mo, d] = m ? [+m[3], +m[1], +m[2]] : iso ? [+iso[1], +iso[2], +iso[3]] : []
  if (!y) return null
  const t = new Date(Date.UTC(y, mo - 1, d))
  if (t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null
  return { from: t.toISOString(), to: new Date(t.getTime() + 86400000).toISOString() }
}

/** Degrees / minutes / seconds / quadrant → decimal degrees, or null. */
export function dms(deg, min, sec, quad) {
  const d = num(deg)
  if (d == null) return null
  const v = d + (num(min) || 0) / 60 + (num(sec) || 0) / 3600
  return /^[SW]/i.test(String(quad ?? '').trim()) ? -v : v
}

const recreationalType = (t) => /pleasure|recreation|personal water|jet ?ski|sail ?boat|yacht/i.test(String(t ?? ''))

/** NRC vessel name → cleaned name, or null (generic, too short, recreational). */
export function nrcVesselName(row) {
  if (recreationalType(row.VESSEL_TYPE)) return null
  const s = String(row.VESSEL_NAME ?? '').replace(REGNO, ' ').replace(/\s+/g, ' ').trim()
  const n = normName(s)
  return n.length >= 3 && !GENERIC.has(n) ? s : null
}

/** Drop the responsible-party columns from a CALLS row, keeping the original row's hash. */
export const NRC_CALLS_DROP = ['RESPONSIBLE_COMPANY', 'RESPONSIBLE_ORG_TYPE', 'RESPONSIBLE_CITY', 'RESPONSIBLE_STATE', 'RESPONSIBLE_ZIP']
export function redactNrcCall(row) {
  if (!row) return { call: null, redaction: null }
  const call = Object.fromEntries(Object.entries(row).filter(([k]) => !NRC_CALLS_DROP.includes(k)))
  return { call, redaction: { dropped_columns: NRC_CALLS_DROP.filter((k) => k in row), original_row_sha256: sha256(canonicalJson(row)),
    rule: 'responsible-party fields can name private individuals; dropped before storage (docs/SHIP_INCIDENT_SOURCES.md §13)' } }
}

/**
 * Payload { seqnos, file, file_last_modified, retrieved_at, call, redaction, commons, details, materials: [], vessels: [] }
 * (one NRC report; rows exactly as in the workbook except the dropped CALLS columns).
 */
export function mapNrc(payload) {
  const c = payload.commons || {}
  const det = payload.details || {}
  const key = String(payload.seqnos)
  const day = dayOf(c.INCIDENT_DATE_TIME) || dayOf(payload.call?.DATE_TIME_RECEIVED)
  const lat = dms(c.LAT_DEG, c.LAT_MIN, c.LAT_SEC, c.LAT_QUAD), lon = dms(c.LONG_DEG, c.LONG_MIN, c.LONG_SEC, c.LONG_QUAD)
  const okPos = lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && lat > 40 && lat < 50 && lon > -130 && lon < -116
  const mats = payload.materials || []
  const inWater = mats.filter((m) => yes(m.IF_REACHED_WATER))
  const units = uniq(inWater.map((m) => m.UNIT_OF_MEASURE_REACH_WATER)).filter((u) => !/unknown/i.test(u))
  const toWater = units.length === 1 ? inWater.reduce((s, m) => s + (num(m.AMOUNT_IN_WATER) || 0), 0) : null
  const aground = (payload.vessels || []).some((v) => yes(v.IS_VESSEL_AGROUND))
  const types = uniq([...typesFromText(c.INCIDENT_CAUSE, c.TYPE_OF_INCIDENT), ...(aground ? ['grounding'] : []), ...(yes(det.FIRE_INVOLVED) ? ['fire'] : []),
    ...(inWater.length ? ['spill'] : [])])
  const deaths = yes(det.ANY_FATALITIES) ? num(det.NUMBER_FATALITIES) : null
  const injuries = yes(det.ANY_INJURIES) ? num(det.NUMBER_INJURED) : null
  const refs = []
  ;(payload.vessels || []).forEach((v, i) => {
    const name = nrcVesselName(v)
    if (!name) return
    refs.push({ ref_key: `row${i}:${normName(name)}`, role_raw: null, role: 'involved', name_raw: name, flag_raw: v.FLAG || null,
      vessel_type_raw: v.VESSEL_TYPE || null, detail: { name_only: true, length_raw: v.VESSEL_LENGTH || null, aground: yes(v.IS_VESSEL_AGROUND) } })
  })
  return {
    source: NRC_SOURCE, entityKind: NRC_ENTITY_KIND, key, payload,
    datasetVersion: `${payload.file}${payload.file_last_modified ? `:${String(payload.file_last_modified).slice(0, 10)}` : ''}`,
    event: {
      event_kinds: kindsOf(inWater.length > 0, types),
      event_types: types, event_type_raw: uniq([c.TYPE_OF_INCIDENT, c.INCIDENT_CAUSE]).join(' · ') || null, title: null,
      occurred_from: day?.from ?? null, occurred_to: day?.to ?? null, period_kind: day ? 'validity' : 'unknown',
      time_raw: c.INCIDENT_DATE_TIME || payload.call?.DATE_TIME_RECEIVED || null, time_quality: day ? 'date_only_local_zone_unstated' : 'missing',
      lat: okPos ? lat : null, lon: okPos ? lon : null,
      location_text: uniq([c.LOCATION_NEAREST_CITY, c.LOCATION_COUNTY ? `${c.LOCATION_COUNTY} County` : null, c.LOCATION_STATE, det.BODY_OF_WATER]).join(', ') || null,
      position_quality: lat == null ? null : okPos ? 'reporter_supplied' : 'rejected_implausible',
      severity_raw: null, severity_rank: deaths > 0 || types.includes('sinking') ? 2 : 1, deaths, injuries, missing: null,
      material: uniq(mats.map((m) => m.NAME_OF_MATERIAL)).join(' · ') || null,
      quantity: null, quantity_unit: units.length === 1 ? units[0] : null, quantity_to_water: toWater || null,
      narrative: c.DESCRIPTION_OF_INCIDENT || null, report_url: NRC_SOURCE.homepage_url, report_ref: `NRC report ${key} (${payload.file})`,
      evidence_class: 'initial_report',
      detail: { narrative: { display: false, reason: 'caller-supplied free text; may name people' }, initial_report: true,
        materials: mats.map((m) => ({ name: m.NAME_OF_MATERIAL || null, amount: m.AMOUNT_OF_MATERIAL || null, unit: m.UNIT_OF_MEASURE || null,
          reached_water: m.IF_REACHED_WATER || null, in_water: m.AMOUNT_IN_WATER || null, in_water_unit: m.UNIT_OF_MEASURE_REACH_WATER || null })),
        caveat: 'INITIAL incident data, not validated or investigated by a response agency (NRC)' },
    },
    refs,
  }
}

/** IncidentNews CSV row → mapped event. Payload { row, retrieved_at, file_url }. */
export function mapIncidentNews(payload) {
  const r = payload.row || {}
  const key = String(r.id)
  const day = dayOf(r.open_date)
  const lat = num(r.lat), lon = num(r.lon)
  const [titleHead, titlePlace] = String(r.name || '').split(';')
  const name = vesselNameFromCaseName(titleHead)
  const types = typesFromText(titleHead, r.tags)
  return {
    source: INCIDENTNEWS_SOURCE, entityKind: INCIDENTNEWS_ENTITY_KIND, key, payload,
    datasetVersion: `retrieved:${String(payload.retrieved_at).slice(0, 10)}`,
    event: {
      event_kinds: kindsOf(/oil|chemical/i.test(r.threat || ''), types),
      event_types: types, event_type_raw: uniq([r.threat, r.tags]).join(' · ') || null, title: r.name || null,
      occurred_from: day?.from ?? null, occurred_to: day?.to ?? null, period_kind: day ? 'validity' : 'unknown',
      time_raw: r.open_date || null, time_quality: day ? 'date_only_noaa_notified' : 'missing',
      lat: lat != null && Math.abs(lat) <= 90 ? lat : null, lon: lon != null && Math.abs(lon) <= 180 ? lon : null,
      location_text: (titlePlace || r.location || '').trim() || null, position_quality: lat != null ? 'approximate_per_source' : null,
      severity_raw: null, severity_rank: types.includes('sinking') || num(r.max_ptl_release_gallons) >= 1000 ? 2 : 1,
      deaths: null, injuries: null, missing: null, material: r.commodity || null,
      quantity: null, quantity_unit: null, quantity_to_water: null,
      narrative: r.description || null, report_url: `https://incidentnews.noaa.gov/incident/${encodeURIComponent(key)}`,
      report_ref: `IncidentNews ${key}`, evidence_class: 'news_summary',
      detail: { title_display: false, narrative: { display: false, reason: 'free text; stored as evidence only' },
        max_potential_release_gallons: num(r.max_ptl_release_gallons), tags: r.tags || null,
        date_note: 'open_date is the date NOAA OR&R was notified' },
    },
    refs: name ? [{ ref_key: `name:${normName(name)}`, role: 'involved', name_raw: name, detail: { name_only: true, extracted_from: 'title' } }] : [],
  }
}

/** IncidentNews rows the import keeps: WA / BC waters box, and the title indicates a vessel. */
export const IN_BOX = { latMin: 46.0, latMax: 50.8, lonMin: -128.5, lonMax: -121.0 }
export function incidentNewsWanted(r) {
  const lat = num(r.lat), lon = num(r.lon)
  if (lat == null || lon == null || lat < IN_BOX.latMin || lat > IN_BOX.latMax || lon < IN_BOX.lonMin || lon > IN_BOX.lonMax) return false
  return /\b(F\/V|M\/V|T\/V|S\/V|R\/V|FV|MV|tug|barge|ship|vessel|ferry|boat|tanker|freighter|sinking|sunk|sank|aground|grounding|capsiz|collision|allision)\b/i.test(String(r.name || ''))
}
