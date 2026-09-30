/**
 * MEP Alliance lists: what of a stored row the public may see (lib/ships/mepAlliance.js). No imports, so the API read path
 * (lib/ships/queries.js) can use it without pulling in the importer. Privacy: the list names company officers with their
 * emails and phone numbers; those stay in the stored record only.
 */

export const MEP_SOURCE_IDS = ['mep-alliance-voyages', 'mep-alliance-fitted-ships']

/** Contact columns: never shown, never in a claim. */
export const CONTACT_COLUMNS = ['Owner’s Contact Details', 'Customer’s Contact Details']

/**
 * Strip every contact detail from a cell: emails, web addresses, phone numbers, postal addresses. Pure.
 * (Company-level names stay; see companyName for removing people.)
 */
export function stripContacts(raw) {
  return String(raw || '')
    .replace(/\baddress:[\s\S]*$/i, ' ')
    .replace(/\b(office\s+no\.?|room\s+\d|suite\s+\d|p\.?\s?o\.?\s+box)[\s\S]*$/i, ' ')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ')
    .replace(/\b(https?:\/\/|www?\.)[^\s)]+/gi, ' ')
    .replace(/(\+|\(\+)?\d[\d\s().\-‪‬]{5,}\d/g, ' ')
    .replace(/\b(tel|phone|email|e-mail|fax)\b:?/gi, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/[ \t]+/g, ' ').trim()
}

/** A stored record's payload as the public may see it: contact columns and the raw HTML removed. Pure. */
export function publicRecordPayload(payload) {
  if (!payload || !Array.isArray(payload.rows)) return payload
  return {
    ...payload,
    rows: payload.rows.map((r) => {
      const cells = { ...(r.cells || {}) }
      for (const k of CONTACT_COLUMNS) if (k in cells) cells[k] = cells[k] ? '(contact details withheld by EarthAtlas)' : ''
      for (const k of ['Owner of Polluting Ship', 'Customer Leasing Polluting Ship']) if (cells[k]) cells[k] = stripContacts(cells[k])
      return { ...(r.list ? { list: r.list } : {}), cells }
    }),
    html_withheld: 'The row HTML (with contact details) is kept by EarthAtlas and not shown.',
  }
}
