/**
 * /ship-intake matching (shared by scripts/ships/intake.mjs and the web intake page, lib/ships/intakeWeb.js).
 * For each boat on an operator's page: the vessels we hold under that name, the FCC ship licences under that name (with
 * their MMSI, licensee organisation and status), and USCG PSIX records we don't hold yet, each with the signals that tie
 * it to this operator. Read-only; nothing here writes. Decisions are the reviewer's (Josh), never automatic.
 */
import { normName } from './normalize.js'
import { lengthsAgree } from './resolve.js'
import { parseDataset } from './psix.js'
import { classifyClaims } from './taxonomy.js'

// Words that say nothing about which company it is.
const FILLER = new Set(['LLC', 'INC', 'CO', 'CORP', 'COMPANY', 'LTD', 'THE', 'AND', 'OF', 'CHARTERS', 'CHARTER', 'MARINE', 'SERVICES',
  'SERVICE', 'TOURS', 'CRUISES', 'BOATS', 'BOAT', 'WATER', 'TAXI', 'FERRY', 'TRANSPORTATION'])
const words = (s) => new Set(String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !FILLER.has(w)))
/**
 * A party names the operator when it carries the operator's distinctive words: ALL of them for a name of up to three
 * (place words are common: "San Juan Charters" is not "San Juan Safaris"; "Fishers Island Ferry District" is not
 * "Island Express Charters"), two thirds of them for a longer name.
 */
export const namesOperator = (party, op) => { const O = words(op), P = words(party); const n = [...O].filter((w) => P.has(w)).length
  return O.size > 0 && n >= (O.size <= 3 ? O.size : Math.ceil((O.size * 2) / 3)) }
const US_MID = /^(303|338|366|367|368|369)/
export const midPlace = (mmsi) => (!mmsi ? null : US_MID.test(mmsi) ? (mmsi.startsWith('303') ? 'US (Alaska)' : 'US')
  : /^31[06]/.test(mmsi) ? 'Canada' : `MID ${mmsi.slice(0, 3)}`)
/** A company name without its legal suffix, for comparing owners: "Outer Island Expeditions, LLC" = "Outer Island Expeditions". */
export const companyKey = (s) => normName(String(s || '').replace(/[,.]?\s*\b(L\.?L\.?C|INC(ORPORATED)?|CO(MPANY)?|CORP(ORATION)?|LTD|LIMITED|L\.?P)\.?\s*$/i, ''))
const toM = (raw) => { const n = parseFloat(String(raw)); if (!Number.isFinite(n)) return null; return /ft/i.test(String(raw)) ? n * 0.3048 : n }

/** Signals for one candidate: { ok: true|false, text } each. */
export function signals(intake, boat, { lengths = [], parties = [], salishAis = false, mmsis = [] }) {
  const out = []
  const ft = Number(boat.facts?.length_ft)
  if (ft > 0 && lengths.length) {
    const m = ft * 0.3048
    out.push(lengths.some((x) => lengthsAgree(m, x)) ? { ok: true, text: `length ${ft} ft agrees` }
      : { ok: false, text: `length differs (${lengths.map((x) => `${(x / 0.3048).toFixed(0)} ft`).join(', ')})` })
  }
  const tied = parties.filter((p) => namesOperator(p, intake.operator.name))
  if (tied.length) out.push({ ok: true, strong: true, text: `licensee/owner names the operator (${tied.join('; ')})` })
  if (salishAis) out.push({ ok: true, text: 'seen on Salish Sea AIS (NOAA)' })
  const country = intake.operator.country
  if (country && mmsis.length) {
    const places = [...new Set(mmsis.map(midPlace))]
    const want = country === 'US' ? /^US/ : country === 'CA' ? /^Canada/ : null
    if (want) out.push({ ok: places.some((p) => want.test(p)), text: `MMSI country ${places.join(', ')}` })
  }
  return out
}

// Short names for the sources a vessel record is built from (shown on the intake page's "Built from" line).
const SOURCE_SHORT = { 'fcc-uls-ship': 'FCC licence', 'uscg-psix': 'USCG registry', 'uscg-cgmix-iir': 'USCG incident reports',
  'marinecadastre-ais': 'NOAA AIS', 'gfw-vessel-identity': 'GFW AIS', 'gfw-4wings-ais': 'GFW AIS', 'wikidata': 'Wikidata',
  'wikimedia-commons': 'Wikimedia Commons', 'tc-vessel-registry': 'Transport Canada registry' }
const sourceShort = (id) => SOURCE_SHORT[id] || (String(id).startsWith('operator-site-') ? 'operator website' : id)

/** The vessels we hold under one normalized name, with what the review shows about each. */
export async function ourVessels(q, S, norm) {
  const ids = (await q(`SELECT DISTINCT vessel_id FROM ${S}.vessel_assertions WHERE attribute = 'name' AND value_norm = $1
                          AND evidence_class <> 'operator_published'`, [norm])).map((r) => r.vessel_id)
  const out = []
  for (const id of ids) {
    const rows = await q(`SELECT attribute, value_raw, value_norm, evidence_class, source_id, detail, upper(period) AS "to"
                            FROM ${S}.vessel_assertions WHERE vessel_id = $1
                             AND attribute IN ('name', 'mmsi', 'length_m', 'radio_licensee', 'registry_owner', 'owner', 'registered_owner', 'operator', 'official_number',
                                               'port_of_registry', 'flag')`, [id])
    const vals = (a, f = () => true) => [...new Set(rows.filter((r) => r.attribute === a && f(r)).map((r) => r.value_raw))]
    const lastSeen = rows.filter((r) => r.attribute === 'mmsi' && /^ais/.test(r.evidence_class) && r.to)
      .map((r) => String(r.to.toISOString?.() ?? r.to).slice(0, 10)).sort().at(-1) || null
    const parties = [...vals('radio_licensee', (r) => r.detail?.display !== false), ...vals('registry_owner'), ...vals('owner'),
      ...vals('registered_owner'), ...vals('operator', (r) => r.evidence_class !== 'operator_published')]
    // What the record is built from: each source with its number of claims and the dates they cover. Dates come only from
    // dated claims: not undated ones, and not GFW's whole-year type estimates (they would stretch 5 days of AIS to a year);
    // an open-ended validity period (a licence running to 2034) counts up to today.
    const built = await q(`SELECT source_id, count(*)::int AS n,
                                  to_char(min(lower(period)) FILTER (WHERE dated), 'YYYY-MM-DD') AS "from",
                                  to_char(max(least(upper(period), now())) FILTER (WHERE dated), 'YYYY-MM-DD') AS "to"
                             FROM (SELECT source_id, period, period_kind <> 'unknown' AND coalesce(detail->>'granularity', '') <> 'year' AS dated
                                     FROM ${S}.vessel_assertions WHERE vessel_id = $1 AND evidence_class <> 'operator_published') x
                            GROUP BY source_id ORDER BY count(*) DESC`, [id])
    // The kind of ship its records give it now, the same reading as its ship card (taxonomy.classifyClaims), without
    // anything an operator's page added: what the boat would be if the reviewer picks no kind.
    const types = await q(`SELECT attribute, source_id, evidence_class, value_raw, value_norm, detail, period_kind,
                                  lower(period) AS "from", upper(period) AS "to"
                             FROM ${S}.vessel_assertions WHERE vessel_id = $1 AND attribute = 'vessel_type' AND evidence_class <> 'operator_published'`, [id])
    const now = new Date().toISOString()
    const k = classifyClaims(types, { from: now, to: now, keepObserved: true })
    const kind = !k.group || k.group === 'unknown' ? (k.conflict ? 'sources disagree' : 'not known')
      : k.class && !String(k.class).endsWith('_unspecified') ? `${k.groupLabel} · ${k.classLabel}` : `${k.groupLabel} · type not known`
    // The name the page searched for first (a record can carry another boat's AIS name under a shared blank MMSI).
    const names = vals('name').sort((x, y) => (normName(y) === norm) - (normName(x) === norm)).slice(0, 6)
    out.push({ vessel_id: id, names, mmsis: vals('mmsi'), last_ais: lastSeen, parties, kind,
      built_from: built.map((b) => ({ source: sourceShort(b.source_id), n: b.n, from: b.from, to: b.to })),
      records: built.reduce((a, b) => a + b.n, 0),
      official_numbers: vals('official_number'),
      // Where it is registered: home port (registry) and flag, as the sources give them.
      home_ports: vals('port_of_registry').slice(0, 3), flags: [...new Set(vals('flag').map((f) => String(f).replace(/\s*\(Q\d+\)$/, '').toUpperCase()))].slice(0, 3),
      lengths_m: [...new Set(rows.filter((r) => r.attribute === 'length_m').map((r) => toM(r.value_raw)).filter(Boolean).map((x) => +x.toFixed(1)))],
      salish_ais: rows.some((r) => r.source_id === 'marinecadastre-ais') })
  }
  return out
}

/** FCC licences by normalized name, from the fcc_ship_lookup table (migration 038). { missing, hits: { norm: [licence] } } */
export async function fccFromTable(q, S, norms) {
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM (SELECT 1 FROM ${S}.fcc_ship_lookup LIMIT 1) x`)
  if (!n) return { missing: true, hits: {} }
  const rows = await q(`SELECT usi, callsign, ship_name AS name, name_norm, mmsi, length_m, status, service,
                               licensee_org AS licensee, licensee_place AS place
                          FROM ${S}.fcc_ship_lookup WHERE name_norm = ANY($1)`, [[...norms]])
  const hits = {}
  for (const r of rows) (hits[r.name_norm] ||= []).push({ ...r, length_m: r.length_m == null ? null : Number(r.length_m) })
  return { missing: false, hits }
}

/** USCG PSIX records whose name is exactly this boat's (one summary search). */
export async function psixByName(client, name) {
  const r = await client.call('summary', { VesselName: String(name).toUpperCase() })
  const want = normName(name)
  return parseDataset(r.xml).filter((x) => normName(x.VesselName || '') === want).map((x) => ({
    psix_id: x.VesselId, name: x.VesselName, callsign: /^N\/?A$/i.test(x.VesselCallSign || '') ? null : x.VesselCallSign,
    official_number: x.Identification || null, service: x.ServiceType || null, built: x.ConstructionCompletedYear || null,
    status: x.StatusLookupName || null, country: x.CountryLookupName || null }))
}

/**
 * The review for a whole intake: per boat { name, ours: [vessel + fcc + signals], fcc_not_held, fcc_hidden,
 * psix_not_held, psix_hidden, psix_error, suggestion }. `fcc` = { missing, hits } (fccFromTable or the CLI's file reader);
 * `psix` = a psixClient or null.
 */
export async function reviewIntake(q, S, intake, { fcc, psix = null }) {
  const allUsis = Object.values(fcc.hits).flat().map((h) => h.usi)
  const heldUsis = new Set(allUsis.length ? (await q(`SELECT entity_key FROM ${S}.source_entities WHERE source_id = 'fcc-uls-ship' AND entity_key = ANY($1)`,
    [allUsis])).map((r) => r.entity_key) : [])
  const boats = []
  for (const b of intake.boats) {
    const n = normName(b.name)
    const ours = await ourVessels(q, S, n)
    // FCC licences under this name whose MMSI one of our vessels carries: shown on that vessel (held or not).
    for (const v of ours) {
      v.fcc = (fcc.hits[n] || []).filter((h) => h.mmsi && v.mmsis.includes(h.mmsi))
      for (const h of v.fcc) if (h.licensee && !v.parties.includes(h.licensee)) v.parties.push(h.licensee)
      v.signals = signals(intake, b, { lengths: v.lengths_m, parties: v.parties, salishAis: v.salish_ais, mmsis: v.mmsis })
    }
    const onOurs = new Set(ours.flatMap((v) => v.fcc.map((h) => h.usi)))
    const fccNew = (fcc.hits[n] || []).filter((h) => !heldUsis.has(h.usi) && !onOurs.has(h.usi)).map((h) => ({ ...h,
      signals: signals(intake, b, { lengths: h.length_m ? [h.length_m] : [], parties: h.licensee ? [h.licensee] : [], mmsis: h.mmsi ? [h.mmsi] : [] }) }))
    const ourOfficial = new Set(ours.flatMap((v) => v.official_numbers))
    let psixAll = null, psixError = null
    if (psix) try { psixAll = (await psixByName(psix, b.name)).filter((x) => !ourOfficial.has(x.official_number)) }
    catch (e) { psixError = String(e.message).slice(0, 80) }
    // Shown: licences with an MMSI and commercial (non-recreational) USCG records; the rest are counted.
    boats.push({ name: b.name, ours, decision: b.match ?? null, psix_error: psixError,
      fcc_not_held: fccNew.filter((h) => h.mmsi), fcc_hidden: fccNew.filter((h) => !h.mmsi),
      psix_not_held: psixAll?.filter((x) => !/^Recreational$/i.test(x.service || '')) ?? null,
      psix_hidden: psixAll?.filter((x) => /^Recreational$/i.test(x.service || '')) ?? null })
  }
  // A licensee / owner that also holds a same-name vessel for ANOTHER boat on this page ties the operator's boats together.
  const holders = new Map()
  for (const r of boats) for (const v of r.ours) for (const p of v.parties) {
    const k = companyKey(p); if (!k) continue; if (!holders.has(k)) holders.set(k, new Set()); holders.get(k).add(r.name)
  }
  for (const r of boats) {
    for (const v of r.ours) {
      const others = [...new Set(v.parties.flatMap((p) => [...(holders.get(companyKey(p)) || [])].filter((x) => x !== r.name).map((x) => `${x} (${p})`)))]
      if (others.length) v.signals.push({ ok: true, strong: true, text: `same licensee/owner as ${others.join(', ')}` })
    }
    markFragments(r.ours)
    r.suggestion = suggest(r.ours)
  }
  return { fcc_missing: fcc.missing, reviewed_at: new Date().toISOString(), boats }
}

/**
 * Two same-name records that share an MMSI are probably one boat split in two (our rules never merge on an MMSI alone):
 * the smaller record (fewer claims, then fewer sources) is marked `fragment_of` the fuller one, so the page can fold it
 * under it. Nothing is merged here; the records stay separate until someone merges them.
 */
export function markFragments(ours) {
  const size = (v) => [v.records ?? 0, v.built_from?.length ?? 0]
  for (const v of ours) {
    const fuller = ours.filter((w) => w !== v && w.mmsis.some((m) => v.mmsis.includes(m)))
      .filter((w) => { const [a, b] = size(w), [c, d] = size(v); return a > c || (a === c && b > d) })
      .sort((x, y) => size(y)[0] - size(x)[0])[0]
    if (fuller) v.fragment_of = fuller.vessel_id
  }
  return ours
}

/**
 * Pre-select a candidate only when exactly one vessel has a STRONG tie (its licensee/owner names the operator, or it shares
 * a licensee with another boat on the page) and no failed check. Everything else is left for the reviewer.
 */
export function suggest(ours) {
  const strong = ours.filter((v) => !v.fragment_of && v.signals.some((s) => s.strong) && !v.signals.some((s) => s.ok === false))
  return strong.length === 1 ? { vessel_id: strong[0].vessel_id, why: strong[0].signals.filter((s) => s.ok).map((s) => s.text).join('; ') } : null
}
