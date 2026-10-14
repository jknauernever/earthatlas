/**
 * Where /permits reads its data. Production reads the weekly bake from Blob (.github/workflows/permits-bake.yml →
 * permits/ on Blob); localhost reads the local bake output (public/permits-data/, npm run permits:bake). Each falls
 * back to the other, so the site still works before the first weekly run or if Blob can't be reached.
 */
const BLOB = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/permits'
const LOCAL = '/permits-data'
const ORDER = import.meta.env.DEV ? [LOCAL, BLOB] : [BLOB, LOCAL]
let chosen = null // the first base that answered; later reads stay on it so the files match one bake

export async function fetchPermitsJson(path) {
  for (const base of chosen ? [chosen, ...ORDER.filter((b) => b !== chosen)] : ORDER) {
    try {
      const r = await fetch(`${base}/${path}`)
      if (r.ok) { chosen ??= base; return await r.json() }
    } catch { /* try the other */ }
  }
  throw new Error(`${path}: not found`)
}
export const permitsBase = () => chosen || ORDER[0]
