/**
 * Hover readout for map items: a small non-interactive card that follows the pointer over the given layers.
 * Shared so every EarthAtlas map reads the same (every item on the map has a mouseover display).
 *
 *   const off = installHoverTip(map, { layers: ['a', 'b'], html: (features, lngLat) => '<div>…</div>' | null })
 *
 * `html` gets every feature under the pointer (top first) and returns the card's HTML, or null for none.
 * Or pass `at: (e) => html | null` instead of layers + html, for maps that hit-test themselves (/ships' click pickers,
 * canvas overlays): it gets the mousemove event and is called at most once per animation frame.
 * Layers that don't exist yet are skipped, so it can be installed before they are added. No-op on touch screens
 * (no hover there; taps open the item instead). The frame is the shared popup frame (src/index.css, .ea-hover-tip).
 */
import mapboxgl from 'mapbox-gl'

export function installHoverTip(map, { layers, html, at, offset = 14 }) {
  if (typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches) return () => {}
  const tip = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset, maxWidth: '300px', className: 'ea-hover-tip' })
  let shown = false, raf = 0, last = null
  const hide = () => { if (shown) { tip.remove(); shown = false } }
  const show = (e, body) => {
    if (!body) { hide(); if (!at) map.getCanvas().style.cursor = ''; return }
    if (!at) map.getCanvas().style.cursor = 'pointer'
    tip.setLngLat(e.lngLat).setHTML(body)
    if (!shown) { tip.addTo(map); shown = true }
  }
  const onMove = at
    ? (e) => { last = e; if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (last) show(last, at(last)) }) }
    : (e) => {
      const live = layers.filter((id) => map.getLayer(id))
      const feats = live.length ? map.queryRenderedFeatures(e.point, { layers: live }) : []
      show(e, feats.length ? html(feats, e.lngLat) : null)
    }
  const onOut = () => { last = null; hide() }
  map.on('mousemove', onMove)
  map.on('mouseout', onOut)
  return () => { if (raf) cancelAnimationFrame(raf); map.off('mousemove', onMove); map.off('mouseout', onOut); hide() }
}
