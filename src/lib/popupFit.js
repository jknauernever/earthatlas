/**
 * Keep a Mapbox popup card on the map and let it use the map — the ONE implementation every EarthAtlas site uses
 * (Josh 2026-09-27: "we've fixed this MULTIPLE times on other sites… REUSE code for the basic infrastructure").
 * Moved here from /inmotion's SystemsApp.jsx, unchanged in behaviour:
 *
 *   Hang the card off whichever side of the click has more room, then cap its height to that room so its content
 *   scrolls inside instead of flowing off the map. Measured from the anchor POINT, never from the card's current box
 *   (the old version measured the side Mapbox had already picked and shrank the card to it, and once shrunk, Mapbox
 *   saw a small card that "fit" and never flipped).
 *
 * The popup's HTML must be ONE wrapper element (`.mapboxgl-popup-content > div`): that element becomes the scroller.
 * `keepPopupOnMap` also re-fits whenever the card's content changes (async detail filling in), so callers need no
 * "popup grew" events. Phones (≤600 px) use the bottom sheet from index.css + popupSheet.js instead; nothing runs there.
 */

const TIP = 10 + 12 // popup offset + arrow
const PAD = 16

export function fitPopupToMap(popup, { topReserve = 64 } = {}) {
  const el = popup.getElement()
  const scroller = el?.querySelector('.mapboxgl-popup-content > div')
  const mapEl = el?.closest('.mapboxgl-map')
  if (!el || !scroller || !mapEl) return
  if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 600px)').matches) return
  const mapRect = mapEl.getBoundingClientRect()
  let pt
  try { pt = popup._map.project(popup.getLngLat()) } catch { return }
  // The top of the map belongs to each site's own controls (search, Explain, cues): cards stop short of it.
  const down = mapRect.height - pt.y - TIP - PAD
  const up = pt.y - topReserve - TIP - PAD
  const ceiling = Math.floor(mapRect.height * 0.75)
  const cur = ([...el.classList].find((c) => c.startsWith('mapboxgl-popup-anchor-')) || '').replace('mapboxgl-popup-anchor-', '')
  const curVert = cur.startsWith('top') ? 'top' : cur.startsWith('bottom') ? 'bottom' : null
  // Stay put only if the current side already offers all the card could use.
  const want = curVert && (curVert === 'top' ? down : up) >= ceiling ? curVert : (down >= up ? 'top' : 'bottom')
  if (want !== curVert) {
    // Keep Mapbox's horizontal choice (edge clicks shift the card sideways).
    const horiz = cur.includes('-left') ? '-left' : cur.includes('-right') ? '-right' : ''
    popup.options.anchor = want + horiz
    try { popup.setLngLat(popup.getLngLat()) } catch { return } // re-lays out with the new anchor
  }
  const room = want === 'top' ? down : up
  scroller.style.maxHeight = `${Math.max(160, Math.min(ceiling, Math.floor(room)))}px`
  scroller.style.overflowY = 'auto'
  scroller.style.overscrollBehavior = 'contain'
}

/** Fit now, and again whenever the card's content changes, until the popup closes. Returns the popup. */
export function keepPopupOnMap(popup, opts) {
  const run = () => fitPopupToMap(popup, opts)
  run()
  // Watch the content box, not the wrapper: setHTML() replaces the wrapper when a card re-renders.
  const content = popup.getElement()?.querySelector('.mapboxgl-popup-content')
  if (content && typeof MutationObserver !== 'undefined') {
    let queued = false
    const mo = new MutationObserver(() => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => { queued = false; run() })
    })
    mo.observe(content, { childList: true, subtree: true, characterData: true })
    popup.once('close', () => mo.disconnect())
  }
  return popup
}
