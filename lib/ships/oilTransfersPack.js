/**
 * Compact wire format for the oil-transfer report (lib/ships/oilTransfers.js): ~18k operations are ~15 MB as plain JSON, over a
 * serverless response limit, so every string goes into one dictionary and the operations into columns. Pure; shared by the
 * server (pack) and the report page (unpack). Lossless for the fields listed below (times to the minute).
 */
const STR = ['company', 'receiver', 'receiverType', 'delivererType', 'location', 'city', 'region', 'ship', 'shipType', 'group',
  'setting', 'status', 'reason']
const NUM = ['durationH', 'gallons']
const BOOL = ['isPreboomed', 'rateGt500']
const STR_LIST = ['antIds', 'deliverers', 'transferTypes', 'terminals']
const NUM_LIST = ['recordIds']

/** Product groups (Ecology's own product names inside each). Pure. */
export function productGroup(product) {
  const p = String(product || '')
  if (/crude/i.test(p)) return 'Crude oil'
  if (/gasoline/i.test(p)) return 'Gasoline'
  if (/jet|kerosene/i.test(p)) return 'Jet fuel / kerosene'
  if (/renewable|biodiesel/i.test(p)) return 'Renewable diesel / biodiesel'
  if (/hfo|bunker/i.test(p)) return /0\.5\s*-\s*3\.5/.test(p) ? 'Heavy fuel oil, 0.5–3.5% sulfur' : 'Heavy fuel oil, ≤0.5% sulfur'
  if (/diesel|gas oil|ulsd/i.test(p)) return 'Marine gas oil / diesel'
  if (/vgo|cat feed|cutter|decant|naphtha|napt|nonene/i.test(p)) return 'Refinery feedstocks and blendstocks'
  if (/ethanol/i.test(p)) return 'Ethanol'
  if (/lube|motor|hydraulic|grease/i.test(p)) return 'Lube / hydraulic oil'
  if (/oily|waste|used/i.test(p)) return 'Oily water / waste oil'
  return 'Other products'
}

const min = (t) => (t == null ? null : Math.round(Date.parse(t) / 60e3))
const iso = (m) => (m == null ? null : new Date(m * 60e3).toISOString())

export function packOps(ops) {
  const dict = [], at = new Map()
  const s = (v) => { if (v == null) return -1; const k = String(v); let i = at.get(k); if (i == null) { i = dict.length; dict.push(k); at.set(k, i) } return i }
  const cols = {}
  cols.startAt = ops.map((o) => Math.round(Date.parse(o.startAt) / 60e3))   // minutes since 1970 (UTC)
  for (const f of STR) cols[f] = ops.map((o) => s(o[f]))
  for (const f of NUM) cols[f] = ops.map((o) => (o[f] == null ? null : Math.round(o[f] * 100) / 100))
  for (const f of BOOL) cols[f] = ops.map((o) => (o[f] == null ? null : o[f] ? 1 : 0))
  for (const f of STR_LIST) cols[f] = ops.map((o) => (o[f] || []).map(s))
  for (const f of NUM_LIST) cols[f] = ops.map((o) => o[f] || [])
  cols.products = ops.map((o) => (o.products || []).flatMap((p) => [s(p.product), p.gallons == null ? null : Math.round(p.gallons)]))
  cols.contacts = ops.map((o) => (o.contacts || []).flatMap((c) => [s(c.name), s(c.phone)]))
  // seen: [kind, t0, t1, delayH, a, b, hours, tugs] — a/b = terminalKey/aisName (call) or place/null (alongside)
  cols.seen = ops.map((o) => {
    const x = o.seen
    if (!x) return null
    return x.kind === 'call'
      ? [s('call'), min(x.t0), min(x.t1), x.delayH ?? null, s(x.terminalKey), s(x.aisName), null, [], s(x.mmsi)]
      : [s('alongside'), min(x.t0), min(x.t1), x.delayH ?? null, s(x.place), -1, x.hours ?? null, (x.tugs || []).map(s), -1]
  })
  return { n: ops.length, dict, cols }
}

export function unpackOps(p) {
  const d = (i) => (i == null || i < 0 ? null : p.dict[i])
  const out = []
  for (let i = 0; i < p.n; i++) {
    const o = { startAt: new Date(p.cols.startAt[i] * 60e3).toISOString() }
    for (const f of STR) o[f] = d(p.cols[f][i])
    for (const f of NUM) o[f] = p.cols[f][i]
    for (const f of BOOL) o[f] = p.cols[f][i] == null ? null : p.cols[f][i] === 1
    for (const f of STR_LIST) o[f] = p.cols[f][i].map(d)
    for (const f of NUM_LIST) o[f] = p.cols[f][i]
    const pr = p.cols.products[i]; o.products = []
    for (let j = 0; j < pr.length; j += 2) o.products.push({ product: d(pr[j]), gallons: pr[j + 1] })
    const ct = p.cols.contacts[i]; o.contacts = []
    for (let j = 0; j < ct.length; j += 2) o.contacts.push({ name: d(ct[j]), phone: d(ct[j + 1]) })
    const x = p.cols.seen[i]
    o.seen = !x ? null : d(x[0]) === 'call'
      ? { kind: 'call', t0: iso(x[1]), t1: iso(x[2]), delayH: x[3], terminalKey: d(x[4]), aisName: d(x[5]), mmsi: d(x[8]) }
      : { kind: 'alongside', t0: iso(x[1]), t1: iso(x[2]), delayH: x[3], place: d(x[4]), hours: x[6], tugs: x[7].map(d) }
    out.push(o)
  }
  return out
}
