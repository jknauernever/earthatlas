/**
 * WebGL renderer for tape playback: one full-world web-mercator image per
 * tick, produced by warping the two bracketing frames along their optical
 * flow and blending — so between 3-hourly analyses the haze MOVES rather
 * than dissolves. The canvas is the Mapbox canvas-source (preserveDrawingBuffer
 * so Mapbox can read it whenever it renders).
 *
 * Textures: A, B — byte grids (LUMINANCE; every grid is non-power-of-two, so
 * WebGL1 allows only CLAMP_TO_EDGE — the shader wraps longitude itself);
 * FLOW — coarse displacement encoded in two bytes (±MAXFLOW cells); LUT —
 * 256×1 RGBA ramp; MASK (optional) — 0.1° land raster for water-only layers.
 */

const VS = `
attribute vec2 a;
varying vec2 v;
void main(){ v = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }
`
const FS = `
precision highp float;
varying vec2 v;
uniform sampler2D uA, uB, uFlow, uLut, uMask;
uniform float uMix, uHasB, uHasMask, uFlowCells;
uniform vec2 uFlowScale;
uniform vec4 uGrid;     // lat0, dLat, lon0, dLon (degrees)
uniform vec2 uN;        // nLon, nLat
uniform vec2 uLutRange; // min, max in value units
uniform float uQ;       // byte = (value - offset) * q
uniform float uOffset;  // value offset (see tape index)
uniform float uNodata0; // 1 when byte 0 means NO DATA (ocean-only layers)
const float PI = 3.14159265358979;
// Bilinear by hand: frame grids are non-power-of-two and WebGL1 samples NPOT
// textures only with CLAMP_TO_EDGE (REPEAT silently returns black), so the
// longitude wrap happens here. When uNodata0, byte-0 texels are skipped and
// the remaining weights renormalised (no dark/cold rim along coasts).
// Samples land on texel centres, so LINEAR filtering returns exact texels.
// Returns (sum v*w, sum w).
vec2 sampleGrid(sampler2D t, vec2 p) {
  vec2 tc = p * uN - 0.5;
  vec2 b0 = floor(tc);
  vec2 f = tc - b0;
  float s = 0.0;
  float w = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 c = vec2(float(k - (k / 2) * 2), float(k / 2));
    float wt = (c.x > 0.5 ? f.x : 1.0 - f.x) * (c.y > 0.5 ? f.y : 1.0 - f.y);
    vec2 q = b0 + c;
    q.x = mod(q.x, uN.x);
    q.y = clamp(q.y, 0.0, uN.y - 1.0);
    float val = texture2D(t, (q + 0.5) / uN).r;
    if (uNodata0 < 0.5 || val > 0.5 / 255.0) { s += val * wt; w += wt; }
  }
  return vec2(s, w);
}
void main(){
  // Mercator pixel -> lng/lat (image spans lat +-85.0511, lng -180..180; row 0 = north).
  float lng = -180.0 + 360.0 * v.x;
  float my = PI * (2.0 * v.y - 1.0);
  float lat = degrees(atan(0.5 * (exp(my) - exp(-my)))); // sinh: GLSL ES 1.0 has none
  if (uHasMask > 0.5) {
    float m = texture2D(uMask, vec2((lng + 180.0) / 360.0, (90.0 - lat) / 180.0)).r;
    if (m > 0.5) discard;
  }
  // Grid coords (cells), then texture coords with texel-centre alignment.
  float col = mod(lng - uGrid.z, 360.0) / uGrid.w;
  float row = (lat - uGrid.x) / uGrid.y;
  if (row < -0.5 || row > uN.y - 0.5) discard;
  vec2 p = vec2((col + 0.5) / uN.x, (row + 0.5) / uN.y);
  vec2 f = (texture2D(uFlow, p).ra - 0.5) * 2.0 * uFlowCells; // coarse cells, A->B
  vec2 d = f * uFlowScale;                                    // -> texture units
  vec2 sa = sampleGrid(uA, p - d * uMix);
  vec2 sb = (uHasB > 0.5) ? sampleGrid(uB, p + d * (1.0 - uMix)) : sa;
  // A warped sample that lands on no-data (coasts, ice edge) falls back to
  // the unwarped one — otherwise the flow punches mix-dependent notches
  // along every coastline.
  if (sa.y < 0.05) sa = sampleGrid(uA, p);
  if (uHasB > 0.5 && sb.y < 0.05) sb = sampleGrid(uB, p);
  if (sa.y < 0.05 && sb.y < 0.05) discard; // nothing valid nearby (ocean tapes over land/ice)
  float a = sa.y < 0.05 ? sb.x / sb.y : sa.x / sa.y;
  float b = sb.y < 0.05 ? a : sb.x / sb.y;
  float val = mix(a, b, uMix) * 255.0 / uQ + uOffset;
  float li = clamp((val - uLutRange.x) / (uLutRange.y - uLutRange.x), 0.0, 1.0);
  vec4 c = texture2D(uLut, vec2(li, 0.5));
  gl_FragColor = vec4(c.rgb * c.a, c.a); // premultiplied for the canvas source
}
`

const MAXFLOW = 4 // coarse cells encoded per byte range

export class TapeWarpGL {
  constructor(size) {
    this.size = size
    this.canvas = document.createElement('canvas')
    this.canvas.width = size
    this.canvas.height = size
    const gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: true, antialias: false, alpha: true })
    if (!gl) throw new Error('webgl unavailable')
    this.gl = gl
    const sh = (type, src) => {
      const s = gl.createShader(type)
      gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
      return s
    }
    const prog = gl.createProgram()
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
    gl.useProgram(prog)
    this.prog = prog
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'a')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    this.u = {}
    for (const n of ['uA', 'uB', 'uFlow', 'uLut', 'uMask', 'uMix', 'uHasB', 'uHasMask', 'uFlowScale', 'uFlowCells', 'uGrid', 'uN', 'uLutRange', 'uQ', 'uOffset', 'uNodata0']) {
      this.u[n] = gl.getUniformLocation(prog, n)
    }
    gl.uniform1i(this.u.uA, 0); gl.uniform1i(this.u.uB, 1); gl.uniform1i(this.u.uFlow, 2); gl.uniform1i(this.u.uLut, 3); gl.uniform1i(this.u.uMask, 4)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    this._tex = new Map()     // key → texture (frames, flows)
    this._lutTex = null
    this._lutKey = null
    this._maskTex = null
    this._maskKey = null
  }

  _texture(key, make) {
    let t = this._tex.get(key)
    if (t) return t
    const gl = this.gl
    t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    make(gl)
    this._tex.set(key, t)
    return t
  }

  frameTexture(key, bytes, w, h) {
    return this._texture(`f:${key}`, (gl) => {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    })
  }

  flowTexture(key, flow) {
    return this._texture(`w:${key}`, (gl) => {
      const n = flow.W * flow.H
      const enc = new Uint8Array(n * 2)
      for (let k = 0; k < n; k++) {
        enc[k * 2] = Math.max(0, Math.min(255, Math.round((flow.fx[k] / MAXFLOW * 0.5 + 0.5) * 255)))
        enc[k * 2 + 1] = Math.max(0, Math.min(255, Math.round((flow.fy[k] / MAXFLOW * 0.5 + 0.5) * 255)))
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, flow.W, flow.H, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, enc)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    })
  }

  _zeroFlow() {
    return this._texture('w:zero', (gl) => {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, 1, 1, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128]))
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    })
  }

  setLut(lut, key) {
    if (this._lutKey === key) return
    const gl = this.gl
    if (!this._lutTex) this._lutTex = gl.createTexture()
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, this._lutTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lut.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(lut.buffer))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this._lutKey = key
  }

  /** bits: packed 0.1° land raster (3600×1800, 1 = land) or null. */
  setMask(bits) {
    const gl = this.gl
    if (!bits) { this._maskKey = null; return }
    if (this._maskKey === bits) return
    if (!this._maskTex) this._maskTex = gl.createTexture()
    const w = 3600, h = 1800
    const px = new Uint8Array(w * h)
    for (let k = 0; k < w * h; k++) px[k] = bits[k >> 3] & (0x80 >> (k & 7)) ? 255 : 0 // MSB-first, as landMask.isLand
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, this._maskTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, px)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this._maskKey = bits
  }

  /**
   * Draw one tick. meta: grid geometry + scale (qscale) + offset/nodata0; texA/texB frame
   * textures; flowTex or null; mix in [0,1]; lut range [min,max].
   */
  // Bounded cache, evicted AFTER a draw and never touching the textures that
  // draw used — deleting a bound texture mid-loop painted black frames once
  // the cache filled (i.e. from the second run-through on).
  _evict(keep) {
    const gl = this.gl
    const MAX = 160 // ~400 KB each; a year of weekly frames + flows fits
    for (const key of this._tex.keys()) {
      if (this._tex.size <= MAX) break
      if (keep.has(key) || key === 'w:zero') continue
      gl.deleteTexture(this._tex.get(key)); this._tex.delete(key)
    }
  }

  draw({ meta, texA, texB, flowTex, flowDs, mix, min, max }) {
    const gl = this.gl
    gl.viewport(0, 0, this.size, this.size)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texA)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texB || texA)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, flowTex || this._zeroFlow())
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this._lutTex)
    if (this._maskTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this._maskTex) }
    gl.uniform1f(this.u.uMix, texB ? mix : 0)
    gl.uniform1f(this.u.uHasB, texB ? 1 : 0)
    gl.uniform1f(this.u.uHasMask, this._maskKey ? 1 : 0)
    // coarse cells → texture units: ds grid cells per coarse cell, / n
    gl.uniform2f(this.u.uFlowScale, flowTex ? flowDs / meta.nLon : 0, flowTex ? flowDs / meta.nLat : 0)
    gl.uniform1f(this.u.uFlowCells, MAXFLOW)
    gl.uniform4f(this.u.uGrid, meta.lat0, meta.dLat, meta.lon0, meta.dLon)
    gl.uniform2f(this.u.uN, meta.nLon, meta.nLat)
    gl.uniform2f(this.u.uLutRange, min, max)
    gl.uniform1f(this.u.uQ, meta.scale)
    gl.uniform1f(this.u.uOffset, meta.offset || 0)
    gl.uniform1f(this.u.uNodata0, meta.nodata0 ? 1 : 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    const keep = new Set()
    for (const [k, t] of this._tex) if (t === texA || t === texB || t === flowTex) keep.add(k)
    this._evict(keep)
  }

  destroy() {
    const gl = this.gl
    for (const t of this._tex.values()) gl.deleteTexture(t)
    this._tex.clear()
    if (this._lutTex) gl.deleteTexture(this._lutTex)
    if (this._maskTex) gl.deleteTexture(this._maskTex)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
