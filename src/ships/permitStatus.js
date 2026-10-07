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
}
export const statusKey = (s) => String(s || '').split(/[;(]/)[0].trim().toLowerCase()
export const statusSource = (p) => (p.system === 'WA-PARIS' ? 'WA Ecology PARIS' : 'EPA ECHO')

/** "In force" etc. for a card row (p = a permits row: epa_system + program_status). */
export const statusShort = (p) => STATUS_WORDS[statusKey(p.program_status)]?.short ?? p.program_status ?? ''
export const statusTitle = (p) => `${p.epa_system === 'WA-PARIS' ? 'WA Ecology PARIS' : 'EPA ECHO'} lists it as “${p.program_status}”${STATUS_WORDS[statusKey(p.program_status)] ? `: ${STATUS_WORDS[statusKey(p.program_status)].long}` : ''}`
