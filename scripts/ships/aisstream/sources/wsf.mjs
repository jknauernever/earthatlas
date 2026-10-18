/**
 * Source: Washington State Ferries vessel positions (WSDOT Traveler API, WSF Vessels: /vessellocations; catalogued
 * 2026-10-18). One request returns the whole fleet; each in-service ferry's position is ~10–20 s old and changes every
 * ~10–15 s, so this polls every POLL_MS and hands each NEW position to ctx.ingest() (same MMSI as its AIS, so the core
 * keeps one record per ferry whichever source reports it). Out-of-service boats and positions older than MAX_AGE_S are
 * skipped (WSF keeps a laid-up boat's last position for weeks). Extras for the live map: route, terminals, ETA, scheduled
 * departure, time it left the dock. Identity: WSF's vessel name, only where AIS hasn't given one.
 * WSF positions are not AIS messages: status and transceiver are left empty. Needs WSDOT_ACCESS_CODE.
 * Public agency data: credit Washington State Ferries / WSDOT with a link wherever it is shown.
 */
const URL_ = 'https://www.wsdot.wa.gov/ferries/api/vessels/rest/vessellocations'
const POLL_MS = 15_000
const MAX_AGE_S = 600
// WCF JSON dates: "/Date(1729281725000-0700)/" → ms since epoch (the offset is informational; the number is UTC ms).
const wcf = (s) => { const m = /\/Date\((-?\d+)/.exec(s || ''); return m ? Number(m[1]) : null }

let timer = null
const lastT = new Map()   // mmsi → the WSF timestamp last ingested (positions repeat between polls)

export function start(ctx) {
  const CODE = process.env.WSDOT_ACCESS_CODE
  if (!CODE) { ctx.log('wsf: no WSDOT_ACCESS_CODE, source off'); return }
  const h = (ctx.health.wsf = { lastPollAt: null, lastOkAt: null, vesselsInService: 0, errors: 0, lastError: null })
  const poll = async () => {
    h.lastPollAt = new Date().toISOString()
    try {
      const r = await fetch(`${URL_}?apiaccesscode=${encodeURIComponent(CODE)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const list = await r.json()
      h.lastOkAt = new Date().toISOString()
      h.vesselsInService = list.filter((v) => v.InService).length
      const now = Date.now()
      for (const v of list) {
        const ms = wcf(v.TimeStamp)
        if (!v.InService || !v.Mmsi || !ms || now - ms > MAX_AGE_S * 1000) continue
        if (lastT.get(v.Mmsi) === ms) continue
        lastT.set(v.Mmsi, ms)
        ctx.activity('wsf')
        if (v.VesselName) ctx.noteIdentity(v.Mmsi, { vessel_name: v.VesselName.toUpperCase() })
        const hdg = Number.isFinite(v.Heading) && v.Heading >= 0 && v.Heading <= 359 ? v.Heading : null
        ctx.ingest({ source: 'wsf', mmsi: v.Mmsi, t: new Date(ms), lat: v.Latitude, lon: v.Longitude, sog: v.Speed ?? null, cog: null, heading: hdg,   // WSF reports heading, not course
          status: null, transceiver: null,
          extras: { ferry: v.VesselName, route: (v.OpRouteAbbrev || [])[0] || null, from: v.DepartingTerminalName || null, to: v.ArrivingTerminalName || null,
            atDock: !!v.AtDock, schedDep: wcf(v.ScheduledDeparture), leftDock: wcf(v.LeftDock), eta: wcf(v.Eta), etaBasis: v.EtaBasis || null } })
      }
    } catch (e) {
      h.errors++; h.lastError = String(e.message || e).slice(0, 160)
      if (h.errors === 1 || h.errors % 40 === 0) ctx.log('wsf: poll failed', h.lastError, `(x${h.errors})`)
    }
  }
  ctx.log('wsf: polling every', POLL_MS / 1000, 's')
  poll()
  timer = setInterval(poll, POLL_MS)
}

export function stop() { clearInterval(timer) }
