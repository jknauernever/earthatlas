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

/**
 * Options:
 *   topReserve     px at the top of the map kept for the site's own controls (default 64).
 *   bottomReserve  px at the bottom of the map kept clear, e.g. a docked bar over the map (default 0 = the whole height,
 *                  exactly the old behaviour). A number, or a function returning one (read at every fit, so a bar
 *                  that appears, grows or goes away later is honoured).
 */
export function fitPopupToMap(popup, opts = {}) {
  const { topReserve = 64, bottomReserve = 0, pan = true } = opts
  const el = popup.getElement()
  const scroller = el?.querySelector('.mapboxgl-popup-content > div')
  const mapEl = el?.closest('.mapboxgl-map')
  if (!el || !scroller || !mapEl) return
  if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 600px)').matches) return
  const mapRect = mapEl.getBoundingClientRect()
  let pt
  try { pt = popup._map.project(popup.getLngLat()) } catch { return }
  // The top of the map belongs to each site's own controls (search, Explain, cues): cards stop short of it.
  // bottomReserve does the same for anything docked along the bottom (Explore's month bar).
  let bottom = typeof bottomReserve === 'function' ? bottomReserve() : bottomReserve
  bottom = Number.isFinite(bottom) && bottom > 0 ? bottom : 0
  const down = mapRect.height - bottom - pt.y - TIP - PAD
  const up = pt.y - topReserve - TIP - PAD
  // 75% of the free map, but short maps (Explore's ~380 px above its month bar) may use all but 60 px of it,
  // up to 340 px, so a normal card still fits whole.
  const usable = mapRect.height - bottom
  const ceiling = Math.floor(Math.max(usable * 0.75, Math.min(usable - 60, 340)))
  // What the card wants: its full content, up to the ceiling (scrollHeight ignores any max-height set by a prior fit).
  const need = Math.min(ceiling, scroller.scrollHeight)
  const cur = ([...el.classList].find((c) => c.startsWith('mapboxgl-popup-anchor-')) || '').replace('mapboxgl-popup-anchor-', '')
  const curVert = cur.startsWith('top') ? 'top' : cur.startsWith('bottom') ? 'bottom' : null
  // Stay put only if the current side already offers all the card could use.
  const want = curVert && (curVert === 'top' ? down : up) >= need ? curVert : (down >= up ? 'top' : 'bottom')
  if (want !== curVert) {
    // Keep Mapbox's horizontal choice (edge clicks shift the card sideways).
    const horiz = cur.includes('-left') ? '-left' : cur.includes('-right') ? '-right' : ''
    popup.options.anchor = want + horiz
    try { popup.setLngLat(popup.getLngLat()) } catch { return } // re-lays out with the new anchor
  }
  const room = want === 'top' ? down : up
  // Neither side has room for the card (short maps, a click mid-map, a docked bar): slide the map so the clicked
  // point moves toward the far edge and the card gets the room it needs, instead of squeezing it to a sliver.
  // Once per fit cycle; the re-fit after the pan never pans again.
  if (pan && room < need - 4 && !popup._eaFitPanning) {
    const minY = topReserve + 12
    const maxY = mapRect.height - bottom - 12
    const target = want === 'top'
      ? Math.max(minY, mapRect.height - bottom - TIP - PAD - need)
      : Math.min(maxY, topReserve + TIP + PAD + need)
    const dy = Math.round(pt.y - target)
    if (Math.abs(dy) > 8) {
      const map = popup._map
      popup._eaFitPanning = true
      map.once('moveend', () => {
        popup._eaFitPanning = false
        if (popup.isOpen()) fitPopupToMap(popup, { ...opts, pan: false })
      })
      map.panBy([0, dy], { duration: 300 })
    }
  }
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
