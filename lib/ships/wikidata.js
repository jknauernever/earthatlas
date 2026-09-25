/**
 * Wikidata ship items → EarthAtlas claims (pure; no I/O).
 * Property semantics, counts and quirks: docs/WIKIDATA_SHIPS.md.
 *
 * One Wikidata item (Q-id) = one source entity. Every claim is
 * 'community_curated': Wikidata is openly edited, not a registry, not AIS,
 * not a model. Each claim keeps its statement id (sub_record_ref) and property
 * id, so any value leads back to the exact statement in the raw record.
 *
 * Referenced items (the operator, the country, the ship class…) are stored by
 * Q-id; their English label, ISO 3166 alpha-3 code and whether they are a kind
 * of watercraft come from a separate SPARQL lookup (`lookup`), which is
 * recorded in each claim's detail.
 */
import { normName, normCallsign, normImo, normMmsi } from './normalize.js'

export const WIKIDATA_SOURCE = {
  id: 'wikidata',
  name: 'Wikidata (ship items)',
  publisher: 'Wikimedia Foundation; content edited by the Wikidata community',
  homepage_url: 'https://www.wikidata.org/wiki/Wikidata:WikiProject_Ships',
  license: 'CC0 1.0',
  license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  commercial_use: true,
  attribution_text: 'Wikidata',
  attribution_url: 'https://www.wikidata.org',
  notes: 'Structured data is CC0 (no attribution legally required; we credit it anyway). Community-edited: evidence class community_curated, never registry. Wikimedia Commons images (P18) carry their own licences and are NOT imported. Access: wbgetentities + SPARQL with a descriptive User-Agent (Wikimedia User-Agent policy).',
}
export const WD_ENTITY_KIND = 'wikidata_item'
export const EVIDENCE = 'community_curated'

/**
 * Wikimedia Commons, for the licence facts of P18 images. Each FILE carries its
 * own licence (recorded per claim); only files whose licence allows reuse on a
 * public website, commercial included, with attribution (CC0, public domain,
 * CC BY, CC BY-SA) are kept as claims.
 */
export const COMMONS_SOURCE = {
  id: 'wikimedia-commons',
  name: 'Wikimedia Commons (file licence metadata)',
  publisher: 'Wikimedia Foundation; files by their individual authors',
  homepage_url: 'https://commons.wikimedia.org',
  license: 'Per file (CC0 / public domain / CC BY / CC BY-SA only; each claim records its file licence)',
  license_url: 'https://commons.wikimedia.org/wiki/Commons:Licensing',
  commercial_use: true,
  attribution_text: 'Photo credits per file, via Wikimedia Commons',
  attribution_url: 'https://commons.wikimedia.org',
  notes: 'Only files whose licence allows commercial reuse with attribution are stored as image claims. CC BY-SA files require share-alike for adaptations: show them unmodified (resizing is fine), always with author + licence + link. Metadata from the imageinfo API (extmetadata).',
}
export const COMMONS_ENTITY_KIND = 'commons_file'

/** P18 file names of an item (non-deprecated, with a value). */
export function imageFiles(entity) {
  return (entity.claims?.P18 || []).filter((st) => st.rank !== 'deprecated' && st.mainsnak?.snaktype === 'value')
    .map((st) => st.mainsnak.datavalue.value)
}

/** Plain text of a Commons extmetadata HTML value. */
export function stripHtml(v) {
  return String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * May this file be shown on a public website, commercial use included, with
 * attribution? Decided from the file's own licence (extmetadata License /
 * LicenseShortName). NC / ND / GFDL-only / fair use / unknown → no.
 */
export function commonsLicense(meta = {}) {
  const short = String(meta.LicenseShortName?.value ?? '').trim()
  const code = String(meta.License?.value ?? '').trim().toLowerCase()
  const s = short.toLowerCase()
  const both = `${s} ${code}`
  if (/(\bnc\b|-nc-|non-?commercial|\bnd\b|-nd-|no-?deriv|fair use|non-free)/.test(both)) return { ok: false, kind: 'nc_nd_or_nonfree', short }
  if (code === 'cc0' || /^cc0/.test(s) || /^cc-zero/.test(code)) return { ok: true, kind: 'cc0', short }
  if (/^pd\b|^pd-/.test(code) || /^public domain/.test(s) || /^pd\b/.test(s)) return { ok: true, kind: 'public_domain', short }
  if (/^cc-by-sa-/.test(code) || /^cc[ -]by-sa\b/.test(s)) return { ok: true, kind: 'cc_by_sa', short }
  if (/^cc-by-\d/.test(code) || /^cc[ -]by \d/.test(s) || /^cc[ -]by-\d/.test(s)) return { ok: true, kind: 'cc_by', short }
  return { ok: false, kind: 'other', short }
}

const noTracking = (u) => (u ? String(u).replace(/[?&]utm_[^#]*$/, '') : null)

// Units Wikidata uses on ship dimensions (Q-ids of unit items).
const METRE = 'Q11573', FOOT = 'Q3710'
const TO_M = { [METRE]: 1, [FOOT]: 0.3048 }

/** Item-valued properties: attribute and how the value normalizes. */
const ITEM_PROPS = {
  P137: 'operator',
  P127: 'owner',
  P289: 'vessel_class',
  P176: 'builder',
  P532: 'port_of_registry',
  P793: 'event',
  P8047: 'flag',
}
const LENGTH_PROPS = { P2043: 'length_m', P2049: 'width_m', P2261: 'width_m', P2262: 'draft_m' }

const MAPPED = new Set(['P18', 'P31', 'P458', 'P587', 'P2317', 'P1448', 'P1093', 'P1083', 'P729', 'P730',
  ...Object.keys(ITEM_PROPS), ...Object.keys(LENGTH_PROPS)])

const has = (v) => v !== null && v !== undefined && String(v).trim() !== ''

/**
 * A Wikidata time value → { iso, until, text } at its stated precision.
 * `iso` is the start of the precision period and `until` the start of the
 * next one (both UTC; Wikibase times are UTC, `timezone` is only a display
 * offset). Precision 11 = day, 10 = month, 9 = year. Coarser precisions
 * (decade, century…) and BCE dates return null: we don't turn "the 1990s"
 * into a date.
 */
export function wdTime(v) {
  if (!v || typeof v.time !== 'string') return null
  const m = /^\+(\d{4,})-(\d{2})-(\d{2})T/.exec(v.time)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const p = v.precision
  if (p < 9 || p > 14) return null
  const iso = (Y, M, D) => new Date(Date.UTC(Y, M - 1, D)).toISOString()
  if (p === 9) return { iso: iso(y, 1, 1), until: iso(y + 1, 1, 1), text: String(y).padStart(4, '0'), precision: 'year' }
  if (p === 10 || !d) {
    if (!mo) return null
    return { iso: iso(y, mo, 1), until: iso(y, mo + 1, 1), text: `${y}-${m[2]}`, precision: 'month' }
  }
  return { iso: iso(y, mo, d), until: iso(y, mo, d + 1), text: `${y}-${m[2]}-${m[3]}`, precision: 'day' }
}

function qualifierTimes(st, prop) {
  return (st.qualifiers?.[prop] || []).filter((s) => s.snaktype === 'value').map((s) => s.datavalue.value)
}

/** Parse a Wikidata "+123.4" quantity amount. */
const amount = (q) => (q && has(q.amount) ? Number(q.amount) : NaN)
const unitQid = (q) => (q?.unit && q.unit !== '1' ? q.unit.split('/').pop() : null)
const fmt = (n) => String(Math.round(n * 1000) / 1000)
/** Wikidata writes amounts with an explicit sign ("+285.43"); the sign is serialization, not value. */
const plain = (a) => String(a).replace(/^\+/, '')

/** Plain JSON of a statement's qualifiers, other than the time ones we turn into the period. */
function otherQualifiers(st) {
  const out = {}
  for (const [p, snaks] of Object.entries(st.qualifiers || {})) {
    if (p === 'P580' || p === 'P582') continue
    out[p] = snaks.map((s) => (s.snaktype !== 'value' ? s.snaktype
      : s.datavalue.value?.id ?? s.datavalue.value?.time ?? s.datavalue.value?.amount ?? s.datavalue.value?.text ?? s.datavalue.value))
  }
  return Object.keys(out).length ? out : undefined
}

/** English label of the item itself, if any. */
export const itemLabel = (entity) => entity?.labels?.en?.value ?? null

/** Every Q-id an item references, so the caller can look up labels/codes/classes. */
export function referencedQids(entity) {
  const ids = new Set()
  const items = new Set()
  for (const [p, sts] of Object.entries(entity.claims || {})) {
    for (const st of sts) {
      const v = st.mainsnak?.datavalue?.value
      if (st.mainsnak?.snaktype === 'value' && v?.['entity-type'] === 'item') {
        ids.add(v.id)
        if (p === 'P31') items.add(v.id)
      }
    }
  }
  return { all: [...ids].sort(), classes: [...items].sort() }
}

/**
 * Map one item (the wbgetentities entity object) to assertion rows.
 * `lookup[qid] = { label, iso3, watercraft, offshore }`.
 * Returns { assertions, warnings, isVessel, qid }.
 */
export function mapItem(entity, lookup = {}, commons = {}) {
  const images = []
  const out = []
  const warnings = []
  const qid = entity.id
  const label = itemLabel(entity)
  let isVessel = false

  const push = (st, prop, a) => {
    if (!has(a.value_raw) || !has(a.value_norm)) return
    const period = a.period ?? periodOf(st, prop)
    out.push({
      attribute: a.attribute,
      value_raw: String(a.value_raw).trim(),
      value_norm: String(a.value_norm).trim(),
      period_from: period.from, period_to: period.to, period_kind: period.kind,
      evidence_class: EVIDENCE,
      sub_record_ref: st.id,
      detail: { property: prop, rank: st.rank, ...(a.detail || {}), ...(period.detail || {}),
        ...(otherQualifiers(st) ? { qualifiers: otherQualifiers(st) } : {}) },
    })
  }

  // P580 start time / P582 end time → a validity period [from, to).
  const periodOf = (st, prop) => {
    const s = qualifierTimes(st, 'P580'), e = qualifierTimes(st, 'P582')
    if (!s.length && !e.length) return { from: null, to: null, kind: 'unknown' }
    const f = s.length === 1 ? wdTime(s[0]) : null
    const t = e.length === 1 ? wdTime(e[0]) : null
    if (s.length > 1 || e.length > 1) warnings.push(`${st.id} (${prop}): several start/end qualifiers; stored with unknown dates`)
    if ((s.length === 1 && !f) || (e.length === 1 && !t)) warnings.push(`${st.id} (${prop}): start/end time coarser than a year; that bound is unknown`)
    if (f && t && f.iso >= t.until) {
      warnings.push(`${st.id} (${prop}): start ${f.text} is after end ${t.text}; stored with unknown dates`)
      return { from: null, to: null, kind: 'unknown' }
    }
    if (!f && !t) return { from: null, to: null, kind: 'unknown' }
    return { from: f?.iso ?? null, to: t?.until ?? null, kind: 'validity',
      detail: { start: f?.text ?? null, end: t?.text ?? null,
        period_basis: 'Wikidata start time (P580) / end time (P582) qualifiers, widened to their stated precision' } }
  }

  const itemRef = (v) => {
    const id = v?.id
    const l = lookup[id] || {}
    return { id, label: l.label ?? null, raw: l.label ? `${l.label} (${id})` : id, info: l }
  }

  for (const [prop, sts] of Object.entries(entity.claims || {})) {
    for (const st of sts) {
      const ms = st.mainsnak
      if (!MAPPED.has(prop)) continue
      if (st.rank === 'deprecated') { warnings.push(`${st.id} (${prop}): deprecated rank, kept only in the raw record`); continue }
      if (!ms || ms.snaktype !== 'value') continue // "no value" / "unknown value": nothing to claim
      const v = ms.datavalue.value

      if (prop === 'P18') {
        // commons[file] = { page (Commons imageinfo page as received), recordId }
        const c = commons[v]
        const info = c?.page?.imageinfo?.[0]
        if (!info) { images.push({ file: v, status: c?.page?.missing !== undefined ? 'missing_on_commons' : 'no_commons_info' }); continue }
        const meta = info.extmetadata || {}
        const lic = commonsLicense(meta)
        if (!lic.ok) { images.push({ file: v, status: 'skipped_license', license: lic.short || '(none)', kind: lic.kind }); continue }
        const artist = stripHtml(meta.Artist?.value)
        images.push({ file: v, status: 'kept', license: lic.short })
        push(st, prop, { attribute: 'image', value_raw: v, value_norm: v, detail: {
          commons_record_id: c.recordId ?? null,
          file_page_url: info.descriptionurl ?? null,
          thumb_url: noTracking(info.thumburl), thumb_width: info.thumbwidth ?? null, thumb_height: info.thumbheight ?? null,
          file_url: noTracking(info.url),
          license_short_name: lic.short, license_kind: lic.kind, license_url: meta.LicenseUrl?.value ?? null,
          usage_terms: meta.UsageTerms?.value ?? null,
          attribution_required: meta.AttributionRequired?.value ?? null,
          artist_html: meta.Artist?.value ?? null, artist, credit_html: meta.Credit?.value ?? null, credit: stripHtml(meta.Credit?.value),
          credit_line: `${artist || 'Unknown author'} / ${lic.short} / via Wikimedia Commons`,
          share_alike: lic.kind === 'cc_by_sa',
        } })
      } else if (prop === 'P458') {
        const i = normImo(v)
        push(st, prop, { attribute: 'imo', value_raw: v, value_norm: i.value,
          detail: { checksum_ok: i.valid, item_label: label } })
      } else if (prop === 'P587') {
        const m = normMmsi(v)
        push(st, prop, { attribute: 'mmsi', value_raw: v, value_norm: m.value, detail: { valid: m.valid, ship_station: m.ship } })
      } else if (prop === 'P2317') {
        push(st, prop, { attribute: 'callsign', value_raw: v, value_norm: normCallsign(v) })
      } else if (prop === 'P1448') {
        push(st, prop, { attribute: 'name', value_raw: v.text, value_norm: normName(v.text), detail: { language: v.language } })
      } else if (prop === 'P31') {
        const r = itemRef(v)
        const vesselish = r.info.watercraft === true || r.info.offshore === true
        if (vesselish) isVessel = true
        push(st, prop, { attribute: vesselish ? 'vessel_type' : 'instance_of', value_raw: r.raw, value_norm: `WD_${r.id}`,
          detail: { qid: r.id, label: r.label, watercraft: r.info.watercraft ?? null, offshore_unit: r.info.offshore ?? null } })
      } else if (ITEM_PROPS[prop]) {
        const r = itemRef(v)
        const attribute = ITEM_PROPS[prop]
        let norm
        if (attribute === 'flag') norm = r.info.iso3 || `WD_${r.id}`
        else if (attribute === 'event' || attribute === 'vessel_class') norm = `WD_${r.id}`
        else norm = r.label ? normName(r.label) : `WD_${r.id}`
        const extra = {}
        if (attribute === 'event') {
          const pit = qualifierTimes(st, 'P585').map(wdTime).filter(Boolean)[0]
          if (pit) extra.point_in_time = pit.text
        }
        if (attribute === 'owner') extra.role_note = 'Wikidata "owned by" (P127): the source does not say registered or beneficial owner.'
        if (attribute === 'flag') extra.basis = 'Wikidata country of registry (P8047)'
        push(st, prop, { attribute, value_raw: r.raw, value_norm: norm, detail: { qid: r.id, label: r.label, ...extra } })
      } else if (LENGTH_PROPS[prop]) {
        const n = amount(v), u = unitQid(v)
        if (!Number.isFinite(n) || !TO_M[u]) { warnings.push(`${st.id} (${prop}): unit ${u ?? 'none'} not converted; kept only in the raw record`); continue }
        push(st, prop, { attribute: LENGTH_PROPS[prop], value_raw: `${plain(v.amount)} ${u === METRE ? 'm' : 'ft'}`, value_norm: fmt(n * TO_M[u]),
          detail: { unit: u } })
      } else if (prop === 'P1093') {
        const n = amount(v)
        if (!Number.isFinite(n) || unitQid(v)) { warnings.push(`${st.id} (P1093): unexpected unit ${unitQid(v)}`); continue }
        push(st, prop, { attribute: 'tonnage_gt', value_raw: plain(v.amount), value_norm: fmt(n),
          detail: { note: 'Wikidata gross tonnage (P1093); older ships may carry gross register tons, the item does not say.' } })
      } else if (prop === 'P1083') {
        const n = amount(v)
        if (!Number.isFinite(n)) continue
        push(st, prop, { attribute: 'max_capacity', value_raw: plain(v.amount), value_norm: fmt(n), detail: { unit: unitQid(v) } })
      } else if (prop === 'P729' || prop === 'P730') {
        const t = wdTime(v)
        if (!t) { warnings.push(`${st.id} (${prop}): date coarser than a year; kept only in the raw record`); continue }
        push(st, prop, { attribute: prop === 'P729' ? 'service_entry' : 'service_retirement', value_raw: t.text, value_norm: t.text,
          detail: { precision: t.precision, time: v.time } })
      }
    }
  }
  return { assertions: out, warnings, isVessel, qid, label, images }
}
