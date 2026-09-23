/**
 * Tropical-cyclone proxy — one normalized payload for the /inmotion Storms
 * layer, assembled from NOAA's two tropical endpoints.
 *
 * GET /api/storms  →  { fetched_ms, advisory_ms, storms: [...], coverage, source… }
 *
 * Why a server route rather than fetching in the browser (full catalog and
 * every verified field in docs/STORMS_API.md):
 *
 *   1. nhc.noaa.gov/CurrentStorms.json sends NO CORS headers, so the browser
 *      cannot read it at all. It is also the only place the human-readable
 *      advisory/discussion URLs live, and those are the layer's inline
 *      provenance links — we are not shipping storm intensities without a
 *      click-through to the advisory they came from.
 *   2. The geometry lives in a separate ArcGIS service and needs SIX queries
 *      (forecast points/track/cone, watch-warning, past points/track). Doing
 *      that per visitor is 7 round trips; here it is one edge-cached call
 *      shared by everyone.
 *   3. `9999` is NOAA's missing-value sentinel on the forecast-point layer —
 *      every row past tau=0 carries mslp=9999, tcdir=9999, tcspd=9999.
 *      Stripping it in one place means no client can ever print "9999 hPa".
 *
 * Cadence: NHC issues full advisories every 6 h with intermediate ones every
 * 3 h (and hourly when a storm threatens land), so a 5-minute edge cache is
 * far fresher than the data and still collapses the traffic.
 *
 * Coverage is global, from two warning centres:
 *   NHC  — Atlantic, eastern and central Pacific (the RSMC for those basins)
 *   JTWC — western Pacific, Indian Ocean, Southern Hemisphere (US military)
 *
 * They OVERLAP: JTWC also issues on eastern-Pacific storms, at a different
 * synoptic hour, so the same hurricane can carry two different intensities
 * (2026-09-22: NHC had Polo at 155 kt from the 19Z advisory while JTWC's 12Z
 * warning said 140 kt). Showing both would be two contradictory storms on one
 * map, so NHC wins in the basins it is responsible for and JTWC is used only
 * where NHC does not reach. See JTWC_BASINS below.
 */

export const config = { runtime: 'edge' }

const CURRENT_STORMS = 'https://www.nhc.noaa.gov/CurrentStorms.json'
const GIS = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer'

const COVERAGE =
  'every ocean basin where tropical cyclones form. The US National Hurricane Center covers the Atlantic and the eastern and central Pacific; the Joint Typhoon Warning Center covers the western Pacific, the Indian Ocean and the Southern Hemisphere.'

const JTWC_RSS = 'https://www.metoc.navy.mil/jtwc/rss/jtwc.rss'
const JTWC_PRODUCTS = 'https://www.metoc.navy.mil/jtwc/products'

// Basins NHC is the responsible warning centre for. JTWC issues on these too,
// and its warnings are cut at a different synoptic hour, so taking both would
// put two versions of the same storm on the map.
const NHC_BASINS = new Set(['al', 'ep', 'cp'])

// Basin from the storm's id prefix, in words. Carried through to the client
// because the AI narrator otherwise GUESSES it from the name and gets it
// wrong: on 2026-09-22 it described eastern-Pacific Polo as "one of the
// strongest Atlantic hurricanes on record".
const BASIN_WORD = {
  al: 'the Atlantic',
  ep: 'the eastern Pacific',
  cp: 'the central Pacific',
  wp: 'the western Pacific',
  io: 'the northern Indian Ocean',
  sh: 'the Southern Hemisphere',
}
const basinWord = (id) => BASIN_WORD[String(id).slice(0, 2).toLowerCase()] || null

// NOAA's missing-value sentinel. Anything at or past it is "not reported".
const MISSING = 9999
const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) && Math.abs(n) < MISSING ? n : null
}

// stormtype / classification codes → plain language (docs/STORMS_API.md §4)
const TYPE_WORD = {
  DB: 'Disturbance', LO: 'Low', WV: 'Tropical wave',
  TD: 'Tropical depression', TS: 'Tropical storm',
  HU: 'Hurricane', MH: 'Major hurricane',
  SD: 'Subtropical depression', SS: 'Subtropical storm',
  STD: 'Subtropical depression', STS: 'Subtropical storm',
  EX: 'Post-tropical cyclone', PT: 'Post-tropical cyclone', IN: 'Inland',
}
const WW_WORD = {
  TWA: 'Tropical storm watch', TWR: 'Tropical storm warning',
  HWA: 'Hurricane watch', HWR: 'Hurricane warning',
}

// Saffir-Simpson from sustained wind in knots. NHC's own thresholds; used
// only when the feed doesn't hand us a category directly.
const catOf = (kt) =>
  !Number.isFinite(kt) ? 0 : kt >= 137 ? 5 : kt >= 113 ? 4 : kt >= 96 ? 3 : kt >= 83 ? 2 : kt >= 64 ? 1 : 0

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  }
}

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...(init.headers || {}),
    },
  })

async function gis(layer, fields, geometry = true) {
  const qs = new URLSearchParams({
    where: '1=1',
    outFields: fields,
    returnGeometry: String(geometry),
    outSR: '4326',
    f: 'geojson',
  })
  const r = await fetch(`${GIS}/${layer}/query?${qs}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!r.ok) throw new Error(`gis ${layer} ${r.status}`)
  const j = await r.json()
  return Array.isArray(j?.features) ? j.features : []
}

// ArcGIS hands back Polygon or MultiPolygon / LineString or MultiLineString
// depending on the storm; normalize to an array of coordinate rings so the
// client renderer only ever deals with one shape.
// ArcGIS returns coordinates at full float precision (14 decimals ≈ 1 nm),
// and a 5-day cone is ~1600 vertices per storm — that alone was most of a
// 200 KB payload. 3 decimals is ~110 m, still far finer than a forecast cone
// whose real uncertainty is measured in hundreds of kilometres.
const round6 = (pair) => [Math.round(pair[0] * 1e3) / 1e3, Math.round(pair[1] * 1e3) / 1e3]

// Past wind radii arrive as ~361-vertex rings, one per threshold per 6-hour
// step — far more detail than a 60-nautical-mile shell needs on screen, and
// the timeline multiplies them by every frame. Every 6th vertex is visually
// identical at any zoom this layer is read at, and cuts the tape's share of
// the payload by the same factor. First and last are always kept so the ring
// still closes.
function decimate(ring, step = 6) {
  if (ring.length <= 12) return ring
  const out = []
  for (let i = 0; i < ring.length - 1; i += step) out.push(ring[i])
  out.push(ring[ring.length - 1])
  return out
}
const ringsOf = (g) => {
  if (!g) return []
  const rings =
    g.type === 'Polygon' || g.type === 'MultiLineString' ? g.coordinates
      : g.type === 'MultiPolygon' ? g.coordinates.flat()
        : g.type === 'LineString' ? [g.coordinates]
          : []
  return rings.map((r) => r.map(round6))
}

// ─── JTWC ───────────────────────────────────────────────────────────────────
// JTWC publishes no GIS service and no JSON. What it does publish, per storm,
// is a `.tcw` ("JMV 3.0") file whose first lines are a compact machine-
// readable summary — far more robust to parse than the prose warning, and
// 5 KB instead of the 437 KB KMZ:
//
//   2026092212 17E POLO       008  02 090 04 SATL 020
//   T000 147N 1016W 140 R064 025 NE QD 030 SE QD 030 SW QD 025 NW QD R034 …
//
// Line 3 is synoptic time, ATCF id, name, warning number, active-storm count,
// movement bearing, movement speed (kt). Each T-line is a forecast hour:
// latitude and longitude in TENTHS of a degree with a hemisphere letter, then
// max sustained wind in knots, then any 64/50/34-knot quadrant radii in
// nautical miles.
//
// What JTWC does NOT give us, and what we therefore do not draw:
//   * central pressure — absent from the warning product entirely (`mb: null`,
//     rendered as "not reported", never guessed from wind speed)
//   * a track-uncertainty cone — JTWC's KMZ carries a "34-knot danger swath",
//     which answers a different question (where wind may reach, not where the
//     centre may go). Substituting one for the other would be a lie with a
//     legend on it, so JTWC storms simply have no cone.
//   * past track — the .tcw is current + forecast only.

const jtwcNum = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null }

/** "1016W" → -101.6 ; "0848E" → 84.8 ; "390N" → 39.0 (tenths of a degree). */
function tenths(digits, hemi) {
  const n = parseInt(digits, 10)
  if (!Number.isFinite(n)) return null
  const v = n / 10
  return hemi === 'S' || hemi === 'W' ? -v : v
}

/**
 * Quadrant wind radii → a closed ring, as literal quadrant arcs.
 *
 * NHC's own GIS smooths its radii into an organic blob; we deliberately do
 * not, because the reported datum IS four numbers ("125 nm in the northeast
 * quadrant"). Drawing stepped quadrant arcs shows exactly what was reported
 * and nothing that wasn't. Longitude degrees are divided by cos(lat) so the
 * shape stays circular on the ground rather than in degree space.
 */
function radiiRing(lat, lng, q) {
  const quads = [q.ne, q.se, q.sw, q.nw]
  if (!quads.some((r) => r > 0)) return null
  const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180))
  const ring = []
  // Bearing 0 = north, increasing clockwise. NE quadrant spans 0–90°, etc.
  for (let q4 = 0; q4 < 4; q4++) {
    const rNm = quads[q4] || 0
    const rDeg = rNm / 60
    for (let k = 0; k <= 15; k++) {
      const brg = ((q4 * 90 + (k / 15) * 90) * Math.PI) / 180
      ring.push([
        Math.round((lng + (Math.sin(brg) * rDeg) / cosLat) * 1e3) / 1e3,
        Math.round((lat + Math.cos(brg) * rDeg) * 1e3) / 1e3,
      ])
    }
    // Radial step to the next quadrant's radius — the visible discontinuity
    // is honest: the two quadrants really were reported as different sizes.
  }
  ring.push(ring[0])
  return ring
}

/** Parse one .tcw into the same storm shape the NHC branch produces. */
function parseTcw(text, fileId) {
  const lines = text.split(/\r?\n/)
  const head = lines.find((l) => /^\d{10}\s+\S+\s/.test(l.trim()))
  if (!head) return null
  const h = head.trim().match(/^(\d{10})\s+(\S+)\s+(.+?)\s{2,}(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/)
  if (!h) return null
  const [, dtg, atcf, rawName, advNum, , dirStr, spdStr] = h

  const synoptic = Date.parse(
    `${dtg.slice(0, 4)}-${dtg.slice(4, 6)}-${dtg.slice(6, 8)}T${dtg.slice(8, 10)}:00:00Z`,
  ) || null

  const steps = []
  for (const line of lines) {
    const m = line.match(/^T(\d{3})\s+(\d{2,4})([NS])\s+(\d{3,5})([EW])\s+(\d{2,3})(.*)$/)
    if (!m) continue
    const [, tau, latD, latH, lonD, lonH, ktStr, rest] = m
    const lat = tenths(latD, latH)
    const lng = tenths(lonD, lonH)
    if (lat == null || lng == null) continue
    const radii = []
    const re = /R(\d{3})\s+(\d{3})\s+NE QD\s+(\d{3})\s+SE QD\s+(\d{3})\s+SW QD\s+(\d{3})\s+NW QD/g
    let r
    while ((r = re.exec(rest))) {
      radii.push({ kt: jtwcNum(r[1]), ne: jtwcNum(r[2]), se: jtwcNum(r[3]), sw: jtwcNum(r[4]), nw: jtwcNum(r[5]) })
    }
    steps.push({ tau: jtwcNum(tau), lat, lng, kt: jtwcNum(ktStr), radii })
  }
  if (!steps.length) return null

  const now = steps.find((x) => x.tau === 0) || steps[0]
  const kt = now.kt
  const cat = catOf(kt)
  // JTWC names the system in the warning subject; `rawName` is the ATCF name
  // field, which is "ONE"/"INVEST" style for unnamed systems.
  const name = rawName.trim().replace(/_/g, ' ')
  const pretty = name && name !== 'INVEST' ? name[0] + name.slice(1).toLowerCase() : atcf
  const typeWord = cat >= 3 ? 'Major hurricane' : cat >= 1 ? 'Hurricane' : kt >= 34 ? 'Tropical storm' : 'Tropical depression'
  // In the western Pacific the same intensities are called typhoons.
  const basin = fileId.slice(0, 2)
  const localWord = basin === 'wp'
    ? (cat >= 1 ? 'Typhoon' : typeWord)
    : basin === 'io' || basin === 'sh'
      ? (cat >= 1 ? 'Tropical cyclone' : typeWord)
      : typeWord

  return {
    id: `jtwc-${fileId}`,
    bin: atcf,
    basin_word: basinWord(fileId),
    name: pretty,
    type: cat >= 1 ? 'HU' : kt >= 34 ? 'TS' : 'TD',
    type_word: localWord,
    kt,
    mph: kt == null ? null : Math.round(kt * 1.15078),
    mb: null, // JTWC warnings carry no central pressure. Never guess one.
    cat,
    lat: now.lat,
    lng: now.lng,
    move_dir: jtwcNum(dirStr),
    move_kt: jtwcNum(spdStr),
    advisory_ms: synoptic,
    advisory_num: advNum,
    advisory_url: `${JTWC_PRODUCTS}/${fileId}web.txt`,
    discussion_url: `${JTWC_PRODUCTS}/${fileId}web.txt`,
    graphics_url: `${JTWC_PRODUCTS}/${fileId}.gif`,
    agency: 'JTWC',
    agency_name: 'US Joint Typhoon Warning Center',
    // Deliberately empty — see the note above. The client shows a plain
    // sentence about it rather than drawing something that isn't published.
    past: [],
    past_track: [],
    past_wind: [],
    cone: [],
    cone_days: null,
    watches: [],
    no_cone_reason:
      'The Joint Typhoon Warning Center does not publish a track-uncertainty cone, so there is none to draw for this storm.',
    no_pressure: true,
    forecast: steps.map((x) => ({
      tau: x.tau,
      when: null,
      type: null,
      type_word: null,
      kt: x.kt,
      gust_kt: null,
      mb: null,
      cat: catOf(x.kt),
      lng: x.lng,
      lat: x.lat,
    })),
    peak_forecast: steps.reduce(
      (best, x) => (x.kt != null && (!best || x.kt > best.kt) ? { tau: x.tau, kt: x.kt, cat: catOf(x.kt), when: null } : best),
      null,
    ),
    forecast_track: [steps.map((x) => [Math.round(x.lng * 1e3) / 1e3, Math.round(x.lat * 1e3) / 1e3])],
    wind_field: (now.radii || [])
      .map((q) => ({ kt: q.kt, ne: q.ne, se: q.se, sw: q.sw, nw: q.nw, rings: [radiiRing(now.lat, now.lng, q)].filter(Boolean) }))
      .filter((w) => w.rings.length)
      .sort((a, b) => (a.kt || 0) - (b.kt || 0)),
  }
}

async function fetchJtwc() {
  const r = await fetch(JTWC_RSS, { headers: { accept: 'application/rss+xml' }, signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error(`jtwc rss ${r.status}`)
  const xml = await r.text()

  // Every active JTWC system links its own products; the file id carries the
  // basin and storm number. Numbers 90–99 are INVESTS, whose product is a
  // "Tropical Cyclone Formation Alert" — prose with no position block at all,
  // a completely different document. Parsing one as a warning would produce
  // garbage, so they are excluded here rather than failing downstream.
  const ids = [...new Set([...xml.matchAll(/products\/([a-z]{2}\d{2}\d{2})web\.txt/g)].map((m) => m[1]))]
    .filter((id) => {
      const basin = id.slice(0, 2)
      const num = parseInt(id.slice(2, 4), 10)
      return !NHC_BASINS.has(basin) && num >= 1 && num <= 89
    })

  const out = await Promise.all(
    ids.map(async (id) => {
      try {
        const rr = await fetch(`${JTWC_PRODUCTS}/${id}.tcw`, { signal: AbortSignal.timeout(12000) })
        if (!rr.ok) return null
        return parseTcw(await rr.text(), id)
      } catch { return null }
    }),
  )
  return out.filter(Boolean)
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, { status: 405 })

  try {
    const [current, fcstPts, fcstTrack, cone, ww, pastPts, pastTrack, windField, pastWind, jtwcResult] = await Promise.all([
      fetch(CURRENT_STORMS, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`nhc ${r.status}`)))),
      gis(5, 'binnumber,stormname,stormtype,maxwind,gust,mslp,ssnum,tau,datelbl,fldatelbl,tcdir,tcspd,advdate,advisnum'),
      gis(6, 'binnumber,stormname,stormtype,advdate'),
      gis(7, 'binnumber,stormname,stormtype,fcstprd,advdate'),
      gis(8, 'binnumber,stormname,tcww,advdate'),
      // lat/lon are REQUIRED here, not decorative: the live view draws the
      // past track from layer 11's geometry, but the replay positions the
      // storm from these fixes. Omitting them left every replayed frame
      // coordinate-less and drew nothing at all.
      gis(10, 'binnumber,stormname,stormtype,intensity,mslp,ss,dtg,lat,lon', false),
      gis(11, 'binnumber,stormtype,ss'),
      gis(16, 'binnumber,radii,tau,ne,se,sw,nw,validtime'),
      gis(13, 'binnumber,radii,synoptime,ne,se,sw,nw'),
      // JTWC is fetched alongside, but must never take the whole payload down
      // with it: if the Navy's feed is unreachable we still show every NHC
      // storm and say the other basins are unavailable, rather than an
      // all-or-nothing failure that hides an active hurricane.
      fetchJtwc().catch((err) => ({ _error: String(err).slice(0, 160) })),
    ])

    const active = Array.isArray(current?.activeStorms) ? current.activeStorms : []
    const byBin = (feats, bin) => feats.filter((f) => f.properties?.binnumber === bin)

    const storms = active.map((s) => {
      const bin = s.binNumber
      const kt = num(s.intensity)
      const mb = num(s.pressure)

      // Past positions, oldest first. dtg is a float like 2026092212 (UTC).
      const past = byBin(pastPts, bin)
        .map((f) => {
          const p = f.properties
          const d = String(Math.round(p.dtg ?? 0))
          const at = d.length === 10
            ? Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:00:00Z`)
            : null
          return {
            at_ms: at,
            type: p.stormtype,
            type_word: TYPE_WORD[p.stormtype] || p.stormtype,
            kt: num(p.intensity),
            mb: num(p.mslp),
            cat: num(p.ss) || 0,
            lng: num(p.lon),
            lat: num(p.lat),
          }
        })
        .filter((p) => p.at_ms)
        .sort((a, b) => a.at_ms - b.at_ms)

      // Forecast positions. tau is hours from the advisory; the 9999 sweep in
      // `num` drops the unreported pressure/motion on every step past tau=0.
      const forecast = byBin(fcstPts, bin)
        .map((f) => {
          const p = f.properties
          return {
            tau: num(p.tau),
            when: p.datelbl || p.fldatelbl || null,
            type: p.stormtype,
            type_word: TYPE_WORD[p.stormtype] || p.stormtype,
            kt: num(p.maxwind),
            gust_kt: num(p.gust),
            mb: num(p.mslp),
            cat: num(p.ssnum) || catOf(num(p.maxwind)),
            lng: f.geometry?.coordinates?.[0] ?? null,
            lat: f.geometry?.coordinates?.[1] ?? null,
          }
        })
        .filter((p) => p.lng != null && p.tau != null)
        .sort((a, b) => a.tau - b.tau)

      const peak = forecast.reduce(
        (best, p) => (p.kt != null && (!best || p.kt > best.kt) ? p : best),
        null,
      )

      return {
        id: s.id,
        bin,
        basin_word: basinWord(s.id),
        agency: 'NHC',
        agency_name: 'US National Hurricane Center',
        name: s.name,
        type: s.classification,
        type_word: TYPE_WORD[s.classification] || s.classification,
        kt,
        mph: kt == null ? null : Math.round(kt * 1.15078),
        mb,
        cat: catOf(kt),
        lat: s.latitudeNumeric ?? null,
        lng: s.longitudeNumeric ?? null,
        // Null on intermediate advisories — the client must not print "0°".
        move_dir: num(s.movementDir),
        move_kt: num(s.movementSpeed),
        advisory_ms: Date.parse(s.lastUpdate) || null,
        advisory_num: s.publicAdvisory?.advNum || null,
        // Inline provenance: the actual advisory this storm's numbers came
        // from, and the forecaster's reasoning behind the track.
        advisory_url: s.publicAdvisory?.url || null,
        discussion_url: s.forecastDiscussion?.url || null,
        graphics_url: s.forecastGraphics?.url || null,
        past,
        forecast,
        peak_forecast: peak ? { tau: peak.tau, kt: peak.kt, cat: peak.cat, when: peak.when } : null,
        past_track: byBin(pastTrack, bin).map((f) => ({
          type: f.properties.stormtype,
          cat: num(f.properties.ss) || 0,
          lines: ringsOf(f.geometry),
        })),
        forecast_track: byBin(fcstTrack, bin).flatMap((f) => ringsOf(f.geometry)),
        cone: byBin(cone, bin).flatMap((f) => ringsOf(f.geometry)),
        cone_days: num(byBin(cone, bin)[0]?.properties?.fcstprd) / 24 || null,
        // The storm's REAL wind field: NHC's 34/50/64-knot extents, which are
        // genuinely lopsided (Polo on 2026-09-22 reached 80 nm of
        // tropical-storm winds to the southeast but only 70 nm to the
        // northeast). True geographic polygons, so they scale honestly with
        // zoom instead of being a fixed-size mark pretending to be a storm.
        wind_field: byBin(windField, bin)
          .filter((f) => !f.properties.tau) // the current advisory, not forecasts
          .map((f) => ({
            kt: num(f.properties.radii),
            ne: num(f.properties.ne),
            se: num(f.properties.se),
            sw: num(f.properties.sw),
            nw: num(f.properties.nw),
            rings: ringsOf(f.geometry),
          }))
          .sort((a, b) => (a.kt || 0) - (b.kt || 0)),
        // The storm's wind field through time, one entry per 6-hour advisory
        // fix — what the replay animates. Early frames are legitimately empty:
        // a disturbance has no 34-knot radius to report, so the shells appear
        // only once it organises. That absence is data, not a gap to fill.
        past_wind: (() => {
          const byTime = new Map()
          for (const f of byBin(pastWind, bin)) {
            const t = String(f.properties.synoptime || '')
            if (t.length !== 10) continue
            const at = Date.parse(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:00:00Z`)
            if (!Number.isFinite(at)) continue
            if (!byTime.has(at)) byTime.set(at, [])
            byTime.get(at).push({
              kt: num(f.properties.radii),
              ne: num(f.properties.ne),
              se: num(f.properties.se),
              sw: num(f.properties.sw),
              nw: num(f.properties.nw),
              rings: ringsOf(f.geometry).map((r) => decimate(r)),
            })
          }
          return [...byTime.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([at_ms, shells]) => ({ at_ms, shells: shells.sort((x, y) => (x.kt || 0) - (y.kt || 0)) }))
        })(),
        watches: byBin(ww, bin).map((f) => ({
          code: f.properties.tcww,
          word: WW_WORD[f.properties.tcww] || f.properties.tcww,
          lines: ringsOf(f.geometry),
        })),
      }
    })

    const jtwcStorms = Array.isArray(jtwcResult) ? jtwcResult : []
    const jtwcError = Array.isArray(jtwcResult) ? null : jtwcResult?._error || 'unavailable'

    // Strongest first, so the storm that matters most is drawn and described
    // first regardless of which centre is warning on it.
    const all = [...storms, ...jtwcStorms].sort((a, b) => (b.kt ?? 0) - (a.kt ?? 0))

    // Newest advisory across all storms — the layer's "live" stamp.
    const advisory_ms = all.reduce((m, s) => Math.max(m, s.advisory_ms || 0), 0) || null

    return json(
      {
        fetched_ms: Date.now(),
        advisory_ms,
        count: all.length,
        coverage: COVERAGE,
        agencies: [
          { id: 'NHC', name: 'US National Hurricane Center', url: 'https://www.nhc.noaa.gov/', count: storms.length },
          {
            id: 'JTWC',
            name: 'US Joint Typhoon Warning Center',
            url: 'https://www.metoc.navy.mil/jtwc/jtwc.html',
            count: jtwcStorms.length,
            ...(jtwcError ? { error: jtwcError } : {}),
          },
        ],
        // A half-outage has to be visible: if one centre failed, the map is
        // not showing every storm on Earth and must not claim to.
        partial: jtwcError ? 'JTWC (western Pacific, Indian Ocean, Southern Hemisphere) could not be reached — storms in those basins are missing from this view.' : null,
        source: 'US National Hurricane Center and US Joint Typhoon Warning Center',
        source_url: 'https://www.nhc.noaa.gov/',
        storms: all,
      },
      { headers: { 'cache-control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=900' } },
    )
  } catch (err) {
    // Never invent an empty ocean: an upstream failure is reported as a
    // failure so the layer shows its honest "unavailable" state, not "no
    // storms". 200 + signal keeps it out of the console as a network error.
    return json(
      { fetched_ms: Date.now(), storms: null, coverage: COVERAGE, _upstream_error: String(err).slice(0, 200) },
      { headers: { 'cache-control': 'public, s-maxage=60' } },
    )
  }
}
