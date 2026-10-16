/**
 * Agencies by their official names on /permits (Josh 2026-10-15: "shortening to 'Ecology' or 'Corps' doesn't serve
 * anyone"). One rule for everything EarthAtlas writes: labels, statuses, event names, document titles. Quoted source
 * text (a record's own description, a permit's provisions) is never passed through it.
 */
const RULES = [
  [/(?<!U\.S\. )\bArmy Corps\b(?! of Engineers)/g, 'U.S. Army Corps of Engineers'],
  [/(?<!Army )\bCorps\b(?! of Engineers)/g, 'U.S. Army Corps of Engineers'],
  [/(?<!Department of )\bEcology\b/g, 'Washington State Department of Ecology'],
  [/\bWDFW\b/g, 'Washington Department of Fish and Wildlife'],
  [/\bDOH\b/g, 'Washington State Department of Health'],
  [/(?<!U\.S\. )\bEPA\b/g, 'U.S. Environmental Protection Agency'],
]
export function official(text) {
  if (typeof text !== 'string') return text
  return RULES.reduce((s, [re, to]) => s.replace(re, to), text)
}
