/**
 * Per-view social share cards — client side.
 *
 * The idea: every EarthAtlas map tool round-trips its full view into the URL
 * (docs/MAP_TOOL_CONVENTIONS.md §1), so the address bar IS the share link.
 * To make a plain copy/paste of that URL unfurl with an image of the actual
 * view, the app quietly captures a snapshot whenever the view settles and
 * uploads it keyed by a hash of the canonical URL. When a crawler later
 * fetches any such URL, middleware.js computes the same hash and serves the
 * matching image as og:image. No share button required — though the
 * ShareControl button uses the same machinery to guarantee the card exists
 * the moment a link is shared.
 *
 * Key = SHA-1( pathname + search ) of the URL exactly as the app writes it
 * (the app's own canonical serialization, so client and middleware always
 * agree). Views without query params are skipped — bare routes keep their
 * designed static hero cards.
 */

const DEBOUNCE_MS = 2500
const uploaded = new Set() // ids confirmed present this session
let timer = 0
let inflight = null

export async function viewCardId(key = window.location.pathname + window.location.search) {
  const bytes = new TextEncoder().encode(key)
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function uploadCard(capture) {
  if (!window.location.search) return // bare route → designed hero card
  if (document.hidden) return // hidden tabs render blank canvases
  const key = window.location.pathname + window.location.search
  const id = await viewCardId(key)
  if (uploaded.has(id)) return
  try {
    const check = await fetch(`/api/share-card?id=${id}&check=1`)
    if (check.ok && (await check.json()).exists) { uploaded.add(id); return }
    const blob = await capture()
    if (!blob) return
    // The view may have changed while capturing — only upload if it still matches.
    if (window.location.pathname + window.location.search !== key) return
    const res = await fetch(`/api/share-card?id=${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
    })
    if (res.ok) uploaded.add(id)
  } catch { /* share cards are best-effort — the link itself always works */ }
}

/** Debounced auto-upload; call whenever shareable view state settles. */
export function scheduleViewCard(capture) {
  clearTimeout(timer)
  timer = setTimeout(() => { inflight = uploadCard(capture) }, DEBOUNCE_MS)
}

/** Immediate upload (Share button) — awaits any in-flight auto-upload first. */
export async function ensureViewCard(capture) {
  clearTimeout(timer)
  if (inflight) await inflight.catch(() => {})
  inflight = uploadCard(capture)
  return inflight
}

// ─── Generic capture for standard Mapbox tools ──────────────────────────────
// Draws the map's WebGL canvas (which includes all in-style layers) into a
// 1920×1080 center cover-crop. Must read inside a 'render' callback — the
// drawing buffer is cleared after compositing. Tools with their own overlay
// canvases (/inmotion) pass a richer capture instead (see clipRecorder.js).
export function captureMapImage(map, quality = 0.82) {
  return new Promise((resolve) => {
    map.once('render', () => {
      try {
        const src = map.getCanvas()
        const vw = src.clientWidth
        const vh = src.clientHeight
        const out = document.createElement('canvas')
        out.width = 1920
        out.height = 1080
        const ctx = out.getContext('2d')
        const aspect = out.width / out.height
        let cw = vw, ch = vh
        if (vw / vh > aspect) cw = vh * aspect
        else ch = vw / aspect
        const k = out.width / cw
        ctx.setTransform(k, 0, 0, k, -((vw - cw) / 2) * k, -((vh - ch) / 2) * k)
        ctx.scale(vw / src.width, vh / src.height)
        ctx.drawImage(src, 0, 0)
        out.toBlob(resolve, 'image/jpeg', quality)
      } catch { resolve(null) }
    })
    map.triggerRepaint()
  })
}
