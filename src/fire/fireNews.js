// ─── Fire news — "news about this fire" in the click popup ──────────────────
// Reuses the cloud function's provider-agnostic news backend (the same
// `?news=1&named=…&location=…&cause=…&window=…` endpoint the Forest Monitor
// popup uses — Tavily / Brave / Google News RSS behind one shape). We surface it
// for fire clicks:
//   • a NIFC named incident → search by fire NAME → precise "news about this fire"
//   • a FIRMS hotspot / Canada perimeter (no name) → search by reverse-geocoded
//     place + "wildfire" in a tight recent window → "recent wildfire news near here"
// Every article carries its own source + link (provenance by construction).

import styles from './FireApp.module.css'

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Reverse-geocode returns a "City, REGION, CC" admin string whose LAST part is a
// 2-letter ISO country code — and remote spots can collapse to the bare code
// ("CA" for a Northwest Territories point). Fed to a news search verbatim, "CA"
// reads as California, so a Canadian fire pulled California news. Expand the
// trailing country code to a full name so the query is unambiguous (a full
// "Canada"/"United States" also anchors any earlier "CA"=California region).
const COUNTRY_NAMES = {
  CA: 'Canada', US: 'United States', MX: 'Mexico', AU: 'Australia', BR: 'Brazil',
  AR: 'Argentina', CL: 'Chile', ES: 'Spain', PT: 'Portugal', FR: 'France',
  IT: 'Italy', GR: 'Greece', TR: 'Turkey', RU: 'Russia', ID: 'Indonesia',
  IN: 'India', ZA: 'South Africa', AO: 'Angola', CD: 'DR Congo', GB: 'United Kingdom',
}
// Region (province / state) codes → full names. Wildfire news is reported at the
// province/state level, and headlines say "Saskatchewan", never "SK" — so a
// quoted "SK" in the search finds nothing. Canada + US (+ AU) cover the layers
// that can produce a nearby search. Unmapped codes fall through unchanged.
const REGION_NAMES = {
  // Canada
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories',
  NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec',
  SK: 'Saskatchewan', YT: 'Yukon',
  // US
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  // Australia
  NSW: 'New South Wales', VIC: 'Victoria', QLD: 'Queensland', WA2: 'Western Australia',
  SA: 'South Australia', TAS: 'Tasmania',
}
// Build the location string fed to the news search. `broad` (used for unnamed,
// nearby searches) drops the hyper-local first component (hamlet) and searches
// at the province/state level — a remote fire is covered as "Saskatchewan
// wildfire", never by a tiny hamlet's name. Country and region codes expand to
// full names so "CA" can't read as California and "SK" matches headlines.
export function newsLocation(place, { broad = false } = {}) {
  if (!place) return null
  let parts = String(place).split(',').map((s) => s.trim()).filter(Boolean)
  if (broad && parts.length >= 3) parts = parts.slice(1) // drop the hamlet
  const li = parts.length - 1
  if (li >= 0 && /^[A-Z]{2,3}$/.test(parts[li]) && COUNTRY_NAMES[parts[li]]) parts[li] = COUNTRY_NAMES[parts[li]]
  if (parts.length >= 2) {
    const ri = parts.length - 2
    if (/^[A-Z]{2,3}$/.test(parts[ri]) && REGION_NAMES[parts[ri]]) parts[ri] = REGION_NAMES[parts[ri]]
  }
  return parts.join(', ')
}

// Fetch articles from the cloud function. `base` is TILES_API_BASE (the same
// cloud fn that serves the EE tiles). Returns [] on any failure.
export async function fetchFireNews(base, { named, location, windowDays = 14, signal } = {}) {
  const p = new URLSearchParams({ news: '1', cause: 'wildfire', window: String(windowDays) })
  if (named) p.set('named', named)
  if (location) p.set('location', location)
  try {
    const r = await fetch(`${base}?${p.toString()}`, { signal })
    const d = await r.json()
    return Array.isArray(d.articles) ? d.articles : []
  } catch {
    return []
  }
}

function dateText(iso) {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!ms) return null
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Render the news section. `state` = { articles, loading, named, place }.
// Returns '' when there's nothing useful to show (done + empty for a nearby
// search) so the popup doesn't carry a dead heading.
export function renderNewsCard({ articles, loading, named, place }) {
  const heading = named
    ? `News about the ${esc(named)} Fire`
    : 'Recent wildfire news near here'

  if (loading) {
    return `<div class="${styles.popupParcel}">` +
      `<div class="${styles.popupParcelTitle}">${heading}</div>` +
      `<div class="${styles.popupRow}"><span class="${styles.popupRowValue}">Looking for recent news…</span></div></div>`
  }

  if (!articles || !articles.length) {
    // Always show the empty state (this section only renders on an active-fire
    // click) so "no coverage" reads as exactly that, not a broken lookup.
    return `<div class="${styles.popupParcel}">` +
      `<div class="${styles.popupParcelTitle}">${heading}</div>` +
      `<div class="${styles.popupRow}"><span class="${styles.popupRowValue}">${named ? 'No recent news found for this fire.' : 'No recent wildfire news found nearby.'}</span></div></div>`
  }

  const linkStyle = 'display:block;padding:4px 0;text-decoration:none;color:inherit;border-top:1px solid rgba(255,255,255,0.08)'
  const titleStyle = 'font-weight:600;line-height:1.25'
  const metaStyle = 'opacity:0.7;font-size:0.85em;margin-top:1px'
  const items = articles.slice(0, 4).map((a) => {
    const meta = [a.source, dateText(a.published_date)].filter(Boolean).map(esc).join(' · ')
    return `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" style="${linkStyle}">` +
      `<div style="${titleStyle}">${esc(a.title)}</div>` +
      (meta ? `<div style="${metaStyle}">${meta} ↗</div>` : '') + '</a>'
  }).join('')

  // The subhead is honest about the nearby case being place-based, not pixel-exact.
  const sub = named ? '' : `<div class="${styles.popupRowValue}" style="opacity:0.7;font-size:0.85em">Matched by location, not confirmed for this exact detection.</div>`
  const src = `<div class="${styles.popupParcelSrc}">News via Google News</div>`

  return `<div class="${styles.popupParcel}">` +
    `<div class="${styles.popupParcelTitle}">${heading}</div>` +
    sub + items + src + '</div>'
}
