/**
 * EarthAtlas ship-type taxonomy + crosswalks from each source's vocabulary
 * (pure; no I/O). Decisions and open points: docs/SHIP_CLASSIFICATION.md
 * (groups/classes and ranking decided by Josh 2026-09-25).
 *
 * This is an INTERPRETATION layer. Every source's raw type stays its own claim
 * (AIS code, GFW type, Wikidata class); nothing here is written back as a claim.
 * Two levels: `group` (coarse, what every source can say) and `class`
 * (specific; null when the source can't be that specific: AIS "70" is cargo,
 * but which kind of cargo ship it doesn't say).
 */

export const GROUPS = {
  passenger: 'Passenger',
  cargo: 'Cargo',
  tanker: 'Tanker',
  tug_tow: 'Tug / tow',
  government: 'Government',
  port_service: 'Port service',
  offshore: 'Offshore energy',
  fishing: 'Fishing',
  research: 'Research & survey',
  naval: 'Naval',
  recreational: 'Pleasure & sailing',
  other: 'Other',
  non_vessel: 'Not a vessel',
  unknown: 'Unknown',
}

export const CLASSES = {
  cruise_ship: ['passenger', 'Cruise ship'],
  ferry: ['passenger', 'Ferry (passenger / ro-pax / car)'],
  high_speed_craft: ['passenger', 'High-speed craft'],
  excursion: ['passenger', 'Excursion / tour boat'],
  other_passenger: ['passenger', 'Other passenger ship'],
  container_ship: ['cargo', 'Container ship'],
  bulk_carrier: ['cargo', 'Bulk carrier'],
  general_cargo: ['cargo', 'General cargo / multi-purpose'],
  reefer: ['cargo', 'Refrigerated cargo (reefer)'],
  roro_cargo: ['cargo', 'Ro-ro cargo'],
  vehicle_carrier: ['cargo', 'Vehicle carrier'],
  heavy_lift: ['cargo', 'Heavy-lift ship'],
  livestock_carrier: ['cargo', 'Livestock carrier'],
  oil_tanker: ['tanker', 'Oil tanker'],
  chemical_tanker: ['tanker', 'Chemical tanker'],
  lng_carrier: ['tanker', 'LNG carrier'],
  lpg_carrier: ['tanker', 'LPG carrier'],
  gas_carrier: ['tanker', 'Gas carrier (unspecified)'],
  bunker_tanker: ['tanker', 'Bunkering tanker'],
  other_tanker: ['tanker', 'Other tanker'],
  tug: ['tug_tow', 'Tug'],
  towing: ['tug_tow', 'Towing / pushing'],
  pilot: ['port_service', 'Pilot boat'],
  search_rescue: ['government', 'Search & rescue'],
  patrol: ['government', 'Patrol / law enforcement / coast guard'],
  icebreaker: ['government', 'Icebreaker'],
  buoy_tender: ['government', 'Buoy tender'],
  pollution_response: ['government', 'Pollution response'],
  dredger: ['port_service', 'Dredger'],
  salvage: ['port_service', 'Salvage'],
  port_tender: ['port_service', 'Port tender'],
  training: ['government', 'Training ship'],
  offshore_support: ['offshore', 'Offshore support (PSV / AHTS / crew transfer)'],
  offshore_construction: ['offshore', 'Offshore construction (crane / pipelay / cable / diving)'],
  offshore_unit: ['offshore', 'Drilling / production unit (rig, drillship, FPSO, FSRU)'],
  seismic_survey: ['research', 'Seismic survey'],
  research_vessel: ['research', 'Research / survey vessel'],
  fishing_vessel: ['fishing', 'Fishing vessel'],
  trawler: ['fishing', 'Trawler'],
  fish_carrier: ['fishing', 'Fish carrier / live-fish carrier'],
  fish_factory: ['fishing', 'Fish factory ship'],
  warship: ['naval', 'Warship'],
  naval_auxiliary: ['naval', 'Naval auxiliary'],
  yacht: ['recreational', 'Yacht'],
  sailing_vessel: ['recreational', 'Sailing vessel'],
  museum_ship: ['other', 'Museum ship'],
  wig: ['other', 'Wing-in-ground craft'],
}

/** Every group gets an explicit "type not known" class: `<group>_unspecified`. */
export const unspecified = (group) => `${group}_unspecified`
const UNSPECIFIED_LABEL = {
  passenger: 'Passenger, type not known', cargo: 'Cargo, type not known', tanker: 'Tanker, type not known',
  tug_tow: 'Tug / tow, type not known', government: 'Government, type not known', port_service: 'Port service, type not known',
  offshore: 'Offshore, type not known', fishing: 'Fishing, type not known', research: 'Research, type not known',
  naval: 'Naval, type not known', recreational: 'Pleasure craft, type not known', other: 'Other, type not known',
  non_vessel: 'Not a vessel', unknown: 'Type not known',
}

/**
 * THE list the UI filters and the track bake both use: stable ids + English
 * labels, groups in display order, each with its classes and its
 * `<group>_unspecified` bucket last. Ids never change meaning; labels may.
 */
export const TAXONOMY = Object.entries(GROUPS).map(([id, label]) => ({
  id, label,
  classes: [
    ...Object.entries(CLASSES).filter(([, [g]]) => g === id).map(([cid, [, clabel]]) => ({ id: cid, label: clabel })),
    { id: unspecified(id), label: UNSPECIFIED_LABEL[id] },
  ],
}))
export const TAXONOMY_VERSION = '2026-09-25'

/** Label of a group or class id (including `<group>_unspecified`). */
export function labelOf(id) {
  if (GROUPS[id]) return GROUPS[id]
  if (CLASSES[id]) return CLASSES[id][1]
  return UNSPECIFIED_LABEL[String(id).replace(/_unspecified$/, '')] ?? null
}

/**
 * AIS hazardous-cargo category (self-declared by the ship). In the WIG (2x),
 * HSC (4x), passenger (6x), cargo (7x), tanker (8x) and other (9x) ranges the
 * second digit 1–4 means "carrying dangerous goods, harmful substances or marine
 * pollutants", category A–D (ITU-R M.1371 / NOAA code tables; newer ITU text names
 * them IMO hazard or pollutant categories X, Y, Z, OS). null otherwise.
 */
export function aisHazard(code) {
  const c = Number(code)
  if (!Number.isInteger(c) || c < 20 || c > 99) return null
  const tens = Math.floor(c / 10), unit = c % 10
  if (![2, 4, 6, 7, 8, 9].includes(tens) || unit < 1 || unit > 4) return null
  return { category: 'ABCD'[unit - 1], code: c, basis: 'AIS ship-and-cargo type, self-declared by the ship' }
}

const r = (group, cls = null, note = null) => ({ group, class: cls, ...(note ? { note } : {}) })

/**
 * AIS "ship and cargo type" (ITU-R M.1371) + USCG extended codes (MarineCadastre).
 * Extended-code groups follow NOAA's table in docs/MARINECADASTRE_AIS.md; the
 * individual 1001–1025 names are not all verified (see the doc).
 */
export function fromAisCode(code) {
  const m = aisGroup(code)
  const h = aisHazard(code)
  return h ? { ...m, hazardous_cargo: h } : m
}
function aisGroup(code) {
  const c = Number(code)
  if (!Number.isInteger(c) || c <= 0) return r('unknown')
  if (c >= 20 && c <= 29) return r('other', 'wig')
  if (c === 30) return r('fishing')
  if (c === 31 || c === 32) return r('tug_tow', 'towing')
  if (c === 33) return r('port_service', 'dredger', 'AIS 33 = dredging OR underwater operations')
  if (c === 34) return r('port_service', null, 'AIS 34 = diving operations (judgement: port service)')
  if (c === 35) return r('naval', null, 'AIS 35 = military operations')
  if (c === 36) return r('recreational', 'sailing_vessel')
  if (c === 37) return r('recreational')
  if (c >= 40 && c <= 49) return r('passenger', 'high_speed_craft', 'AIS 4x = high-speed craft; some carry cargo only')
  if (c === 50) return r('port_service', 'pilot')
  if (c === 51) return r('government', 'search_rescue')
  if (c === 52) return r('tug_tow', 'tug')
  if (c === 53) return r('port_service', 'port_tender')
  if (c === 54) return r('government', 'pollution_response')
  if (c === 55) return r('government', 'patrol')
  if (c === 58) return r('government', null, 'AIS 58 = medical transport (judgement: government)')
  if (c === 59) return r('government', null, 'AIS 59 = noncombatant ship (RR Resolution No. 18)')
  if (c >= 60 && c <= 69) return r('passenger')
  if (c >= 70 && c <= 79) return r('cargo')
  if (c >= 80 && c <= 89) return r('tanker')
  if (c >= 90 && c <= 99) return r('other')
  if ([1001, 1002].includes(c)) return r('fishing')
  if ([1003, 1004, 1016].includes(c)) return r('cargo')
  if ([1012, 1013, 1014, 1015].includes(c)) return r('passenger')
  if ([1017, 1024].includes(c)) return r('tanker')
  if (c === 1019) return r('recreational')
  if ([1023, 1025].includes(c)) return r('tug_tow')
  if (c === 1021) return r('non_vessel', null, 'SAR aircraft')
  if (c >= 1001 && c <= 1025) return r('other')
  return r('unknown') // 1–19, 38–39, 56–57, 100–999, 255…: reserved / not a type
}

/** GFW vessel types (docs/GFW_VESSELS_API.md), from shiptype / combinedSourcesInfo. */
const GFW = {
  PASSENGER: r('passenger'),
  CARGO: r('cargo'),
  CARRIER: r('cargo', 'reefer', 'GFW "carrier" = refrigerated cargo vessels that tranship catch'),
  BUNKER: r('tanker', 'bunker_tanker'),
  FISHING: r('fishing'),
  SEISMIC_VESSEL: r('research', 'seismic_survey'),
  SUPPORT: r('other', null, 'GFW "support": meaning not documented beyond the name (UNVERIFIED)'),
  GEAR: r('non_vessel', null, 'GFW "gear": AIS-equipped fishing gear / net buoys'),
  OTHER: r('other'),
  DISCREPANCY: r('unknown', null, 'GFW sources disagree'),
  NA: r('unknown'),
}
export function fromGfwType(t) {
  return GFW[String(t || '').toUpperCase()] ?? r('unknown')
}

/**
 * Wikidata P31 classes (Q-id → group/class). Covers every class used by at
 * least ~12 IMO-bearing items on 2026-09-25 (docs/SHIP_CLASSIFICATION.md).
 * Classes that describe propulsion, hull form or fate rather than a type
 * ("ship", "motor ship", "steamship", "catamaran", "shipwreck") map to null:
 * they are true but say nothing about the ship's job.
 */
export const WIKIDATA_CLASSES = {
  Q11446: null, Q1229765: null, Q402092: null, Q12859788: null, Q178193: null, Q190403: null,
  Q852190: null, Q2447856: null, Q130326199: null, Q628983: r('port_service', null, 'working vessel (judgement)'), Q3337312: r('port_service', null, 'service vessel (judgement)'),
  Q39804: r('passenger', 'cruise_ship'), Q18916020: r('passenger', 'cruise_ship', 'river cruise ship'),
  Q25653: r('passenger', 'ferry'), Q2072352: r('passenger', 'ferry'), Q1760328: r('passenger', 'ferry'),
  Q3784092: r('passenger', 'ferry'), Q3276983: r('passenger', 'ferry'), Q109936535: r('passenger', 'ferry'),
  Q15262: r('passenger', 'ferry', 'train ferry; some carry freight only'),
  Q1617851: r('passenger', 'high_speed_craft'), Q17416980: r('passenger', 'excursion'),
  Q1272711: r('passenger', 'excursion'), Q1121471: r('passenger', 'excursion'),
  Q2055880: r('passenger'), Q697196: r('passenger', 'other_passenger', 'ocean liner'),
  Q1922243: r('passenger', 'other_passenger', 'passenger-cargo ship'),
  Q105999: r('cargo'), Q17210: r('cargo', 'container_ship'), Q353699: r('cargo', 'container_ship'),
  Q2477625: r('cargo', 'container_ship'), Q15276: r('cargo', 'bulk_carrier'),
  Q189323: r('cargo', 'bulk_carrier', 'cement carrier'), Q1165999: r('cargo', 'bulk_carrier', 'lake freighter'),
  Q7448069: r('cargo', 'bulk_carrier', 'self-discharger'), Q15272: r('cargo', 'bulk_carrier', 'ore-bulk-oil carrier'),
  Q1752434: r('cargo', 'general_cargo'), Q1917626: r('cargo', 'general_cargo'), Q1797381: r('cargo', 'general_cargo'),
  Q1504307: r('cargo', 'reefer'), Q473932: r('cargo', 'roro_cargo', 'Wikidata ro-ro also covers some ro-pax'),
  Q1123401: r('cargo', 'roro_cargo'), Q356847: r('cargo', 'vehicle_carrier'), Q7918428: r('cargo', 'vehicle_carrier'),
  Q1151009: r('cargo', 'heavy_lift'), Q15266: r('cargo', 'livestock_carrier'),
  Q14970: r('tanker'), Q14928: r('tanker', 'oil_tanker'), Q2135586: r('tanker', 'oil_tanker'),
  Q15254: r('tanker', 'chemical_tanker'), Q15247: r('tanker', 'lng_carrier'), Q2928814: r('tanker', 'lpg_carrier'),
  Q3758612: r('tanker', 'gas_carrier'), Q1009600: r('tanker', 'bunker_tanker'), Q1470795: r('tanker', 'other_tanker'),
  Q191826: r('tug_tow', 'tug'), Q19292005: r('tug_tow', 'tug'), Q820385: r('tug_tow', 'tug'),
  Q939770: r('port_service', 'pilot'), Q11997320: r('government', 'search_rescue', 'many rescue boats are run by charities (RNLI, DGzRS); still grouped as government'), Q331795: r('government', 'patrol'),
  Q11479409: r('government', 'patrol', 'offshore patrol vessel; navies operate many'), Q1797385: r('government', 'patrol'),
  Q14978: r('government', 'icebreaker'), Q544823: r('government', 'icebreaker'), Q1623035: r('government', 'buoy_tender'),
  Q115497568: r('government', 'pollution_response'), Q11903334: r('government', 'pollution_response'),
  Q5810820: r('port_service', 'dredger'), Q2550720: r('port_service', 'dredger'), Q820378: r('port_service', 'salvage'),
  Q660668: r('government', 'training'), Q15888: r('government', null, 'hospital ship'),
  Q1201871: r('offshore', 'offshore_support'), Q557281: r('offshore', 'offshore_support'),
  Q117112843: r('offshore', 'offshore_support'), Q117674967: r('offshore', 'offshore_support'),
  Q114409407: r('offshore', 'offshore_support'), Q5461999: r('offshore', 'offshore_support', 'flotel'),
  Q970092: r('offshore', 'offshore_construction'), Q1131532: r('offshore', 'offshore_construction'),
  Q348741: r('offshore', 'offshore_construction'), Q776704: r('offshore', 'offshore_construction'),
  Q1361559: r('offshore', 'offshore_construction'),
  Q1571437: r('offshore', 'offshore_unit'), Q509222: r('offshore', 'offshore_unit'), Q1430652: r('offshore', 'offshore_unit'),
  Q15252: r('offshore', 'offshore_unit'), Q10387679: r('offshore', 'offshore_unit', 'FSRU'),
  Q689880: r('offshore', 'offshore_unit', 'oil platform'), Q12688575: r('offshore', 'offshore_unit'),
  Q391022: r('research', 'research_vessel'), Q1303735: r('research', 'research_vessel'),
  Q19267382: r('research', 'research_vessel'),
  Q1420024: r('fishing', 'fishing_vessel'), Q326561: r('fishing', 'trawler'), Q1678525: r('fishing', 'fish_carrier'),
  Q108815497: r('fishing', 'fish_carrier', 'stun-and-bleed vessel'), Q431858: r('fishing', 'fish_factory'),
  Q161705: r('naval', 'warship'), Q2607934: r('naval', 'warship'), Q11229656: r('naval', 'warship'),
  Q162986: r('naval', 'naval_auxiliary'), Q2518299: r('naval', 'naval_auxiliary'), Q1286790: r('naval', 'naval_auxiliary'),
  Q671079: r('naval', 'naval_auxiliary'),
  Q21505397: r('recreational', 'yacht'), Q443802: r('recreational', 'yacht'), Q170173: r('recreational', 'yacht'),
  Q170483: r('recreational', 'sailing_vessel'), Q204577: r('recreational', 'sailing_vessel'),
  Q3112873: r('recreational', 'sailing_vessel'), Q1581130: r('recreational', 'sailing_vessel'),
  Q4847899: r('recreational', 'sailing_vessel'), Q216057: r('recreational', 'sailing_vessel'),
  Q575727: r('other', 'museum_ship'),
}

/** undefined = class not in the crosswalk yet; null = known, but not a type. */
export function fromWikidataClass(qid) {
  return Object.prototype.hasOwnProperty.call(WIKIDATA_CLASSES, qid) ? WIKIDATA_CLASSES[qid] : undefined
}

/**
 * Map one vessel_type claim (as stored) to the taxonomy, by source. The result
 * carries the claim's evidence class and source, which `combine` ranks by.
 * Returns null when the claim says nothing about type.
 */
export function crosswalkClaim(a) {
  let m = null
  if (a.source_id === 'marinecadastre-ais') m = fromAisCode(a.detail?.code ?? String(a.value_norm).replace(/^AIS_/, ''))
  else if (a.source_id === 'gfw-vessel-identity') m = fromGfwType(a.value_norm)
  else if (a.source_id === 'wikidata') m = fromWikidataClass(String(a.value_norm).replace(/^WD_/, '')) ?? null
  return m ? { ...m, evidence: a.evidence_class ?? null, source: a.source_id } : null
}

/**
 * Evidence classes that rank BELOW the rest for vessel type (Josh, 2026-09-25):
 * GFW's model classification ('inferred') only decides when nothing else votes.
 */
export const LOW_RANK_TYPE_EVIDENCE = new Set(['inferred'])

/**
 * Combination rule (docs/SHIP_CLASSIFICATION.md §4; decided by Josh 2026-09-25):
 * 1. 'unknown' and null mappings abstain; a bare 'other' (AIS 90, GFW OTHER)
 *    only counts when nothing more specific votes.
 * 2. Ranked sources (AIS, registry, Wikidata; anything not 'inferred') decide.
 *    Model ('inferred', GFW's classification) decides only when no ranked source votes.
 * 3. group: the one group the deciding votes agree on; disagreement among them →
 *    conflict (group null, class null: never picked).
 *    class: the one specific class inside that group; none → `<group>_unspecified`;
 *    two different classes → `<group>_unspecified` + conflict (never guessed).
 * 4. Model votes that disagree with the result come back as `dissent`
 *    (shown, lower-ranked), never as a blocking conflict.
 * 5. No votes at all → group 'unknown', class 'unknown_unspecified'.
 * `hazardous_cargo`: the self-declared AIS categories among the inputs (A–D).
 */
export function combine(mappings) {
  const all = mappings.filter((m) => m && m.group !== 'unknown')
  const bareOther = (m) => m.group === 'other' && !m.class
  const specificEnough = all.filter((m) => !bareOther(m))
  const votes = specificEnough.length ? specificEnough : all
  const ranked = votes.filter((m) => !LOW_RANK_TYPE_EVIDENCE.has(m.evidence))
  const model = votes.filter((m) => LOW_RANK_TYPE_EVIDENCE.has(m.evidence))
  const deciders = ranked.length ? ranked : model
  const basis = ranked.length ? 'ranked' : model.length ? 'model_only' : 'none'
  const hazardous_cargo = [...new Set(mappings.filter((m) => m?.hazardous_cargo).map((m) => m.hazardous_cargo.category))].sort()
  const groups = [...new Set(deciders.map((m) => m.group))].sort()
  if (!groups.length) {
    return { group: 'unknown', class: unspecified('unknown'), conflict: false, groups, classes: [], basis, dissent: [], hazardous_cargo }
  }
  if (groups.length > 1) {
    return { group: null, class: null, conflict: true, groups, classes: [], basis, dissent: model.map(dis), hazardous_cargo }
  }
  const group = groups[0]
  const classes = [...new Set(deciders.filter((m) => m.class).map((m) => m.class))].sort()
  const cls = classes.length === 1 ? classes[0] : unspecified(group)
  const dissent = ranked.length
    ? dedupe(model.filter((m) => m.group !== group || (m.class && classes.length === 1 && m.class !== cls)).map(dis))
    : []
  return { group, class: cls, conflict: classes.length > 1, groups, classes, basis, dissent, hazardous_cargo }
}
const dis = (m) => ({ group: m.group, class: m.class ?? null, source: m.source ?? null })
const dedupe = (xs) => [...new Map(xs.map((x) => [`${x.group}|${x.class}|${x.source}`, x])).values()]

const t = (v) => (v == null ? null : new Date(v).getTime())
/**
 * Classify a vessel from its vessel_type claims (rows with source_id,
 * evidence_class, value_norm, detail, period_kind, from, to) for a time window
 * [from, to] (ISO / Date / null = open). A claim counts when its period is
 * unknown or overlaps the window. For "now" pass { from: now, to: now,
 * keepObserved: true }: an AIS type last observed a month ago is still our best
 * knowledge, whereas a Wikidata type whose validity ended is not.
 */
export function classifyClaims(claims, { from = null, to = null, keepObserved = false } = {}) {
  const f = t(from), e = t(to)
  const use = claims.filter((a) => {
    if (a.attribute && a.attribute !== 'vessel_type') return false
    if (a.period_kind === 'unknown') return true
    if (keepObserved && a.period_kind === 'observed') return true
    const lo = t(a.from), hi = t(a.to)
    return (e == null || lo == null || lo <= e) && (f == null || hi == null || hi >= f)
  })
  const c = combine(use.map(crosswalkClaim))
  return { ...c, groupLabel: c.group ? labelOf(c.group) : null, classLabel: c.class ? labelOf(c.class) : null,
    dissent: c.dissent.map((d) => ({ ...d, groupLabel: labelOf(d.group), classLabel: d.class ? labelOf(d.class) : null })),
    hazardous_cargo: hazardsOf(use) }
}

/** Self-declared AIS hazardous-cargo claims (category + code + when + source) among vessel_type claims. */
export function hazardsOf(claims) {
  const out = []
  for (const a of claims) {
    if (a.attribute && a.attribute !== 'vessel_type') continue
    const m = crosswalkClaim(a)
    if (m?.hazardous_cargo) out.push({ ...m.hazardous_cargo, evidence: a.evidence_class, source: a.source_id, from: a.from ?? null, to: a.to ?? null })
  }
  return out
}
