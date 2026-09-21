/**
 * One answer to "should /inmotion be animating right now?" for every render
 * loop on the page (particles, pings, replay, overlay self-heal).
 *
 * Asleep when the tab is hidden (Page Visibility), or when nothing has
 * happened for IDLE_MS: no pointer/keyboard/wheel/touch input AND no replay
 * advancing (a replay that is still playing its passes counts as activity —
 * someone may be watching it hands-off; it parks itself after three passes,
 * and the idle clock starts then). Loops don't poll this: they stop
 * scheduling frames while asleep and are restarted by `onWake`.
 */

const IDLE_MS = 5 * 60 * 1000

let lastActivity = Date.now()
let awake = typeof document === 'undefined' ? true : !document.hidden
const listeners = new Set()
let idleTimer = 0

function evaluate() {
  const next = !document.hidden && Date.now() - lastActivity < IDLE_MS
  if (next === awake) return
  awake = next
  for (const fn of listeners) fn(awake)
}

function armIdleTimer() {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => { evaluate(); if (awake) armIdleTimer() }, IDLE_MS + 250 - (Date.now() - lastActivity))
}

/** Input happened, or a replay advanced: push the idle deadline out. */
export function noteActivity() {
  lastActivity = Date.now()
  if (!awake) { evaluate(); armIdleTimer() }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) lastActivity = Date.now(); evaluate(); armIdleTimer() })
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(type, noteActivity, { passive: true, capture: true })
  }
  armIdleTimer()
}

export const isAwake = () => awake

/** Subscribe to sleep/wake flips; returns an unsubscribe. */
export function onActivityChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * A requestAnimationFrame loop that only exists while the page is awake:
 * `frame(now)` runs every animation frame; asleep, no frame is scheduled at
 * all (not a scheduled no-op), and waking restarts it. Returns stop().
 */
export function runWhileAwake(frame) {
  let raf = 0
  let stopped = false
  const loop = (now) => {
    raf = 0
    if (stopped || !awake) return
    frame(now)
    if (!stopped && awake && !raf) raf = requestAnimationFrame(loop)
  }
  const kick = () => { if (!stopped && awake && !raf) raf = requestAnimationFrame(loop) }
  const off = onActivityChange(kick)
  kick()
  return () => { stopped = true; off(); cancelAnimationFrame(raf) }
}
