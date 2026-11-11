/**
 * The /ships general report (src/ships/GeneralReport.jsx; Josh 2026-11-10): high-level numbers about everything /ships holds,
 * worldwide, plus where each dataset covers. Read only. Built once a day (api/cron/ships-counts.js ?part=report) into Blob at
 * ships/general-report.json; `zsh scripts/ships/prod.sh report` / scripts/ships/general-report.mjs build it by hand.
 *
 * Terminal and anchorage numbers come from lib/ships/changelogCounts.js with `collect`, i.e. the cards' own read code, so every
 * row here adds up to the changelog's totals and to what each card shows. Identity values follow the ship card's summary rule
 * (lib/ships/queries.js summarize): a registry claim first, then the latest.
 *
 * q = (text, params) → rows. trackSource = src/ships/trackSource.json. fetchJson = (url, { timeoutMs }) → parsed JSON.
 * Every part is wrapped: a part that fails is null (and listed in `failed`), so one slow source never blanks the report.
 */
import { changelogCounts } from './changelogCounts.js'
import { classIndex } from './typeSearch.js'
import { GROUPS } from './taxonomy.js'
import { scrubberMmsis } from './scrubberFilter.js'
import { summarize } from './queries.js'
import { CERULEAN_API, credibleFilter } from './cerulean.js'
import { COVERAGE as TERMINAL_AIS } from './terminalCalls.js'

export const REPORT_PATH = 'ships/general-report.json'
export const REPORT_VERSION = 1

// Terminal kinds that handle oil, gas or fuel (the report's Oil and gas section).
export const OIL_GAS_KINDS = ['refinery_dock', 'crude_terminal', 'product_terminal', 'bunkering_terminal', 'fuel_dock',
  'military_fuel_pier', 'lng_terminal', 'lpg_terminal']

const LENGTH_BANDS = [[0, 15, 'Under 15 m'], [15, 30, '15–30 m'], [30, 60, '30–60 m'], [60, 120, '60–120 m'], [120, 200, '120–200 m'],
  [200, 300, '200–300 m'], [300, 1e9, '300 m and longer']]

const N = (v) => (v == null ? null : Number(v))
const ym = (d) => (d ? new Date(d).toISOString().slice(0, 7) : null)
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)

/** The ships we hold: kinds, flags, sizes, ages, and how much of each record we know. */
async function fleet(q, S, scrubbers) {
  const [tot] = await q(`SELECT count(*)::int n FROM ${S}.vessels WHERE status = 'active'`)
  // One value per ship and attribute, the card's rule: registry first, then the latest.
  const best = `WITH best AS (
    SELECT DISTINCT ON (va.vessel_id, va.attribute) va.vessel_id, va.attribute, va.value_norm
      FROM ${S}.vessel_assertions va JOIN ${S}.vessels v ON v.id = va.vessel_id AND v.status = 'active'
     WHERE va.attribute = ANY($1)
     ORDER BY va.vessel_id, va.attribute, (va.evidence_class = 'registry') DESC, upper(va.period) DESC NULLS LAST, va.id)`
  const flags = await q(`${best} SELECT b.value_norm AS iso3, c.name, c.iso2, count(*)::int n FROM best b
                          LEFT JOIN ${S}.countries c ON c.iso3 = b.value_norm WHERE b.attribute = 'flag' GROUP BY 1, 2, 3 ORDER BY 4 DESC`, [['flag']])
  const nums = await q(`${best} SELECT attribute, value_norm::numeric AS v FROM best
                         WHERE attribute IN ('length_m', 'year_built') AND value_norm ~ '^[0-9]+(\\.[0-9]+)?$'`, [['length_m', 'year_built']])
  const thisYear = new Date().getUTCFullYear()
  const lengths = LENGTH_BANDS.map(([lo, hi, label]) => ({ label, lo, hi: hi >= 1e9 ? null : hi, n: 0 }))
  const decades = new Map()
  let withLength = 0, withYear = 0
  for (const r of nums) {
    const v = Number(r.v)
    if (r.attribute === 'length_m' && v > 0 && v < 500) {
      withLength++
      lengths[LENGTH_BANDS.findIndex(([lo, hi]) => v >= lo && v < hi)].n++
    } else if (r.attribute === 'year_built' && v >= 1850 && v <= thisYear) {
      withYear++
      const d = Math.floor(v / 10) * 10
      decades.set(d, (decades.get(d) || 0) + 1)
    }
  }
  const [known] = await q(`SELECT
      count(DISTINCT va.vessel_id) FILTER (WHERE va.attribute = 'imo')::int AS imo,
      count(DISTINCT va.vessel_id) FILTER (WHERE va.evidence_class = 'registry')::int AS registry,
      count(DISTINCT va.vessel_id) FILTER (WHERE va.attribute IN ('owner', 'registry_owner', 'operator'))::int AS owner,
      count(DISTINCT va.vessel_id) FILTER (WHERE va.attribute = 'image')::int AS photo,
      count(DISTINCT va.vessel_id) FILTER (WHERE va.attribute = 'year_built')::int AS year_built
    FROM ${S}.vessel_assertions va JOIN ${S}.vessels v ON v.id = va.vessel_id AND v.status = 'active'`)
  // Kinds: the classification the search and filters use (lib/ships/typeSearch.js classIndex).
  const tally = (await classIndex(q, S)).tally
  const groups = new Map()
  for (const t of tally) {
    const g = t.group || 'unknown'
    groups.set(g, (groups.get(g) || 0) + t.n)
  }
  return {
    ships: tot.n,
    groups: [...groups].map(([group, n]) => ({ group, label: GROUPS[group] || group, n })).sort((a, b) => b.n - a.n),
    classes: tally.map((t) => ({ group: t.group, class: t.class, label: t.label, n: t.n })),
    classified: tally.reduce((n, t) => n + t.n, 0),
    flags: flags.filter((f) => f.iso3).map((f) => ({ iso3: f.iso3, iso2: f.iso2, name: f.name || f.iso3, n: f.n })),
    lengths, withLength,
    decades: [...decades].sort((a, b) => a[0] - b[0]).map(([decade, n]) => ({ decade, n })), withYear,
    known: { ...known, scrubber: scrubbers },
  }
}

/** Ship tracks per month, from the published track indexes (one ship's path in one month = one track). */
// The live Salish Sea recorder's monthly index (same file api/ship-tracks.js reads as AISM_INDEX).
export const LIVE_INDEX = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/tracks/ais-v1/index.json'

export async function tracks(trackSource, fetchJson) {
  const [us, gfw, live] = await Promise.all([fetchJson(trackSource.us.index), fetchJson(trackSource.gfw.index),
    fetchJson(LIVE_INDEX).catch(() => null)])
  const months = new Map()
  const row = (m) => months.get(m) || { month: m, minute: 0, hourly: 0, live: 0 }
  for (const [m, x] of Object.entries(us.months || {})) months.set(m, { ...row(m), minute: x.vessels || 0 })
  const areas = new Set()
  for (const [m, x] of Object.entries(gfw.months || {})) {
    const r = row(m)
    r.hourly = x.vessels || 0
    months.set(m, r)
    for (const a of x.areas || []) areas.add(a)
  }
  // Recorder months: dates are the first and last recorded day; the current month is still filling.
  const liveM = Object.keys(live?.months || {}).sort()
  for (const m of liveM) { const r = row(m); r.live = live.months[m].vessels || 0; months.set(m, r) }
  const liveSpan = liveM.length ? {
    from: live.months[liveM[0]].first || null, through: live.months[liveM[liveM.length - 1]].through || null,
    months: liveM.length, tracks: liveM.reduce((n, m) => n + (live.months[m].tracks || 0), 0),
    total: liveM.reduce((n, m) => n + (live.months[m].vessels || 0), 0),
    perMonth: liveM.map((m) => ({ month: m, vessels: live.months[m].vessels || 0, tracks: live.months[m].tracks || 0,
      first: live.months[m].first || null, through: live.months[m].through || null,
      sources: live.months[m].sources || null })),   // { feed: { vessels, only, points } } from build_tracks.py, once the month is rebaked
  } : null
  const list = [...months.values()].sort((a, b) => a.month.localeCompare(b.month))
  const usM = Object.keys(us.months || {}).sort(), gfwM = Object.keys(gfw.months || {}).sort()
  return {
    months: list,
    minute: { from: usM[0] || null, to: usM[usM.length - 1] || null, months: usM.length, total: list.reduce((n, r) => n + r.minute, 0) },
    hourly: { from: gfwM[0] || null, to: gfwM[gfwM.length - 1] || null, months: gfwM.length, total: list.reduce((n, r) => n + r.hourly, 0), areas: areas.size },
    live: liveSpan,
  }
}

/** Port visits (Global Fishing Watch) by the ships we hold: busiest ports, countries, routes, most-traveled ships. */
async function ports(q, S) {
  const V = `${S}.port_visits pv`
  const live = `pv.status = 'active' AND pv.port_id IS NOT NULL`
  const [span] = await q(`SELECT count(*)::int visits, count(DISTINCT pv.gfw_vessel_id)::int identities, count(DISTINCT pv.port_id)::int ports,
                                 min(pv.start_at) AS "from", max(pv.start_at) AS "to"
                            FROM ${V} WHERE ${live}`)
  const top = await q(`SELECT p.id, p.name, p.iso3, c.name AS country, count(*)::int visits, count(DISTINCT pv.gfw_vessel_id)::int ships
                         FROM ${V} JOIN ${S}.ports p ON p.id = pv.port_id LEFT JOIN ${S}.countries c ON c.iso3 = p.iso3
                        WHERE ${live} GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC LIMIT 15`)
  const abroad = await q(`SELECT p.id, p.name, p.iso3, c.name AS country, count(*)::int visits, count(DISTINCT pv.gfw_vessel_id)::int ships
                            FROM ${V} JOIN ${S}.ports p ON p.id = pv.port_id LEFT JOIN ${S}.countries c ON c.iso3 = p.iso3
                           WHERE ${live} AND p.iso3 NOT IN ('USA', 'CAN') GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC LIMIT 15`)
  const countries = await q(`SELECT p.iso3, c.name, count(*)::int visits, count(DISTINCT pv.port_id)::int ports
                               FROM ${V} JOIN ${S}.ports p ON p.id = pv.port_id LEFT JOIN ${S}.countries c ON c.iso3 = p.iso3
                              WHERE ${live} AND p.iso3 IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC`)
  // Routes: one ship's visit, then its next visit at a different port; A→B and B→A are one route.
  const legs = `WITH s AS (SELECT pv.gfw_vessel_id, pv.port_id, LAG(pv.port_id) OVER (PARTITION BY pv.gfw_vessel_id ORDER BY pv.start_at) AS prev
                             FROM ${V} WHERE ${live}),
                     r AS (SELECT LEAST(prev, port_id) a, GREATEST(prev, port_id) b, gfw_vessel_id FROM s WHERE prev IS NOT NULL AND prev <> port_id)`
  const routeSel = (where) => `${legs}
    SELECT r.a, r.b, pa.name AS a_name, pa.iso3 AS a_iso3, pb.name AS b_name, pb.iso3 AS b_iso3, count(*)::int trips, count(DISTINCT r.gfw_vessel_id)::int ships
      FROM r JOIN ${S}.ports pa ON pa.id = r.a JOIN ${S}.ports pb ON pb.id = r.b ${where}
     GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 7 DESC LIMIT 12`
  const routes = await q(routeSel(''))
  const intl = await q(routeSel('WHERE pa.iso3 IS DISTINCT FROM pb.iso3'))
  const [legCount] = await q(`${legs} SELECT count(*)::int n, count(DISTINCT (a, b))::int routes FROM r`)
  // Most-traveled ships: the most countries, then ports. Which EarthAtlas ship each is: the port card's first rule, the exact
  // GFW identity (lib/ships/portCard.js), and only when exactly one ship carries it; otherwise the name GFW sent, unlinked.
  const traveled = await q(`SELECT pv.gfw_vessel_id, max(pv.vessel_name_raw) AS name, count(DISTINCT pv.port_id)::int ports,
                                   count(DISTINCT p.iso3)::int countries, count(*)::int visits
                              FROM ${V} JOIN ${S}.ports p ON p.id = pv.port_id
                             WHERE ${live} GROUP BY 1 ORDER BY 4 DESC, 3 DESC LIMIT 12`)
  const byGfw = traveled.length ? new Map((await q(
    `SELECT sub_record_ref AS gfw_id, array_agg(DISTINCT vessel_id) AS ids FROM ${S}.vessel_assertions
      WHERE source_id = 'gfw-vessel-identity' AND sub_record_ref = ANY($1) GROUP BY 1`, [traveled.map((r) => r.gfw_vessel_id)]))
    .filter((r) => r.ids.length === 1).map((r) => [r.gfw_id, r.ids[0]])) : new Map()
  const names = byGfw.size ? await summarize(q, S, [...byGfw.values()]) : {}
  const port = (r) => ({ id: Number(r.id), name: r.name, iso3: r.iso3, country: r.country || r.iso3, visits: r.visits, ships: r.ships })
  const route = (r) => ({ a: { id: Number(r.a), name: r.a_name, iso3: r.a_iso3 }, b: { id: Number(r.b), name: r.b_name, iso3: r.b_iso3 }, trips: r.trips, ships: r.ships })
  return {
    visits: span.visits, ships: span.identities, ports: span.ports, from: day(span.from), to: day(span.to),
    top: top.map(port), abroad: abroad.map(port),
    countries: countries.map((r) => ({ iso3: r.iso3, name: r.name || r.iso3, visits: r.visits, ports: r.ports })),
    legs: legCount.n, routeCount: legCount.routes, routes: routes.map(route), international: intl.map(route),
    traveled: traveled.map((r) => {
      const id = byGfw.get(r.gfw_vessel_id) || null, s = (id && names[id]?.latest) || {}
      return { id, name: s.name?.value || r.name || null, flag: s.flag?.value || null, ports: r.ports, countries: r.countries, visits: r.visits }
    }),
  }
}

function terminalsPart(rows, counts) {
  const kinds = new Map()
  for (const t of rows) {
    const k = kinds.get(t.kind) || { kind: t.kind, terminals: 0, visits: 0, estimated: 0, co2e: 0 }
    k.terminals++; k.visits += t.visits; k.estimated += t.estimated; k.co2e += t.co2e || 0
    kinds.set(t.kind, k)
  }
  const byCountry = {}
  for (const t of rows) byCountry[t.country] = (byCountry[t.country] || 0) + 1
  const slim = (t) => ({ key: t.key, name: t.name, kind: t.kind, country: t.country, visits: t.visits, estimated: t.estimated, ships: t.ships,
    hours: t.hours, co2e: t.co2e, ctStays: t.ctStays })
  return {
    terminals: rows.length, berths: counts.berths, byCountry,
    visits: counts.terminalVisits, emissions: counts.terminalEmissions,
    kinds: [...kinds.values()].sort((a, b) => (b.visits + b.estimated) - (a.visits + a.estimated)),
    top: [...rows].sort((a, b) => (b.visits + b.estimated) - (a.visits + a.estimated)).slice(0, 12).map(slim),
    topEmissions: rows.filter((t) => t.co2e > 0).sort((a, b) => b.co2e - a.co2e).slice(0, 12).map(slim),
  }
}

function anchoragesPart(rows, counts) {
  const longest = rows.flatMap((a) => a.top.map((t) => ({ ...t, anchorage: { key: a.key, name: a.name } })))
    .sort((a, b) => b.days - a.days || b.hours - a.hours).slice(0, 12)
  return {
    anchorages: counts.anchorages, withStays: counts.anchorageStays.anchoragesWithStays, stays: counts.anchorageStays,
    top: [...rows].sort((a, b) => (b.stays + b.estimated) - (a.stays + a.estimated)).slice(0, 12)
      .map((a) => ({ key: a.key, name: a.name, location: a.location, legal: a.legal, stays: a.stays, estimated: a.estimated, ships: a.ships,
        hours: a.hours, shipDays: a.shipDays })),
    longest,
  }
}

/** Oil and gas: our terminals that handle oil / gas / fuel, the refineries we list, Climate TRACE's oil & gas sites, offshore registers. */
async function oilGas(q, S, termRows, trackSource, fetchJson) {
  const refineries = await q(`SELECT country, count(*)::int n FROM ${S}.facilities WHERE list_status = 'listed' AND kind = 'refinery' GROUP BY 1 ORDER BY 2 DESC`)
  const og = termRows.filter((t) => OIL_GAS_KINDS.includes(t.kind))
  const out = {
    terminals: og.length, visits: og.reduce((n, t) => n + t.visits + t.estimated, 0),
    co2e: Math.round(og.reduce((n, t) => n + (t.co2e || 0), 0)),
    kinds: OIL_GAS_KINDS.map((k) => { const x = og.filter((t) => t.kind === k); return { kind: k, terminals: x.length, visits: x.reduce((n, t) => n + t.visits + t.estimated, 0) } })
      .filter((k) => k.terminals),
    refineries: refineries.map((r) => ({ country: r.country, n: r.n })),
    trace: null, offshore: null,
  }
  try {
    const ptr = await fetchJson('https://fxj3imydg9misw9w.public.blob.vercel-storage.com/trace/latest.json')
    const idx = await fetchJson(ptr.index)
    const sub = (k) => idx.subsectors?.[k]?.sources ?? null
    out.trace = {
      release: idx.release, year: idx.fullYear, lastMonth: idx.months?.[idx.months.length - 1] || null,
      refining: sub('oil-and-gas-refining'), production: sub('oil-and-gas-production'), transport: sub('oil-and-gas-transport'), coal: sub('coal-mining'),
    }
  } catch { out.trace = null }
  try {
    const fc = await fetchJson(trackSource.offshore.geojson, { timeoutMs: 60e3 })
    const t = new Map()
    for (const f of fc.features || []) {
      const p = f.properties || {}, key = `${p.k}|${p.status}|${p.src}`
      t.set(key, (t.get(key) || 0) + 1)
    }
    out.offshore = { version: trackSource.offshore.version,
      rows: [...t].map(([k, n]) => { const [kind, status, src] = k.split('|'); return { kind, status, src, n } }).sort((a, b) => b.n - a.n) }
  } catch { out.offshore = null }
  return out
}

async function incidents(q, S) {
  const types = await q(`SELECT t, count(*)::int n FROM ${S}.incident_events, unnest(event_types) t WHERE status = 'active' GROUP BY 1 ORDER BY 2 DESC`)
  const years = await q(`SELECT extract(year FROM lower(occurred))::int y, count(*)::int n FROM ${S}.incident_events
                          WHERE status = 'active' AND lower(occurred) IS NOT NULL GROUP BY 1 ORDER BY 1`)
  const sources = await q(`SELECT e.source_id, s.name, s.publisher, s.homepage_url, count(*)::int n, min(lower(e.occurred)) AS "from", max(lower(e.occurred)) AS "to"
                             FROM ${S}.incident_events e JOIN ${S}.sources s ON s.id = e.source_id WHERE e.status = 'active' GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC`)
  const [tot] = await q(`SELECT count(*)::int n FROM ${S}.incident_events WHERE status = 'active'`)
  const [ships] = await q(`SELECT count(DISTINCT il.vessel_id)::int n FROM ${S}.incident_links il
                             JOIN ${S}.vessels v ON v.id = il.vessel_id AND v.status = 'active' WHERE il.status = 'accepted'`)
  return {
    total: tot.n, ships: ships?.n ?? null,
    types: types.map((r) => ({ type: r.t, n: r.n })),
    years: years.filter((r) => r.y >= 1980).map((r) => ({ year: r.y, n: r.n })),
    sources: sources.map((r) => ({ id: r.source_id, name: r.name, publisher: r.publisher, url: r.homepage_url, n: r.n, from: day(r.from), to: day(r.to) })),
  }
}

/** SkyTruth Cerulean: slicks worldwide that SkyTruth counts as credible, and how many it ties to each kind of likely source. */
async function slicks(fetchJson, now) {
  const today = now.toISOString().slice(0, 10)
  const tomorrow = new Date(now.getTime() + 864e5).toISOString().slice(0, 10)
  const cred = credibleFilter(tomorrow, today)
  const count = async (extra) => {
    const filter = extra ? `(${cred}) AND ${extra}` : cred
    const u = `${CERULEAN_API}/collections/public.slick_plus/items?limit=1&properties=id&filter=${encodeURIComponent(filter)}`
    return (await fetchJson(u, { timeoutMs: 150e3 })).numberMatched ?? null
  }
  const [credible, ship, infra, dark, first] = await Promise.all([
    count(null), count('source_type_1_ids IS NOT NULL'), count('source_type_2_ids IS NOT NULL'), count('source_type_3_ids IS NOT NULL'),
    fetchJson(`${CERULEAN_API}/collections/public.slick_plus/items?limit=1&properties=slick_timestamp&sortby=slick_timestamp`, { timeoutMs: 150e3 })
      .then((j) => j.features?.[0]?.properties?.slick_timestamp?.slice(0, 10) || null).catch(() => null),
  ])
  return { credible, ship, infra, dark, from: first, to: today }
}

/** Where each anchorage list comes from (official US + Canadian anchorages). */
async function anchorageLists(q, S) {
  return (await q(`SELECT a.source_id, s.name, count(*)::int n FROM ${S}.anchorages a JOIN ${S}.sources s ON s.id = a.source_id
                    WHERE a.status = 'active' GROUP BY 1, 2 ORDER BY 3 DESC`)).map((r) => ({ id: r.source_id, name: r.name, n: r.n }))
}

async function ctSpan(q, S) {
  const [r] = await q(`SELECT min(t0) AS "from", max(t0) AS "to" FROM ${S}.terminal_ct_stays`)
  return { from: ym(r.from), to: ym(r.to) }
}

/**
 * → the report JSON. opts: { trackSource, fetchJson, now, limit (terminals / anchorages, for a quick check), concurrency }.
 */
export async function generalReport(q, S, { trackSource, fetchJson, now = new Date(), limit = Infinity, concurrency = 8 } = {}) {
  const t0 = Date.now()
  const failed = []
  const part = async (name, f) => {
    try { return await f() } catch (e) { failed.push({ part: name, error: String(e?.message || e).slice(0, 300) }); return null }
  }
  const collect = { terminals: [], anchorages: [] }
  // Cerulean is slow (~30 s a count) and outside us: start it first so it runs while the database work does.
  const slickP = part('slicks', () => slicks(fetchJson, now))
  const counts = await changelogCounts(q, S, { now, limit, concurrency, collect, trackSource, fetchJson })
  const scrub = (await scrubberMmsis(q, S)).vessels
  const out = {
    version: REPORT_VERSION, asOf: now.toISOString(), counts,
    fleet: await part('fleet', () => fleet(q, S, scrub)),
    tracks: await part('tracks', () => tracks(trackSource, fetchJson)),
    ports: await part('ports', () => ports(q, S)),
    terminals: terminalsPart(collect.terminals, counts),
    anchorages: { ...anchoragesPart(collect.anchorages, counts), lists: await part('anchorageLists', () => anchorageLists(q, S)) },
    oilGas: await part('oilGas', () => oilGas(q, S, collect.terminals, trackSource, fetchJson)),
    incidents: await part('incidents', () => incidents(q, S)),
    slicks: await slickP,
    coverage: {
      terminalsAis: TERMINAL_AIS,
      ctStays: await part('ctSpan', () => ctSpan(q, S)),
    },
    failed,
  }
  out.seconds = Math.round((Date.now() - t0) / 1000)
  return out
}

/** fetchJson for node: a timeout, and a clear error on a non-JSON answer. */
export function nodeFetchJson(url, { timeoutMs = 30e3 } = {}) {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).then(async (r) => {
    if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 120)}`)
    return r.json()
  })
}
