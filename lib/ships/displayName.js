/**
 * Which of a vessel's names is its title (ship card header, search results, the pill). Pure; shared by
 * src/ships/VesselCard.jsx currentIdentity and lib/ships/queries.js summarize so both show the same name (Josh 2026-10-21).
 *
 * `rows` = the vessel's name claims: { value_raw, evidence_class, source_id, to } (to = end of the claim's period, ISO or
 * null). Steps:
 *   1. AIS padding is not part of a name: trailing/leading runs of - _ . * @ = are cut ("US GOV VESSEL-------").
 *   2. Generic labels ("US GOV VESSEL", "US WARSHIP 25", "NAVY UNIT 34", misspelled "WAPSHIP 25") lose to any specific
 *      name the vessel also carries (USS SOMERSET LPD25).
 *   3. The usual order: a registry name first, then the latest.
 *   4. If that name has a one-letter variant on the same vessel (a reviewed typo merge: HARMATTAN / HARMATTANA), the variant
 *      more publishers report wins (all GFW feeds count as one); still tied, the spelling without a stray extra letter at either end wins, unless the
 *      shorter one is cut at AIS's 20-character limit (SWIFT OF SOUTHAMPTO).
 * Returns the chosen row with value_raw cleaned, or null.
 */
const FILLER = /^[\s\-_.*@=]+|[\s\-_.*@=]+$/g
export const cleanName = (raw) => String(raw ?? '').replace(FILLER, '').replace(/\s{2,}/g, ' ')
const key = (raw) => cleanName(raw).normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')

const GENERIC = ['US', 'USA', 'USS', 'USNS', 'USCG', 'USCGC', 'GOV', 'GOVT', 'GOVERNMENT', 'GOVERMENT', 'VESSEL', 'VSL', 'NAVY', 'WARSHIP',
  'SHIP', 'UNIT', 'MILITARY', 'COAST', 'GUARD', 'UNKNOWN', 'NONAME', 'NA', 'TEST', 'BOAT']

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/** A name that only says "a government / navy ship" (+ a number): every word generic, a number, or one letter off a generic word. */
export function isGenericName(raw) {
  const words = cleanName(raw).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  if (!words.length) return true
  return words.every((w) => /^\d+$/.test(w) || GENERIC.includes(w) || (w.length >= 5 && GENERIC.some((g) => g.length >= 5 && lev(w, g) === 1))
    || GLUED.test(w))
}
// Generic words run together (USGOVTVSL, NAVYUNIT34, USWARSHIP25).
const GLUED = new RegExp(`^(?:${[...GENERIC].sort((a, b) => b.length - a.length).join('|')})+\\d*$`)

const latestFirst = (x, y) => (y.evidence_class === 'registry') - (x.evidence_class === 'registry') || String(y.to || '9999').localeCompare(String(x.to || '9999'))

export function pickDisplayName(rows = []) {
  const all = rows.filter((r) => key(r.value_raw))
  if (!all.length) return null
  const specific = all.filter((r) => !isGenericName(r.value_raw))
  const pool = specific.length ? specific : all
  let best = [...pool].sort(latestFirst)[0]
  const variants = pool.filter((r) => { const a = key(r.value_raw), b = key(best.value_raw); return a !== b && lev(a, b) === 1 && a.replace(/\D/g, '') === b.replace(/\D/g, '') })
  if (variants.length && best.evidence_class !== 'registry') {
    // Independent publishers, not feeds: GFW's identity data and its hourly positions are one publisher (prod HARMATTANA
    // came from both, HARMATTAN from MarineCadastre: a tie, settled by the stray-letter rule below).
    const publisher = (id) => (String(id).startsWith('gfw-') ? 'gfw' : id)
    const support = (k) => new Set(pool.filter((r) => key(r.value_raw) === k).map((r) => publisher(r.source_id))).size
    const registry = (k) => pool.some((r) => key(r.value_raw) === k && r.evidence_class === 'registry')
    for (const v of variants) {
      const [a, b] = [key(best.value_raw), key(v.value_raw)]
      const [short, long] = a.length < b.length ? [a, b] : [b, a]
      // One extra letter at either end: a stray character (prefer the shorter), unless the shorter is cut at AIS's
      // 20-character limit (prefer the longer, complete name).
      const endOnly = long.length === short.length + 1 && (long.startsWith(short) || long.endsWith(short))
      const cut = endOnly && long.startsWith(short) && cleanName(pool.find((r) => key(r.value_raw) === short).value_raw).length >= 19
      const prefer = !endOnly ? null : cut ? long : short
      const better = registry(b) - registry(a) || support(b) - support(a) || (prefer ? (b === prefer) - (a === prefer) : 0)
      if (better > 0) best = v
    }
  }
  // Of spellings of the chosen name, the most readable (most word breaks; ties keep the given order).
  const breaks = (raw) => (cleanName(raw).match(/[\s\-/.]/g) || []).length
  const spellings = all.filter((r) => key(r.value_raw) === key(best.value_raw))
  const shown = spellings.reduce((m, r) => (breaks(r.value_raw) > breaks(m.value_raw) ? r : m), best)
  return { ...best, value_raw: cleanName(shown.value_raw) }
}
