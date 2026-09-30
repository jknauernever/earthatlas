/**
 * Pure matching helpers for the MEP Alliance lists (lib/ships/mepAlliance.js), used by resolve.js v1.9 decideMep. No imports
 * beyond normalize.js, so resolve.js can use them without an import cycle.
 */
import { normName } from './normalize.js'

// Words that say what kind of company it is, not which one.
const GENERIC = new Set(['SHIPPING', 'MARITIME', 'MARINE', 'NAVIGATION', 'LINES', 'LINE', 'BULK', 'BULKERS', 'CARRIERS', 'CARRIER', 'TANKERS',
  'SHIPMANAGEMENT', 'MANAGEMENT', 'SHIP', 'SHIPS', 'GROUP', 'HOLDINGS', 'HOLDING', 'INTERNATIONAL', 'GLOBAL', 'OCEAN', 'TRADING', 'TRANSPORT',
  'LIMITED', 'CORP', 'CORPORATION', 'COMPANY', 'KISEN', 'KAIUN', 'KAISHA', 'SERVICES', 'ENTERPRISES', 'OWNERS', 'CHARTERING', 'OPERATIONS',
  'TAKEN', 'OVER', 'BENEFIT', 'THE', 'AND', 'PANAMA', 'LIBERIA', 'MARSHALL', 'ISLANDS', 'MALTA', 'HONG', 'KONG', 'SINGAPORE', 'GREECE',
  'JAPAN', 'CHINA', 'CANADA', 'ENERGY', 'DRY', 'STAR', 'GOLDEN', 'NORD', 'NORTH', 'SOUTH', 'EAST', 'WEST', 'PACIFIC', 'ATLANTIC', 'NEW', 'FIRST'])
/** Distinctive words of a company name (≥ 4 letters, not generic). Pure. */
export const companyWords = (s) => [...new Set(String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/)
  .filter((w) => w.length >= 4 && !GENERIC.has(w)))]
/**
 * Do the list's company names share a distinctive word with the vessel's own owner / operator / manager claims? Compared on the
 * compact form too, so "STARBULK" meets "STAR BULK CARRIERS". → the shared words (empty = no corroboration). Pure.
 */
export function companyOverlap(listNames, vesselNames) {
  const theirs = vesselNames.map((v) => ({ words: new Set(companyWords(v)), compact: normName(v) }))
  const shared = new Set()
  for (const n of listNames.filter(Boolean)) {
    for (const w of companyWords(n)) if (theirs.some((t) => t.words.has(w) || (w.length >= 6 && t.compact.includes(w)))) shared.add(w)
    const mine = normName(n)
    if (mine.length >= 6) for (const t of theirs) for (const w of t.words) if (w.length >= 6 && mine.includes(w)) shared.add(w)
  }
  return [...shared]
}

/** Big, ocean-going: ≥ 100 m, or (length unknown and) a big-ship type. A known length under 100 m is never big. Pure. */
export const BIG_M = 100
const BIG_TYPE = /tanker|bulk|container|vehicle|car\s*carrier|ro-?ro|pctc|pcc|cruise|lng|lpg|gas\s*carrier|ore|general\s*cargo|cargo/i
export function isBigShip({ lengths = [], types = [] }) {
  const ls = lengths.map(Number).filter((x) => Number.isFinite(x) && x > 0)
  if (ls.length) return Math.max(...ls) >= BIG_M
  return types.some((t) => BIG_TYPE.test(String(t || '')))
}

