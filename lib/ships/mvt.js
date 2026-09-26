// Minimal Mapbox Vector Tile (MVT 2.1) reader: enough to read /ships track tiles on the
// server (api/ship-tracks.js op=near). Decodes layers, feature properties and line
// geometry into tile coordinates (0..extent). No dependency; spec:
// https://github.com/mapbox/vector-tile-spec/tree/master/2.1

function reader(buf) {
  let pos = 0
  const varint = () => {
    let r = 0, s = 0, b
    do { b = buf[pos++]; r += (b & 0x7f) * 2 ** s; s += 7 } while (b & 0x80)
    return r
  }
  return {
    get pos() { return pos },
    done: (end) => pos >= end,
    varint,
    tag() { const v = varint(); return [v >>> 3, v & 7] },
    bytes() { const n = varint(); const out = buf.subarray(pos, pos + n); pos += n; return out },
    skip(wire) {
      if (wire === 0) varint()
      else if (wire === 1) pos += 8
      else if (wire === 2) pos += varint()
      else if (wire === 5) pos += 4
      else throw new Error(`mvt: bad wire type ${wire}`)
    },
  }
}

const zigzag = (n) => (n % 2 ? -(n + 1) / 2 : n / 2)

function value(buf) {
  const r = reader(buf)
  while (!r.done(buf.length)) {
    const [f, w] = r.tag()
    if (f === 1) return new TextDecoder().decode(r.bytes())
    if (f === 2) { const v = buf.subarray(r.pos, r.pos + 4); r.skip(5); return new DataView(v.buffer, v.byteOffset, 4).getFloat32(0, true) }
    if (f === 3) { const v = buf.subarray(r.pos, r.pos + 8); r.skip(1); return new DataView(v.buffer, v.byteOffset, 8).getFloat64(0, true) }
    if (f === 4 || f === 5) return r.varint()
    if (f === 6) return zigzag(r.varint())
    if (f === 7) return !!r.varint()
    r.skip(w)
  }
  return null
}

// Geometry commands → array of rings/lines, each an array of [x, y] tile coordinates.
function geometry(cmds) {
  const parts = []
  let x = 0, y = 0, cur = null
  for (let i = 0; i < cmds.length;) {
    const c = cmds[i++], id = c & 7, n = c >> 3
    if (id === 7) { if (cur?.length) cur.push(cur[0]); continue } // ClosePath
    for (let k = 0; k < n; k++) {
      x += zigzag(cmds[i++]); y += zigzag(cmds[i++])
      if (id === 1) { cur = [[x, y]]; parts.push(cur) } else cur.push([x, y])
    }
  }
  return parts
}

/** Decode a (gunzipped) MVT buffer → { [layerName]: { extent, features: [{ properties, type, parts }] } }. */
export function decodeMvt(buf) {
  const out = {}
  const r = reader(buf)
  while (!r.done(buf.length)) {
    const [f, w] = r.tag()
    if (f !== 3) { r.skip(w); continue }
    const lb = r.bytes(), lr = reader(lb)
    let name = '', extent = 4096
    const keys = [], values = [], raw = []
    while (!lr.done(lb.length)) {
      const [lf, lw] = lr.tag()
      if (lf === 1) name = new TextDecoder().decode(lr.bytes())
      else if (lf === 2) raw.push(lr.bytes())
      else if (lf === 3) keys.push(new TextDecoder().decode(lr.bytes()))
      else if (lf === 4) values.push(value(lr.bytes()))
      else if (lf === 5) extent = lr.varint()
      else lr.skip(lw)
    }
    const features = raw.map((fb) => {
      const fr = reader(fb)
      let tags = [], type = 0, cmds = []
      const packed = () => { const b = fr.bytes(), pr = reader(b), a = []; while (!pr.done(b.length)) a.push(pr.varint()); return a }
      while (!fr.done(fb.length)) {
        const [ff, fw] = fr.tag()
        if (ff === 2) tags = packed()
        else if (ff === 3) type = fr.varint()
        else if (ff === 4) cmds = packed()
        else fr.skip(fw)
      }
      const properties = {}
      for (let i = 0; i + 1 < tags.length; i += 2) properties[keys[tags[i]]] = values[tags[i + 1]]
      return { properties, type, parts: geometry(cmds) }
    })
    out[name] = { extent, features }
  }
  return out
}
