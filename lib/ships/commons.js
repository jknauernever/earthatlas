/**
 * Wikimedia Commons "Category:IMO <n>" → EarthAtlas photo claims (pure; no I/O).
 * API facts, licence gate and the photo-choice rule: docs/COMMONS_PHOTOS.md.
 *
 * One IMO category = one source entity (`commons_imo_category`, key
 * "Category:IMO <n>"). Its raw record holds every API response we used for it,
 * exactly as received. Each file ALSO gets its own `commons_file` entity whose raw
 * record is the file's page object (same as Wikidata P18 photos), and the image
 * claim points to it (detail.commons_record_id).
 *
 * The category makes NO identity claim (no `imo` assertion): the IMO comes from the
 * category title, and the resolver (resolve.js, decideCommons) links the entity
 * to a vessel only when exactly one vessel holds that IMO as a registry-class,
 * checksum-valid IMO. Never by name.
 */
import { normImo } from './normalize.js'
import { COMMONS_SOURCE, commonsImageDetail, stripHtml } from './wikidata.js'

export { COMMONS_SOURCE }
export const IMO_CATEGORY_KIND = 'commons_imo_category'
export const COMMONS_FILE_KIND = 'commons_file'
export const EVIDENCE = 'community_curated'
/** How long a checked IMO counts as fresh for the click lookup and --resume. */
export const FRESH_DAYS = 30

export const imoCategory = (imo) => `Category:IMO ${imo}`

/** "Category:IMO 9509401" → { imo, valid } (checksum). Anything else → null. */
export function parseImoCategory(title) {
  const m = /^Category:IMO (\d{7})$/.exec(String(title || ''))
  if (!m) return null
  const n = normImo(m[1])
  return { imo: n.value, valid: n.valid }
}

// Raster photos only: drawings (SVG), documents (PDF) and video are not ship photos.
const PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/gif'])

// A photo of a part or the inside of the ship, not the ship. Matched against the file
// title and its Commons categories (not the free-text description: "inside the harbour").
const DETAIL_RE = /\b(interiors?|cabins?|engine rooms?|engine control|wheelhouses?|lounges?|restaurants?|dining|atrium|theat(?:re|er)s?|casino|buffet|menus?|logos?|emblems?|plaques?|nameplates?|ship models?|models of|bells?|propellers?|lifeboats?|deck plans?|details?|bridges of ships|ship bridges|navigating bridges?|on the bridge)\b/i
// A category naming one particular ship / boat, e.g. "Svitzer Eagle (tugboat, 2008)".
const SHIP_CAT_RE = /\([a-z][a-z .'-]*, \d{4}\)$/i

/** Capture date from extmetadata DateTimeOriginal (free text / HTML) → 'YYYY[-MM[-DD]]' or null. */
export function captureDate(meta = {}, now = new Date()) {
  const s = stripHtml(meta.DateTimeOriginal?.value)
  const m = /(\d{4})(?:[-:.](\d{2})(?:[-:.](\d{2}))?)?/.exec(s)
  if (!m) return null
  const y = Number(m[1])
  if (y < 1839 || y > now.getUTCFullYear() + 1) return null
  const mo = m[2] && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? m[2] : null
  const d = mo && m[3] && Number(m[3]) >= 1 && Number(m[3]) <= 31 ? m[3] : null
  return [m[1], mo, d].filter(Boolean).join('-')
}

const catsOf = (meta) => String(meta.Categories?.value ?? '').split('|').map((c) => c.trim()).filter(Boolean)

/**
 * Why this file is not a good "main photo" of the ship, or null. `ownCats` = the
 * ship categories we harvested (their names without "Category:").
 */
export function notBestReason(page, ownCats = []) {
  const info = page.imageinfo?.[0] || {}
  const meta = info.extmetadata || {}
  const cats = catsOf(meta)
  const text = `${String(page.title).replace(/^File:/, '').replace(/[_]/g, ' ')} | ${cats.join(' | ')}`
  const dm = DETAIL_RE.exec(text)
  if (dm) return `detail_or_interior (${dm[0].toLowerCase()})`
  const own = new Set(ownCats)
  const others = cats.filter((c) => SHIP_CAT_RE.test(c) && !own.has(c))
  if (others.length) return `shows other ships too (${others.slice(0, 2).join('; ')})`
  if (info.width && info.height && info.width < info.height) return 'portrait'
  if (info.width && info.width < 800) return 'small'
  return null
}

/** Pages of a set of generator responses, merged by title (a page may continue across responses). */
export function pagesOf(bodies) {
  const byTitle = new Map()
  for (const b of bodies) {
    for (const p of b?.query?.pages || []) {
      const cur = byTitle.get(p.title)
      if (!cur || (!cur.imageinfo && p.imageinfo)) byTitle.set(p.title, p)
    }
  }
  return [...byTitle.values()]
}

/** Members (categorymembers) of a set of member responses. */
export const membersOf = (bodies) => bodies.flatMap((b) => b?.query?.categorymembers || [])

/** Which categories to harvest: the IMO category itself when it holds files, plus each subcategory (one level). */
export function harvestCategories(imoCat, members) {
  return [...(members.some((m) => m.type === 'file') ? [imoCat] : []),
    ...members.filter((m) => m.type === 'subcat').map((m) => m.title)]
}

/**
 * Map one IMO category to image claims.
 * @param {object} a
 * @param {string} a.title                   "Category:IMO <n>"
 * @param {object|null} a.catPage             the category's page object (categoryinfo) as received
 * @param {Record<string, object[]>} a.files  harvested category title → generator response bodies
 * @param {Record<string, number>} [a.fileRecords]  file title → its commons_file raw record id
 * @returns {{ exists:boolean, imo:string|null, imoValid:boolean, assertions:object[], images:object[] }}
 */
export function mapImoCategory({ title, catPage, files = {}, fileRecords = {} }) {
  const parsed = parseImoCategory(title)
  const exists = !!catPage && catPage.missing === undefined && catPage.invalid === undefined
  const out = { exists, imo: parsed?.imo ?? null, imoValid: !!parsed?.valid, assertions: [], images: [] }
  if (!exists || !parsed) return out
  const ownCats = Object.keys(files).map((t) => t.replace(/^Category:/, ''))
  const seen = new Set()
  const kept = []
  for (const [cat, bodies] of Object.entries(files)) {
    for (const page of pagesOf(bodies)) {
      if (seen.has(page.title)) continue // a file can sit in two of the ship's categories
      seen.add(page.title)
      const file = String(page.title).replace(/^File:/, '')
      const info = page.imageinfo?.[0]
      if (!info) { out.images.push({ file, status: 'no_imageinfo' }); continue }
      if (!PHOTO_MIME.has(info.mime)) { out.images.push({ file, status: 'not_a_photo', mime: info.mime }); continue }
      const { lic, detail } = commonsImageDetail(info, fileRecords[page.title] ?? null)
      if (!lic.ok) { out.images.push({ file, status: 'skipped_license', license: lic.short || '(none)', kind: lic.kind }); continue }
      const cap = captureDate(info.extmetadata)
      kept.push({ page, file, cat, lic, detail, cap, why: notBestReason(page, ownCats), info })
    }
  }
  // Photo choice (docs/COMMONS_PHOTOS.md §Choosing the main photo): whole-ship shots first
  // (not a detail/interior, not a group of ships, landscape, ≥ 800 px), then the most recent
  // capture date (falls back to the upload date), then the file name.
  const when = (k) => k.cap ?? String(k.info.timestamp || '').slice(0, 10)
  kept.sort((x, y) => (!!x.why - !!y.why) || (when(y) > when(x) ? 1 : when(y) < when(x) ? -1 : 0) || (x.file < y.file ? -1 : 1))
  kept.forEach((k, i) => {
    out.images.push({ file: k.file, status: 'kept', license: k.lic.short, best: i === 0 })
    out.assertions.push({
      attribute: 'image', value_raw: k.file, value_norm: k.file,
      period_from: null, period_to: null, period_kind: 'unknown',
      evidence_class: EVIDENCE, sub_record_ref: k.page.title,
      detail: { ...k.detail, via: 'commons_imo_category', imo: parsed.imo, imo_category: title,
        category: k.cat, width: k.info.width ?? null, height: k.info.height ?? null, mime: k.info.mime,
        capture_date: k.cap, date_basis: k.cap ? 'DateTimeOriginal' : 'upload timestamp',
        best: i === 0, photo_order: i, not_best_reason: k.why },
    })
  })
  return out
}
