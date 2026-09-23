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

/** Mapbox needs an ABSOLUTE tile template — a root-relative one is resolved
 * against the Mapbox API host and silently never loads. */
export const traceTileUrl = () =>
  `${window.location.origin}/api/trace-tiles?v=${encodeURIComponent(traceIndex?.build || '')}&z={z}&x={x}&y={y}`

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
