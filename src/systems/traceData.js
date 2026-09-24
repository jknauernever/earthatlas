/**
 * Climate TRACE facility data for /inmotion — where the baked artifacts live
 * and how to read them. Produced by scripts/bake-climatetrace/bake.mjs; see
 * docs/CLIMATETRACE_API.md for the upstream study.
 *
 *   pointer <blob>/trace/latest.json → the current release's index URL
 *           (republished by the monthly GitHub Action, climatetrace-bake.yml)
 *   index   trace-index.json — release, build, months[], counts, dictionary
 *   tiles   /api/trace-tiles?v=<build> (PMTiles range-read; every facility,
 *           each carrying its monthly series)
 *   detail  /api/trace-detail?v=<build>&s=<id % shards> — exact per-source
 *           records (ownership chains, confidence, capacity, activity, extras)
 *
 * Dev reads the index from public/dev-data/trace/ (bake.mjs dev) and the
 * routes read the local build; if there's no local bake it falls back to the
 * production pointer.
 */

import cfg from './traceSource.json'

const DEV_INDEX = '/dev-data/trace/trace-index.json'
const POINTER_URL = `${cfg.blobBase.replace(/\/+$/, '')}/${cfg.pointer}`

export const TRACE_URL = 'https://climatetrace.org'
// Live bindings, filled in by loadTraceIndex().
export let TRACE_RELEASE = 'Climate TRACE'
let traceIndex = null
export const currentTraceIndex = () => traceIndex

/** Mapbox needs an ABSOLUTE tile template — a root-relative one is resolved
 * against the Mapbox API host and silently never loads. `g` = measure; a
 * release baked before per-measure tiles (no index.measures) has one file. */
export const traceTileUrl = (g = PRIMARY_MEASURE) =>
  `${window.location.origin}/api/trace-tiles?v=${encodeURIComponent(traceIndex?.build || '')}` +
  (traceIndex?.measures ? `&g=${encodeURIComponent(g)}` : '') + '&z={z}&x={x}&y={y}'

// ─── Measures (what the map can be sized by) ─────────────────────────────────
// Wording and numbers follow docs/CLIMATETRACE_FACTS.md (Climate TRACE's own
// FAQ + GWP post) — change them only against that page.
export const PRIMARY_MEASURE = 'co2e_100yr'
export const MEASURE_INFO = {
  co2e_100yr: { group: 'climate', label: 'All greenhouse gases', short: 'CO₂e', unit: 'tonnes CO₂e', hint: 'every gas combined by how much heat it traps' },
  co2e_20yr: { group: 'climate', label: 'All greenhouse gases', short: 'CO₂e · 20-yr', unit: 'tonnes CO₂e (20-year)', hint: 'every gas combined, near-term warming', variantOf: 'co2e_100yr' },
  co2: { group: 'climate', label: 'Carbon dioxide', short: 'CO₂', unit: 'tonnes of CO₂', hint: 'mostly from burning coal, oil and gas' },
  ch4: { group: 'climate', label: 'Methane', short: 'Methane', unit: 'tonnes of methane', hint: 'gas leaks, coal mines, cattle, landfills' },
  n2o: { group: 'climate', label: 'Nitrous oxide', short: 'N₂O', unit: 'tonnes of nitrous oxide', hint: 'manure, fertilizer and some industry' },
  pm2_5: { group: 'air', label: 'Fine particles (PM2.5)', short: 'PM2.5', unit: 'tonnes of fine particles (PM2.5)', hint: 'soot small enough to reach deep into lungs' },
  so2: { group: 'air', label: 'Sulfur dioxide', short: 'SO₂', unit: 'tonnes of sulfur dioxide', hint: 'burning coal and heavy oil, smelting' },
  nox: { group: 'air', label: 'Nitrogen oxides', short: 'NOx', unit: 'tonnes of nitrogen oxides', hint: 'engines, boilers, furnaces' },
  co: { group: 'air', label: 'Carbon monoxide', short: 'CO', unit: 'tonnes of carbon monoxide', hint: 'fuel that doesn’t burn completely' },
}
export const measureInfo = (g) => MEASURE_INFO[g] || MEASURE_INFO[PRIMARY_MEASURE]
/** Measures this release actually has (older releases: CO₂e only). */
export const availableMeasures = (index) => (index?.measures ? Object.keys(index.measures) : [PRIMARY_MEASURE])
/** One line for facility cards; the full note lives in the measure picker. */
export const AIR_CAVEAT_SHORT = 'Air-pollution figures are rough: estimated from national averages per industry, so they show where pollution comes from better than exact amounts.'
export const AIR_CAVEAT = 'Air-pollution figures are rougher than the climate ones: for most kinds of site, Climate TRACE estimates them from national averages per industry and fuel, scaled by each site’s activity. They show where pollution comes from better than exactly how much one site emits.'

async function fetchIndex(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`trace index ${r.status}`)
  const j = await r.json()
  if (j?.version !== 1 || j?.kind !== 'trace-facilities') throw new Error('unexpected trace index')
  return j
}

export async function loadTraceIndex() {
  let j = null
  if (import.meta.env.DEV) { try { j = await fetchIndex(DEV_INDEX) } catch { j = null } }
  if (!j) {
    const r = await fetch(POINTER_URL, { cache: 'no-cache' })
    if (!r.ok) throw new Error(`Climate TRACE pointer ${r.status}`)
    const pointer = await r.json()
    j = await fetchIndex(pointer.index)
  }
  traceIndex = j
  TRACE_RELEASE = j.release
  return j
}

const shardCache = new Map() // shard → Promise<Map<id, record>>

const CONF_WORDS_BY_CODE = { 1: 'very low', 2: 'low', 3: 'medium', 4: 'high', 5: 'very high' }
const unRle = (arr) => arr.flatMap((v) => (Array.isArray(v) ? Array(v[1]).fill(v[0]) : [v]))

/** Format-2 shard record (bake.mjs encodeDetail) → the full record shape:
 * series expanded, otherN as [definition, value] pairs, units and sector
 * restored from the index dictionary, confidence as words. */
export function decodeDetail(rec, index = traceIndex) {
  if (!index || index.detailFormat !== 2) return rec
  const sd = index.detailDict?.[rec.sub] || { odefs: [], units: {} }
  const out = { ...rec, at: rec.at ?? '', sec: index.subsectors?.[rec.sub]?.sector ?? null }
  out.e = unRle(rec.e)
  if (rec.act) out.act = unRle(rec.act)
  for (const k of ['au', 'cu', 'efu']) out[k] = rec[k] ?? sd.units[k] ?? null
  out.md = rec.md ?? sd.md ?? null
  if (rec.o) out.o = rec.o.map((v, i) => (v == null ? null : [sd.odefs[i], v])).filter(Boolean)
  // Other measures: g = { ch4: [m0, rle], … } → { ch4: { m0, e: [...] }, … }
  if (rec.g) {
    out.g = {}
    for (const [k, [m0, rle]] of Object.entries(rec.g)) out.g[k] = { m0, e: unRle(rle) }
  }
  if (rec.conf) {
    out.conf = {}
    index.confFields.forEach((f, i) => { const w = CONF_WORDS_BY_CODE[rec.conf[i]]; if (w) out.conf[f] = w })
  }
  return out
}

/** Exact detail record for one source (ownership, confidence, capacity…). */
export function loadTraceDetail(id, shards) {
  if (!traceIndex || !shards) return Promise.resolve(null)
  const k = id % shards
  if (!shardCache.has(k)) {
    shardCache.set(k, fetch(`/api/trace-detail?v=${encodeURIComponent(traceIndex.build)}&s=${k}`)
      .then((r) => (r.ok ? r.text() : ''))
      .then((txt) => {
        const m = new Map()
        for (const line of txt.split('\n')) {
          if (!line) continue
          const rec = decodeDetail(JSON.parse(line))
          m.set(rec.id, rec)
        }
        return m
      })
      .catch(() => { shardCache.delete(k); return new Map() }))
  }
  return shardCache.get(k).then((m) => m.get(id) || null)
}

/** Synchronous peek — the popup builder can't await. */
const settled = new Map()
export function peekTraceDetail(id, shards) {
  if (!shards) return null
  const hit = settled.get(id)
  if (hit !== undefined) return hit
  loadTraceDetail(id, shards).then((rec) => { settled.set(id, rec) })
  return null
}

/** Inverse of bake.mjs encodeMonth: 3 chars → tonnes (3 significant figures),
 * NaN when not reported. */
export function decodeMonth(s) {
  if (s === '---') return NaN
  const code = parseInt(s, 36)
  if (!code) return 0
  const c = code - 1
  const e = Math.floor(c / 900) - 3
  return Number(((c % 900 + 100) * 10 ** e).toPrecision(3))
}

// ─── Plain-language vocabulary ──────────────────────────────────────────────

export const SECTOR_STYLE = {
  power: { label: 'Power plants', color: '#fb923c' },
  'fossil-fuel-operations': { label: 'Oil, gas & coal', color: '#f43f5e' },
  manufacturing: { label: 'Heavy industry', color: '#c084fc' },
  'mineral-extraction': { label: 'Mines', color: '#facc15' },
  transportation: { label: 'Airports & ports', color: '#38bdf8' },
  waste: { label: 'Landfills & wastewater', color: '#34d399' },
  agriculture: { label: 'Cattle operations', color: '#e7c9a0' },
  'forestry-and-land-use': { label: 'Reservoirs', color: '#818cf8' },
}
export const sectorStyle = (sec) => SECTOR_STYLE[sec] || { label: sec, color: '#e5e7eb' }

const SUBSECTOR_WORDS = {
  'electricity-generation': 'power plant',
  'coal-mining': 'coal mine',
  'oil-and-gas-production': 'oil & gas production basin',
  'oil-and-gas-transport': 'oil & gas transport basin',
  'oil-and-gas-refining': 'oil refinery',
  aluminum: 'aluminum plant',
  cement: 'cement plant',
  chemicals: 'chemical plant',
  'food-beverage-tobacco': 'food & beverage plant',
  glass: 'glass plant',
  'iron-and-steel': 'steel mill',
  lime: 'lime plant',
  'other-chemicals': 'chemical plant',
  'other-manufacturing': 'factory',
  'other-metals': 'metals plant',
  'petrochemical-steam-cracking': 'petrochemical plant',
  'pulp-and-paper': 'pulp & paper mill',
  'textiles-leather-apparel': 'textile mill',
  'bauxite-mining': 'bauxite mine',
  'copper-mining': 'copper mine',
  'iron-mining': 'iron mine',
  'domestic-aviation': 'airport (domestic flights)',
  'international-aviation': 'airport (international flights)',
  'domestic-shipping': 'port (domestic shipping)',
  'international-shipping': 'port (international shipping)',
  'domestic-wastewater-treatment-and-discharge': 'wastewater plant',
  'industrial-wastewater-treatment-and-discharge': 'industrial wastewater plant',
  'solid-waste-disposal': 'landfill',
  'enteric-fermentation-cattle-operation': 'cattle operation (animals’ digestion)',
  'manure-management-cattle-operation': 'cattle operation (manure)',
  'water-reservoirs': 'reservoir',
}
export const subsectorWord = (sub) => SUBSECTOR_WORDS[sub] || sub.replace(/-/g, ' ')

export const CONFIDENCE_WORDS = {
  'very high': 'very high', high: 'high', medium: 'medium', low: 'low', 'very low': 'very low',
}

/** Tonnes → plain words: "1.2 million tonnes", "8,400 tonnes", "31 tonnes". */
export function tonnesWord(t) {
  if (t == null || !Number.isFinite(t)) return 'not reported'
  if (t >= 1e9) return `${(t / 1e9).toFixed(2)} billion tonnes`
  if (t >= 1e6) return `${(t / 1e6).toFixed(t >= 1e7 ? 0 : 1)} million tonnes`
  // Model estimates: 3 significant figures, never false precision.
  if (t >= 100) return `${Number(t.toPrecision(3)).toLocaleString('en-US')} tonnes`
  return `${t.toFixed(t >= 10 ? 0 : 1)} tonnes`
}

export const monthWord = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

// ─── Monthly transport tape ─────────────────────────────────────────────────

const monthStartMs = (ym) => Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1)

/**
 * MonthTape — the TapeField subset ReplayController drives (frames / locate /
 * setTime / ready / prefetch / metaAt), with one frame per calendar month.
 * Months aren't a fixed stride, so locate() searches the real month starts.
 * The last frame is the latest PUBLISHED month, not today: Climate TRACE
 * releases monthly with a ~2-month lag, so the bar says "latest" instead of
 * "now".
 */
export class MonthTape {
  constructor(months) {
    this.months = months
    this.frames = months.map((ym, i) => ({ valid_ms: monthStartMs(ym), run_ms: monthStartMs(ym), lead_h: 0, live: i === months.length - 1 }))
    this.step_ms = (this.end_ms - this.start_ms) / Math.max(1, months.length - 1)
    this.index = { step_ms: this.step_ms }
    this.t = this.end_ms
  }
  get start_ms() { return this.frames[0].valid_ms }
  get end_ms() { return this.frames[this.frames.length - 1].valid_ms }
  setTime(t) { this.t = Math.max(this.start_ms, Math.min(this.end_ms, t)) }
  /** Month index containing t (floor), clamped to the tape. */
  monthOf(t = this.t) {
    const fr = this.frames
    if (t <= fr[0].valid_ms) return 0
    if (t >= fr[fr.length - 1].valid_ms) return fr.length - 1
    let lo = 0, hi = fr.length - 1
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fr[mid].valid_ms <= t) lo = mid; else hi = mid }
    return lo
  }
  locate(t = this.t) {
    const i = this.monthOf(t)
    const j = Math.min(this.frames.length - 1, i + 1)
    const span = this.frames[j].valid_ms - this.frames[i].valid_ms
    return { i, j, mix: span > 0 ? (t - this.frames[i].valid_ms) / span : 0 }
  }
  ready() { return true }
  prefetch() {}
  get useFlow() { return false }
  metaAt(t = this.t) {
    const i = this.monthOf(t)
    const live = i === this.frames.length - 1
    return {
      valid_ms: this.frames[i].valid_ms,
      run_ms: this.frames[i].valid_ms,
      lead_h: 0,
      live,
      frame_kind: 'Climate TRACE monthly estimates',
      tape: true,
      event: true,
      monthLabel: true,
      liveBadge: 'LATEST',
      kindLabel: live ? 'latest month published (released ~2 months behind)' : 'estimated emissions in this month',
      steadyLabel: 'facility emissions, month by month',
    }
  }
}

// ─── Popup chart ────────────────────────────────────────────────────────────

/**
 * Monthly bar chart for a facility popup, as an SVG string. Built ONLY from
 * numbers and our own fixed labels (no upstream text), so it is safe to
 * insert unescaped. One bar per month; the month on the time bar is solid
 * with a white cap, the rest translucent; months with no estimate get a
 * small dash on the baseline (not a zero bar); January dividers + year labels.
 */
export function seriesChartSvg(series, months, curIdx, color) {
  const W = 260, H = 64, top = 4, base = 50
  const n = series.length
  const max = Math.max(0, ...series.filter((v) => v != null))
  if (!(max > 0)) return ''
  const bw = W / n
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  let bars = '', grid = ''
  for (let i = 0; i < n; i++) {
    const x = i * bw
    const ym = months[i]
    if (ym.endsWith('-01')) {
      grid += `<line x1="${x.toFixed(1)}" y1="${top}" x2="${x.toFixed(1)}" y2="${base}" stroke="currentColor" stroke-opacity="0.18" stroke-width="0.6"/>`
      grid += `<text x="${(x + 1.5).toFixed(1)}" y="${H - 3}" font-size="9" fill="currentColor" fill-opacity="0.6">${ym.slice(0, 4)}</text>`
    }
    const v = series[i]
    const label = `${monthWord(ym)}: ${v == null ? 'no estimate' : `${tonnesWord(v)} CO₂e`}`
    if (v == null) {
      bars += `<rect x="${(x + bw * 0.2).toFixed(1)}" y="${base - 1}" width="${(bw * 0.6).toFixed(1)}" height="1" fill="currentColor" fill-opacity="0.35"><title>${esc(label)}</title></rect>`
      continue
    }
    const h = Math.max(v > 0 ? 1 : 0, ((base - top) * v) / max)
    const cur = i === curIdx
    bars += `<rect x="${(x + 0.4).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${Math.max(0.8, bw - 0.8).toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" fill-opacity="${cur ? 1 : 0.5}"${cur ? ' stroke="#fff" stroke-width="0.8"' : ''}><title>${esc(label)}</title></rect>`
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Monthly emissions ${esc(monthWord(months[0]))} to ${esc(monthWord(months[n - 1]))}" style="display:block;margin:6px 0 2px;color:inherit">` +
    `<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="currentColor" stroke-opacity="0.35" stroke-width="0.6"/>${grid}${bars}</svg>`
}

// ─── "Everything this site emits" (facility popup) ──────────────────────────

/** Text after a tonnage in the popup's big number: "1.2 million tonnes of methane". */
export const MEASURE_SUFFIX = {
  co2e_100yr: 'CO₂e', co2e_20yr: 'CO₂e (20-year)', co2: 'of CO₂', ch4: 'of methane', n2o: 'of nitrous oxide',
  pm2_5: 'of PM2.5', so2: 'of SO₂', nox: 'of NOx', co: 'of carbon monoxide',
}
/** One measure's value for the month `ym` from a decoded detail record
 * (null = not reported). */
function mixValue(rec, ym, g) {
  const idx = traceIndex?.months?.indexOf(ym) ?? -1
  if (idx < 0 || !rec) return null
  const s = g === PRIMARY_MEASURE ? { m0: rec.m0, e: rec.e } : rec.g?.[g]
  if (!s) return null
  const i = idx - s.m0
  const v = i >= 0 && i < s.e.length ? s.e[i] : null
  return v == null || !Number.isFinite(v) ? null : v
}

/** Every measure for one site-month, for the popup narrator (exact numbers,
 * so it never guesses which gases are in the CO₂e figure). */
export function traceMixFacts(rec, ym) {
  const out = {}
  for (const g of Object.keys(MEASURE_INFO)) {
    const v = mixValue(rec, ym, g)
    if (v != null) out[g] = v
  }
  return out
}

// Under a tonne, kilograms (a coal mine's 0.0013 t of N₂O is 1.3 kg, not "0.0 t").
const tw = (v) => (v == null ? '—' : v === 0 ? '0 t'
  : v < 1 ? `${Number((v * 1000).toPrecision(2)).toLocaleString('en-US')} kg`
    : tonnesWord(v).replace(' tonnes', ' t'))

/**
 * "Everything this site emits" for the month on screen, as the facility
 * card's breakdown: labeled rows per gas and per air pollutant, the measure
 * the map shows in bold. Built ONLY from numbers and our fixed labels (no
 * upstream text), so it is safe to insert.
 *
 * Bars: tonnes of different gases aren't comparable heat-wise, so there are
 * no per-gas tonnage bars. The one bar shows what IS comparable — how this
 * site's CO₂e splits between CO₂ and the other greenhouse gases (CO₂e − CO₂,
 * Climate TRACE's own totals, no GWP arithmetic of ours).
 */
export function traceMixHtml(rec, ym, current) {
  if (!rec || (traceIndex?.months?.indexOf(ym) ?? -1) < 0) return ''
  const v = (g) => mixValue(rec, ym, g)
  const twenty = current === 'co2e_20yr'
  const co2eKey = twenty ? 'co2e_20yr' : 'co2e_100yr'
  const base = current === 'co2e_20yr' ? 'co2e_100yr' : current
  const row = (g, label) => {
    const val = v(g)
    if (val == null) return ''
    const on = g === base || (g === 'co2e_100yr' && twenty)
    return `<div style="display:flex;justify-content:space-between;gap:10px;${on ? 'font-weight:700' : ''}">` +
      `<span>${label}</span><span style="white-space:nowrap">${tw(val)}</span></div>`
  }
  const head = (t, tag) => `<div style="margin:8px 0 3px;font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;opacity:.6">${t}${tag ? ` <span style="text-transform:none;letter-spacing:0;font-weight:500">· ${tag}</span>` : ''}</div>`

  // Warming the planet
  const co2e = v(co2eKey), co2 = v('co2'), ch4 = v('ch4'), n2o = v('n2o')
  let climate = row(co2eKey, twenty ? 'All greenhouse gases (CO₂e, 20-yr)' : 'All greenhouse gases (CO₂e)') +
    row('co2', 'Carbon dioxide') + row('ch4', 'Methane') + row('n2o', 'Nitrous oxide')
  if (co2e > 0 && co2 != null) {
    const pCo2 = Math.max(0, Math.min(1, co2 / co2e))
    const pct = (x) => (x > 0 && x < 0.005 ? '<1' : x > 0.995 && x < 1 ? '>99' : String(Math.round(x * 100)))
    climate += `<div style="display:flex;height:7px;border-radius:4px;overflow:hidden;margin:5px 0 2px;background:#e5e7eb" role="img" aria-label="CO₂ ${pct(pCo2)}% of this site’s warming">` +
      `<span style="width:${(pCo2 * 100).toFixed(1)}%;background:#ea580c"></span><span style="flex:1;background:#7c3aed"></span></div>` +
      `<div style="font-size:11px;opacity:.75"><span style="color:#ea580c">■</span> CO₂ ${pct(pCo2)}% · <span style="color:#7c3aed">■</span> methane &amp; nitrous oxide ${pct(1 - pCo2)}% of this site’s warming${twenty ? ' (20-year view)' : ''}</div>`
  }
  if (co2e != null && ch4 == null && n2o == null) {
    climate += '<div style="font-size:11px;opacity:.75;margin-top:2px">Climate TRACE gives no separate methane or nitrous-oxide figure for this site.</div>'
  }

  // Air people breathe
  const air = row('pm2_5', 'Fine particles (PM2.5)') + row('so2', 'Sulfur dioxide') + row('nox', 'Nitrogen oxides') + row('co', 'Carbon monoxide')

  const parts = []
  if (climate) parts.push(head('Warming the planet') + climate)
  if (air) parts.push(head('Air people breathe', 'rough estimates') + air)
  return parts.length
    ? `<div style="border-top:1px solid rgba(0,0,0,.1);margin-top:6px">${parts.join('')}</div>`
    : '<div style="opacity:.7">No other measures for this site this month.</div>'
}
