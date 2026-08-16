/**
 * popupSheet — drag-to-extend for mobile Mapbox popups.
 *
 * On phones (≤600px) index.css renders every Mapbox popup as a full-width
 * bottom sheet capped at a default height. This module injects a grab handle
 * into each popup as it opens and lets the user drag the sheet taller (up to
 * ~85% of the screen) to read long content, or shorter to see more map.
 *
 * It works on plain DOM because popup bodies come from `setHTML()` strings,
 * not React. The dragged height is written to the `--popup-sheet-h` CSS
 * variable on `.mapboxgl-popup-content`; index.css uses it as the sheet's
 * max-height (and tool modules inherit it where they need to).
 *
 * Call `installPopupSheet()` once per app — repeat calls are no-ops.
 */

const MOBILE_QUERY = '(max-width: 600px)'
const MIN_HEIGHT = 140
const MAX_VIEWPORT_FRACTION = 0.85

function attachHandle(content) {
  if (content.querySelector('.ea-popup-grab')) return

  const grab = document.createElement('div')
  grab.className = 'ea-popup-grab'
  grab.innerHTML = '<span class="ea-popup-grab-bar"></span>'
  content.prepend(grab)

  let drag = null
  grab.addEventListener('pointerdown', (e) => {
    drag = { startY: e.clientY, startH: content.getBoundingClientRect().height }
    try { grab.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
  })
  grab.addEventListener('pointermove', (e) => {
    if (!drag) return
    const h = Math.min(
      Math.max(drag.startH + (drag.startY - e.clientY), MIN_HEIGHT),
      window.innerHeight * MAX_VIEWPORT_FRACTION,
    )
    content.style.setProperty('--popup-sheet-h', `${h}px`)
  })
  const end = () => { drag = null }
  grab.addEventListener('pointerup', end)
  grab.addEventListener('pointercancel', end)

  // Mapbox's column-reverse sizing opens bottom-anchored popups scrolled to
  // the bottom — header, verdict and close button all out of view. Pin the
  // sheet to the top on open (and after each setHTML re-render, which lands
  // here again because it wipes and re-adds the handle).
  content.scrollTop = 0
}

let installed = false

export function installPopupSheet() {
  if (installed || typeof window === 'undefined' || !window.MutationObserver) return
  installed = true

  const observer = new MutationObserver((mutations) => {
    if (!window.matchMedia(MOBILE_QUERY).matches) return
    for (const m of mutations) {
      // Popups re-render via setHTML() (e.g. /fire streams results in), which
      // wipes the content's children — including an already-injected handle.
      // Any child change inside a live popup re-attaches it (attachHandle
      // no-ops when the handle survived, so this can't loop).
      const inPopup = m.target.nodeType === 1 && m.target.closest?.('.mapboxgl-popup-content')
      if (inPopup) { attachHandle(inPopup); continue }
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue
        const content = node.classList?.contains('mapboxgl-popup')
          ? node.querySelector('.mapboxgl-popup-content')
          : node.querySelector?.('.mapboxgl-popup .mapboxgl-popup-content')
        if (content) attachHandle(content)
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}
