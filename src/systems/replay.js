/**
 * ReplayController — drives a TapeField through time and tells the overlay
 * to redraw. Plain class (no React) so the rAF loop never re-renders the
 * app; the TransportBar subscribes and keeps its own small state.
 *
 * Earth's systems are in motion: a replay-capable layer starts PLAYING the
 * moment it's switched on, loops over its window (default: the last 7 days),
 * and the bar exists to pause / scrub / step / jump to now.
 */

const HOLD_AT_END_MS = 2500
const FRAMES_PER_SEC = 2 // playback: two tape frames per second, whatever the cadence

export class ReplayController {
  /**
   * Pace and window follow the tape's cadence: 2 frames/s (3-hourly → 6 h/s,
   * daily → 2 d/s); default window 7 days for 3-hourly tapes, 31 for daily.
   * opts: { rateHoursPerSec, windowDays } override both.
   */
  constructor(tape, opts = {}) {
    this.tape = tape
    this.overlay = null
    const stepMs = tape.step_ms || 3 * 3.6e6
    this.daily = stepMs >= 23 * 3.6e6
    this.weekly = stepMs >= 6 * 8.64e7
    this.hourly = stepMs <= 1.5 * 3.6e6
    // Hourly tapes carry 8× the frames: play faster and default to a week
    // so a view stays ~17 MB / ~40 s.
    this.rate = opts.rateHoursPerSec ?? (stepMs / 3.6e6) * (this.hourly ? 2 * FRAMES_PER_SEC : FRAMES_PER_SEC)
    this.windowDays = opts.windowDays ?? (this.weekly ? 371 : this.daily ? 31 : this.hourly ? 7 : 14)
    this.playing = true
    this.buffering = false
    this.holding = false
    this.t = this.windowStart
    this._listeners = new Set()
    this._raf = 0
    this._last = 0
    this._holdUntil = 0
    this._destroyed = false
    this.tape.setTime(this.t)
    this.tape.prefetch(this.t, 4)
    this._loop = this._loop.bind(this)
    this._raf = requestAnimationFrame(this._loop)
  }

  get start_ms() { return this.tape.start_ms }
  get end_ms() { return this.tape.end_ms }
  // First archive frame inside the window, so the loop starts ON a frame.
  get windowStart() {
    const lo = this.tape.end_ms - this.windowDays * 8.64e7
    const f = this.tape.frames.find((fr) => fr.valid_ms >= lo)
    return f ? f.valid_ms : this.tape.start_ms
  }
  get atLive() { return this.t >= this.tape.end_ms - 1 }
  get stepMs() { return this.tape.step_ms || 3 * 3.6e6 }
  get tapeDays() { return (this.tape.end_ms - this.tape.start_ms) / 8.64e7 }
  /** Window choices worth offering: only when the tape has ≥2× the frames of the shorter window. */
  get windowOptions() {
    if (this.weekly) return []
    if (this.daily) return this.tapeDays > 8 ? [31] : []
    if (this.tapeDays <= 8) return []
    const per7 = Math.round((7 * 8.64e7) / this.stepMs)
    return this.tape.frames.length >= 2 * per7 ? [7, 14, 31] : []
  }

  attach(overlay) { this.overlay = overlay; this._apply() }
  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn) }
  _emit() { for (const fn of this._listeners) fn(this) }

  _apply() {
    this.tape.setTime(this.t)
    this.t = this.tape.t
    this.overlay?.tick()
  }

  play() { if (this.atLive) this.t = this.windowStart; this.playing = true; this.holding = false; this._holdUntil = 0; this._apply(); this._emit() }
  pause() { this.playing = false; this._emit() }
  toggle() { this.playing ? this.pause() : this.play() }
  seek(t) { this.t = Math.max(this.start_ms, Math.min(this.end_ms, t)); this.holding = false; this._holdUntil = 0; this.tape.prefetch(this.t, 3); this._apply(); this._emit() }
  stepFrames(n) { this.pause(); this.daily ? this._stepSnap(n) : this.seek(this.t + n * this.stepMs) }
  // Daily tapes: a day IS a frame — snap to the adjacent frame stamp (12:00Z)
  // rather than jumping 24 h from wherever t sits between two frames.
  stepDays(n) { this.pause(); this.daily ? this._stepSnap(n) : this.seek(this.t + n * 8.64e7) } // manual steps hold the frame
  _stepSnap(n) {
    const fr = this.tape.frames
    const { i, j, mix } = this.tape.locate(this.t)
    let k = n > 0 ? (mix > 0 ? j : i + 1) : (mix > 0 ? i : i - 1)
    k = Math.max(0, Math.min(fr.length - 1, k))
    this.seek(fr[k].valid_ms)
  }
  toStart() { this.seek(this.windowStart) }
  toLive() { this.pause(); this.seek(this.end_ms) }
  setWindowDays(d) { this.windowDays = d; if (this.t < this.windowStart) this.seek(this.windowStart); else this._emit() }

  _loop(now) {
    if (this._destroyed) return
    this._raf = requestAnimationFrame(this._loop)
    const dt = this._last ? Math.min(100, now - this._last) : 16
    this._last = now
    if (!this.playing || document.hidden) return
    if (now < this._holdUntil) return
    if (this.holding) {
      // Hold over: restart the loop from the window start.
      this.holding = false
      this.t = this.windowStart
      this.tape.prefetch(this.t, 4)
      this._apply(); this._emit()
      return
    }
    const next = this.t + (dt / 1000) * this.rate * 3.6e6
    // Don't advance into frames that aren't decoded yet — buffer instead.
    this.tape.prefetch(next, 5)
    if (!this.tape.ready(Math.min(next, this.end_ms))) {
      if (!this.buffering) { this.buffering = true; this._emit() }
      return
    }
    if (this.buffering) { this.buffering = false }
    if (next >= this.end_ms) {
      // Land on "now", hold there, then (next tick after the hold) loop.
      this.t = this.end_ms
      this.holding = true
      this._holdUntil = now + HOLD_AT_END_MS
      this._apply(); this._emit()
      return
    }
    this.t = next
    this._apply()
    this._emit()
  }

  destroy() {
    this._destroyed = true
    cancelAnimationFrame(this._raf)
    this._listeners.clear()
  }
}
