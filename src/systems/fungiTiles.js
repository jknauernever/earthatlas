/**
 * The Underground fungi layer's on-screen picture: SPUN's ~1 km maps as
 * value-encoded raster tiles (api/spun-tiles, baked by
 * scripts/bake-spun/tiles.py), coloured on the GPU by Mapbox `raster-color`.
 *
 * The layer's DATA stays the 0.1° scalar field (popups, Explain); only the
 * drawing moves here, because the scalar overlay renders a 0.1° grid and, at
 * globe zooms, one 2048 px world image, which blurs 1 km maps into blocks.
 * While this draws, SystemsApp raises the layer's `fungi:yield` flag (the
 * same flag the US radar uses to take the map from precipitation) so the
 * scalar wash steps aside.
 *
 * Each byte is a value: 0 = no prediction, 1..255 = lo + (b-1)/254·(hi-lo)
 * (linear maps) or class + 1 (hotspot maps). Ramps come from fungiData.js in
 * physical units and are converted to byte space here, so the tiles never
 * need re-baking for a colour change.
 */

import { FUNGI_MEASURES } from './fungiData.js'

const SRC = 'systems-fungi-tiles-src'
const LAYER = 'systems-fungi-tiles-layer'
const CLEAR = 'rgba(0,0,0,0)'

function colorExpr(id, enc) {
  const m = FUNGI_MEASURES[id]
  if (enc.enc === 'class') {
    // step: 1 none, 2 richness, 3 rarity, 4 both (class + 1); 0 = masked.
    const c = m.stops.filter((_, i) => i % 2 === 0).map(([, col]) => col)
    return ['step', ['raster-value'], CLEAR, 0.5, c[0], 1.5, c[1], 2.5, c[2], 3.5, c[3]]
  }
  const toByte = (v) => 1 + ((v - enc.lo) / (enc.hi - enc.lo)) * 254
  const expr = ['interpolate', ['linear'], ['raster-value'], 0, CLEAR, 0.99, CLEAR]
  let last = 0.99
  for (const [v, col] of m.stops) {
    const b = Math.min(255, Math.max(1, toByte(v)))
    if (b <= last) continue // stops must strictly increase
    expr.push(b, col)
    last = b
  }
  return expr
}

export class FungiTilesOverlay {
  constructor(map, index, opacity) {
    this.map = map
    this.index = index
    this.opacity = opacity
    this.id = null
    this.visible = true
    this._onStyle = () => { if (this.id) this._add(this.id) }
    map.on('style.load', this._onStyle)
  }

  has(id) { return !!this.index.measures?.[id] }

  _url(id) {
    const enc = this.index.measures[id]
    return `${location.origin}/api/spun-tiles?m=${id}&z={z}&x={x}&y={y}&v=${enc.baked_ms || 0}`
  }

  _maxzoom() { return this.index.maxzoom }

  /** Reads values from the very tiles this overlay draws (null if unbaked). */
  sampler(id) {
    if (!this.has(id) || this.index.measures[id].enc === 'class') return null
    return new TileValueSampler(this._url(id), this._maxzoom(), this.index.measures[id])
  }

  show(id) {
    if (!this.has(id)) return false
    if (id !== this.id || !this.map.getLayer(LAYER)) this._add(id)
    return true
  }

  _add(id) {
    const map = this.map
    const enc = this.index.measures[id]
    this._remove()
    this.id = id
    try {
      map.addSource(SRC, {
        type: 'raster',
        tiles: [this._url(id)],
        tileSize: 256,
        maxzoom: this._maxzoom(),
        attribution: 'SPUN (Society for the Protection of Underground Networks) · CC BY 4.0',
      })
      // Under the place-name labels, like every other /inmotion wash.
      let labelsId
      try { labelsId = map.getStyle().layers.find((l) => l.type === 'symbol')?.id } catch { labelsId = undefined }
      map.addLayer({
        id: LAYER,
        type: 'raster',
        source: SRC,
        layout: { visibility: this.visible ? 'visible' : 'none' },
        paint: {
          'raster-opacity': this.opacity,
          // Channel R carries the byte; mix scales it to 0..255.
          'raster-color-mix': [255, 0, 0, 0],
          'raster-color-range': [0, 255],
          'raster-color': colorExpr(id, enc),
          // Hotspot classes must never blend into a neighbouring class.
          'raster-resampling': enc.enc === 'class' ? 'nearest' : 'linear',
          'raster-fade-duration': 0,
        },
      }, labelsId)
    } catch (err) {
      console.warn('[systems] fungi tiles failed:', err)
    }
  }

  setVisible(v) {
    this.visible = v
    try { if (this.map.getLayer(LAYER)) this.map.setLayoutProperty(LAYER, 'visibility', v ? 'visible' : 'none') } catch { /* style mid-swap */ }
  }

  _remove() {
    try {
      if (this.map.getLayer(LAYER)) this.map.removeLayer(LAYER)
      if (this.map.getSource(SRC)) this.map.removeSource(SRC)
    } catch { /* style gone */ }
  }

  destroy() {
    this.map.off('style.load', this._onStyle)
    this._remove()
    this.id = null
  }
}

/**
 * Values at lng/lat from the same tiles the overlay paints, so anything drawn
 * from them (the living threads) appears exactly where the colour does:
 * never over water, never on ground too sparse to be tinted. Tiles share the
 * overlay's URLs, so they usually come straight from the browser cache.
 */
export class TileValueSampler {
  constructor(template, maxzoom, enc) {
    this.template = template
    this.maxzoom = maxzoom
    this.lo = enc.lo
    this.hi = enc.hi
    this.z = 0
    this.tiles = new Map() // "z/x/y" → Uint8Array(256²) | 'loading' | null (failed)
  }

  /** Fetch the tiles covering the current view, at the zoom Mapbox draws. */
  prepare(map) {
    // 256 px tiles on Mapbox's 512 px zoom scale: one level finer than the map.
    const z = Math.max(0, Math.min(this.maxzoom, Math.floor(map.getZoom()) + 1))
    this.z = z
    const n = 2 ** z
    let xs = []
    let y0 = 0
    let y1 = n - 1
    const b = z > 2 ? map.getBounds() : null
    if (b) {
      const tx = (lng) => Math.floor((((lng + 180) / 360) % 1 + 1) % 1 * n)
      const x0 = tx(b.getWest())
      const x1 = tx(b.getEast())
      for (let x = x0; ; x = (x + 1) % n) { xs.push(x); if (x === x1 || xs.length >= n) break }
      y0 = Math.max(0, this._ty(b.getNorth(), n))
      y1 = Math.min(n - 1, this._ty(b.getSouth(), n))
    } else {
      xs = Array.from({ length: n }, (_, i) => i)
    }
    if (xs.length * (y1 - y0 + 1) > 160) return // too many to be worth it; seeding falls back
    for (const x of xs) for (let y = y0; y <= y1; y++) this._load(z, x, y)
    if (this.tiles.size > 400) {
      for (const k of this.tiles.keys()) { if (!k.startsWith(`${z}/`)) this.tiles.delete(k); if (this.tiles.size <= 200) break }
    }
  }

  _ty(lat, n) {
    const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  }

  _load(z, x, y) {
    const key = `${z}/${x}/${y}`
    if (this.tiles.has(key)) return
    this.tiles.set(key, 'loading')
    const url = this.template.replace('{z}', z).replace('{x}', x).replace('{y}', y)
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.blob() })
      .then((blob) => createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
      .then((bmp) => {
        const c = new OffscreenCanvas(256, 256)
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(bmp, 0, 0, 256, 256) // the 1×1 empty tile stretches to all-zero
        const px = ctx.getImageData(0, 0, 256, 256).data
        const v = new Uint8Array(256 * 256)
        for (let i = 0; i < v.length; i++) v[i] = px[i * 4 + 3] ? px[i * 4] : 0
        this.tiles.set(key, v)
      })
      .catch(() => this.tiles.set(key, null))
  }

  /** Value at lng/lat; null where nothing is drawn or the tile isn't in yet. */
  value(lng, lat) {
    const n = 2 ** this.z
    const xf = ((((lng + 180) / 360) % 1 + 1) % 1) * n
    const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180
    const yf = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
    const tx = Math.floor(xf)
    const ty = Math.floor(yf)
    const t = this.tiles.get(`${this.z}/${tx}/${ty}`)
    if (!t || t === 'loading') return null
    const b = t[Math.min(255, Math.floor((yf - ty) * 256)) * 256 + Math.min(255, Math.floor((xf - tx) * 256))]
    return b ? this.lo + ((b - 1) / 254) * (this.hi - this.lo) : null
  }
}
