/**
 * Minimal Wikidata client (transport only). Reference: docs/WIKIDATA_SHIPS.md.
 *
 * - Every request carries a descriptive User-Agent (Wikimedia User-Agent policy;
 *   generic library agents get blocked).
 * - Requests are serial and paced (minIntervalMs). The Action API gets
 *   `maxlag=5` and backs off when the servers are lagged; 429/5xx back off too,
 *   honouring Retry-After.
 * - SPARQL (query.wikidata.org) has a 60 s timeout per query, so big lists
 *   are paged (the IMO index is fetched per leading digit).
 */
const API = 'https://www.wikidata.org/w/api.php'
const SPARQL = 'https://query.wikidata.org/sparql'
const COMMONS = 'https://commons.wikimedia.org/w/api.php'
// "bot" in the name: Wikimedia's User-Agent policy asks automated clients to say so.
export const USER_AGENT = 'EarthAtlasShipsBot/1.0 (https://earthatlas.org/ships; vessel identity import)'

export const WATERCRAFT = 'Q1229765'
// Fixed/mobile offshore units that carry IMO numbers but are not "watercraft" in Wikidata's tree.
export const OFFSHORE_ROOTS = ['Q689880', 'Q12688575'] // oil platform, drilling rig

export function wikidataClient({ minIntervalMs = 500, log = console.log } = {}) {
  let last = 0
  let calls = 0

  async function request(url, init = {}) {
    for (let attempt = 0; ; attempt++) {
      const wait = last + minIntervalMs - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      last = Date.now()
      calls++
      const res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...(init.headers || {}) } })
      if (res.ok) {
        const body = await res.json()
        if (body?.error?.code === 'maxlag' && attempt < 6) {
          const s = Number(res.headers.get('retry-after') || 5)
          log(`Wikidata maxlag; retrying in ${s}s`)
          await new Promise((r) => setTimeout(r, s * 1000))
          continue
        }
        if (body?.error) throw new Error(`Wikidata API error ${body.error.code}: ${body.error.info}`)
        return body
      }
      const text = await res.text()
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        const s = Number(res.headers.get('retry-after')) || 5 * 2 ** attempt
        log(`Wikidata ${res.status}; retrying in ${s}s`)
        await new Promise((r) => setTimeout(r, s * 1000))
        continue
      }
      throw new Error(`Wikidata ${res.status} for ${url.slice(0, 120)}: ${text.slice(0, 300)}`)
    }
  }

  async function sparql(query) {
    const body = await request(SPARQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
      body: new URLSearchParams({ query }),
    })
    return body.results.bindings
  }
  const val = (b, k) => b[k]?.value ?? null
  const qidOf = (uri) => (uri ? uri.split('/').pop() : null)

  return {
    get calls() { return calls },

    /** Up to 50 items, English labels only, claims with qualifiers and references. */
    async getEntities(ids) {
      if (ids.length > 50) throw new Error('wbgetentities takes at most 50 ids')
      const qs = new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props: 'info|labels|descriptions|claims|sitelinks/urls',
        languages: 'en', sitefilter: 'enwiki', format: 'json', maxlag: '5' })
      const url = `${API}?${qs}`
      return { url, body: await request(url) }
    },

    /**
     * Commons licence metadata for P18 file names (≤ 50 per request), 640 px thumbnail.
     * Returns { url, body, byFile } where byFile maps each requested name to its
     * page object exactly as received (via the response's title normalization).
     */
    async commonsImageInfo(files) {
      if (files.length > 50) throw new Error('imageinfo takes at most 50 titles')
      const qs = new URLSearchParams({ action: 'query', titles: files.map((f) => `File:${f}`).join('|'), prop: 'imageinfo',
        iiprop: 'url|extmetadata|size|mime|sha1|timestamp', iiurlwidth: '640',
        iiextmetadatafilter: 'LicenseShortName|LicenseUrl|License|Artist|Credit|AttributionRequired|UsageTerms|Copyrighted|Restrictions',
        format: 'json', maxlag: '5' })
      const url = `${COMMONS}?${qs}`
      const body = await request(url)
      const norm = Object.fromEntries((body.query?.normalized || []).map((n) => [n.from, n.to]))
      const byTitle = Object.fromEntries(Object.values(body.query?.pages || {}).map((pg) => [pg.title, pg]))
      const byFile = {}
      for (const f of files) {
        const t = `File:${f}`
        const pg = byTitle[norm[t] ?? t]
        if (pg) byFile[f] = pg
      }
      return { url, body, byFile }
    },

    /** Every IMO ship number statement (all ranks): [{ qid, imo, rank }]. Paged by leading character. */
    async imoIndex() {
      const out = []
      const pages = [...'0123456789'].map((d) => `FILTER(STRSTARTS(STR(?imo), "${d}"))`)
      pages.push('FILTER(!REGEX(STR(?imo), "^[0-9]"))')
      for (const f of pages) {
        const rows = await sparql(`SELECT ?s ?imo ?rank WHERE { ?s p:P458 ?st . ?st ps:P458 ?imo ; wikibase:rank ?rank . ${f} }`)
        for (const b of rows) out.push({ qid: qidOf(val(b, 's')), imo: val(b, 'imo'), rank: val(b, 'rank')?.split('#').pop() })
      }
      return out
    },

    /** Every MMSI statement (all ranks): [{ qid, mmsi, rank }]. */
    async mmsiIndex() {
      const rows = await sparql('SELECT ?s ?mmsi ?rank WHERE { ?s p:P587 ?st . ?st ps:P587 ?mmsi ; wikibase:rank ?rank }')
      return rows.map((b) => ({ qid: qidOf(val(b, 's')), mmsi: val(b, 'mmsi'), rank: val(b, 'rank')?.split('#').pop() }))
    },

    /**
     * Labels and ISO 3166-1 alpha-3 codes for referenced items, plus, for
     * `classIds`, whether each is a subclass of watercraft / an offshore unit.
     * Returns { lookup, raw } (raw = the SPARQL bindings as received).
     */
    async lookup(allIds, classIds = []) {
      const lookup = {}
      const raw = []
      for (let i = 0; i < allIds.length; i += 200) {
        const vals = allIds.slice(i, i + 200).map((q) => `wd:${q}`).join(' ')
        const rows = await sparql(`SELECT ?x ?label ?iso3 WHERE { VALUES ?x { ${vals} }
          OPTIONAL { ?x rdfs:label ?label FILTER(LANG(?label) = "en") } OPTIONAL { ?x wdt:P298 ?iso3 } }`)
        raw.push(...rows)
        for (const b of rows) {
          const q = qidOf(val(b, 'x'))
          const cur = (lookup[q] ||= { label: null, iso3: null })
          cur.label ??= val(b, 'label')
          cur.iso3 ??= val(b, 'iso3')
        }
      }
      for (let i = 0; i < classIds.length; i += 100) {
        const vals = classIds.slice(i, i + 100).map((q) => `wd:${q}`).join(' ')
        const off = OFFSHORE_ROOTS.map((r) => `EXISTS { ?x wdt:P279* wd:${r} }`).join(' || ')
        const rows = await sparql(`SELECT ?x ?w ?o WHERE { VALUES ?x { ${vals} }
          BIND(EXISTS { ?x wdt:P279* wd:${WATERCRAFT} } AS ?w) BIND((${off}) AS ?o) }`)
        raw.push(...rows)
        for (const b of rows) {
          const q = qidOf(val(b, 'x'))
          const cur = (lookup[q] ||= { label: null, iso3: null })
          cur.watercraft = val(b, 'w') === 'true'
          cur.offshore = val(b, 'o') === 'true'
        }
      }
      return { lookup, raw }
    },
  }
}
