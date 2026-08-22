/**
 * EventTape — a replay "tape" made of timestamped events (earthquakes) rather
 * than baked frames. Nothing is fetched or baked: the USGS feed already
 * carries 30 days of event times, so the transport bar simply becomes a time
 * cursor. Implements the subset of the TapeField interface ReplayController
 * drives (frames/locate/setTime/ready/prefetch/metaAt).
 */
export class EventTape {
  constructor(events, { stepH = 6, windowDays = 30 } = {}) {
    const step = stepH * 3.6e6
    // The last frame is NOW itself (not a rounded tick), so "Now" means the
    // past 24 h rather than a partial UTC day that may have just begun.
    const end = Date.now()
    const start = end - windowDays * 8.64e7
    this.step_ms = step
    this.index = { step_ms: step }
    this.frames = []
    for (let t = start; t < end; t += step) this.frames.push({ valid_ms: t, run_ms: t, lead_h: 0, live: false })
    this.frames.push({ valid_ms: end, run_ms: end, lead_h: 0, live: true })
    this.events = events
    this.t = end
  }
  get start_ms() { return this.frames[0].valid_ms }
  get end_ms() { return this.frames[this.frames.length - 1].valid_ms }
  setTime(t) { this.t = Math.max(this.start_ms, Math.min(this.end_ms, t)) }
  locate(t = this.t) {
    const i = Math.max(0, Math.min(this.frames.length - 1, Math.floor((t - this.start_ms) / this.step_ms)))
    const j = Math.min(this.frames.length - 1, i + 1)
    const mix = j === i ? 0 : (t - this.frames[i].valid_ms) / this.step_ms
    return { i, j, mix }
  }
  ready() { return true }
  prefetch() {}
  get useFlow() { return false }
  metaAt(t = this.t) {
    return { valid_ms: t, run_ms: t, lead_h: 0, live: t >= this.end_ms - 1, frame_kind: 'USGS catalogue', tape: true, event: true, dayLabel: true }
  }
  /** Events that have happened by time t (the cursor). */
  countAt(t = this.t) { return this.events.reduce((n, e) => n + (e.time <= t ? 1 : 0), 0) }
}
