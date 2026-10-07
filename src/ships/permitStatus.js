/**
 * Plain words for a permit's status, shared by the Permits tab and the permit page (Josh 2026-10-06: "what does Effective
 * mean?"). The source's own term stays visible on hover.
 */
// Statuses: EPA DFR data dictionary (ICIS-NPDES statuses); PARIS uses Active / Inactive / Draft.
export const STATUS_WORDS = {
  effective: { short: 'In force', long: 'issued and currently in force' },
  'administratively continued': { short: 'Expired, still in force', long: 'past its expiry date but kept in force while the renewal is pending' },
  expired: { short: 'Expired', long: 'past its expiry date' },
  terminated: { short: 'Ended', long: 'ended; no longer in force' },
  retired: { short: 'Retired', long: 'retired; no longer in use' },
  pending: { short: 'Pending', long: 'applied for, not yet issued' },
  'not needed': { short: 'Not needed', long: 'the agency decided no permit is needed' },
  active: { short: 'In force', long: 'active (in force)' },
  operating: { short: 'Operating', long: 'the air program lists the source as operating' },
  draft: { short: 'Draft', long: 'a draft, not yet issued' },
  cancelled: { short: 'Cancelled', long: 'cancelled; no longer in force' },   // BC EMA register (and the next two)
  withdrawn: { short: 'Withdrawn', long: 'withdrawn; not in force' },
  abandoned: { short: 'Abandoned', long: 'listed as abandoned; not in force' },
}
export const statusKey = (s) => String(s || '').split(/[;(]/)[0].trim().toLowerCase()
const SOURCE_OF = { 'WA-PARIS': 'WA Ecology PARIS', 'BC-EMA': 'The BC waste discharge authorizations register' }
export const statusSource = (p) => SOURCE_OF[p.system] || 'EPA ECHO'

/** "In force" etc. for a card row (p = a permits row: epa_system + program_status). */
export const statusShort = (p) => STATUS_WORDS[statusKey(p.program_status)]?.short ?? p.program_status ?? ''
export const statusTitle = (p) => `${SOURCE_OF[p.epa_system] || 'EPA ECHO'} lists it as “${p.program_status}”${STATUS_WORDS[statusKey(p.program_status)] ? `: ${STATUS_WORDS[statusKey(p.program_status)].long}` : ''}`

/** BC NRCED inspection results ("Out of Compliance - Advisory", "Compliant - Notice") in plain words; NRCED's term on hover. */
export function nrcedResult(o) {
  const t = String(o || '').trim()
  if (!t) return null
  if (/^compliant\b/i.test(t)) return 'In compliance'
  const m = /^out of compliance\s*-\s*(advisory|warning|order|ticket|penalty)/i.exec(t)
  return m ? `Out of compliance: ${m[1].toLowerCase()}` : t
}

/** BC register text sometimes repeats itself ("Chlor-Alkali Plant Chlor-Alkali Plant"): show the phrase once. */
export function oncePhrase(s) {
  const t = String(s ?? '').trim()
  const m = /^(.+?)\s+\1$/.exec(t)
  return m ? m[1] : t
}
