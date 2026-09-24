/**
 * The Emission sources facility card (redesign of 2026-09-24, Josh's layout):
 *
 *   header      name · kind of site · place · month, one confidence badge;
 *               then who owns / runs it and how big it is, in plain words
 *   tiles       three numbers that answer "how much, and should I care?"
 *   why         why it matters HERE — what the gases do (climate, health),
 *               and how the site compares with its neighbours within 4 km
 *   chart       month by month, with the same month last year marked
 *   breakdown   climate share bar + air pollutants
 *   details     collapsed: how the number is counted, owner, confidence…
 *
 * Every outside fact is sourced inline: Climate TRACE (docs/CLIMATETRACE_FACTS.md,
 * their FAQ + GWP post) and EPA pages verified 2026-09-24 (car figure, NO₂,
 * ozone, PM2.5, SO₂). Everything else is computed from the site's own data.
 * Upstream text (names, owners, units) is always escaped; the rest is ours.
 *
 * The shell (header + chart) renders immediately; the body needs the detail
 * records of the site, its co-located twins and its neighbours, so it is
 * filled in when they arrive (usually already cached by the hover).
 */

import {
  currentTraceIndex, loadTraceDetail, peekTraceDetail, traceMixFacts, sectorStyle, subsectorWord, tonnesWord, monthWord,
  measureInfo, MEASURE_SUFFIX, TRACE_URL, TRACE_RELEASE,
} from './traceData.js'

const EPA = {
  car: 'https://www.epa.gov/greenvehicles/greenhouse-gas-emissions-typical-passenger-vehicle',
  no2: 'https://www.epa.gov/no2-pollution/basic-information-about-no2',
  pm: 'https://www.epa.gov/pm-pollution/particulate-matter-pm-basics',
  ozone: 'https://www.epa.gov/ground-level-ozone-pollution/ground-level-ozone-basics',
  so2: 'https://www.epa.gov/so2-pollution/sulfur-dioxide-basics',
}
const GWP_POST = 'https://climatetrace.org/news/feeling-the-heat-global-warming-potentials-and-20-vs-100'
const CAR_T_PER_YEAR = 4.6 // EPA: "A typical passenger vehicle emits about 4.6 metric tons of carbon dioxide per year."
const METHANE_GWP100 = 30 // Climate TRACE: methane's 100-year GWP "is about 30" (AR6)
export const NEARBY_KM = 4

// Climate TRACE uses its own air-pollutant methods for these; every other
// kind of site gets pollutants from national per-industry ratios (Tier 1).
const OWN_AIR_METHOD = /^(electricity-generation|domestic-shipping|international-shipping|road-transportation)$/

// What produces the emissions, in plain words, by kind of site.
const WHERE_FROM = [
  [/shipping$/, 'Ships burn fuel on every trip in and out, and their exhaust comes out at sea level along the shore.'],
  [/aviation$/, 'Planes burn jet fuel on every flight to and from here.'],
  [/^electricity-generation$/, 'This plant burns fuel to make electricity for the grid.'],
  [/refining$/, 'Refineries burn fuel and flare gas to turn crude oil into gasoline, diesel and other products.'],
  [/^oil-and-gas-(production|transport)$/, 'Oil and gas fields leak and flare methane and burn fuel to pump, process and ship what they produce.'],
  [/^coal-mining$/, 'Mining coal releases methane trapped in the seams, and the machinery burns fuel.'],
  [/mining$|quarrying$/, 'Mines burn fuel to dig, haul and process ore.'],
  [/^solid-waste-disposal$/, 'Rotting waste in a landfill makes methane.'],
  [/wastewater/, 'Treating sewage gives off methane and nitrous oxide as the waste breaks down.'],
  [/cattle-operation$/, 'Cattle release methane as they digest their feed, and their manure gives off more.'],
  [/^water-reservoirs$/, 'Plants and soil flooded by the reservoir rot underwater and release methane.'],
  [/^cement$|^lime$/, 'Kilns burn fuel at extreme heat, and baking limestone itself releases CO₂.'],
  [/^iron-and-steel$|^aluminum$|metals$/, 'Metal plants burn fuel and use electricity-hungry processes to make metal.'],
  [/./, 'This site burns fuel for heat and power in its work.'],
]
const whereFrom = (sub) => WHERE_FROM.find(([re]) => re.test(sub))[1]

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const link = (href, label = '↗') => `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#b45309;text-decoration:none">${label}</a>`
const t = (v) => (v == null ? '—' : v === 0 ? '0 t' : v < 1 ? `${Number((v * 1000).toPrecision(2)).toLocaleString('en-US')} kg` : tonnesWord(v).replace(' tonnes', ' t'))
const big = (v) => (v == null ? '—' : v < 1 ? t(v) : v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M t` : `${Number(v.toPrecision(3)).toLocaleString('en-US')} t`)
const pct = (x) => (x > 0 && x < 0.005 ? '<1' : x > 0.995 && x < 1 ? '>99' : String(Math.round(x * 100)))
/** Readable names: "Birch Bay,WA" → "Birch Bay, WA"; basins
 * "Russia_Central Sub-basin" → "Russia · Central Sub-basin"; Climate TRACE's
 * machine names for cattle operations "USA_Washington_MatureDairyCattle_22790"
 * → "Dairy cattle operation #22790, Washington". */
const HERD = { MatureDairyCattle: 'Dairy cattle', OtherBeefCattle: 'Beef cattle' }
export const displayName = (n) => {
  const s = String(n || '')
  const herd = s.match(/^[A-Z]{3}_(?:(.+)_)?([A-Za-z]+Cattle)_(\d+)$/)
  if (herd) {
    const kind = HERD[herd[2]] || herd[2].replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/ (\w)/g, (m) => m.toLowerCase())
    return `${kind} operation #${herd[3]}${herd[1] ? `, ${herd[1].replace(/_/g, ' ')}` : ''}`
  }
  return s.replace(/_/g, ' · ').replace(/,(?=\S)/g, ', ')
}
/** Methane's share of warming in words — the share uses Climate TRACE's
 * rounded "about 30×" factor, so it's only good to a word, not a percent. */
const shareWords = (x) => (x >= 0.9 ? 'nearly all' : x >= 0.6 ? 'most' : x >= 0.4 ? 'about half' : x >= 0.2 ? 'about a third' : 'some')

const GAS_LABEL = { co2e_100yr: 'All greenhouse gases', co2e_20yr: 'All greenhouse gases (20-yr)', co2: 'Carbon dioxide', ch4: 'Methane', n2o: 'Nitrous oxide', pm2_5: 'Fine particles (PM2.5)', so2: 'Sulfur dioxide', nox: 'Nitrogen oxides (NOx)', co: 'Carbon monoxide' }
const GAS_SHORT = { co2e_100yr: 'CO₂e', co2e_20yr: 'CO₂e', co2: 'CO₂', ch4: 'methane', n2o: 'N₂O', pm2_5: 'PM2.5', so2: 'SO₂', nox: 'NOx', co: 'CO' }

// ─── Header + chart (synchronous) ────────────────────────────────────────────

/** Month-by-month bars with a scale, the month on screen solid and the same
 * month a year earlier outlined; plus a caption that says what changed. */
function chart(series, months, idx, color) {
  // The top-of-scale label sits ABOVE the plot (it can be "97,100 t" wide);
  // only the short "0" lives in the left gutter.
  const W = 420, H = 100, left = 16, top = 16, base = 82
  const n = series.length
  const from = Math.max(0, idx - 17) // the 18 months up to the one on screen
  const view = series.slice(from, idx + 1)
  const max = Math.max(0, ...view.filter((v) => v != null))
  if (!(max > 0)) return ''
  const step = (W - left) / view.length
  const bw = Math.max(2, step - 3)
  const lyIdx = idx - 12
  let bars = ''
  view.forEach((v, k) => {
    const i = from + k
    const x = left + k * step
    if (v == null) { bars += `<rect x="${x.toFixed(1)}" y="${base - 1}" width="${bw.toFixed(1)}" height="1" fill="#9ca3af"/>`; return }
    const h = Math.max(v > 0 ? 1 : 0, ((base - top) * v) / max)
    const title = `<title>${esc(monthWord(months[i]))}: ${esc(t(v))}</title>`
    if (i === idx) bars += `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}">${title}</rect>`
    else if (i === lyIdx) bars += `<rect x="${(x + 0.6).toFixed(1)}" y="${(base - h + 0.6).toFixed(1)}" width="${(bw - 1.2).toFixed(1)}" height="${Math.max(0, h - 1.2).toFixed(1)}" fill="none" stroke="${color}" stroke-width="1.2" stroke-dasharray="3 2">${title}</rect>`
    else bars += `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" fill-opacity="0.4">${title}</rect>`
  })
  const lbl = (i, text) => `<text x="${(left + (i - from) * step).toFixed(1)}" y="${H - 4}" font-size="10" fill="#6b7280">${text}</text>`
  let labels = ''
  for (let i = from; i <= idx; i++) if (months[i].endsWith('-01') || i === from) labels += lbl(i, months[i].endsWith('-01') ? months[i].slice(0, 4) : monthWord(months[i]).slice(0, 3))
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Month by month, ${esc(monthWord(months[from]))} to ${esc(monthWord(months[idx]))}" style="display:block">` +
    `<text x="0" y="${top - 5}" font-size="10" fill="#6b7280">${esc(big(max))}</text><text x="0" y="${base}" font-size="10" fill="#6b7280">0</text>` +
    `<line x1="${left}" y1="${base}" x2="${W}" y2="${base}" stroke="#d1d5db" stroke-width="0.8"/>` +
    `<line x1="${left}" y1="${top}" x2="${W}" y2="${top}" stroke="#e5e7eb" stroke-width="0.8" stroke-dasharray="3 3"/>${bars}${labels}</svg>`
  // What changed versus the same month last year — or, if nothing did, why.
  const now = series[idx], ly = lyIdx >= 0 ? series[lyIdx] : null
  let caption = ''
  if (now != null && ly != null && ly > 0) {
    const ch = (now - ly) / ly
    caption = Math.abs(ch) < 0.0005
      ? `${esc(monthWord(months[idx]))} (solid) exactly matches ${esc(monthWord(months[lyIdx]))} (outlined), which suggests the newest months are projected, not yet measured.`
      : `${esc(monthWord(months[idx]))} (solid) is ${ch > 0 ? 'up' : 'down'} ${pct(Math.abs(ch))}% from ${esc(monthWord(months[lyIdx]))} (outlined).`
  }
  return svg + (caption ? `<div style="font-size:11.5px;color:#6b7280;margin:2px 0 0">${caption}</div>` : '')
}

/** Header + chart, ready at click time. `ev` from TraceFacilitiesOverlay.eventFor. */
export function traceCardShell(ev, bodyId) {
  const idx = ev.monthIdx
  // A merged card names the place, not one of its entries.
  const what = ev.twins?.length && /shipping$/.test(ev.sub) ? 'port area (ship traffic)'
    : ev.twins?.length && /cattle-operation$/.test(ev.sub) ? 'cattle operation (animals and manure)'
      : subsectorWord(ev.sub)
  const conf = ev.q
  const confBadge = conf
    ? `<span title="How sure Climate TRACE is about this site's estimate (very low → high)" style="font-size:11px;padding:2px 8px;border-radius:999px;white-space:nowrap;${/low/.test(conf) ? 'background:#fef3c7;color:#92400e' : 'background:#e0f2fe;color:#075985'}">${esc(conf[0].toUpperCase() + conf.slice(1))} confidence</span>`
    : ''
  const color = sectorStyle(ev.sec).color
  return `<div data-trace-card style="width:100%">` +
    `<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">` +
      `<div><div style="font-size:15px;font-weight:700;color:#111827;line-height:1.3">${esc(displayName(ev.n))}</div>` +
      `<div style="font-size:12px;color:#6b7280">${esc(what[0].toUpperCase() + what.slice(1))}${ev.country ? ` · ${esc(ev.country)}` : ''} · ${esc(monthWord(ev.month))}</div>` +
      `<div data-trace-ident>${identHtml([ev.id, ...(ev.twins || []).map((x) => x.id)].map((id) => peekTraceDetail(id, ev.shards)), ev.sub)}</div></div>${confBadge}</div>` +
    `<div id="${bodyId}" style="margin-top:10px">` +
      `<div style="font-size:12.5px;color:#6b7280">Loading what this site puts into the air…</div></div>` +
    `<div style="font-size:13px;font-weight:700;color:#111827;margin:12px 0 2px">Month by month <span style="font-weight:500;color:#6b7280;font-size:11.5px">· ${esc(measureInfo(ev.measure).label.toLowerCase())}</span></div>` +
    chart(ev.series, ev.months, idx, color) +
    `<div data-trace-rest></div>` +
  `</div>`
}

// ─── Body (after the detail records arrive) ──────────────────────────────────

const sumFacts = (list) => {
  const out = {}
  for (const f of list) for (const [g, v] of Object.entries(f || {})) out[g] = (out[g] || 0) + v
  return out
}
const km = (a, b) => {
  const r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(s))
}

/** Compare a site's amount with a neighbour's, in words. */
function versus(mine, theirs, theirName) {
  if (!(mine > 0) || !(theirs > 0)) return null
  const r = mine / theirs
  const who = esc(theirName)
  if (r >= 1.5) return `${r >= 9.5 ? Math.round(r) : r.toFixed(1).replace(/\.0$/, '')}× ${who}`
  if (r >= 0.67) return `about as much as ${who}`
  if (r >= 0.1) return `${pct(r)}% of ${who}`
  return null
}

/**
 * Builds the body HTML (tiles, why, neighbours) and the "rest" HTML
 * (breakdown + collapsed details). Returns null if the site's own record
 * is unavailable.
 */
export async function traceCardBody(ev) {
  const index = currentTraceIndex()
  if (!index) return null
  const ym = ev.month
  const ids = [ev.id, ...(ev.twins || []).map((x) => x.id)]
  const recs = await Promise.all(ids.map((id) => loadTraceDetail(id, ev.shards)))
  if (!recs[0]) return null
  const facts = sumFacts(recs.map((r) => (r ? traceMixFacts(r, ym) : null)))
  const nearby = (ev.nearby || []).slice(0, 6)
  const nRecs = await Promise.all(nearby.map((x) => loadTraceDetail(x.id, ev.shards)))
  const merged = []
  nearby.forEach((x, i) => {
    const f = nRecs[i] ? traceMixFacts(nRecs[i], ym) : {}
    const same = merged.find((m) => m.n === x.n && Math.abs(m.km - x.km) < 0.05)
    if (same) { same.facts = sumFacts([same.facts, f]); same.subs.push(x.sub) } else merged.push({ ...x, facts: f, subs: [x.sub] })
  })
  const neighbours = merged
    .filter((x) => x.facts.co2e_100yr > 0 || x.facts.nox > 0 || x.facts.pm2_5 > 0 || x.facts.ch4 > 0)
    .sort((a, b) => (b.facts.co2e_100yr || 0) - (a.facts.co2e_100yr || 0))

  const g = ev.measure || 'co2e_100yr'
  const co2e = facts.co2e_100yr, co2 = facts.co2, ch4 = facts.ch4
  const methaneShare = ch4 > 0 && co2e > 0 ? Math.min(1, (ch4 * METHANE_GWP100) / co2e) : 0
  const methaneNotable = methaneShare >= 0.1
  const maxNeighbour = (gas) => neighbours.filter((x) => x.facts[gas] > 0).sort((a, b) => b.facts[gas] - a.facts[gas])[0] || null

  // ── Tiles: the measure on the map first, then the two most telling others.
  const tile = (label, value, sub) =>
    `<div style="background:#f3f4f6;border-radius:8px;padding:8px 10px;min-width:0">` +
    `<div style="font-size:11px;color:#6b7280">${label}</div>` +
    `<div style="font-size:18px;font-weight:700;color:#111827;line-height:1.25">${esc(big(value))}</div>` +
    `<div style="font-size:11px;color:#4b5563;line-height:1.35">${sub}</div></div>`
  const tileFor = (gas) => {
    const v = facts[gas]
    if (!(v > 0)) return null
    if (gas === 'co2e_100yr' || gas === 'co2e_20yr' || gas === 'co2') {
      const cars = Math.round((v / CAR_T_PER_YEAR) / 100) * 100
      const sub = gas !== 'co2e_20yr' && cars >= 100
        ? `${GAS_SHORT[gas]} · as much as ${cars.toLocaleString('en-US')} cars emit in a year ${link(EPA.car, 'EPA ↗')}`
        : `${GAS_SHORT[gas]}${gas === 'co2e_20yr' ? ', 20-year view' : ''}`
      return tile('Warms the planet', v, sub)
    }
    if (gas === 'ch4') return tile('Methane', v, co2e > 0 ? `${shareWords(methaneShare)} of its warming ${link(GWP_POST, 'why ↗')}` : 'a potent, short-lived warming gas')
    if (gas === 'n2o') return tile('Nitrous oxide', v, 'traps heat for about a century')
    const nb = maxNeighbour(gas)
    const cmp = nb ? versus(v, nb.facts[gas], displayName(nb.n)) : null
    const plain = { nox: 'forms smog', pm2_5: 'reaches deep into lungs', so2: 'makes breathing harder', co: 'from incomplete burning' }[gas]
    const label = { nox: 'Smog-forming NOx', pm2_5: 'Fine particles', so2: 'Sulfur dioxide', co: 'Carbon monoxide' }[gas]
    return tile(label, v, cmp ? `${cmp} nearby` : plain)
  }
  const order = [g, 'co2e_100yr', methaneNotable ? 'ch4' : null, 'nox', 'pm2_5', 'so2', 'n2o', 'co', 'co2']
    .filter(Boolean)
    .filter((x, i, a) => a.indexOf(x) === i)
    .filter((x) => !(x === 'co2' && order0(g)))
  function order0(m) { return m === 'co2e_100yr' || m === 'co2e_20yr' }
  const tiles = []
  for (const gas of order) {
    if (tiles.length >= 3) break
    if ((gas === 'co2e_100yr' && g === 'co2e_20yr')) continue
    const tl = tileFor(gas)
    if (tl) tiles.push(tl)
  }
  const tilesHtml = tiles.length ? `<div style="display:grid;grid-template-columns:repeat(${tiles.length},minmax(0,1fr));gap:8px">${tiles.join('')}</div>` : ''

  // ── Why it matters here.
  const why = []
  let climate
  if (methaneNotable) {
    climate = `Most of the warming here comes from methane${methaneShare < 0.5 ? ' and CO₂' : ''}. Methane traps about 80 times more heat than CO₂ in its first 20 years (about 30 times over 100), so cutting it is one of the fastest ways to slow warming ${link(GWP_POST, 'Climate TRACE ↗')}.`
  } else if (co2 > 0 && co2e > 0 && co2 / co2e > 0.9) {
    climate = 'Almost all of its warming is CO₂, which stays in the air for centuries.'
  } else if (co2e > 0) {
    climate = 'Its greenhouse gases keep warming the planet long after they leave the site.'
  }
  why.push(`${whereFrom(ev.sub)}${climate ? ` ${climate}` : ''}`)
  const health = []
  if (facts.nox > 0) health.push(`its nitrogen oxides irritate airways, aggravate asthma, and help form ground-level ozone and fine particles ${link(EPA.no2, 'EPA ↗')}`)
  if (facts.pm2_5 > 0) health.push(`fine particles get deep into lungs and some reach the bloodstream ${link(EPA.pm, 'EPA ↗')}`)
  if (facts.so2 > 0 && facts.so2 >= (facts.pm2_5 || 0)) health.push(`sulfur dioxide makes breathing difficult, especially for children with asthma ${link(EPA.so2, 'EPA ↗')}`)
  if (health.length) why.push(`What it releases also affects the air people nearby breathe: ${health.join('; ')}.`)
  if (!OWN_AIR_METHOD.test(ev.sub) && health.length) why.push('<span style="color:#6b7280">These air-pollution figures are rough: Climate TRACE estimates them from national averages per industry and fuel.</span>')

  let cluster = ''
  if (neighbours.length) {
    const around = neighbours.reduce((a, x) => a + (x.facts.co2e_100yr || 0), 0)
    const ratio = co2e > 0 ? around / co2e : 0
    const airRival = ['pm2_5', 'nox'].some((gas) => { const nb = maxNeighbour(gas); return facts[gas] > 0 && nb && facts[gas] >= 0.67 * nb.facts[gas] })
    if (ratio >= 2) cluster = `This site sits in a cluster: the ${neighbours.length === 1 ? 'other site' : `${neighbours.length} other sites`} within ${NEARBY_KM} km${neighbours.length > 3 ? ' (largest three below)' : ''} released ${ratio >= 9.5 ? Math.round(ratio) : ratio.toFixed(1).replace(/\.0$/, '')}× more climate gases this month${airRival ? '. For the air people breathe, though, this one rivals them.' : '.'}`
    else if (ratio > 0 && ratio <= 0.5) cluster = `It's the biggest climate source within ${NEARBY_KM} km.`
    else if (ratio > 0) cluster = `It's one of several comparable sources within ${NEARBY_KM} km.`
    const rows = neighbours.slice(0, 3).map((x) =>
      `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(displayName(x.n))} <span style="color:#9ca3af">· ${esc(x.subs.length > 1 && /cattle/.test(x.sub) ? 'cattle operation' : x.subs.length > 1 && /shipping$/.test(x.sub) ? 'port area' : subsectorWord(x.sub))} · ${x.km.toFixed(1)} km</span></span>` +
      `<span style="white-space:nowrap">${x.facts.co2e_100yr > 0 ? `${esc(big(x.facts.co2e_100yr))} CO₂e` : '—'}</span>`).join('')
    cluster = (cluster ? `<div>${cluster}</div>` : '') +
      `<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;font-size:12px;color:#4b5563;margin-top:4px">${rows}</div>`
  }
  const whyHtml = `<div style="font-size:13px;font-weight:700;color:#111827;margin:12px 0 3px">Why it matters here</div>` +
    `<div style="font-size:13px;line-height:1.55;color:#1f2937;display:flex;flex-direction:column;gap:6px">${why.map((p) => `<div>${p}</div>`).join('')}${cluster ? `<div>${cluster}</div>` : ''}</div>`

  // ── Breakdown (after the chart).
  let breakdown = ''
  if (co2e > 0 && co2 != null) {
    const p = Math.max(0, Math.min(1, co2 / co2e))
    breakdown += `<div style="display:flex;height:7px;border-radius:4px;overflow:hidden;background:#e5e7eb;margin-top:4px" role="img" aria-label="CO₂ ${pct(p)}% of this site’s warming"><span style="width:${(p * 100).toFixed(1)}%;background:#ea580c"></span><span style="flex:1;background:#7c3aed"></span></div>` +
      `<div style="font-size:11.5px;color:#4b5563;margin:3px 0 6px"><span style="color:#ea580c">■</span> CO₂ ${pct(p)}% · <span style="color:#7c3aed">■</span> methane &amp; nitrous oxide ${pct(1 - p)}% of its warming (CO₂e ${esc(t(co2e))}${ch4 > 0 ? ` · methane ${esc(t(ch4))}` : ''}${facts.n2o > 0 ? ` · N₂O ${esc(t(facts.n2o))}` : ''})</div>`
  } else if (co2e > 0 && (ch4 > 0 || facts.n2o > 0)) {
    breakdown += `<div style="font-size:12px;color:#374151;margin:3px 0 6px">Greenhouse gases: ${ch4 > 0 ? `methane <b>${esc(t(ch4))}</b>` : ''}${ch4 > 0 && facts.n2o > 0 ? ' · ' : ''}${facts.n2o > 0 ? `nitrous oxide <b>${esc(t(facts.n2o))}</b>` : ''} <span style="color:#6b7280">(together ${esc(t(co2e))} CO₂e; no CO₂ reported)</span></div>`
  } else if (co2e > 0 && ch4 == null && facts.n2o == null) {
    breakdown += '<div style="font-size:11.5px;color:#4b5563;margin:3px 0 6px">Climate TRACE gives no separate gas breakdown for this site.</div>'
  }
  const air = ['nox', 'so2', 'pm2_5', 'co'].filter((gas) => facts[gas] != null)
  if (air.length) {
    breakdown += `<div style="display:grid;grid-template-columns:repeat(${air.length},minmax(0,1fr));gap:6px;font-size:12px">` +
      air.map((gas) => `<div><div style="color:#6b7280">${GAS_SHORT[gas]}</div><div style="font-weight:700;color:#111827">${esc(t(facts[gas]))}</div></div>`).join('') + '</div>'
  }
  const breakdownHtml = breakdown ? `<div style="font-size:13px;font-weight:700;color:#111827;margin:12px 0 2px">What's in it · ${esc(monthWord(ym))}</div>${breakdown}` : ''

  // ── Collapsed details.
  let method = null
  try { method = (await import('./traceSubsectors.json')).default[ev.sub] } catch { method = null }
  const scope = ev.b
    ? 'This figure covers a whole oil or gas basin, placed at its center; Climate TRACE deliberately doesn’t publish exact oil and gas locations.'
    : /shipping$/.test(ev.sub)
      ? 'Ship voyages are counted by their ports: each voyage’s emissions are split half to its departure port and half to its arrival port. It isn’t the port’s own operations, and the point stands in for the whole port area.'
      : /aviation$/.test(ev.sub)
        ? 'Counts fuel burned by flights; the airport’s own ground operations aren’t included.'
        : ''
  const twinSplit = ev.twins?.length
    ? `This card combines Climate TRACE’s ${ids.length} entries for this place: ${recs.map((r, i) => r ? `${esc(subsectorWord(r.sub))} ${esc(t(traceMixFacts(r, ym).co2e_100yr))} CO₂e` : null).filter(Boolean).join(' + ')}.`
    : ''
  const confParts = recs[0].conf ? Object.entries(recs[0].conf).map(([k, w]) => `${esc(k.replace(/_/g, ' '))}: ${esc(w)}`).join(' · ') : null
  const details = [
    confParts ? `Confidence by part — ${confParts}` : null,
    ev.r && !ev.twins?.length ? `Rank for ${esc(measureInfo(g).label.toLowerCase())}: #${ev.r.toLocaleString('en-US')} of ${(ev.measureTotal || ev.total).toLocaleString('en-US')} sources on this map` : null,
  ].filter(Boolean)
  const detailsHtml =
    `<details style="margin-top:12px;border-top:1px solid #e5e7eb;padding-top:8px;font-size:12.5px"><summary style="cursor:pointer;font-weight:600;color:#374151">How this is counted</summary>` +
      `<div style="color:#4b5563;line-height:1.5;margin-top:4px;display:flex;flex-direction:column;gap:4px">` +
      (scope ? `<div>${scope}</div>` : '') + (twinSplit ? `<div>${twinSplit}</div>` : '') +
      (method?.method ? `<div>${esc(method.method)}${method.url ? ` ${link(method.url, 'Climate TRACE method ↗')}` : ''}</div>` : '') +
      '<div>Model estimates from satellite and activity data, not measurements.</div></div></details>' +
    (details.length ? `<details style="margin-top:6px;font-size:12.5px"><summary style="cursor:pointer;font-weight:600;color:#374151">Details</summary><div style="color:#4b5563;line-height:1.5;margin-top:4px;display:flex;flex-direction:column;gap:2px">${details.map((d) => `<div>${d}</div>`).join('')}</div></details>` : '') +
    `<div style="font-size:12px;margin-top:8px">${link(TRACE_URL, `Source: Climate TRACE ${esc(TRACE_RELEASE)} ↗`)}</div>`

  return {
    ident: identHtml(recs, ev.sub),
    body: tilesHtml + whyHtml,
    rest: breakdownHtml + detailsHtml,
    facts,
    neighbours: neighbours.map((x) => ({ name: displayName(x.n), type: x.sub, km: Math.round(x.km * 10) / 10, co2e_t: x.facts.co2e_100yr ?? null, nox_t: x.facts.nox ?? null, pm2_5_t: x.facts.pm2_5 ?? null, ch4_t: x.facts.ch4 ?? null })),
    methaneShare,
  }
}

// ─── Owner + size (under the name) ───────────────────────────────────────────

// Ownership rows list every ultimate shareholder — index funds with 0.1%
// stakes included — so the parent is only named when it holds a majority.
const NOT_A_NAME = /^(small shareholder\(s\)|natural person\(s\)|unknown|member\/employee owned|not found)$/i
const named = (x) => (x && !NOT_A_NAME.test(String(x).trim()) ? String(x).trim() : null)
const list2 = (xs) => (xs.length > 2 ? `${xs[0]} and ${xs.length - 1} others` : xs.join(' and '))

/** "Owned by X, part of Y · run by Z" — the company that directly owns the
 * site, its majority parent, and the operator when that's someone else. */
function ownerWords(recs) {
  const rows = recs.flatMap((r) => r?.own || [])
  if (!rows.length) return null
  const direct = [...new Set(rows.map((o) => named(o.imm)).filter(Boolean))]
  const parents = new Map()
  for (const o of rows) { const p = named(o.p); if (p && o.sh != null) parents.set(p, Math.max(parents.get(p) || 0, o.sh)) }
  const majority = [...parents].filter(([, sh]) => sh >= 50).sort((a, b) => b[1] - a[1])[0]?.[0]
  const anyParent = [...new Set(rows.map((o) => named(o.p)).filter(Boolean))]
  const owner = direct.length ? list2(direct) : majority || (anyParent.length === 1 ? anyParent[0] : null)
  const part = owner && majority && !direct.includes(majority) && majority !== owner ? majority : null
  const ops = [...new Set(rows.map((o) => named(o.op)).filter(Boolean))].filter((x) => !direct.includes(x) && x !== owner)
  const bits = []
  if (owner) bits.push(`Owned by ${esc(owner)}${part ? `, part of ${esc(part)}` : ''}`)
  if (ops.length) bits.push(`${owner ? 'run' : 'Run'} by ${esc(list2(ops))}`)
  return bits.length ? bits.join(' · ') : null
}

const n3 = (v) => Number(v.toPrecision(3)).toLocaleString('en-US')
const PRODUCT = { cement: 'cement', steel: 'steel', lime: 'lime', 'pulp & paper': 'pulp and paper', ethylene: 'ethylene', 'alumina/aluminum': 'alumina or aluminum', chemical: 'chemicals' }

/** The site's size in words, from Climate TRACE's capacity field. Only units
 * whose meaning is clear are shown; the "t of …" capacities are per month
 * (activity ÷ capacity = capacity factor on the monthly rows). Merged twins
 * describe the same place, so the largest value is used, not the sum. A zero
 * capacity means withheld, not zero. */
function capacityWords(recs, sub) {
  const withCap = recs.filter((r) => r?.cap > 0 && r.cu)
  if (!withCap.length) return null
  const unit = withCap[0].cu
  const v = Math.max(...withCap.filter((r) => r.cu === unit).map((r) => r.cap))
  if (unit === 'MW') return `Can generate up to ${n3(v)} megawatts`
  if (unit === 'BBL per day') return `Can process ${n3(v)} barrels of crude oil a day`
  if (unit === 'animal head(s)') return `Herd of about ${n3(v)} cattle`
  if (unit === 'population served or population equivalent') return `Serves about ${n3(v)} people`
  if (unit === 'm2') return v >= 1e6 ? `Covers about ${n3(v / 1e6)} km²` : `Covers about ${n3(v / 1e4)} hectares`
  if (unit === 't of coal') return `Can mine about ${n3(v)} t of coal a month`
  const prod = unit.match(/^t of (.+)$/)?.[1]
  if (prod && PRODUCT[prod]) return `Can make about ${n3(v)} t of ${PRODUCT[prod]} a month`
  return null
}

/** Owner and size lines under the card's name (empty until the record loads). */
export function identHtml(recs, sub) {
  if (!recs?.[0]) return ''
  const lines = [ownerWords(recs), capacityWords(recs, sub)].filter(Boolean)
  if (!lines.length) return ''
  return `<div style="font-size:12px;color:#374151;line-height:1.45;margin-top:3px">${lines.map((l) => `<div>${l}</div>`).join('')}` +
    `<div style="font-size:11px">${link(TRACE_URL, 'Climate TRACE ↗')}</div></div>`
}

/** Neighbours within NEARBY_KM and co-located twins, from the overlay's
 * harvested items (TraceFacilitiesOverlay.eventFor calls this). */
export function nearbyOf(it, items) {
  const twins = [], nearby = []
  for (const o of items) {
    if (o === it || o.id === it.id) continue
    const d = km({ lat: it.lat, lng: it.lng }, { lat: o.lat, lng: o.lng })
    if (d < 0.05 && o.n === it.n) { twins.push({ id: o.id, sub: o.sub, vals: o.vals }); continue }
    if (d <= NEARBY_KM) nearby.push({ id: o.id, n: o.n, sub: o.sub, sec: o.sec, km: d, y: o.y || 0 })
  }
  nearby.sort((a, b) => b.y - a.y)
  return { twins, nearby: nearby.slice(0, 8) }
}
