/**
 * Which parcel bake /shoreline draws. The yearly Action (.github/workflows/shoreline-bake.yml) publishes a new dated
 * bake to Blob and then flips shoreline/latest.json, so a refresh needs no commit or deploy. Until a pointer exists, or
 * if it can't be read, the bake recorded in src/fire/parcelSources.json (region shoreline-sjc) is used.
 *
 *   { version, pmtilesUrl, detailBase, detailShards, updatedAt, parcels, buildings }
 */
import parcelSources from '../fire/parcelSources.json'

const BUILT_IN = parcelSources['shoreline-sjc']
const POINTER = `${new URL(BUILT_IN.pmtilesUrl).origin}/shoreline/latest.json`

/** The bake in use. Filled in place by loadShorelineBake(); read it after that resolves. */
export const shorelineBake = { ...BUILT_IN }

let promise = null
export function loadShorelineBake() {
  promise ??= fetch(POINTER, { signal: AbortSignal.timeout?.(4000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => {
      if (p?.version && p.detailBase && /^\d{4}-\d{2}-\d{2}$/.test(p.version)) Object.assign(shorelineBake, p)
      return shorelineBake
    })
    .catch(() => shorelineBake)
  return promise
}
