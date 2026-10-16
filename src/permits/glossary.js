/**
 * Plain definitions for the permit terms /permits shows (Josh 2026-10-15: "we also need to define things"). One list
 * for the map popup, the permit report and the glossary page (/permits/glossary). Each entry: a term, a pattern that
 * finds it in record text, a plain sentence or two, and the law or agency page behind it. Wording is EarthAtlas's
 * own summary of the law; the link is the authority.
 */
const USC = (t, s) => `https://www.law.cornell.edu/uscode/text/${t}/${s}`
const RCW = (c) => `https://app.leg.wa.gov/rcw/default.aspx?cite=${c}`

export const TERMS = [
  { id: 's404', term: 'Clean Water Act §404', re: /\b404\b|§\s?404/,
    plain: 'An U.S. Army Corps of Engineers permit to place fill or dredged material in waters of the United States, including wetlands.', law: '33 U.S.C. § 1344', href: USC(33, 1344) },
  { id: 's10', term: 'Rivers and Harbors Act §10', re: /§\s?10\b|section 10\b/i,
    plain: 'An U.S. Army Corps of Engineers permit to build structures or do work in navigable waters: docks, piles, floats, buoys, cables.', law: '33 U.S.C. § 403', href: USC(33, 403) },
  { id: 'nwp', term: 'Nationwide Permit', re: /nationwide permit/i,
    plain: 'A U.S. Army Corps of Engineers permit approved in advance, nationally, for common smaller kinds of work. A project that fits one gets a short "verification" instead of its own permit; most verifications are not published.', law: '33 C.F.R. part 330', href: 'https://www.ecfr.gov/current/title-33/chapter-II/part-330' },
  { id: 'lop', term: 'Letter of Permission', re: /letter of permission/i,
    plain: 'A shortened U.S. Army Corps of Engineers individual permit for minor work. Other agencies are consulted, but there is no full public notice and comment period.', law: '33 C.F.R. § 325.2(e)', href: 'https://www.ecfr.gov/current/title-33/chapter-II/part-325/section-325.2' },
  { id: 'notice', term: 'Joint Public Notice', re: /joint public notice/i,
    plain: 'A notice issued together by the U.S. Army Corps of Engineers and Washington State Department of Ecology that announces an application and opens a public comment period (usually 15 to 30 days).', law: '33 C.F.R. § 325.3', href: 'https://www.ecfr.gov/current/title-33/chapter-II/part-325/section-325.3' },
  { id: 'jd', term: 'Jurisdictional determination', re: /jurisdictional determination|\bJD\b/i,
    plain: 'The U.S. Army Corps of Engineers’ ruling on whether a site holds "waters of the United States", which decides whether §404 applies there.', law: '33 C.F.R. § 331.2', href: 'https://www.ecfr.gov/current/title-33/chapter-II/part-331/section-331.2' },
  { id: 's408', term: 'Section 408 permission', re: /\b408\b/,
    plain: 'U.S. Army Corps of Engineers permission to alter a project the U.S. Army Corps of Engineers built (a federal civil works project, such as a navigation channel).', law: '33 U.S.C. § 408', href: USC(33, 408) },
  { id: 'ea', term: 'Environmental assessment', re: /environmental assessment/i,
    plain: 'A federal agency’s study of whether a permit could have significant environmental effects; if it finds none, no full environmental impact statement is written.', law: '42 U.S.C. § 4332', href: USC(42, 4332) },
  { id: 's401', term: '401 water quality certification', re: /\b401\b|water quality certification|\bWQC\b/i,
    plain: 'Washington State Department of Ecology’s decision on whether a project needing a federal permit will meet Washington’s water quality standards. Washington State Department of Ecology can certify, certify with conditions, or deny; the U.S. Army Corps of Engineers cannot issue its permit without it.', law: '33 U.S.C. § 1341', href: USC(33, 1341) },
  { id: 'prefile', term: 'Pre-filing meeting request', re: /pre-?filing/i,
    plain: 'The first step toward a 401 certification: the applicant must ask Washington State Department of Ecology for a pre-filing meeting at least 30 days before submitting the certification request.', law: '40 C.F.R. § 121.4', href: 'https://www.ecfr.gov/current/title-40/chapter-I/subchapter-D/part-121' },
  { id: 'czm', term: 'Coastal Zone Management (CZM) decision', re: /\bCZM\b|coastal zone/i,
    plain: 'Washington State Department of Ecology’s ruling on whether a federal permit in Washington’s coastal zone (which includes San Juan County) is consistent with the state’s coastal program, chiefly the Shoreline Management Act and water quality law. Washington State Department of Ecology concurs or objects; if it objects, the U.S. Army Corps of Engineers cannot issue the permit unless the applicant wins an appeal to the Secretary of Commerce.', law: '16 U.S.C. § 1456', href: USC(16, 1456) },
  { id: 'order', term: 'Washington State Department of Ecology administrative order', re: /administrative order/i,
    plain: 'Washington State Department of Ecology’s own state approval, under Washington’s water pollution law, for work in waters the U.S. Army Corps of Engineers does not regulate (such as some isolated wetlands).', law: 'RCW 90.48', href: RCW('90.48') },
  { id: 'hpa', term: 'Hydraulic Project Approval (HPA)', re: /\bHPA\b|hydraulic project/i,
    plain: 'A Washington Department of Fish and Wildlife permit for work that uses, obstructs or changes the bed or flow of state waters, including marine shorelines. Its provisions set how and when work may happen to protect fish.', law: 'RCW 77.55', href: RCW('77.55') },
  { id: 'window', term: 'Work window (timing limitation)', re: /work window|timing limitation/i,
    plain: 'The dates when in-water work is allowed, chosen to avoid times when fish spawn or migrate. Some permits allow work outside the window only after a survey finds no eggs.', law: 'WAC 220-660-330', href: 'https://app.leg.wa.gov/wac/default.aspx?cite=220-660-330' },
  { id: 'forage', term: 'Forage fish', re: /forage fish|surf smelt|sand lance|herring/i,
    plain: 'Small schooling fish (surf smelt, Pacific sand lance, Pacific herring) eaten by salmon, seabirds and marine mammals. Smelt and sand lance spawn on upper beaches; herring spawn on eelgrass and seaweed.', law: 'Washington Department of Fish and Wildlife forage fish', href: 'https://wdfw.wa.gov/species-habitats/species/forage-fish' },
  { id: 'jarpa', term: 'JARPA', re: /\bJARPA\b/,
    plain: 'The Joint Aquatic Resources Permit Application: one application form that goes to the U.S. Army Corps of Engineers, Washington State Department of Ecology, Washington Department of Fish and Wildlife and the county for in-water work.', law: 'Washington ORIA', href: 'https://www.oria.wa.gov/permitting/JARPA' },
  { id: 'sepa', term: 'SEPA review', re: /\bSEPA\b/,
    plain: 'Washington’s State Environmental Policy Act review: a lead agency (often the county) looks at a proposal’s environmental effects before deciding on it. Each determination has a public comment period.', law: 'RCW 43.21C', href: RCW('43.21C') },
  { id: 'dns', term: 'DNS (Determination of Nonsignificance)', re: /\bDNS\b/,
    plain: 'A SEPA finding that a proposal is not likely to have significant adverse environmental effects, so no environmental impact statement is required.', law: 'WAC 197-11-340', href: 'https://app.leg.wa.gov/wac/default.aspx?cite=197-11-340' },
  { id: 'mdns', term: 'MDNS (Mitigated DNS)', re: /\bMDNS\b|mitigated DNS/i,
    plain: 'A DNS that holds only because of conditions (mitigation) attached to the proposal.', law: 'WAC 197-11-350', href: 'https://app.leg.wa.gov/wac/default.aspx?cite=197-11-350' },
  { id: 'shoreline', term: 'Shoreline permit or exemption', re: /shoreline (exemption|permit|substantial)|substantial development/i,
    plain: 'Under Washington’s Shoreline Management Act, work on shorelines needs a county (or town) permit: a substantial development permit, a conditional use permit or a variance, unless it qualifies for an exemption.', law: 'RCW 90.58', href: RCW('90.58') },
  { id: 'npdes', term: 'NPDES discharge permit (§402)', re: /\b402\b|NPDES/,
    plain: 'A permit to discharge pollutants (treated sewage, stormwater, boatyard runoff) into water, with limits and monitoring. In Washington, Washington State Department of Ecology issues it.', law: '33 U.S.C. § 1342', href: USC(33, 1342) },
  { id: 'wq303d', term: '303(d) list (impaired waters)', re: /303\(d\)|impaired/i,
    plain: 'Washington State Department of Ecology’s list of waters that fail water quality standards for a pollutant (Category 5); each needs a cleanup plan.', law: '33 U.S.C. § 1313(d)', href: USC(33, 1313) },
  { id: 'shellfish', term: 'Shellfish growing area classification', re: /shellfish/i,
    plain: 'The Department of Health’s rating of where shellfish can be harvested safely: approved, conditionally approved, restricted or prohibited, based mostly on fecal coliform.', law: 'WAC 246-282', href: 'https://app.leg.wa.gov/wac/default.aspx?cite=246-282' },
  { id: 'pchb', term: 'Pollution Control Hearings Board', re: /Pollution Control Hearings Board|\bPCHB\b/i,
    plain: 'The state board that hears appeals of Washington State Department of Ecology decisions (including 401 certifications) and of Washington Department of Fish and Wildlife HPAs; most appeals must be filed within 30 days.', law: 'RCW 43.21B', href: RCW('43.21B') },
  { id: 'mmpa', term: 'Marine mammal incidental take', re: /marine mammal|incidental take/i,
    plain: 'NOAA Fisheries’ authorization for in-water work (such as pile driving) whose noise may disturb marine mammals.', law: '16 U.S.C. § 1371', href: USC(16, 1371) },
]
export const TERM_BY_ID = Object.fromEntries(TERMS.map((t) => [t.id, t]))

/** The terms that appear anywhere in a piece of text (or several), in glossary order. */
export function termsIn(...texts) {
  const s = texts.flat().filter(Boolean).join(' \n ')
  return TERMS.filter((t) => t.re.test(s))
}
