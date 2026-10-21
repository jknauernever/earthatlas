/**
 * Which killer whales a sighting names, read from the observer's own words (Orca Network/Whale Alert remarks,
 * SalishSea.io, iNaturalist notes, Happywhale individual labels). Only Southern Residents are federally listed, and
 * no record source has a field for it, so this is the only way a record can confirm the federal listing.
 *
 *   orcaEcotype(text) -> { ecotype: 'southern-resident' | 'biggs' | 'northern-resident' | 'mixed' | null,
 *                          tentative: boolean, evidence: string | null }
 *
 * Conservative on purpose: a hedged identification ("likely J pod", "possibly T46s") is marked tentative and does not
 * confirm anything; a remark naming both ecotypes is 'mixed'; corrections ("edited from SRKWs") are ignored.
 */

// Southern Residents: J, K and L pods, their members (J35, K33, L121), "Js", "SRKW", "Southern Resident".
const SRKW = [
  /\bsouthern residents?\b/i, /\bSRKWs?\b/i, /\b[JKL][- ]?pods?\b/i, /\b[JKL]\s*,\s*[JKL]\s*(?:,|and|&)\s*[JKL]\b/,
  /\b[JKL]'?s\b/, /\b[JKL]\d{1,3}\b/, /\bJKL\b/,
]
// Bigg's (transients): "Biggs", "Bigg's KW", "transients", T-numbers (T19s, T065A5, T124A1, T36A1s).
const BIGGS = [/\bbigg'?s\b/i, /\btransients?\b/i, /\bT0*\d{1,3}(?:[A-Z]\d*)*s?\b/]
const NRKW = [/\bnorthern residents?\b/i, /\bNRKWs?\b/]
const HEDGE = /\b(likely|possibl[ey]|probabl[ey]|presumed|maybe|perhaps|unconfirmed|could be|might be|suspected|\?)/i

const firstMatch = (res, s) => { for (const re of res) { const m = re.exec(s); if (m) return m } return null }

export function orcaEcotype(...texts) {
  const raw = texts.filter(Boolean).join(' · ')
  if (!raw) return { ecotype: null, tentative: false, evidence: null }
  // drop corrections and the boilerplate tail Maplify appends
  const s = raw.replace(/\(?\s*edited? from [^)]*\)?/gi, ' ').replace(/Submitted by .*$/i, ' ')
  const sr = firstMatch(SRKW, s), bg = firstMatch(BIGGS, s), nr = firstMatch(NRKW, s)
  const ecotype = sr && bg ? 'mixed' : sr ? 'southern-resident' : bg ? 'biggs' : nr ? 'northern-resident' : null
  if (!ecotype) return { ecotype: null, tentative: false, evidence: null }
  const m = sr || bg || nr
  // hedge words within ~30 characters before the identification
  const tentative = HEDGE.test(s.slice(Math.max(0, m.index - 30), m.index + m[0].length + 2))
  return { ecotype, tentative, evidence: m[0] }
}
