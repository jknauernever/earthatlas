/**
 * Boats as their operators describe them on their own websites (migration 037; Josh 2026-10-19, /ship-intake).
 * Pure mapping, no I/O: an intake file (lib/ships/data/intake/*.json) → source, page + boat records, claims.
 * Review + write: scripts/ships/intake.mjs. How to make an intake file: .claude/skills/ship-intake/SKILL.md.
 *
 * Evidence class 'operator_published': what the operator says, not a registry and not AIS. Photos are the operator's own
 * (all rights reserved). Josh chose 2026-10-19 to show them with a visible credit linking to the operator's page; the
 * card loads them from the operator's site (never copied to our storage), so a photo the operator removes disappears.
 * Linking a boat to a vessel is a reviewed human decision only (MANUAL_REVIEW); the resolver never links these.
 */
import { normName } from './normalize.js'
import { fromOperatorType, CLASSES, GROUPS, labelOf } from './taxonomy.js'

export const OPERATOR_EVIDENCE = 'operator_published'
export const PAGE_KIND = 'operator_site_page'
export const BOAT_KIND = 'operator_site_boat'
export const INTAKE_DECIDER = 'manual:ship-intake'

const FT_M = 0.3048

/** Source id for one operator website: 'operator-site-<host without www>'. */
export function operatorSourceId(url) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  return `operator-site-${host.replace(/[^a-z0-9.-]/g, '')}`
}

export function operatorSource(intake) {
  const op = intake.operator
  const home = op.url || new URL(intake.page.url).origin + '/'
  return {
    id: operatorSourceId(intake.page.url),
    name: `${op.name} website`,
    publisher: op.name,
    homepage_url: home,
    license: `All rights reserved by ${op.name}. Text and photos shown with a visible credit and a link to the page (Josh 2026-10-19, /ship-intake option B); photos load from the operator's own site, never copied.`,
    license_url: null,
    commercial_use: false,
    attribution_text: op.name,
    attribution_url: intake.page.url,
    notes: 'Operator-published boat descriptions (evidence class operator_published). Linked to vessels by reviewed decision only.',
  }
}

/** Problems with an intake file (empty = fine). `forApply` also requires every boat's match decision. */
export function intakeProblems(intake, { forApply = false } = {}) {
  const errs = []
  if (!/^https?:\/\//.test(intake?.page?.url || '')) errs.push('page.url must be a link')
  if (Number.isNaN(Date.parse(intake?.page?.retrieved_at || ''))) errs.push('page.retrieved_at must be a timestamp')
  if (!String(intake?.operator?.name || '').trim()) errs.push('operator.name missing')
  if (!Array.isArray(intake?.boats) || !intake.boats.length) errs.push('boats: none')
  const seen = new Set()
  for (const [i, b] of (intake?.boats || []).entries()) {
    const at = `boats[${i}] ${b?.name || ''}`.trim()
    if (!normName(b?.name || '')) { errs.push(`${at}: name missing`); continue }
    if (seen.has(boatKey(intake, b))) errs.push(`${at}: listed twice`)
    seen.add(boatKey(intake, b))
    for (const p of b.photos || []) {
      if (!/^https?:\/\//.test(p?.url || '')) errs.push(`${at}: photo url must be a link`)
      if (p?.added && !String(p.credit || '').trim()) errs.push(`${at}: a photo added by hand needs a credit`)
    }
    if (b.page_url != null && !/^https?:\/\//.test(b.page_url)) errs.push(`${at}: page_url must be a link`)
    const kind = b.kind || intake.kind
    if (kind && !CLASSES[kind] && !GROUPS[kind]) errs.push(`${at}: kind "${kind}" isn't on EarthAtlas's list of ship kinds`)
    const f = b.facts || {}
    for (const k of ['length_ft', 'max_capacity', 'year_built']) if (f[k] != null && !Number.isFinite(Number(f[k]))) errs.push(`${at}: facts.${k} must be a number`)
    if (forApply) {
      const m = b.match
      if (!m) errs.push(`${at}: no match decision (match.vessel_id, or match.none with the reason)`)
      else if (m.vessel_id && !/^[0-9a-f-]{36}$/i.test(m.vessel_id)) errs.push(`${at}: match.vessel_id is not a uuid`)
      else if (m.vessel_id && !String(m.basis || '').trim()) errs.push(`${at}: match.basis missing (what ties the boat to that vessel)`)
      else if (!m.vessel_id && !String(m.none || '').trim()) errs.push(`${at}: match.none must say why the boat is not linked`)
    }
  }
  return errs
}

/** The boat's entity key: the page it is described on plus its name as the page writes it. */
export const boatKey = (intake, b) => `${intake.page.url}#${String(b.name).trim()}`

const num = (v) => (v == null || v === '' ? null : Number(v))

/**
 * Claims for one boat. Every claim is dated to when the page was read ('observed', that instant), since the operator
 * gives no dates. `photoUrls` keeps the page's own order; the first is the main photo.
 */
export function boatClaims(intake, b) {
  const at = new Date(intake.page.retrieved_at).toISOString()
  const f = b.facts || {}
  // A fleet page often links each boat to its own page: that page is the boat's source and its photos' credit link.
  const pageUrl = b.page_url || intake.page.url
  const out = []
  const push = (attribute, value_raw, value_norm, detail = {}) => {
    if (value_raw == null || String(value_raw).trim() === '') return
    out.push({ attribute, value_raw: String(value_raw).trim(), value_norm: String(value_norm ?? value_raw).trim(),
      period_from: at, period_to: at, period_kind: 'observed', evidence_class: OPERATOR_EVIDENCE, sub_record_ref: '',
      detail: { via: 'operator_site', page_url: pageUrl, ...detail } })
  }
  push('name', b.name, normName(b.name))
  // What the boat is, in the operator's words: what the boat's own text says (facts.vessel_type), and how the operator's
  // site describes its business (operator.service, quoted verbatim from its home page). Each is its own claim;
  // lib/ships/taxonomy.js fromOperatorType reads them.
  // The kind picked on the intake page from EarthAtlas's own list (lib/ships/taxonomy.js): the boat's own pick, else the
  // page-wide one. A reviewed decision: it decides the card's kind (taxonomy combine rule 0).
  const kind = b.kind || intake.kind
  if (kind) push('vessel_type', labelOf(kind), `REVIEW_${kind}`, { stated: 'reviewer', ...(CLASSES[kind] ? { class: kind, group: CLASSES[kind][0] } : { group: kind }),
    picked_for: b.kind ? 'this boat' : 'every boat on the page' })
  if (f.vessel_type) push('vessel_type', f.vessel_type, `OPERATOR_${normName(f.vessel_type)}`, { stated: 'boat' })
  if (intake.operator.service) push('vessel_type', intake.operator.service, `OPERATOR_${normName(intake.operator.service)}`,
    { stated: 'operator_business', page_url: intake.operator.service_url || intake.operator.url || intake.page.url,
      // The boat's own words win: a water taxi run by a whale-watching company is still a water taxi.
      ...(f.vessel_type && fromOperatorType(f.vessel_type) ? { boat_words_decide: true } : {}) })
  push('operator', intake.operator.name, normName(intake.operator.name))
  if (num(f.length_ft) > 0) push('length_m', `${num(f.length_ft)} ft`, (num(f.length_ft) * FT_M).toFixed(2), { unit_as_published: 'ft' })
  if (f.builder) push('builder', f.build_place ? `${f.builder} (${f.build_place})` : f.builder, normName(f.builder))
  if (num(f.year_built) > 0) push('year_built', String(num(f.year_built)))
  if (f.hull_material) push('hull_material', f.hull_material, String(f.hull_material).toLowerCase())
  if (num(f.max_capacity) > 0) push('max_capacity', String(num(f.max_capacity)), String(num(f.max_capacity)), { basis: f.capacity_basis || null })
  if (f.propulsion) push('propulsion', f.propulsion, String(f.propulsion).toLowerCase())
  if (f.speed_kn) push('speed_kn', String(f.speed_kn), String(f.speed_kn).replace(/\s+/g, ''), { basis: f.speed_basis || 'cruising' })
  if (b.description) push('description', b.description, normName(b.description).slice(0, 64))
  // A photo from the page is credited to the operator and links to the page it is on. One Josh added by hand (pasted URL or
  // upload, on the intake page) carries its own credit and, when given, the page it came from. A photo Josh picked as the
  // main one ("Make main photo") is `featured`: the card shows it before every other photo.
  for (const [i, p] of (b.photos || []).entries()) {
    const own = !p.credit
    push('image', p.url, p.url, { thumb_url: p.url, file_page_url: p.credit_url || (own ? pageUrl : null), credit: p.credit || intake.operator.name,
      caption: p.caption || null, photo_order: i, best: i === 0, rights: own ? 'all rights reserved (operator)' : 'credited as given',
      ...(p.added ? { added: p.added } : {}), ...(p.featured && i === 0 ? { featured: true } : {}) })
  }
  return out
}

/** The stored raw record for one boat: what the page said about it, plus where and when it was read. */
export function boatPayload(intake, b) {
  return { page_url: intake.page.url, page_title: intake.page.title ?? null, retrieved_at: intake.page.retrieved_at,
    operator: intake.operator, boat: { name: b.name, page_url: b.page_url ?? null, facts: b.facts ?? {}, description: b.description ?? null, photos: b.photos ?? [] } }
}

/** The stored raw record for the page itself (its full visible text as read, so every claim can be checked against it). */
export function pagePayload(intake) {
  return { url: intake.page.url, title: intake.page.title ?? null, retrieved_at: intake.page.retrieved_at,
    operator: intake.operator, text: intake.page.text ?? null }
}
