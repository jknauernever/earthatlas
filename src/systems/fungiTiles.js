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
        tiles: [`${location.origin}/api/spun-tiles?m=${id}&z={z}&x={x}&y={y}&v=${enc.baked_ms || 0}`],
        tileSize: 256,
        maxzoom: this.index.maxzoom,
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
