/**
 * A photo's capture time from its EXIF header (Josh 2026-10-18: HappyWhale gives a date only, but its photos keep the
 * camera's EXIF). Reads only the first 64 KB of the file (a Range request); no dependencies.
 *
 * Returns { at, how } — `at` an ISO UTC time only when the photo pins the moment down:
 *   'gps'    GPSDateStamp + GPSTimeStamp (always UTC)
 *   'offset' DateTimeOriginal + OffsetTimeOriginal (the camera's local time and its UTC offset)
 * A DateTimeOriginal with no offset (most dedicated cameras) is a clock reading in an unknown time zone, sometimes
 * not even set right, so it never becomes an exact time: { at: null, how: 'local-only', local }. No EXIF → how 'none'.
 */

const MAX_BYTES = 65536

function tiff(buf, start) {
  const le = buf.toString('latin1', start, start + 2) === 'II'
  const u16 = (o) => (le ? buf.readUInt16LE(start + o) : buf.readUInt16BE(start + o))
  const u32 = (o) => (le ? buf.readUInt32LE(start + o) : buf.readUInt32BE(start + o))
  const inBuf = (o, n = 1) => start + o + n <= buf.length
  function ifd(off) {
    const tags = new Map()
    if (!inBuf(off, 2)) return tags
    const n = u16(off)
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12
      if (!inBuf(e, 12)) break
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4)
      const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1
      const at = size * count > 4 ? u32(e + 8) : e + 8
      if (type === 2) { if (inBuf(at, count)) tags.set(tag, buf.toString('latin1', start + at, start + at + count).replace(/\0+$/, '').trim()) }
      else if (type === 5) {
        const vals = []
        for (let q = 0; q < count && inBuf(at + q * 8, 8); q++) { const d = u32(at + q * 8 + 4); vals.push(d ? u32(at + q * 8) / d : 0) }
        tags.set(tag, vals)
      } else if (type === 4) tags.set(tag, u32(e + 8))
      else if (type === 3) tags.set(tag, u16(e + 8))
    }
    return tags
  }
  const ifd0 = ifd(u32(4))
  const exif = ifd0.has(0x8769) ? ifd(ifd0.get(0x8769)) : new Map()
  const gps = ifd0.has(0x8825) ? ifd(ifd0.get(0x8825)) : new Map()
  return { ifd0, exif, gps }
}

/** Parse EXIF capture time from the start of a JPEG. */
export function exifTime(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return { at: null, how: 'none' }
  let p = 2
  while (p + 4 <= buf.length && buf[p] === 0xff) {
    const marker = buf[p + 1], len = buf.readUInt16BE(p + 2)
    if (marker === 0xda) break // image data starts: no more headers
    if (marker === 0xe1 && buf.toString('latin1', p + 4, p + 10) === 'Exif\0\0') {
      const { ifd0, exif, gps } = tiff(buf, p + 10)
      const local = exif.get(0x9003) || ifd0.get(0x0132) || null   // DateTimeOriginal, else DateTime
      const offset = exif.get(0x9011) || null                      // OffsetTimeOriginal "-07:00"
      const gd = gps.get(0x001d), gt = gps.get(0x0007)              // GPSDateStamp "YYYY:MM:DD", GPSTimeStamp [h, m, s]
      const iso = (s) => s.replace(/^(\d{4}):(\d{2}):(\d{2})[ T]/, '$1-$2-$3T')
      if (gd && Array.isArray(gt) && gt.length === 3) {
        const d = new Date(`${gd.replace(/:/g, '-')}T00:00:00Z`).getTime() + ((gt[0] * 60 + gt[1]) * 60 + gt[2]) * 1000
        if (Number.isFinite(d)) return { at: new Date(Math.round(d / 1000) * 1000).toISOString(), how: 'gps', local }
      }
      if (local && /^[+-]\d{2}:\d{2}$/.test(offset || '')) {
        const d = Date.parse(`${iso(local)}${offset}`)
        if (Number.isFinite(d)) return { at: new Date(d).toISOString(), how: 'offset', local }
      }
      return { at: null, how: local ? 'local-only' : 'none', local }
    }
    p += 2 + len
  }
  return { at: null, how: 'none' }
}

/** Fetch the first 64 KB of a photo and read its capture time. */
export async function photoTime(url, { signal } = {}) {
  const r = await fetch(url, { headers: { Range: `bytes=0-${MAX_BYTES - 1}`, 'User-Agent': 'earthatlas-whales/1.0 (+https://earthatlas.org)' }, signal })
  if (!r.ok && r.status !== 206) throw new Error(`photo HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  return exifTime(buf.subarray(0, MAX_BYTES))
}
