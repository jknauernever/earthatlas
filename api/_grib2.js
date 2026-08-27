/**
 * Minimal GRIB2 reader for NOAA HRRR fields — clean-room, only what the
 * smoke bake needs:
 *   • section walker over one byte-ranged GRIB2 message (via .idx offsets)
 *   • data representation templates 5.0 (simple) and 5.2/5.3 (complex
 *     packing, optionally with spatial differencing — what HRRR uses)
 *   • grid definition template 30 (Lambert conformal) + forward projection,
 *     so a regular lat/lon output grid can sample the native 3 km grid
 *
 * No missing-value management support (HRRR 2-D fields don't use it) — the
 * decoder throws rather than guess. Verified against the same file's 2 m
 * temperature field, whose values are independently checkable.
 */

// GRIB signed ints are sign-magnitude: high bit = negative flag.
const signMag16 = (u) => (u & 0x8000 ? -(u & 0x7fff) : u)
const signMagBytes = (buf, off, n) => {
  let v = buf[off] & 0x7f
  for (let i = 1; i < n; i++) v = v * 256 + buf[off + i]
  return buf[off] & 0x80 ? -v : v
}

class BitReader {
  constructor(buf, byteOff) {
    this.buf = buf
    this.pos = byteOff * 8
  }
  read(nbits) {
    if (nbits === 0) return 0
    let v = 0
    let left = nbits
    while (left > 0) {
      const byte = this.buf[this.pos >> 3]
      const bitInByte = this.pos & 7
      const take = Math.min(8 - bitInByte, left)
      v = v * (1 << take) + ((byte >> (8 - bitInByte - take)) & ((1 << take) - 1))
      this.pos += take
      left -= take
    }
    return v
  }
  alignByte() { this.pos = (this.pos + 7) & ~7 }
  get byteOffset() { return this.pos >> 3 }
}

/** Walk one GRIB2 message into its sections (num → {off, len}). */
export function gribSections(buf) {
  if (buf.toString('ascii', 0, 4) !== 'GRIB') throw new Error('not a GRIB2 message')
  const sections = {}
  let off = 16
  while (off < buf.length - 4) {
    if (buf.toString('ascii', off, off + 4) === '7777') break
    const len = buf.readUInt32BE(off)
    const num = buf[off + 4]
    sections[num] = { off, len }
    off += len
  }
  for (const need of [3, 5, 7]) if (!sections[need]) throw new Error(`GRIB2 section ${need} missing`)
  return sections
}

/** Lambert-conformal grid parameters from grid definition template 30. */
export function gribLambertGrid(buf, sections) {
  const o = sections[3].off
  const tmpl = buf.readUInt16BE(o + 12)
  if (tmpl !== 30) throw new Error(`grid template ${tmpl}, expected 30 (Lambert)`)
  const shape = buf[o + 14]
  // HRRR uses a sphere of radius 6371229 m (shape code 6).
  const radius = shape === 6 ? 6371229 : shape === 0 ? 6367470 : null
  if (radius == null) throw new Error(`unsupported earth shape ${shape}`)
  return {
    radius,
    nx: buf.readUInt32BE(o + 30),
    ny: buf.readUInt32BE(o + 34),
    la1: buf.readInt32BE(o + 38) / 1e6,
    lo1: buf.readInt32BE(o + 42) / 1e6,
    lov: buf.readInt32BE(o + 51) / 1e6,
    dx: buf.readUInt32BE(o + 55) / 1e3,
    dy: buf.readUInt32BE(o + 59) / 1e3,
    latin1: buf.readInt32BE(o + 65) / 1e6,
    latin2: buf.readInt32BE(o + 69) / 1e6,
    scan: buf[o + 71],
  }
}

/** Forward Lambert projection factory: (lat, lng in degrees) → {i, j}. */
export function lambertProjector(g) {
  const rad = Math.PI / 180
  const lat1 = g.latin1 * rad
  const lat2 = g.latin2 * rad
  const n = Math.abs(g.latin1 - g.latin2) < 1e-9
    ? Math.sin(lat1)
    : Math.log(Math.cos(lat1) / Math.cos(lat2)) /
      Math.log(Math.tan(Math.PI / 4 + lat2 / 2) / Math.tan(Math.PI / 4 + lat1 / 2))
  const F = (Math.cos(lat1) * Math.pow(Math.tan(Math.PI / 4 + lat1 / 2), n)) / n
  const rho = (latRad) => (g.radius * F) / Math.pow(Math.tan(Math.PI / 4 + latRad / 2), n)
  const lov = g.lov * rad
  const xy = (latDeg, lngDeg) => {
    const r = rho(latDeg * rad)
    let dl = lngDeg * rad - lov
    while (dl > Math.PI) dl -= 2 * Math.PI
    while (dl < -Math.PI) dl += 2 * Math.PI
    const a = n * dl
    return { x: r * Math.sin(a), y: -r * Math.cos(a) }
  }
  const origin = xy(g.la1, g.lo1)
  if ((g.scan & 0x40) === 0) throw new Error('unsupported scan mode (expected +j, south→north)')
  return (latDeg, lngDeg) => {
    const p = xy(latDeg, lngDeg)
    return { i: (p.x - origin.x) / g.dx, j: (p.y - origin.y) / g.dy }
  }
}

/** Decode the data values of one message (templates 5.0 / 5.2 / 5.3). */
export function gribDecode(buf, sections) {
  const s5 = sections[5].off
  const nVals = buf.readUInt32BE(s5 + 5)
  const tmpl = buf.readUInt16BE(s5 + 9)
  const R = buf.readFloatBE(s5 + 11)
  const E = signMag16(buf.readUInt16BE(s5 + 15))
  const D = signMag16(buf.readUInt16BE(s5 + 17))
  const nbits = buf[s5 + 19]
  const scale = Math.pow(2, E) / Math.pow(10, D)
  const out = new Float32Array(nVals)

  if (tmpl === 0) {
    const br = new BitReader(buf, sections[7].off + 5)
    for (let i = 0; i < nVals; i++) out[i] = (R + br.read(nbits) * Math.pow(2, E)) / Math.pow(10, D)
    return out
  }
  if (tmpl !== 2 && tmpl !== 3) throw new Error(`unsupported data template 5.${tmpl}`)

  const missingMgmt = buf[s5 + 22]
  if (missingMgmt !== 0) throw new Error(`missing-value management ${missingMgmt} unsupported`)
  const NG = buf.readUInt32BE(s5 + 31)
  const widthRef = buf[s5 + 35]
  const widthBits = buf[s5 + 36]
  const lenRef = buf.readUInt32BE(s5 + 37)
  const lenInc = buf[s5 + 41]
  const lastLen = buf.readUInt32BE(s5 + 42)
  const lenBits = buf[s5 + 46]
  const sdOrder = tmpl === 3 ? buf[s5 + 47] : 0
  const sdOctets = tmpl === 3 ? buf[s5 + 48] : 0
  if (tmpl === 3 && (sdOrder < 1 || sdOrder > 2)) throw new Error(`spatial differencing order ${sdOrder}`)

  // Section 7: [spatial-diff initial values + overall minimum] then the
  // group reference / width / length bitstreams, then the packed values.
  let off = sections[7].off + 5
  const ivals = []
  let gmin = 0
  if (tmpl === 3) {
    for (let k = 0; k < sdOrder; k++) { ivals.push(signMagBytes(buf, off, sdOctets)); off += sdOctets }
    gmin = signMagBytes(buf, off, sdOctets)
    off += sdOctets
  }
  const br = new BitReader(buf, off)
  const groupRefs = new Uint32Array(NG)
  for (let gI = 0; gI < NG; gI++) groupRefs[gI] = br.read(nbits)
  br.alignByte()
  const groupWidths = new Uint32Array(NG)
  for (let gI = 0; gI < NG; gI++) groupWidths[gI] = widthRef + br.read(widthBits)
  br.alignByte()
  const groupLens = new Uint32Array(NG)
  for (let gI = 0; gI < NG; gI++) groupLens[gI] = lenRef + lenInc * br.read(lenBits)
  groupLens[NG - 1] = lastLen
  br.alignByte()

  // Unpack per group, then undo spatial differencing, then unscale.
  const X = new Int32Array(nVals)
  let idx = 0
  for (let gI = 0; gI < NG; gI++) {
    const gw = groupWidths[gI]
    const gr = groupRefs[gI]
    const gl = groupLens[gI]
    if (gw === 0) {
      for (let k = 0; k < gl; k++) X[idx++] = gr
    } else {
      for (let k = 0; k < gl; k++) X[idx++] = gr + br.read(gw)
    }
  }
  if (idx !== nVals) throw new Error(`unpacked ${idx} of ${nVals} values`)

  if (tmpl === 3) {
    for (let i = sdOrder; i < nVals; i++) X[i] += gmin
    if (sdOrder === 1) {
      X[0] = ivals[0]
      for (let i = 1; i < nVals; i++) X[i] += X[i - 1]
    } else {
      X[0] = ivals[0]
      X[1] = ivals[1]
      for (let i = 2; i < nVals; i++) X[i] += 2 * X[i - 1] - X[i - 2]
    }
  }
  for (let i = 0; i < nVals; i++) out[i] = (R + X[i] * Math.pow(2, E)) / Math.pow(10, D)
  return out
}

/**
 * Fetch ONE field from an AWS-hosted GRIB2 file by its .idx inventory line.
 * matcher tests the idx line (e.g. /:MASSDEN:8 m above ground:/).
 * Returns { values, grid, sections } — values in the file's native units.
 */
export async function fetchGribField(fileUrl, matcher) {
  const idxText = await (await fetch(`${fileUrl}.idx`)).text()
  const lines = idxText.trim().split('\n')
  const at = lines.findIndex((l) => matcher.test(l))
  if (at < 0) throw new Error(`field ${matcher} not in inventory`)
  const start = Number(lines[at].split(':')[1])
  const end = at + 1 < lines.length ? Number(lines[at + 1].split(':')[1]) - 1 : ''
  const r = await fetch(fileUrl, { headers: { Range: `bytes=${start}-${end}` } })
  if (!r.ok) throw new Error(`grib range fetch ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  const sections = gribSections(buf)
  const grid = gribLambertGrid(buf, sections)
  const values = gribDecode(buf, sections)
  if (values.length !== grid.nx * grid.ny) throw new Error(`decoded ${values.length} ≠ ${grid.nx}×${grid.ny}`)
  return { values, grid, idxLine: lines[at] }
}
