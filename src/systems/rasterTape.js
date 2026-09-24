/**
 * RasterTape — a replay tape whose "frames" are raster tile URLs.
 *
 * This exists so that precipitation plays the way every other animated layer
 * in /inmotion plays. ReplayController already refuses to advance past a
 * frame its tape says is not ready:
 *
 *     this.tape.prefetch(next, 5)
 *     if (!this.tape.ready(...)) { this.buffering = true; return }
 *
 * TapeField honours that by decoding baked frames ahead of the cursor, which
 * is why wind and currents never stutter. The first cut of the rain replay
 * ignored the contract — it let the cursor run free and chased it with tile
 * swaps — and the map blinked, because a swap landed on tiles that had not
 * arrived. Answering ready()/prefetch() honestly fixes it at the source: the
 * cursor simply waits, exactly like the scalar layers.
 *
 * "Ready" here means the tiles for the CURRENT VIEWPORT at that frame are in
 * the browser's HTTP cache, so Mapbox paints them without a round trip.
 */

import { EventTape } from './eventTape.js'

export class RasterTape extends EventTape {
  /**
   * opts, on top of EventTape's:
   *   urlAt(valid_ms) -> tile template for that moment (or { url, maxzoom }),
   *                      or null if the archive has nothing there
   *   map            -> used only to work out which tiles are on screen
   *   maxzoom        -> the source's own maxzoom, so we never warm past it
   */
  constructor(opts = {}) {
    super([], opts)
    this._urlAt = opts.urlAt
    this._map = opts.map
    this._maxzoom = opts.maxzoom ?? 6
    this._warm = new Map()   // frame index -> { sig, done, ok, urls }
    this._queue = []         // frames waiting to be warmed, cursor-first
    this._busy = false
    this._sigNow = ''
  }

  /**
   * The tiles Mapbox would ask for right now. Its own covering-tile maths
   * when we can reach it — guessing the zoom is the one thing that would
   * quietly warm the wrong level and put the blink back.
   */
  _tiles() {
    const map = this._map
    if (!map) return []
    try {
      const covering = map.transform.coveringTiles({
        tileSize: 256, minzoom: 0, maxzoom: this._maxzoom, roundZoom: true,
      })
      if (covering?.length) {
        return covering.map((t) => ({ z: t.canonical.z, x: t.canonical.x, y: t.canonical.y }))
      }
    } catch { /* internal API moved — fall through */ }
    // Fallback: Mapbox's covering zoom for a 256 px source is round(zoom + 1),
    // because its own transform works in 512 px tiles.
    try {
      const z = Math.max(0, Math.min(this._maxzoom, Math.round(map.getZoom() + 1)))
      const b = map.getBounds()
      const n = 1 << z
      const xt = (lng) => Math.floor(((lng + 180) / 360) * n)
      const yt = (lat) => {
        const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180)
        return Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n)
      }
      const x0 = Math.max(0, xt(b.getWest())); const x1 = Math.min(n - 1, xt(b.getEast()))
      const y0 = Math.max(0, yt(b.getNorth())); const y1 = Math.min(n - 1, yt(b.getSouth()))
      if (x1 < x0 || y1 < y0 || (x1 - x0) * (y1 - y0) > 400) return []
      const out = []
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y })
      return out
    } catch { return [] }
  }

  /** Viewport fingerprint: pan or zoom and everything warmed is stale. */
  _sig(tiles) {
    return tiles.length ? `${tiles[0].z}:${tiles.length}:${tiles[0].x},${tiles[0].y}` : 'none'
  }

  _warmFrame(i, tiles, sig) {
    const cached = this._warm.get(i)
    if (cached && cached.sig === sig) return cached
    const fr = this.frames[i]
    // urlAt may answer a bare template or { url, maxzoom } — a resolution
    // ladder hands back a different product per moment, each with its own
    // maxzoom, and Mapbox requests a source's tiles no deeper than that.
    const got = fr && this._urlAt ? this._urlAt(fr.valid_ms) : null
    const tpl = typeof got === 'string' ? got : got?.url || null
    const mz = typeof got === 'object' && got?.maxzoom != null ? got.maxzoom : this._maxzoom
    if (tiles.some((t) => t.z > mz)) {
      const seen = new Set()
      tiles = tiles.map((t) => (t.z > mz ? { z: mz, x: t.x >> (t.z - mz), y: t.y >> (t.z - mz) } : t))
        .filter((t) => { const id = `${t.z}/${t.x}/${t.y}`; if (seen.has(id)) return false; seen.add(id); return true })
    }
    const entry = { sig, done: false, ok: false }
    this._warm.set(i, entry)
    if (!tpl || !tiles.length) {
      // Nothing to fetch (outside the archive, or no viewport): "ready", so
      // the cursor is never stuck waiting for a frame that cannot exist.
      entry.done = true
      return entry
    }
    entry.urls = tiles.map((t) => tpl.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y))
    this._queue.push(entry)
    this._drain()
    return entry
  }

  /**
   * Warm ONE frame at a time.
   *
   * A globe view needs ~59 tiles, and ReplayController asks to prefetch five
   * frames ahead. Firing all of those at once is ~300 requests against a
   * browser limit of about six per host: they queue, and the frame the cursor
   * is actually waiting on ends up behind the ones requested after it. That
   * showed as the bar freezing on "buffering" with four later frames already
   * warm. Serial warming keeps the cursor's own frame first in line.
   */
  _drain() {
    if (this._busy || !this._queue.length) return
    const entry = this._queue.shift()
    if (entry.done || entry.sig !== this._sigNow) { this._drain(); return }
    this._busy = true
    // A frame must ALWAYS settle. One tile wedged behind a dead connection
    // would otherwise stall the whole replay for good.
    const bail = setTimeout(() => { entry.done = true; this._busy = false; this._drain() }, 6000)
    Promise.all(entry.urls.map((u) => fetch(u, { mode: 'cors', credentials: 'omit' })
      .then((r) => r.arrayBuffer()).catch(() => null)))
      .then(() => { entry.ok = true })
      .catch(() => {})
      .finally(() => {
        clearTimeout(bail)
        entry.done = true
        this._busy = false
        this._drain()
      })
  }

  ready(t = this.t) {
    // A pure lookup. prefetch() is what creates work — ReplayController calls
    // it immediately before this on every tick.
    const { i } = this.locate(t)
    const e = this._warm.get(i)
    return !!e && e.done && e.sig === this._sigNow
  }

  prefetch(t = this.t, ahead = 3) {
    const tiles = this._tiles()
    const sig = this._sig(tiles)
    if (sig !== this._sigNow) { this._warm.clear(); this._queue.length = 0; this._sigNow = sig }
    const { i } = this.locate(t)
    // Deliberately shallower than asked: each frame here is a screenful of
    // tile requests, not a small decode, so a deep queue starves the cursor.
    const last = Math.min(this.frames.length - 1, i + Math.min(ahead, 2))
    for (let k = i; k <= last; k++) this._warmFrame(k, tiles, sig)
    if (this._warm.size > 64) {
      for (const k of [...this._warm.keys()]) if (k < i - 4) this._warm.delete(k)
    }
  }
}
