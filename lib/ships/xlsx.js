/**
 * Minimal XLSX sheet reader for flat government registry exports (pure; no I/O,
 * no dependency). Takes the XML text of xl/sharedStrings.xml and one
 * xl/worksheets/sheetN.xml (the caller unzips) and returns rows as arrays of
 * cell strings exactly as stored: shared/inline strings as text, numbers as
 * their stored literal (e.g. "152527.0"). No type coercion, no date guessing:
 * mappers decide what a cell means.
 */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
export function unescapeXml(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    return ENT[e.toLowerCase()] ?? m
  })
}

/** Text of every <si> in sharedStrings.xml (rich-text runs concatenated). */
export function sharedStrings(xml) {
  const out = []
  for (const m of String(xml || '').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    out.push([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join(''))
  }
  return out
}

/** Column letters → 0-based index ("A" → 0, "AA" → 26). */
export function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] || 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Rows of one worksheet as arrays of strings ('' for empty cells). */
export function sheetRows(xml, strings = []) {
  const rows = []
  for (const rm of String(xml).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = []
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] ?? ''
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1]
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n'
      const i = ref ? colIndex(ref) : row.length
      let v = ''
      if (type === 's') v = strings[Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1])] ?? ''
      else if (type === 'inlineStr') v = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join('')
      else v = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '')
      while (row.length < i) row.push('')
      row[i] = v
    }
    rows.push(row)
  }
  return rows
}

/** Header row + data rows → objects keyed by header text. */
export function rowsToObjects(rows) {
  const [head = [], ...data] = rows
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}
