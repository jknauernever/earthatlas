// EarthAtlas national datasets (docs/NATIONAL_DATA.md): one catalog on Vercel Blob names the current version and files
// of every national dataset (PAD-US, critical habitat, PHMSA, NRC…). Subsites read data through here, so a new version
// published by scripts/national/publish.mjs goes live without a deploy.

const BLOB = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com'
// Localhost reads the newest local builds (vite.config: nationalDevPlugin) so a build shows before it is published.
export const CATALOG_URL = import.meta.env.DEV ? '/dev-national/catalog.json' : `${BLOB}/national/catalog.json`

let catalogPromise = null
/** The catalog: { updated, datasets: { <id>: { id, name, version, source, license, files: { path: url }, … } } }. */
export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch(CATALOG_URL, { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(`catalog ${r.status}`); return r.json() })
      .catch((e) => { catalogPromise = null; throw e })
  }
  return catalogPromise
}

/** One dataset's catalog entry, or null when it isn't published yet. */
export async function nationalDataset(id) {
  const c = await loadCatalog().catch(() => null)
  return c?.datasets?.[id] || null
}

/** URL of one file of a dataset's current version (`path` as it sits in the dataset's build folder). */
export async function nationalFile(id, path) {
  const d = await nationalDataset(id)
  return d?.files?.[path] || null
}

/**
 * Vector tiles of a national PMTiles dataset, through api/national-tiles (Mapbox's own pmtiles source breaks under the
 * Vite dev pipeline). Must be an ABSOLUTE URL: Mapbox resolves tile templates in a worker.
 */
export const nationalTilesUrl = (id, version) =>
  `${window.location.origin}/api/national-tiles?d=${encodeURIComponent(id)}&v=${encodeURIComponent(version)}&z={z}&x={x}&y={y}`
