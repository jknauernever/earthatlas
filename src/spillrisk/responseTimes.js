// Response-time milestones drawn on the /spillrisk time bar. Every entry is sourced (docs/SPILLRISK_RESPONSE_TIMES.md).
// h = hours after the spill is REPORTED (rules and incident records count from notification). The page treats hour 0
// as the report, the best case: real spills are often found later.
// kind: 'rule' = a required planning standard (a maximum, not a promise); 'record' = what happened in a real spill.
const WAC = 'https://app.leg.wa.gov/wac/default.aspx?cite=173-182&full=true'
const CFR = 'https://www.law.cornell.edu/cfr/text/33/155.1050'
const BUTLER = 'https://waves-vagues.dfo-mpo.gc.ca/library-bibliotheque/4109461x.pdf'
const ALEUTIAN = 'https://ecology.wa.gov/spills-cleanup/spills/spill-preparedness-response/responding-to-spill-incidents/spill-incidents/aleutian-isle-sinking'

export const RESPONSE_MARKS = [
  { id: 'wa-2h', h: 2, kind: 'rule', label: 'First 1,000 ft of boom required (San Juan County)',
    detail: 'Washington’s planning standard for covered vessels and facilities in San Juan County: a work boat and 1,000 ft of boom within 2 hours of notification.',
    src: 'WAC 173-182-370', url: WAC },
  { id: 'marathassa-3h', h: 3, kind: 'record', label: 'Marathassa 2015: cleanup contractor activated',
    detail: 'English Bay, Vancouver: the Coast Guard formally activated the response organization 3 h 09 min after the sheen was reported.',
    src: 'Butler review, 2015', url: BUTLER },
  { id: 'marathassa-5h', h: 5, kind: 'record', label: 'Marathassa 2015: first skimming crew on scene',
    detail: 'The first response crew was on scene and skimming about 4 h 37 min after the report, in near-ideal weather.',
    src: 'Butler review, 2015', url: BUTLER },
  { id: 'wa-6h', h: 6, kind: 'rule', label: '10,000 ft more boom and first recovery capacity required; aircraft on scene',
    detail: 'Washington’s San Juan County standard at 6 hours: 10,000 ft more boom and recovery capacity for 3% of the worst case (or 12,500 bbl a day); aerial surveillance on scene within 6 hours.',
    src: 'WAC 173-182-370 and -321', url: WAC },
  { id: 'us-12h', h: 12, kind: 'rule', label: 'Federal: response to a “maximum most probable” spill required',
    detail: 'In higher-volume port areas, which include the Strait of Juan de Fuca and Puget Sound, a tanker’s plan must have resources for its maximum most probable discharge on scene within 12 hours, and its first tier for a worst case.',
    src: '33 CFR 155.1050', url: CFR },
  { id: 'marathassa-13h', h: 13, kind: 'record', label: 'Marathassa 2015: boom around the leaking ship complete',
    detail: 'Boom around the source ship began at 04:36 and was completed at 05:53 the next morning, about 13 hours after the report.',
    src: 'Butler review, 2015', url: BUTLER },
  { id: 'aleutian-22h', h: 22, kind: 'record', label: 'Aleutian Isle 2022: first boom reported (San Juan Island)',
    detail: 'The fishing vessel sank off San Juan Island’s west side; Ecology was notified at 5 p.m. and its first update reporting sorbent boom came at 3:30 p.m. the next day.',
    src: 'Washington Ecology', url: ALEUTIAN },
  { id: 'wa-24h', h: 24, kind: 'rule', label: '100 trained shoreline cleanup workers required',
    detail: 'Washington’s standard: 100 trained workers for shoreline cleanup within 24 hours of notification.',
    src: 'WAC 173-182-522', url: WAC },
  { id: 'us-36h', h: 36, kind: 'rule', label: 'Federal: second tier of worst-case resources required',
    detail: 'Higher-volume port areas: worst-case discharge resources in three tiers at 12, 36 and 60 hours.',
    src: '33 CFR 155.1050(g)', url: CFR },
  { id: 'wa-48h', h: 48, kind: 'rule', label: 'Full required recovery capacity',
    detail: 'Washington’s standard at 48 hours: recovery capacity for 25% of the worst case (or 60,000 bbl a day).',
    src: 'WAC 173-182-370', url: WAC },
  { id: 'us-60h', h: 60, kind: 'rule', label: 'Federal: third tier of worst-case resources required',
    detail: 'The last tier for a higher-volume port area.',
    src: '33 CFR 155.1050(g)', url: CFR },
]

// What responders usually get back, for context next to the marks (sourced)
export const RECOVERY_NOTE = {
  text: 'Even when equipment arrives, at sea usually only 10–15% of spilled oil is recovered, and booms cannot hold oil against a cross-current over 0.7 knots.',
  src: 'ITOPF', url: 'https://www.itopf.org/knowledge-resources/documents-guides/response-techniques/containment-recovery/',
}
