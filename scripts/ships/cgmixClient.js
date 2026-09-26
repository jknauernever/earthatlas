/**
 * USCG CGMIX web services client for incidents (SOAP 1.1, public, no key):
 *   IIRData.asmx   Incident Investigation Reports (closed marine casualty investigations)
 *   PSIXData.asmx  operational controls + vessel deficiencies per activity
 * docs/SHIP_INCIDENT_SOURCES.md §1–2. cgmix.uscg.mil has no robots.txt (it redirects
 * to an error page) and no published rate limit. We send a descriptive User-Agent and
 * keep request starts ≥ pauseMs apart across both services (default 500 ms = ≤ 2 req/s).
 * Each operation's result string is returned exactly as received.
 */
const UA = 'EarthAtlas-ships/0.1 (+https://earthatlas.org; vessel incident research)'

const SERVICES = {
  iir: { endpoint: 'https://cgmix.uscg.mil/xml/IIRData.asmx', ns: 'https://cgmix.uscg.mil/xml/', action: (n) => `https://cgmix.uscg.mil/xml/${n}` },
  psix: { endpoint: 'https://cgmix.uscg.mil/xml/PSIXData.asmx', ns: 'https://cgmix.uscg.mil', action: (n) => `https://cgmix.uscg.mil/${n}` },
}

const OPS = {
  // IIR, one ActivityId each (the per-incident detail we store)
  title: ['iir', 'getIIRTitleInformationXMLString', ['ActivityId']],
  summary: ['iir', 'getIIRIncidentSummaryXMLString', ['ActivityId']],
  vessels: ['iir', 'getIIRInvolvedVesselsXMLString', ['ActivityId']],
  water: ['iir', 'getIIRWaterSegmentsXMLString', ['ActivityId']],
  casualties: ['iir', 'getIIRPersonalCasualtySummaryXMLString', ['ActivityId']],
  status: ['iir', 'getIIRVesselStatusSummaryXMLString', ['ActivityId']],
  brief: ['iir', 'getIIRIncidentBriefXMLString', ['ActivityId']],
  search: ['iir', 'getIIRIncidentSearchXMLString', ['ActivityId', 'VesselService', 'VesselName', 'OrgName', 'InvolvedFacility', 'KeyWord']],
  // PSIX, per activity
  opcontrols: ['psix', 'getOperationControlsXMLString', ['ActivityID']],
  deficiencies: ['psix', 'getVesselDeficienciesXMLString', ['ActivityNumber']],
}
/** The IIR operations stored for one incident. getIIRInvolvedParties (people) is never requested. */
export const IIR_OPS = ['title', 'summary', 'vessels', 'water', 'casualties', 'status', 'brief']

const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const xmlUnesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

export function cgmixClient({ pauseMs = 500, log = console.warn } = {}) {
  let last = 0
  const client = { calls: 0 }
  async function call(op, params = {}) {
    const [svc, name, fields] = OPS[op]
    const S = SERVICES[svc]
    const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${name} xmlns="${S.ns}">${fields.map((f) => `<${f}>${xmlEsc(params[f] ?? '')}</${f}>`).join('')}</${name}></soap:Body></soap:Envelope>`
    for (let attempt = 1; ; attempt++) {
      // Reserve the next start slot synchronously, so parallel callers stay ≥ pauseMs apart.
      const slot = Math.max(Date.now(), last + pauseMs)
      last = slot
      if (slot > Date.now()) await new Promise((r) => setTimeout(r, slot - Date.now()))
      client.calls++
      try {
        const res = await fetch(S.endpoint, { method: 'POST', body, signal: AbortSignal.timeout(60000),
          headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${S.action(name)}"`, 'User-Agent': UA } })
        const text = await res.text()
        if (res.status === 403 || res.status === 401) { const e = new Error(`CGMIX ${op} HTTP ${res.status} (access refused; not retried)`); e.blocked = true; throw e }
        if (!res.ok) throw new Error(`CGMIX ${op} HTTP ${res.status}: ${text.slice(0, 200)}`)
        const m = new RegExp(`<${name}Result>([\\s\\S]*)</${name}Result>`).exec(text)
        return { op, params, xml: m ? xmlUnesc(m[1]) : '<NewDataSet />' }
      } catch (e) {
        if (e.blocked || attempt >= 4) throw e
        log(`  CGMIX ${op} failed (${String(e.message).slice(0, 100)}); retry ${attempt}/3`)
        await new Promise((r) => setTimeout(r, 3000 * attempt))
      }
    }
  }
  client.call = call
  client.endpoints = Object.fromEntries(Object.entries(SERVICES).map(([k, v]) => [k, v.endpoint]))
  /** Every stored IIR operation for one ActivityId: { activity_id, retrieved_at, responses: {op: xml} }. */
  client.iir = async (activityId) => {
    const responses = {}
    for (const op of IIR_OPS) responses[op] = (await call(op, { ActivityId: activityId })).xml
    return { activity_id: String(activityId), retrieved_at: new Date().toISOString(), responses }
  }
  return client
}
