/**
 * Assembles a story from its content records (content/, see content/README.md) into plain data for a layout.
 * Layouts never see records or ids, only this: everything a chapter shows, with every number already read
 * from the subsite's published report counts. scripts/stories/validate.mjs has checked every reference at build time.
 */
import { BRANDS } from '../lib/brand.js'
import { STORY_SUBSITES, countOf, COUNT_TOKEN, formatCount } from './subsites.js'

const FILES = import.meta.glob(['/content/**/*.json', '!/content/schema/**'], { eager: true, import: 'default' })

const TYPE_OF = { 'photos.json': 'photo', 'texts.json': 'text', 'stats.json': 'stat', 'actions.json': 'action', 'sources.json': 'source',
  'places.json': 'place', 'labels.json': 'labelSet', 'views.json': 'view', 'chapters.json': 'chapter' }
const records = {}
const stories = []
for (const [path, data] of Object.entries(FILES)) {
  const parts = path.split('/')   // ['', 'content', owner, file] or ['', 'content', owner, 'stories', slug.json]
  if (parts[3] === 'stories') { stories.push(data); continue }
  const type = TYPE_OF[parts[3]]
  if (!type) continue
  records[type] ??= {}
  for (const r of data) records[type][r.id] = r
}
const rec = (type, id) => (id == null ? null : records[type]?.[id] || null)

/** The stories told on a subsite (index pages), drafts included; the caller decides what to list. */
export const storiesOf = (subsite) => stories.filter((s) => s.subsite === subsite)

const countsCache = {}
// A failed load isn't kept, so trying again refetches
const loadCounts = (subsite) => (countsCache[subsite] ??= fetch(STORY_SUBSITES[subsite].counts)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${STORY_SUBSITES[subsite].counts}: HTTP ${r.status}`))))
  .catch((e) => { delete countsCache[subsite]; throw e }))

/**
 * One story, ready to render, or null if there's no such story on that subsite.
 * {
 *   slug, subsite, title, layout, status,
 *   author:   { id, name, href, wordmark: { lead, tail } }
 *   explorer: the subsite's map path ("Open the full map" adds the camera and layers)
 *   key:      layer ids shown anywhere in the story (for a map key)
 *   chapters: [{ id, railLabel, kicker, headline, body, photo, stat, view, actions }]
 *     photo   { src, alt, caption, credit, focalPoint: { x, y }, subject: { x, y } }
 *     stat    { value: '407', unit: 'mi', label } or null
 *     view    { camera: { bounds } | { center, zoom }, layers: [{ id, emphasis, opacity, filter, highlight: { prop, ids } | null, rings }], labels: [{ text, at, small }], frames: [bounds] }
 *     actions [{ label, href }]
 *   sources:  [{ name, href, publisher }] — every source the story's records cite, then the subsite's report counts
 * }
 */
export async function loadStory(subsite, slug) {
  const story = stories.find((s) => s.subsite === subsite && s.slug === slug)
  if (!story || !STORY_SUBSITES[subsite]) return null
  const counts = await loadCounts(subsite)
  const num = (key) => { const v = countOf(counts, key); if (v === undefined) throw new Error(`${subsite} counts have no '${key}'`); return v }
  const countedSet = (key) => {
    const s = counts.sets?.[key]
    if (!s) throw new Error(`${subsite} counts have no set '${key}'`)
    return { prop: s.prop, ids: s.ids }
  }
  const fill = (str) => str.replace(COUNT_TOKEN, (_, sub, key, d) => formatCount(sub === subsite ? num(key) : num(`${sub}.${key} (another subsite's count)`), Number(d || 0)))
  const brand = BRANDS.find((b) => b.id === story.author)
  const cited = new Set(story.sources || [])
  const keyIds = new Set()

  const place = (id) => rec('place', id)
  const chapters = story.chapters.map((cid) => {
    const c = rec('chapter', cid)
    const t = rec('text', c.text), p = rec('photo', c.photo), v = rec('view', c.view), s = rec('stat', c.stat)
    for (const src of t.sources || []) cited.add(src)
    if (s?.source) cited.add(s.source)
    const layers = v.layers.filter((l) => l.emphasis !== 'off')
    for (const l of layers) keyIds.add(l.id)
    return {
      id: c.id,
      railLabel: c.railLabel,
      kicker: t.kicker,
      headline: t.headline,
      body: fill(t.body),
      photo: { src: p.src, alt: p.alt, caption: p.caption, credit: p.credit, focalPoint: p.focalPoint, subject: p.subject || p.focalPoint },
      stat: s && {
        value: formatCount(s.dataKey ? num(s.dataKey) : s.value, s.decimals ?? 0),
        unit: s.unit || '',
        label: fill(s.label),
      },
      view: {
        camera: v.camera.place ? { bounds: place(v.camera.place).bounds } : v.camera,
        layers: layers.map((l) => ({ id: l.id, emphasis: l.emphasis, opacity: l.emphasis === 'dim' ? (l.opacity ?? 0.5) : 1, filter: l.filter || null, highlight: l.highlight ? countedSet(l.highlight) : null, rings: !!(l.highlight && l.rings) })),
        labels: v.labels ? rec('labelSet', v.labels).items : [],
        frames: (v.frames || []).map((f) => place(f).bounds),
      },
      actions: (c.actions || []).map((a) => { const r = rec('action', a); return { label: r.label, href: r.href } }),
    }
  })

  return {
    slug: story.slug, subsite, title: story.title, layout: story.layout, status: story.status,
    author: { id: brand.id, name: brand.logoAlt, href: brand.href, wordmark: brand.wordmark || { lead: brand.logoAlt, tail: '' } },
    explorer: STORY_SUBSITES[subsite].explorer,
    key: [...keyIds],
    chapters,
    sources: [
      ...[...cited].map((id) => { const r = rec('source', id); return { name: r.name, href: r.href, publisher: r.publisher } }),
      { ...STORY_SUBSITES[subsite].reports, publisher: 'EarthAtlas' },
    ],
  }
}
