/**
 * USCG CGMIX PSIXData web service client (SOAP 1.1, public, no key).
 * docs/VESSEL_REGISTRIES.md §PSIX. One request at a time with a pause between
 * request starts (no published rate limit; we stay polite). Returns each operation's
 * result string exactly as received (the XML the service wraps in its SOAP body).
 */
const ENDPOINT = 'https://cgmix.uscg.mil/xml/PSIXData.asmx'
const NS = 'https://cgmix.uscg.mil'
const UA = 'EarthAtlas-ships/0.1 (+https://earthatlas.org; vessel registry research)'

const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const xmlUnesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const OPS = {
  summary: ['getVesselSummaryXMLString', ['VesselID', 'VesselName', 'CallSign', 'VIN', 'HIN', 'Flag', 'Service', 'BuildYear']],
  particulars: ['getVesselParticularsXMLString', ['VesselID']],
  dimensions: ['getVesselDimensionsXMLString', ['VesselID']],
  tonnage: ['getVesselTonnageXMLString', ['VesselID']],
  documents: ['getVesselDocumentsXMLString', ['VesselID']],
  cases: ['getVesselCasesXMLString', ['VesselID', 'MaxSearchDate', 'MinSearchDate']],
}

export function psixClient({ pauseMs = 400, log = console.warn } = {}) {
  let last = 0
  const client = { calls: 0 }
  async function call(op, params = {}) {
    const [name, fields] = OPS[op]
    const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${name} xmlns="${NS}">${fields.map((f) => `<${f}>${xmlEsc(params[f] ?? '')}</${f}>`).join('')}</${name}></soap:Body></soap:Envelope>`
    for (let attempt = 1; ; attempt++) {
      // Reserve the next start slot synchronously, so parallel callers stay ≥ pauseMs apart.
      const slot = Math.max(Date.now(), last + pauseMs)
      last = slot
      if (slot > Date.now()) await new Promise((r) => setTimeout(r, slot - Date.now()))
      client.calls++
      try {
        const res = await fetch(ENDPOINT, { method: 'POST', body, signal: AbortSignal.timeout(60000),
          headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${NS}/${name}"`, 'User-Agent': UA } })
        const text = await res.text()
        if (!res.ok) throw new Error(`PSIX ${op} HTTP ${res.status}: ${text.slice(0, 200)}`)
        const m = new RegExp(`<${name}Result>([\\s\\S]*)</${name}Result>`).exec(text)
        // An empty response element (<…Response />) means no rows.
        return { op, params, xml: m ? xmlUnesc(m[1]) : '<NewDataSet />' }
      } catch (e) {
        if (attempt >= 4) throw e
        log(`  PSIX ${op} failed (${String(e.message).slice(0, 100)}); retry ${attempt}/3`)
        await new Promise((r) => setTimeout(r, 3000 * attempt))
      }
    }
  }
  client.call = call
  client.endpoint = ENDPOINT
  /** Every detail operation for one PSIX VesselId, plus the summary row(s) that found it. */
  client.vessel = async (vesselId, summaryXml = null) => {
    const responses = { summary: summaryXml ?? (await call('summary', { VesselID: vesselId })).xml }
    for (const op of ['particulars', 'dimensions', 'tonnage', 'documents', 'cases']) responses[op] = (await call(op, { VesselID: vesselId })).xml
    return { vessel_id: String(vesselId), retrieved_at: new Date().toISOString(), responses }
  }
  return client
}
