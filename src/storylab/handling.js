/**
 * Globe handling for Story Lab (brief: rotation, zoom and tilt must be smooth
 * and fine-grained with mouse, trackpad and touch, with sensible zoom limits
 * and inertia). Applied to the shared engine's Mapbox map once it is ready;
 * /inmotion keeps Mapbox's defaults.
 *
 * Mapbox defaults, for comparison: wheel 1/450, trackpad 1/100, drag
 * inertia linearity 0.3 / deceleration 2500 / maxSpeed 1400, zoom 0–22.
 */

export const HANDLING = {
  minZoom: 1.1,       // the whole globe with room around it, never a speck
  maxZoom: 11,        // past this the 0.25–0.5° data is one blurred cell per screen
  maxPitch: 60,
  wheelZoomRate: 1 / 650,   // mouse wheel: smaller steps per notch
  trackpadZoomRate: 1 / 160, // trackpad pinch / two-finger scroll: finer
  dragPan: { linearity: 0.22, easing: (t) => 1 - Math.pow(1 - t, 3), deceleration: 1800, maxSpeed: 1200 },
}

export function tuneHandling(map, phone = false) {
  if (!map) return
  try {
    map.setMinZoom(phone ? 0.5 : HANDLING.minZoom)
    map.setMaxZoom(HANDLING.maxZoom)
    map.setMaxPitch(HANDLING.maxPitch)
    map.scrollZoom.setWheelZoomRate(HANDLING.wheelZoomRate)
    map.scrollZoom.setZoomRate(HANDLING.trackpadZoomRate)
    // Re-enable drag-pan with gentler, longer inertia (a flick coasts, then settles).
    map.dragPan.disable()
    map.dragPan.enable(HANDLING.dragPan)
    // Right-drag / ctrl-drag rotates and tilts; two fingers rotate, pinch and tilt on touch.
    map.dragRotate.enable()
    map.touchZoomRotate.enable()
    map.touchZoomRotate.enableRotation()
    map.touchPitch.enable()
    map.keyboard.enable()
    map.doubleClickZoom.enable()
  } catch (err) {
    console.warn('[storylab] handling tune failed', err)
  }
}
