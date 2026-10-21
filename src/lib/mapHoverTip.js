/**
 * Hover readout for map items: a small non-interactive card that follows the pointer over the given layers.
 * Shared so every EarthAtlas map reads the same (every item on the map has a mouseover display).
 *
 *   const off = installHoverTip(map, { layers: ['a', 'b'], html: (features, lngLat) => '<div>…</div>' | null })
 *
 * `html` gets every feature under the pointer (top first) and returns the card's HTML, or null for none.
 * Layers that don't exist yet are skipped, so it can be installed before they are added. No-op on touch screens
 * (no hover there; taps open the item instead). The frame is the shared popup frame (src/index.css, .ea-hover-tip).
 */
import mapboxgl from 'mapbox-gl'

export function installHoverTip(map, { layers, html, offset = 14 }) {
  if (typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches) return () => {}
  const tip = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset, maxWidth: '300px', className: 'ea-hover-tip' })
  let shown = false
  const hide = () => { if (shown) { tip.remove(); shown = false } }
  const onMove = (e) => {
    const live = layers.filter((id) => map.getLayer(id))
    const feats = live.length ? map.queryRenderedFeatures(e.point, { layers: live }) : []
    const body = feats.length ? html(feats, e.lngLat) : null
    if (!body) { hide(); map.getCanvas().style.cursor = ''; return }
    map.getCanvas().style.cursor = 'pointer'
    tip.setLngLat(e.lngLat).setHTML(body)
    if (!shown) { tip.addTo(map); shown = true }
  }
  map.on('mousemove', onMove)
  map.on('mouseout', hide)
  return () => { map.off('mousemove', onMove); map.off('mouseout', hide); hide() }
}
