/**
 * FCC Universal Licensing System (ULS), ship radio station licences → EarthAtlas
 * claims (pure; no I/O). File format, codes and caveats: docs/VESSEL_REGISTRIES.md §FCC.
 *
 * Input: the weekly "complete" public access file l_ship.zip (pipe-delimited .dat
 * files, one row per record, joined on unique_system_identifier = one licence).
 * One source entity per licence (entity key = the ULS unique system identifier).
 *
 * The raw record is the licence's rows as they appear in the file, EXCEPT personal
 * data, which is withheld before it is ever stored (privacy rule, docs §Privacy):
 * contact fields of every party, the certifier's name/title and demographics on
 * HD, and — for individuals and party types that may be individuals — the name,
 * licensee id, FRN and city/state. Each redacted row keeps the SHA-256 of the
 * original line, so the stored evidence can be verified against the FCC file.
 */
import { createHash } from 'node:crypto'
import { normName, normCallsign, normMmsi } from './normalize.js'
import { parseDate, plainNumber, has, partyPrivacy, FCC_APPLICANT_TYPES, WITHHELD } from './registry.js'

export const FCC_SOURCE = {
  id: 'fcc-uls-ship',
  name: 'FCC Universal Licensing System — ship radio station licences',
  publisher: 'U.S. Federal Communications Commission (FCC), Wireless Telecommunications Bureau',
  homepage_url: 'https://www.fcc.gov/uls/transactions/daily-weekly',
  license: 'U.S. Government work (public domain, 17 U.S.C. § 105)',
  license_url: 'https://www.fcc.gov/licensing-databases/public-access-information',
  commercial_use: true,
  attribution_text: 'FCC Universal Licensing System (ship licences)',
  attribution_url: 'https://data.fcc.gov/download/pub/uls/complete/l_ship.zip',
  notes: 'Weekly complete public access file l_ship.zip. Vessel particulars (name, official number, tonnage, length, ship class) are declared by the applicant, not verified by FCC. The licensee is the radio licence holder, not stated to be the owner. Personal data of individuals is withheld before storage (docs/VESSEL_REGISTRIES.md §Privacy). www.fcc.gov documentation pages refuse automated clients (HTTP 403); the data.fcc.gov bulk file is served normally.',
}
export const FCC_ENTITY_KIND = 'fcc_ship_license'
const EVIDENCE = 'registry'

/** ULS HD license_status. */
export const LICENSE_STATUS = { A: 'Active', C: 'Cancelled', E: 'Expired', L: 'Pending legal status', P: 'Parent station canceled', T: 'Terminated', X: 'Term pending' }
/** Ship radio service codes (HD radio_service_code). */
export const RADIO_SERVICE = { SA: 'Ship recreation or voluntarily equipped', SB: 'Ship compulsory equipment', SE: 'Ship exemption' }
/** FCC Form 605 Schedule B: general class of ship. */
export const GENERAL_CLASS = { MM: 'Merchant', PL: 'Pleasure', SV: 'Rescue', FV: 'Fishing', GV: 'Official service ship' }
/** FCC Form 605 Schedule B: specific class of ship (ITU List V abbreviations). */
export const SPECIAL_CLASS = {
  ACV: 'Air-cushion vehicle', AUX: 'Auxiliary ship', CHA: 'Barge', BLK: 'Bulk carrier', CBL: 'Cable ship',
  PMX: 'Cargo and passenger', CA: 'Cargo ship', CAB: 'Coaster', CON: 'Container ship', BTA: 'Factory ship',
  FBT: 'Ferry', PH: 'Fishing vessel', VDT: 'Hydrofoil', MTB: 'Motorboat', OIL: 'Oil tanker', TPO: 'Ore carrier',
  PA: 'Passenger ship', PLT: 'Pilot tender', FRG: 'Reefer', EXP: 'Research or survey ship', VLR: 'Sailing ship',
  RAM: 'Salvage ship', SLO: 'Sloop', RAV: 'Supply vessel', CIT: 'Tanker', ECO: 'Training ship', TRA: 'Tramp',
  CHR: 'Trawler', TUG: 'Tug', BLN: 'Whaler', YAT: 'Yacht',
}

// Field positions (0-based) from FCC "Public Access Database Definitions" (pa_ddef, 2025-04-17).
const EN = { entity_type: 5, licensee_id: 6, entity_name: 7, first: 8, mi: 9, last: 10, suffix: 11, phone: 12, fax: 13,
  email: 14, street: 15, city: 16, state: 17, zip: 18, po_box: 19, attention: 20, sgin: 21, frn: 22, applicant_type: 23 }
const HD = { callsign: 4, status: 5, service: 6, grant: 7, expired: 8, cancelled: 9, certifier_first: 30, certifier_mi: 31,
  certifier_last: 32, certifier_suffix: 33, certifier_title: 34, sex: 35, african_american: 36, native_american: 37,
  hawaiian: 38, asian: 39, white: 40, ethnicity: 41, effective: 42, last_action: 43 }
const SH = { callsign: 4, authorization: 5, general_class: 7, special_class: 8, ship_name: 9, ship_number: 10,
  international: 11, foreign: 12, gross_tonnage: 15, ship_length: 16, station_number: 21 }

const EN_CONTACT = ['phone', 'fax', 'email', 'street', 'zip', 'po_box', 'attention']
const EN_PERSON = ['licensee_id', 'entity_name', 'first', 'mi', 'last', 'suffix', 'city', 'state', 'frn']
const HD_PERSON = ['certifier_first', 'certifier_mi', 'certifier_last', 'certifier_suffix', 'certifier_title',
  'sex', 'african_american', 'native_american', 'hawaiian', 'asian', 'white', 'ethnicity']

export const splitLine = (text) => String(text).replace(/\r?\n$/, '').split('|')
const sha = (s) => createHash('sha256').update(s).digest('hex')

/** Withhold the named fields of one row; returns the stored line object. */
function redact(file, text, map, fields) {
  const f = splitLine(text)
  const withheld = fields.filter((k) => has(f[map[k]]))
  if (!withheld.length) return { file, text }
  for (const k of withheld) f[map[k]] = '[withheld]'
  return { file, text: f.join('|'), withheld, original_sha256: sha(text) }
}

/**
 * Build the stored raw record for one licence from its rows (as read from the
 * .dat files, grouped by unique_system_identifier). `rows` = { HD: [line], EN: [...], SH: [...], ... }.
 * `dataset` = the file's own creation stamp from its `counts` file.
 */
export function buildLicenseRecord(usi, rows, dataset) {
  const hd = splitLine(rows.HD?.[0] ?? '')
  const lines = []
  for (const file of Object.keys(rows).sort()) {
    for (const text of rows[file]) {
      if (file === 'EN') {
        const f = splitLine(text)
        const licensee = f[EN.entity_type] === 'L'
        const p = partyPrivacy({ applicantType: f[EN.applicant_type], recreational: hd[HD.service] === 'SA' })
        lines.push(redact(file, text, EN, licensee && p.storeName ? EN_CONTACT : [...EN_CONTACT, ...EN_PERSON]))
      } else if (file === 'HD') lines.push(redact(file, text, HD, HD_PERSON))
      else lines.push({ file, text })
    }
  }
  return { usi: String(usi), dataset, lines }
}

/** 'Sun Sep 20 10:49:57 EDT 2026' (the counts file) → ISO UTC. Only EDT/EST are accepted. */
export function fccStamp(raw) {
  const m = /^\w{3} (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (EDT|EST) (\d{4})$/.exec(String(raw ?? '').trim())
  if (!m) return null
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m[1])
  if (mon < 0) return null
  const off = m[6] === 'EDT' ? 4 : 5
  return new Date(Date.UTC(+m[7], mon, +m[2], +m[3] + off, +m[4], +m[5])).toISOString()
}

/** What kind of number the licence files as "official number of ship". */
export function shipNumberScheme(raw) {
  const s = String(raw ?? '').trim().toUpperCase().replace(/[\s-]/g, '')
  if (/^\d{5,8}$/.test(s)) return { scheme: 'us_official_number', value: s.replace(/^0+/, '') }
  if (/^[A-Z]{2}\d{3,4}[A-Z]{1,2}$/.test(s)) return { scheme: 'us_state_registration', value: s, ais_callsign_alias: s.slice(0, 7) }
  return { scheme: 'as_filed', value: normName(s) }
}

/** One licence record → { assertions, warnings, summary }. */
export function mapLicense(rec) {
  const out = []
  const warnings = []
  const get = (file) => rec.lines.filter((l) => l.file === file).map((l) => ({ f: splitLine(l.text), l }))
  const hdRow = get('HD')[0]
  if (!hdRow) return { assertions: [], warnings: ['no HD row'], summary: null }
  const hd = hdRow.f
  const sh = get('SH')[0]?.f ?? []
  const en = get('EN').find((x) => x.f[EN.entity_type] === 'L')?.f ?? null
  const ref = `fcc:${rec.usi}`

  const grant = parseDate(hd[HD.grant]), expired = parseDate(hd[HD.expired])
  let cancelled = parseDate(hd[HD.cancelled])
  if (has(hd[HD.grant]) && !grant) warnings.push(`unparseable grant date ${hd[HD.grant]}`)
  // Placeholder cancellation dates (e.g. 01/01/1900) precede the grant: ignored, kept in the raw record.
  if (cancelled && grant && cancelled.from < grant.from) {
    warnings.push(`cancellation date ${cancelled.text} precedes the grant ${grant.text}; ignored`)
    cancelled = null
  }
  const end = cancelled && (!expired || cancelled.from < expired.until) ? cancelled.from : expired?.until ?? null
  let term = { from: grant?.from ?? null, to: end, kind: grant || end ? 'validity' : 'unknown' }
  if (term.from && term.to && term.from >= term.to) {
    warnings.push(`licence term ${grant.text} → ${end} is empty; stored with unknown dates`)
    term = { from: null, to: null, kind: 'unknown' }
  }
  const termDetail = { licence_grant: grant?.text ?? null, licence_expires: expired?.text ?? null,
    licence_cancelled: cancelled?.text ?? null, period_basis: 'FCC licence term: grant date → cancellation or expiry date (day precision)' }
  const status = hd[HD.status], service = hd[HD.service]
  const push = (a, period = term, extra = {}) => {
    if (!has(a.value_raw) || !has(a.value_norm)) return
    out.push({ attribute: a.attribute, value_raw: String(a.value_raw).trim(), value_norm: String(a.value_norm).trim(),
      period_from: period.from, period_to: period.to, period_kind: period.kind, evidence_class: EVIDENCE, sub_record_ref: ref,
      detail: { licence_status: status, radio_service: service, ...(period === term ? termDetail : {}), ...(a.detail || {}), ...extra } })
  }

  const cs = hd[HD.callsign] || sh[SH.callsign]
  push({ attribute: 'callsign', value_raw: cs, value_norm: normCallsign(cs), detail: { basis: 'call sign assigned by the licence' } })
  if (has(sh[SH.station_number])) {
    const m = normMmsi(sh[SH.station_number])
    push({ attribute: 'mmsi', value_raw: sh[SH.station_number], value_norm: m.value,
      detail: { valid: m.valid, ship_station: m.ship, basis: 'MMSI (station number) assigned by the licence' } })
  }
  const declared = { declared_by_applicant: true }
  push({ attribute: 'name', value_raw: sh[SH.ship_name], value_norm: normName(sh[SH.ship_name]), detail: declared })
  if (has(sh[SH.ship_number])) {
    const n = shipNumberScheme(sh[SH.ship_number])
    push({ attribute: 'official_number', value_raw: sh[SH.ship_number], value_norm: n.value,
      detail: { ...declared, scheme: n.scheme, ...(n.ais_callsign_alias ? { ais_callsign_alias: n.ais_callsign_alias } : {}),
        field: 'SH ship_number ("official number of ship", as filed)' } })
  }
  if (Number(sh[SH.gross_tonnage]) > 0) {
    push({ attribute: 'tonnage_gt', value_raw: sh[SH.gross_tonnage], value_norm: plainNumber(sh[SH.gross_tonnage]),
      detail: { ...declared, note: 'as filed; the licence does not say gross tonnage vs gross register tons' } })
  }
  if (Number(sh[SH.ship_length]) > 0) {
    push({ attribute: 'length_m', value_raw: sh[SH.ship_length], value_norm: plainNumber(sh[SH.ship_length]),
      detail: { ...declared, unit_basis: 'FCC does not document the unit. Against AIS length for 1,266 of our vessels the median ratio is 1.00, so metres (UNVERIFIED); ~3% look like feet.' } })
  }
  const g = sh[SH.general_class], s = sh[SH.special_class]
  if (has(g) || has(s)) {
    push({ attribute: 'vessel_type',
      value_raw: [g && `${g} ${GENERAL_CLASS[g] ?? '(code not in Form 605)'}`, s && `${s} ${SPECIAL_CLASS[s] ?? '(code not in Form 605)'}`].filter(Boolean).join(' / '),
      value_norm: `FCC_${g || '-'}_${s || '-'}`,
      detail: { ...declared, general_class: g || null, special_class: s || null,
        general_label: GENERAL_CLASS[g] ?? null, special_label: SPECIAL_CLASS[s] ?? null } })
  }
  // The licence itself, with its term as validity.
  push({ attribute: 'certificate', value_raw: `FCC ship station licence ${cs} (${RADIO_SERVICE[service] ?? service})`,
    value_norm: `FCC_LICENCE_${rec.usi}`, detail: { document: 'FCC ship station licence', uls_usi: rec.usi } })
  // Status as of the file's creation (a snapshot).
  const snap = rec.dataset?.created_utc ?? null
  if (has(status)) {
    push({ attribute: 'registration_status', value_raw: `${LICENSE_STATUS[status] ?? status} (FCC licence)`, value_norm: `FCC_${status}` },
      snap ? { from: snap, to: snap, kind: 'observed' } : { from: null, to: null, kind: 'unknown' },
      { basis: 'licence status in the weekly FCC file', file_created: rec.dataset?.created ?? null })
  }
  // Licensee (privacy rule).
  if (en) {
    const p = partyPrivacy({ applicantType: en[EN.applicant_type], recreational: service === 'SA' })
    const t = en[EN.applicant_type]
    const name = en[EN.entity_name] || [en[EN.first], en[EN.last]].filter(has).join(' ')
    const stored = p.storeName && has(name) && name !== '[withheld]'
    push({ attribute: 'radio_licensee', value_raw: stored ? name : WITHHELD.value_raw, value_norm: stored ? normName(name) : WITHHELD.value_norm,
      detail: { display: p.display && stored, display_reason: stored ? p.reason : (p.reason ?? 'name_not_stored'), party_kind: p.kind,
        applicant_type: t || null, applicant_type_label: FCC_APPLICANT_TYPES[t] ?? null,
        role_note: 'FCC ship-station licensee (radio licence holder). The FCC does not state that it owns the vessel.' } })
  }
  return { assertions: out, warnings,
    summary: { usi: rec.usi, callsign: cs, mmsi: sh[SH.station_number] || null, status, service } }
}

/** Parse a .dat file's text into rows grouped by unique_system_identifier (only USIs in `keep`, if given). */
export function groupByUsi(text, keep = null) {
  const out = new Map()
  for (const line of String(text).split('\n')) {
    if (!line) continue
    const t = line.replace(/\r$/, '')
    const usi = t.split('|', 3)[1]
    if (keep && !keep.has(usi)) continue
    ;(out.get(usi) || out.set(usi, []).get(usi)).push(t)
  }
  return out
}

export const SH_FIELDS = SH

/**
 * The stored record as it may leave the server (getRecord): names that are
 * stored but not displayable (an organisation on a recreational licence) are
 * withheld here too, so the raw-record view can't reveal what the claim hides.
 */
export function publicLicenseRecord(rec) {
  const hd = splitLine(rec?.lines?.find((l) => l.file === 'HD')?.text ?? '')
  return { ...rec, lines: (rec?.lines ?? []).map((l) => {
    if (l.file !== 'EN') return l
    const f = splitLine(l.text)
    const p = partyPrivacy({ applicantType: f[EN.applicant_type], recreational: hd[HD.service] === 'SA' })
    if (p.display) return l
    const fields = EN_PERSON.filter((k) => has(f[EN[k]]) && f[EN[k]] !== '[withheld]')
    if (!fields.length) return l
    for (const k of fields) f[EN[k]] = '[withheld]'
    return { ...l, text: f.join('|'), withheld_on_output: fields }
  }) }
}
