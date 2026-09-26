/**
 * Incident privacy on read (pure). Josh's rule (2026-09-25/26): narratives may name people.
 * They are stored as evidence exactly as received, but never leave the server: the card gets a
 * short neutral summary from structured fields plus a link to the official report.
 * Same approach as the registry privacy rule (docs/VESSEL_REGISTRIES.md §Privacy).
 */
export const WITHHELD_TEXT = '[withheld on EarthAtlas: free text may name people; see the official report]'

/** incident_events.detail keys the card may receive (everything else stays server-side). */
export const INCIDENT_DETAIL_KEYS = new Set([
  'classification', 'serious_marine_incident', 'marine_board', 'level_of_investigation', 'imo_incident_type', 'involves', 'subtypes',
  'vessel_damage_status', 'people_at_risk', 'injury_reported', 'death_reported', 'missing_reported', 'time_note', 'link_note',
  'controls', 'imo_reportable', 'still_imposed', 'note',
  'count', 'unresolved', 'port_state_control_exam', 'detention_action_code', 'deficiencies',
  'source_category', 'cause', 'activity', 'impact', 'regulated', 'products', 'quantity_note',
  'initial_report', 'materials', 'caveat', 'max_potential_release_gallons', 'tags', 'date_note',
])

const blankXmlField = (xml, field) => String(xml ?? '').replace(new RegExp(`<${field}>[\\s\\S]*?</${field}>`, 'g'), `<${field}>${WITHHELD_TEXT}</${field}>`)

/** Raw incident payload → the copy a client may see (narratives / free-text names withheld). Other sources pass through. */
export function publicIncidentPayload(sourceId, entityKind, payload) {
  if (!payload || typeof payload !== 'object') return payload
  if (sourceId === 'uscg-cgmix-iir' && payload.responses) {
    return { ...payload, responses: { ...payload.responses, brief: blankXmlField(payload.responses.brief, 'IncidentBrief') }, withheld: ['responses.brief/IncidentBrief'] }
  }
  if (sourceId === 'uscg-psix' && entityKind === 'psix_deficiencies') {
    return { ...payload, xml: blankXmlField(payload.xml, 'Description'), withheld: ['xml/Description'] }
  }
  if (sourceId === 'uscg-nrc') {
    return { ...payload, commons: payload.commons ? { ...payload.commons, DESCRIPTION_OF_INCIDENT: payload.commons.DESCRIPTION_OF_INCIDENT ? WITHHELD_TEXT : '' } : payload.commons,
      withheld: ['commons.DESCRIPTION_OF_INCIDENT'] }
  }
  if (sourceId === 'noaa-incidentnews' && payload.row) {
    return { ...payload, row: { ...payload.row, description: payload.row.description ? WITHHELD_TEXT : '' }, withheld: ['row.description'] }
  }
  if (sourceId === 'wa-ecology-spills' && Array.isArray(payload.rows)) {
    // Case names can carry a boat's state registration number or a person's name.
    return { ...payload, rows: payload.rows.map((r) => ({ ...r, CaseName: r.CaseName ? WITHHELD_TEXT : r.CaseName })), withheld: ['rows[].CaseName'] }
  }
  return payload
}
