/**
 * Mapbox GL JS v3 requires WebGL2, and its Map constructor throws an
 * unhandled "Failed to initialize WebGL." on any browser that can't create
 * a context — in practice mostly headless crawlers (Googlebot renders
 * pages without a GPU), but also real users on old devices or blacklisted
 * GPU drivers. Probe support once up front so map components can render a
 * graceful fallback instead of crashing.
 */

let supported = null

export function isWebGLSupported() {
  if (supported !== null) return supported
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    supported = !!gl
    if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    supported = false
  }
  return supported
}

// Renders a plain-DOM notice inside the (otherwise empty) map container.
// Imperative on purpose: it lets every map component share one guard line
// without threading extra state through 13 different render trees, and
// React never reconciles a map container's children (Mapbox owns them).
function showWebGLFallback(container) {
  if (!container || container.querySelector('[data-webgl-fallback]')) return
  const el = document.createElement('div')
  el.dataset.webglFallback = 'true'
  el.style.cssText = [
    'display:flex', 'flex-direction:column', 'align-items:center',
    'justify-content:center', 'height:100%', 'min-height:240px',
    'padding:24px', 'text-align:center', 'gap:8px',
    'color:#4a463f', 'background:#f2f0eb',
    'font:14px/1.5 system-ui,-apple-system,sans-serif',
  ].join(';')
  const title = document.createElement('strong')
  title.textContent = 'Interactive map unavailable'
  const body = document.createElement('span')
  body.textContent =
    'Your browser doesn’t support WebGL2, which this map requires. ' +
    'Try updating your browser or enabling hardware acceleration.'
  el.append(title, body)
  container.appendChild(el)
}

/**
 * Call at the top of a map-init effect, before `new mapboxgl.Map(...)`.
 * Returns true when it's safe to construct the map; otherwise shows the
 * fallback notice in the container and returns false.
 */
export function ensureWebGLSupport(container) {
  if (isWebGLSupported()) return true
  showWebGLFallback(container)
  return false
}
