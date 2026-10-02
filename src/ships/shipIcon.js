// Top-down ship silhouettes for the hover readout (Josh 2026-10-02: "a ship from above, pointed in the direction of travel",
// by type and size; then "a little wider, a little more flourish"). Each points up (north); the marker rotates it to the
// heading. Drawn in a 40 × 60 box centred on x = 20; on-screen height scales with the ship's length (log scale).
const W = '#ffffff', D = '#94a3b8', K = '#0a0e17', S = 'stroke-linecap="round"'

const HULL = 'M20 1 C26 8 29 17 29 27 L29 53 Q29 59 20 59 Q11 59 11 53 L11 27 C11 17 14 8 20 1 Z'          // big ships
const DOUBLE = 'M20 2 C27 6 30 14 30 22 L30 38 C30 46 27 54 20 58 C13 54 10 46 10 38 L10 22 C10 14 13 6 20 2 Z'
const STUBBY = 'M20 10 C28 12 31 18 31 26 L31 50 Q31 56 20 56 Q9 56 9 50 L9 26 C9 18 12 12 20 10 Z'          // tug
const BOAT = 'M20 9 C26 14 28 21 28 29 L28 50 Q28 55 20 55 Q12 55 12 50 L12 29 C12 21 14 14 20 9 Z'            // fishing
const YACHT = 'M20 3 C27 11 30 21 30 31 L30 50 Q30 57 20 57 Q10 57 10 50 L10 31 C10 21 13 11 20 3 Z'          // sailboat

const shapes = {
  // Tanker: round tank domes either side of the pipe run, a liquid drop amidships (Josh: "something to indicate the tanker nature").
  tanker: `<path d="${HULL}" fill="${W}"/>
    <line x1="20" y1="9" x2="20" y2="46" stroke="${D}" stroke-width="1.4" ${S}/>
    ${[14, 39].map((y) => `<circle cx="15.5" cy="${y}" r="2.6" fill="${D}"/><circle cx="24.5" cy="${y}" r="2.6" fill="${D}"/>`).join('')}
    <path d="M20 20 C24.5 25.5 26 29 20 33.5 C14 29 15.5 25.5 20 20 Z" fill="#38bdf8"/>
    <rect x="15" y="47" width="10" height="7" rx="1.2" fill="${D}"/>`,
  cargo: `<path d="${HULL}" fill="${W}"/>
    ${[14, 21, 28, 35, 42].map((y) => `<rect x="15.5" y="${y}" width="4" height="5.5" fill="${D}"/><rect x="20.5" y="${y}" width="4" height="5.5" fill="${D}"/>`).join('')}
    <rect x="15" y="49" width="10" height="5" rx="1" fill="${D}"/>`,
  cruise: `<path d="${HULL}" fill="${W}"/>
    <rect x="14" y="11" width="12" height="43" rx="5" fill="${D}"/>
    ${[16, 21, 26, 31, 36, 41, 46].map((y) => `<line x1="14.6" y1="${y}" x2="16.2" y2="${y}" stroke="${W}" stroke-width="1"/><line x1="23.8" y1="${y}" x2="25.4" y2="${y}" stroke="${W}" stroke-width="1"/>`).join('')}
    <rect x="18" y="20" width="4" height="7" rx="1.2" fill="#38bdf8"/>
    <ellipse cx="20" cy="42" rx="2.2" ry="3" fill="${K}"/>`,
  ferry: `<path d="${DOUBLE}" fill="${W}"/>
    ${[11, 17, 23, 35, 41, 47].map((y) => `<rect x="13.5" y="${y}" width="5.5" height="4" rx="1.3" fill="${D}"/><rect x="21" y="${y}" width="5.5" height="4" rx="1.3" fill="${D}"/>`).join('')}
    <rect x="12" y="28" width="16" height="5" rx="1.5" fill="${D}"/>
    ${[14.5, 17.5, 20.5, 23.5, 26.5].map((x) => `<circle cx="${x - 0.5}" cy="30.5" r="0.8" fill="${W}"/>`).join('')}`,
  fishing: `<line x1="18" y1="24" x2="3" y2="10" stroke="${K}" stroke-width="1.8" ${S}/>
    <line x1="22" y1="24" x2="37" y2="10" stroke="${K}" stroke-width="1.8" ${S}/>
    <path d="M3 10 C1 26 6 42 3 59" fill="none" stroke="#cbd5e1" stroke-width="1.3" stroke-dasharray="2.5 1.8"/>
    <path d="M37 10 C39 26 34 42 37 59" fill="none" stroke="#cbd5e1" stroke-width="1.3" stroke-dasharray="2.5 1.8"/>
    <path d="M20 4 C27 9 29 17 29 25 L29 44 Q29 50 20 50 Q11 50 11 44 L11 25 C11 17 13 9 20 4 Z" fill="${W}"/>
    <rect x="15" y="13" width="10" height="11" rx="1.8" fill="${D}"/>
    <rect x="15.5" y="32" width="9" height="10" rx="1" fill="none" stroke="${D}" stroke-width="1.4"/>`,
  // Tug: stubby, heavy bow fender, winch aft and a tow line trailing behind (Josh: "looks like it would be towing").
  tug: `<path d="M20 38 C24 44 16 48 20 53 C24 57 18 59 20 60" fill="none" stroke="${K}" stroke-width="1.8" ${S}/>
    <path d="M20 3 C29 5 32 11 32 18 L32 32 Q32 39 20 39 Q8 39 8 32 L8 18 C8 11 11 5 20 3 Z" fill="${W}"/>
    <path d="M9 13 C12 3 28 3 31 13" fill="none" stroke="${K}" stroke-width="3.4" ${S}/>
    <rect x="13.5" y="10" width="13" height="12" rx="2" fill="${D}"/>
    <circle cx="20" cy="31" r="3" fill="${D}"/>`,
  sail: `<path d="${YACHT}" fill="${W}"/>
    <path d="M20 15 C30 21 31 35 23 46 L20 46 Z" fill="#e2e8f0" stroke="${K}" stroke-width="1" stroke-linejoin="round"/>
    <circle cx="20" cy="15" r="1.7" fill="${K}"/>
    <line x1="20" y1="15" x2="20" y2="46" stroke="${K}" stroke-width="1.2"/>
    <rect x="15" y="48" width="10" height="6" rx="1.8" fill="${D}"/>`,
  other: `<path d="${HULL}" fill="${W}"/>
    <rect x="15" y="38" width="10" height="14" rx="1.8" fill="${D}"/>
    <rect x="17" y="18" width="6" height="12" rx="1.2" fill="none" stroke="${D}" stroke-width="1.2"/>`,
}

/** EarthAtlas classification (group, class) → silhouette key. */
export function shapeKey(group, cls) {
  if (cls === 'cruise_ship') return 'cruise'
  if (cls === 'ferry' || cls === 'high_speed_craft') return 'ferry'
  if (group === 'tanker') return 'tanker'
  if (group === 'cargo') return 'cargo'
  if (group === 'passenger') return 'cruise'
  if (group === 'fishing') return 'fishing'
  if (group === 'tug_tow' || group === 'port_service') return 'tug'
  if (group === 'recreational') return 'sail'
  return 'other'
}

const TYPICAL_M = { tanker: 180, cargo: 180, cruise: 250, ferry: 100, fishing: 25, tug: 30, sail: 12, other: 60 }

/** → { svg, w, h, key } for the marker element. lengthM: the ship's length when known. */
export function shipIcon({ group, cls, lengthM }) {
  const key = shapeKey(group, cls)
  const L = Number(lengthM) > 2 && Number(lengthM) < 500 ? Number(lengthM) : TYPICAL_M[key]
  const h = Math.round(1.5 * Math.max(40, Math.min(80, 28 + 10 * Math.log2(L / 8))))   // small craft 60 px … 300 m ≈ 120 px (Josh: +50%)
  const w = Math.round(h * 40 / 60)
  const svg = `<svg viewBox="0 0 40 60" width="${w}" height="${h}" aria-hidden="true"><g stroke="${K}" stroke-width="1.1" stroke-linejoin="round">${shapes[key]}</g></svg>`
  return { svg, w, h, key }
}
