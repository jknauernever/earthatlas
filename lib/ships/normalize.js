/**
 * Deterministic normalization for vessel identifiers (src/ships/CLAUDE.md).
 * Every function returns the comparable form. The raw value is always stored
 * alongside and is never overwritten.
 */

/** Uppercase A–Z0–9 only, diacritics folded: 'Pacific-Star', 'PACIFIC STAR' → 'PACIFICSTAR'. */
export function normName(raw) {
  if (raw == null) return ''
  return String(raw)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/** Callsigns compare case- and punctuation-insensitively. */
export const normCallsign = normName

/** ISO 3166-1 alpha-3, uppercased; anything else is kept but not trusted. */
export function normFlag(raw) {
  return raw == null ? '' : String(raw).trim().toUpperCase()
}

/**
 * IMO ship number: 7 digits whose last digit is the checksum
 * (digits 1–6 weighted 7..2, sum mod 10). 'IMO 8300949' → '8300949'.
 */
export function normImo(raw) {
  const digits = raw == null ? '' : String(raw).replace(/^\s*IMO\s*/i, '').replace(/\D/g, '')
  return { value: digits, valid: imoChecksumOk(digits) }
}

export function imoChecksumOk(d) {
  if (!/^\d{7}$/.test(d) || d === '0000000') return false
  let sum = 0
  for (let i = 0; i < 6; i++) sum += Number(d[i]) * (7 - i)
  return sum % 10 === Number(d[6])
}

/**
 * MMSI: 9 digits. `ship` is true when the leading digit is 2–7, the range the
 * ITU assigns to ship stations (MID 201–775). Coast stations, SAR aircraft,
 * AtoN, handhelds and test ids fall outside it. They are stored, but flagged.
 */
export function normMmsi(raw) {
  const digits = raw == null ? '' : String(raw).replace(/\D/g, '')
  const valid = /^\d{9}$/.test(digits)
  return { value: digits, valid, ship: valid && /^[2-7]/.test(digits) }
}

/**
 * Parse a source timestamp to an ISO UTC string. The zone must be explicit
 * ('Z', '+hh:mm' or GFW's ' UTC' suffix). Zone-less strings throw rather than
 * being guessed as UTC.
 */
export function parseUtc(raw) {
  if (raw == null || raw === '') return null
  let s = String(raw).trim()
  if (/ UTC$/.test(s)) s = s.replace(/ UTC$/, 'Z').replace(' ', 'T')
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) throw new Error(`timestamp without explicit zone: ${raw}`)
  const t = new Date(s)
  if (Number.isNaN(t.getTime())) throw new Error(`unparseable timestamp: ${raw}`)
  return t.toISOString()
}

/** Postgres range literal. Missing bounds = unknown (unbounded), never invented. */
export function rangeLiteral(from, to, kind) {
  if (kind === 'unknown') return '(,)'
  const lo = from ? `"${from}"` : ''
  const hi = to ? `"${to}"` : ''
  const open = from ? '[' : '('
  const close = kind === 'observed' ? (to ? ']' : ')') : ')'
  return `${open}${lo},${hi}${close}`
}
