/**
 * A time-varying vector field read from a history tape — the "vector tape"
 * for /systems. The tape's frames are RGB: R is the layer's own scalar (what
 * the wash draws), G and B are u and v (`extra_bands` in the tape index, see
 * bakeTapeDay). One file per frame, so the three can never be out of step.
 *
 * `sample()` has the GridField shape ParticleLayer expects, so the particle
 * renderer that draws wind draws whatever the tape carries. Bird migration
 * uses it: streaks fly the radar-observed heading, colored by how many birds
 * are crossing, and only where enough are crossing for the heading to mean
 * something (`minValue`).
 *
 * sample() runs a few thousand times per resample, several times a second —
 * it reads the byte planes directly and allocates nothing but its result.
 */
export class TapeVectorField {
  /** opts: { tape: TapeField with extra_bands [u, v], toValue?: raw → display units, minValue?: number } */
  constructor({ tape, toValue, minValue = 0 }) {
    if (!tape.extraBands || tape.extraBands.length < 2) throw new Error('tape has no u/v bands')
    this.tape = tape
    this._toValue = toValue || ((x) => x)
    this._min = minValue
    this._out = { u: 0, v: 0, speed: 0, colorValue: 0 }
    this._s = [0, 0, 0] // scratch: R, G, B at one point of one frame
  }

  /** Are the frames for the tape's current cursor decoded? */
  ready() {
    const { i, j } = this.tape.locate()
    return this.tape._extra.has(i) && this.tape._extra.has(j)
  }

  // Bilinear read of all three planes of frame `fi` at (rf, cf) into this._s.
  // Byte 0 = missing (weights renormalised); false when nothing valid is near.
  _read(fi, r0, c0, c1, fr, fc) {
    const tape = this.tape
    const R = tape._bytes.get(fi)
    const X = tape._extra.get(fi)
    if (!R || !X) return false
    const nLon = tape.meta.nLon
    const o0 = r0 * nLon, o1 = o0 + nLon
    let sr = 0, sg = 0, sb = 0, ws = 0
    for (let k = 0; k < 4; k++) {
      const idx = (k < 2 ? o0 : o1) + (k & 1 ? c1 : c0)
      const byte = R[idx]
      if (byte === 0) continue
      const w = (k < 2 ? 1 - fr : fr) * (k & 1 ? fc : 1 - fc)
      sr += byte * w; sg += X[0][idx] * w; sb += X[1][idx] * w; ws += w
    }
    if (ws < 0.05) return false
    const s = this._s
    s[0] = sr / ws; s[1] = sg / ws; s[2] = sb / ws
    return true
  }

  sample(lng, lat) {
    const tape = this.tape
    const m = tape.meta
    const rf0 = (lat - m.lat0) / m.dLat
    if (!(rf0 >= -0.5 && rf0 <= m.nLat - 0.5)) return null
    let cf = ((((lng - m.lon0) % 360) + 360) % 360) / m.dLon
    // Regional grid: outside the box is "not covered", never a wrap.
    if (m.nLon * m.dLon < 359 && cf > m.nLon - 0.5) {
      cf -= 360 / m.dLon
      if (cf < -0.5) return null
      if (cf < 0) cf = 0
    }
    const rf = Math.min(m.nLat - 1, Math.max(0, rf0))
    const r0 = Math.min(m.nLat - 2, Math.floor(rf))
    const fr = rf - r0
    const cfc = Math.min(m.nLon - 1, cf)
    const c0 = Math.min(m.nLon - 2, Math.floor(cfc))
    const c1 = c0 + 1
    const fc = cfc - c0

    if (tape.t !== this._locT) { this._loc = tape.locate(); this._locT = tape.t } // once per cursor move, not per node
    const { i, j, mix } = this._loc
    if (!this._read(i, r0, c0, c1, fr, fc)) return null
    let raw = this._s[0], gu = this._s[1], gv = this._s[2]
    if (j !== i && mix > 0 && this._read(j, r0, c0, c1, fr, fc)) {
      raw += (this._s[0] - raw) * mix; gu += (this._s[1] - gu) * mix; gv += (this._s[2] - gv) * mix
    }
    const value = this._toValue(raw / m.scale + m.offset)
    if (value < this._min) return null
    const [bu, bv] = tape.extraBands
    const out = this._out
    out.u = gu / bu.qscale + bu.offset
    out.v = gv / bv.qscale + bv.offset
    out.speed = Math.hypot(out.u, out.v)
    out.colorValue = value
    return out
  }
}
