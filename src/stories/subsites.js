/**
 * The subsites stories can be told on. Per subsite, not per story: where its published counts are (the same file its
 * /reports page reads, so a story can never disagree with the report), its explorer, and its layer registry (a story
 * can only switch on layers the subsite already has, by their ids).
 *
 *   name      the subsite's name, as its report page and index page show it
 *   brand     the brand its index page shows on every host (as its report page does)
 *   explorer  the subsite's map, opened by "Open the full map" on the current host
 *   counts    public path of the report counts; a stat's dataKey is a key of its `all` or places.<place>.<key>
 *   reports   the report page those counts feed, credited as a source on every story
 *   look      () → how story maps draw this subsite's layers (src/stories/looks/<subsite>.js)
 *   registry  () → { layerIds, filters }: the registry's layer ids, and per layer the feature properties a story may filter on
 *
 * Kept free of browser-only code: scripts/stories/validate.mjs loads it at build time.
 */
export const STORY_SUBSITES = {
  shoreline: {
    name: 'Shoreline Ecosystems',
    brand: 'friends',   // Friends of the San Juans data: their logo on every host, like /shoreline/reports
    explorer: '/shoreline',
    counts: '/shoreline-data/report-counts.json',
    reports: { name: 'Shoreline Ecosystems counts', href: '/shoreline/reports' },
    look: () => import('./looks/shoreline.js').then((m) => m.default),
    registry: () => import('../shoreline/shorelineLayers.js').then((m) => ({
      layerIds: m.ALL_IDS,
      // t_<mode>: each fish-use segment's priority level (1–3) for one species, as the explorer's Color by uses it
      filters: { fish: [...m.FISH_SPECIES.map((s) => `t_${s.mode}`), `t_${m.FISH_MODE_ALL}`] },
    })),
  },
}

/** A count from a subsite's report counts by key: 'shore_mi' (county total) or 'places.fisherman-bay.armor_pieces'. */
export function countOf(counts, key) {
  const path = key.startsWith('places.') ? key.split('.') : ['all', key]
  const v = path.reduce((o, k) => (o == null ? undefined : o[k]), counts)
  return typeof v === 'number' ? v : undefined
}

/** {{subsite.key}} or {{subsite.key|decimals}} tokens in story wording. */
export const COUNT_TOKEN = /\{\{([a-z0-9-]+)\.([a-z0-9_.-]+?)(?:\|(\d))?\}\}/g

/** A number as stories show it: thousands separators, fixed decimals. */
export const formatCount = (v, decimals = 0) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
