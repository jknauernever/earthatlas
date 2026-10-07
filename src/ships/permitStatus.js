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
  issued: { short: 'Issued', long: 'issued by Metro Vancouver; its term is in the permit' },   // Metro Vancouver (and the next three)
  'amendment applied for': { short: 'Amendment applied for', long: 'the holder applied to amend it; Metro Vancouver is reviewing the application' },
  'renewal applied for': { short: 'Renewal applied for', long: 'the holder applied for a new permit; Metro Vancouver is reviewing the application' },
  'report filed 2023': { short: 'Report filed 2023', long: 'a 2023 report filed with Metro Vancouver lists this permit; the permit document is not online' },
  // WA local clean air agencies (PSCAA, ORCAA, SWCAA): orders of approval, air discharge permits and registrations.
  approved: { short: 'Approved', long: 'approved by the agency; an order of approval stays in force for the life of the equipment unless a later order replaces it' },
  proposed: { short: 'Proposed', long: 'a proposed order the agency posted for public comment; not yet final' },
  superseded: { short: 'Replaced', long: 'replaced by a later order of the agency' },
  registered: { short: 'Registered', long: 'listed by the agency as a registered air pollution source; registration has no permit document' },
  final: { short: 'Final', long: 'issued in final form by the agency' },
  withdrawn: { short: 'Withdrawn', long: 'withdrawn; not in force' },
  abandoned: { short: 'Abandoned', long: 'listed as abandoned; not in force' },
}
export const statusKey = (s) => String(s || '').split(/[;(]/)[0].trim().toLowerCase()
const SOURCE_OF = { 'WA-PARIS': 'WA Ecology PARIS', 'BC-EMA': 'The BC waste discharge authorizations register', 'MV-AQ': 'Metro Vancouver',
  PSCAA: 'Puget Sound Clean Air Agency', ORCAA: 'Olympic Region Clean Air Agency', SWCAA: 'Southwest Clean Air Agency' }
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

// SEPA Register document types in plain words (SEPA per permit, lib/ships/permitSepa.js). The Register's own code stays on hover.
export const SEPA_TYPE_WORDS = {
  DNS: 'Determination of Nonsignificance: no significant impacts, no EIS',
  MDNS: 'Mitigated Determination of Nonsignificance: impacts mitigated to nonsignificant by conditions',
  'DNS-M': 'Mitigated Determination of Nonsignificance', ODNS: 'Determination of Nonsignificance using the optional process',
  'ODNS-M': 'Mitigated Determination of Nonsignificance using the optional process', 'ODNS/NOA': 'Notice of application with an expected DNS (optional process)',
  'ODNS/NOA-M': 'Notice of application with an expected mitigated DNS (optional process)',
  'DS/SCOPING': 'Determination of Significance: an Environmental Impact Statement is required (scoping)', EIS: 'Environmental Impact Statement',
  CONSULT: 'Consultation request to other agencies before a determination', ADDEND: 'Addendum to an earlier document', ADDENDUM: 'Addendum to an earlier document',
  REVISED: 'Revised', WITHDRAWN: 'Withdrawn', DRAFT: 'Draft', FINAL: 'Final', NEPA: 'Federal (NEPA) document', ADOPT: 'Adoption of an existing document',
}
export const sepaTypeTitle = (type) => String(type || '').split(/,\s*/).filter(Boolean).map((t) => SEPA_TYPE_WORDS[t.toUpperCase()] || t).join('; ')
/** A short plain-words name for the determination ("No significant impact with conditions (MDNS)"). */
export function sepaTypeShort(type) {
  const parts = String(type || '').split(/,\s*/).map((t) => t.trim().toUpperCase()).filter(Boolean)
  const mods = ['REVISED', 'WITHDRAWN', 'ADDENDUM', 'ADDEND', 'DRAFT', 'FINAL']
  const main = parts.find((t) => !mods.includes(t)) || parts[0] || ''
  const word = { DNS: 'No significant impact (DNS)', MDNS: 'No significant impact, with conditions (MDNS)', 'DNS-M': 'No significant impact, with conditions (MDNS)',
    ODNS: 'No significant impact (DNS)', 'ODNS-M': 'No significant impact, with conditions (MDNS)', 'ODNS/NOA': 'Notice of application (DNS expected)',
    'ODNS/NOA-M': 'Notice of application (MDNS expected)', 'DS/SCOPING': 'Significant impact: EIS required', EIS: 'Environmental Impact Statement',
    CONSULT: 'Consultation', ADDEND: 'Addendum', ADDENDUM: 'Addendum', NEPA: 'Federal (NEPA) review' }[main] || main
  const extra = parts.filter((t) => t !== main).map((t) => t.toLowerCase())
  return extra.length ? `${word} · ${extra.join(', ')}` : word
}
/** One permit's SEPA answer in a few words (terminal card indicator, permit page facts). s = { status, reviews }. */
export function sepaIndicator(s) {
  if (!s) return null
  if (s.status === 'linked') return { short: `SEPA: ${s.reviews} review${s.reviews === 1 ? '' : 's'}`, long: `${s.reviews} SEPA review${s.reviews === 1 ? '' : 's'} found that cover${s.reviews === 1 ? 's' : ''} this permit` }
  if (s.status === 'exempt') return { short: 'SEPA: exempt', long: 'Exempt from SEPA review, as the permit’s fact sheet states' }
  if (s.status === 'stated') return { short: 'SEPA: see fact sheet', long: 'The permit’s own document describes a SEPA review; no matching record was found in the SEPA Register' }
  return { short: 'SEPA: none found', long: 'No SEPA review found for this permit' }
}

/** BC register text sometimes repeats itself ("Chlor-Alkali Plant Chlor-Alkali Plant"): show the phrase once. */
export function oncePhrase(s) {
  const t = String(s ?? '').trim()
  const m = /^(.+?)\s+\1$/.exec(t)
  return m ? m[1] : t
}
