/**
 * /permits logic shared by the map popups (PermitsApp.jsx) and the printable permit report (PermitsReport.jsx), so
 * the two can never say different things about a record.
 */

// Laws a record can involve: popup name, formal citation (for the printed report), and the law's text online.
export const LAW = {
  s10: { name: 'Rivers and Harbors Act §10', cite: '33 U.S.C. § 403', url: 'https://www.law.cornell.edu/uscode/text/33/403' },
  s404: { name: 'Clean Water Act §404', cite: '33 U.S.C. § 1344', url: 'https://www.law.cornell.edu/uscode/text/33/1344' },
  s402: { name: 'Clean Water Act §402', cite: '33 U.S.C. § 1342', url: 'https://www.law.cornell.edu/uscode/text/33/1342' },
  s401: { name: 'Clean Water Act §401', cite: '33 U.S.C. § 1341', url: 'https://www.law.cornell.edu/uscode/text/33/1341' },
  s408: { name: '33 U.S.C. §408', cite: '33 U.S.C. § 408', url: 'https://www.law.cornell.edu/uscode/text/33/408' },
  czma: { name: 'Coastal Zone Management Act §307', cite: '16 U.S.C. § 1456', url: 'https://www.law.cornell.edu/uscode/text/16/1456' },
  mmpa: { name: 'Marine Mammal Protection Act §101', cite: '16 U.S.C. § 1371', url: 'https://www.law.cornell.edu/uscode/text/16/1371' },
  nepa: { name: 'National Environmental Policy Act §102', cite: '42 U.S.C. § 4332', url: 'https://www.law.cornell.edu/uscode/text/42/4332' },
  sma: { name: 'Washington Shoreline Management Act', cite: 'RCW 90.58', url: 'https://app.leg.wa.gov/rcw/default.aspx?cite=90.58' },
  hpa: { name: 'Washington Hydraulic Code', cite: 'RCW 77.55', url: 'https://app.leg.wa.gov/rcw/default.aspx?cite=77.55' },
  rcw9048: { name: 'RCW 90.48', cite: 'RCW 90.48', url: 'https://app.leg.wa.gov/rcw/default.aspx?cite=90.48' },
}

export const fmtDate = (d) => {
  if (!d) return ''
  const p = String(d).split('-')
  if (p.length < 3) return d
  return `${+p[2]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1]} ${p[0]}`
}

// A doc's readable link: the agency's own page, else the source-record page (never raw JSON).
export const recordPage = (key) => `/permits/source/${encodeURIComponent(key)}`
export const docHref = (docs, key) => {
  const d = docs[key]
  return d ? d.url || (d.record ? recordPage(key) : null) : null
}

// Which permits a record has, from the documents it cites: an Army Corps record (404 / §10, or a §408 request or a
// jurisdictional determination), an Ecology 401 certification, an NPDES permit (402). `tag` is the dot's map label.
export function permitKindOf(r, docs) {
  if (r.layer === 'npdes') return { layer: 'npdes', tag: r.ended ? '402 · ended' : '402' }
  const keys = [...new Set((JSON.stringify(r).match(/"src":"[^"]+"/g) || []).map((m) => m.slice(7, -1)))]
  const corps = keys.some((k) => docs[k]?.agency === 'corps') || !!r.corpsRef
  const has401 = keys.some((k) => /401 certification/i.test(docs[k]?.title || '')) || !!r.cert401
  const corpsTag = r.corpsKind === 's408' ? '408' : r.corpsKind === 'jds' ? 'JD' : '404'
  if (has401) return { layer: 'cert401', tag: corps ? '401 + 404' : '401' }
  if (r.stateOrder) return { layer: 'cert401', tag: 'State order' }
  if (corps) return { layer: 'structures', tag: corpsTag }
  return { layer: 'local', tag: '' }
}

// ─── "Why it needs a permit": a plain summary of the law behind each record (Josh 2026-10-13). Which laws apply is
// read from the record's own documents and type. Each line is a list of pieces: text, or { law: key } where the law
// goes (the popup links its name; the report prints its citation). ───
const L = (strings, ...vals) => strings.flatMap((s, i) => (i < vals.length ? [s, vals[i]] : [s])).filter((x) => x !== '')
const law = (k) => ({ law: k })
export function whyItems(r, docs) {
  const lines = []
  const titles = Object.keys(docs).filter((k) => JSON.stringify(r).includes(`"${k}"`)).map((k) => docs[k].title).join(' | ')
  const events = (r.trail || []).map((t) => t.event).join(' | ')
  if (r.layer === 'npdes') {
    const water = (r.facts || []).find((f) => f.label === 'Receiving water')?.value
    const what = /stormwater/i.test(r.type) ? 'Stormwater that runs off this site' : /wastewater/i.test(r.type) ? 'Treated wastewater from this plant' : 'Water this operation releases'
    lines.push(L`${what} goes to ${water || 'a water body'}. Discharging pollutants to water needs a permit under ${law('s402')} (NPDES); in Washington, Ecology issues it, under its own water pollution law as well.`)
  }
  const corps = r.corpsKind || (/Army Corps/.test(titles) || r.corpsRef ? 'curated' : null)
  if (corps === 's408') lines.push(L`Changing anything built by a federal Corps project${r.civilWorks ? ` (here: ${r.civilWorks})` : ''} needs Corps permission under ${law('s408')}. The Corps decided none was needed here.`)
  else if (corps === 'jds' || /jurisdictional determination/i.test(titles)) lines.push(L`A jurisdictional determination is the Corps’ ruling on whether a site holds “waters of the United States”; that decides whether ${law('s404')} applies to work there.`)
  else if (corps) lines.push(L`Building in or over navigable water (docks, piles, floats, buoys, cables) needs an Army Corps permit under ${law('s10')}; putting fill or dredged material in water needs one under ${law('s404')}.${r.corpsKind ? ' The Corps record does not say which applies here.' : ''}`)
  if (corps === 'nepa_ea' || /environmental assessment/i.test(`${titles} ${events}`)) lines.push(L`For a permit with possible significant effects, the Corps writes an environmental assessment under ${law('nepa')}.`)
  if (r.stateOrder && !r.cert401) lines.push(L`For waters the Corps doesn’t regulate (such as isolated wetlands), Ecology approves the work with an administrative order under Washington’s water pollution law (${law('rcw9048')}).`)
  if (/401 certification/i.test(titles) || r.cert401) lines.push(L`Before the Corps can issue its permit, Ecology must certify under ${law('s401')} that the work will meet Washington’s water quality standards.`)
  if (/Coastal Zone/i.test(titles)) lines.push(L`Ecology also decides whether a federal permit is consistent with Washington’s coastal program (${law('czma')}).`)
  if (/marine mammal|incidental take/i.test(`${titles} ${events}`)) lines.push(L`In-water noise from pile work can harm marine mammals; NOAA Fisheries authorizes that “incidental take” under ${law('mmpa')}.`)
  if (/shoreline/i.test(`${events} ${titles}`) || r.docks?.some((d) => d.permits.some((x) => x.agency === 'county'))) lines.push(L`Work on Washington’s shorelines needs approval from San Juan County (inside Friday Harbor, from the Town of Friday Harbor) under the ${law('sma')}.`)
  if (/WDFW|HPA/i.test(events) || r.docks?.some((d) => d.permits.some((x) => x.agency === 'wdfw'))) lines.push(L`Work in or near salt or fresh water needs a WDFW Hydraulic Project Approval under the ${law('hpa')}.`)
  if (!lines.length) lines.push(L`Not a permit itself: a related ${String(r.type).toLowerCase()} step on the shore. Any in-water work it leads to needs the permits above (${law('s10')}, ${law('s404')}, ${law('s401')}).`)
  return lines
}

// County records are often ALL CAPS; shown in sentence case (the words are unchanged).
export const calm = (t) => { const x = String(t || ''); return x.length > 12 && x === x.toUpperCase() ? x.charAt(0) + x.slice(1).toLowerCase() : x }

// "What it is", stated only from this record's own sources (Josh 2026-10-14: "either make the assertion from the
// facts or don't"). Returns { label, text, srcKey, srcLabel } or null. When only a permit at a nearby dock under the
// same name describes anything, that permit is stated as what it is, at that dock.
export function whatOf(r) {
  const desc = (r.facts || []).find((f) => /What the project is|as the Corps’ public notice describes it/.test(f.label))
  if (r.summary?.text && r.summary.src) return { label: 'What it is:', text: r.summary.text, srcKey: r.summary.src }
  if (desc) return { label: 'What it is:', text: desc.value, srcKey: desc.src }
  const paren = /\(([^()]{3,})\)\s*$/.exec(r.name || '')?.[1]
  if (paren && r.refs?.[0]) return { label: 'What it is:', text: paren, srcKey: r.refs[0].src, srcLabel: `Army Corps record ${r.refs[0].label}` }
  if (r.source === 'ecology-aquatics' && r.type && r.type !== 'Project reviewed by Ecology') return { label: 'What it is:', text: r.type, srcKey: r.position.src, srcLabel: 'Ecology project category' }
  const dock = r.docks?.[0], p = dock?.permits.find((x) => x.what && x.what !== 'No description in the record')
  if (p) return { label: `At a dock ${dock.m} m away${p.applicant ? `, permit to ${p.applicant}` : ''}:`, text: p.what, srcKey: dock.src,
    srcLabel: `${p.agency === 'wdfw' ? 'WDFW Hydraulic Project Approval' : 'San Juan County permit'}${p.number ? ` ${p.number}` : ''}${p.date ? `, ${fmtDate(p.date)}` : ''}` }
  return null
}

// The years a record shows activity: every dated event up to today (applications, decisions, notices, violations,
// permits starting or ending), plus, for records with no dated event, the year in its Army Corps file number
// (NWS-2008-00219 was opened in 2008).
export function activityYears(r, today = new Date().toISOString().slice(0, 10)) {
  const ys = new Set((r.trail || []).filter((t) => t.date && t.date <= today).map((t) => +String(t.date).slice(0, 4)).filter(Boolean))
  if (!ys.size) {
    const m = /NWS-(\d{4})-/.exec(`${r.corpsRef || ''} ${(r.refs || []).map((x) => x.label).join(' ')}`)
    if (m) ys.add(+m[1])
  }
  return [...ys]
}
