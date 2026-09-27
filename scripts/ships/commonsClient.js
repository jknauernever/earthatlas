/**
 * Minimal Wikimedia Commons client for ship photos (transport only).
 * Reference: docs/COMMONS_PHOTOS.md. Mapping lives in lib/ships/commons.js.
 *
 * - Every request carries the same descriptive, generic User-Agent as the
 *   Wikidata client (Wikimedia User-Agent policy; no personal e-mail).
 * - Requests are serial and paced (minIntervalMs); `maxlag=5` on every call,
 *   and a maxlag error / 429 / 5xx backs off (honouring Retry-After).
 * - Every call returns the request URL and the response body exactly as
 *   received, so the importer can store them as evidence.
 */
import { USER_AGENT } from './wikidataClient.js'

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
// Licence facts plus what the photo-choice rule reads (capture date, description, categories).
export const EXTMETADATA = 'LicenseShortName|LicenseUrl|License|Artist|Credit|AttributionRequired|UsageTerms|Copyrighted|Restrictions|DateTimeOriginal|ImageDescription|Categories|ObjectName'

export function commonsClient({ minIntervalMs = 500, log = console.log, fetchImpl = fetch } = {}) {
  let last = 0
  let calls = 0

  async function get(params) {
    const url = `${COMMONS_API}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2', maxlag: '5' })}`
    for (let attempt = 0; ; attempt++) {
      const wait = last + minIntervalMs - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      last = Date.now()
      calls++
      const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } })
      if (res.ok) {
        const body = await res.json()
        if (body?.error?.code === 'maxlag' && attempt < 6) {
          const s = Number(res.headers.get('retry-after') || 5)
          log(`Commons maxlag; retrying in ${s}s`)
          await new Promise((r) => setTimeout(r, s * 1000))
          continue
        }
        if (body?.error) throw new Error(`Commons API error ${body.error.code}: ${body.error.info}`)
        return { url, body }
      }
      const text = await res.text()
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        const s = Number(res.headers.get('retry-after')) || 5 * 2 ** attempt
        log(`Commons ${res.status}; retrying in ${s}s`)
        await new Promise((r) => setTimeout(r, s * 1000))
        continue
      }
      throw new Error(`Commons ${res.status} for ${url.slice(0, 120)}: ${text.slice(0, 300)}`)
    }
  }

  /** Follow `continue` until done or `stop(bodies)` says enough. Returns every { url, body }. */
  async function paged(params, stop = () => false) {
    const out = []
    let cont = {}
    for (;;) {
      const r = await get({ ...params, ...cont })
      out.push(r)
      if (!r.body.continue || stop(out)) return out
      cont = r.body.continue
    }
  }

  return {
    get calls() { return calls },

    /**
     * Does "Category:IMO <n>" exist, and how many files / subcategories does it hold?
     * ≤ 50 titles per request. Returns { url, body, byTitle } (page objects as received).
     */
    async categoryInfo(titles) {
      if (titles.length > 50) throw new Error('at most 50 titles per request')
      const r = await get({ action: 'query', prop: 'categoryinfo', titles: titles.join('|') })
      const norm = Object.fromEntries((r.body.query?.normalized || []).map((n) => [n.from, n.to]))
      const byTitle = {}
      for (const pg of r.body.query?.pages || []) byTitle[pg.title] = pg
      for (const t of titles) if (norm[t] && byTitle[norm[t]]) byTitle[t] = byTitle[norm[t]]
      return { ...r, byTitle }
    },

    /**
     * The (visible) categories each of these categories sits in: for a ship's own category
     * ("Cathlamet (ship, 1981)") these include its type ("Issaquah class ferries"). ≤ 50 titles.
     */
    async parents(titles) {
      if (titles.length > 50) throw new Error('at most 50 titles per request')
      return paged({ action: 'query', prop: 'categories', titles: titles.join('|'), clshow: '!hidden', cllimit: 'max' })
    },

    /** Files and subcategories directly in one category (plus the category's own info). */
    async members(title) {
      return paged({ action: 'query', list: 'categorymembers', cmtitle: title, cmtype: 'file|subcat', cmlimit: '500',
        cmprop: 'ids|title|type|timestamp|sortkeyprefix', prop: 'categoryinfo', titles: title })
    },

    /**
     * The files directly in one category, each with imageinfo (licence extmetadata, size,
     * mime, sha1, a 640 px thumbnail): generator=categorymembers, 50 per request, until
     * `maxFiles` pages have arrived.
     */
    async files(title, { maxFiles = 200 } = {}) {
      const seen = (rs) => new Set(rs.flatMap((r) => (r.body.query?.pages || []).map((p) => p.title))).size
      return paged({ action: 'query', generator: 'categorymembers', gcmtitle: title, gcmtype: 'file', gcmlimit: '50',
        prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime|sha1|timestamp', iiurlwidth: '640',
        iiextmetadatafilter: EXTMETADATA }, (rs) => seen(rs) >= maxFiles)
    },
  }
}
