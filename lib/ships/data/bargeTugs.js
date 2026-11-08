// Reviewed barge ↔ tug pairs (lib/ships/bargeTugs.js; Josh 2026-11-07). Never a merge: the pair is only used to check notices
// naming the barge (lib/ships/oilTransfers.js rule 8). Reviewed by Claude 2026-11-08 from the production proposals
// (scripts/ships/barge-tugs.mjs propose --prod: Ecology notices Jan 2025 – Jun 2026 × terminal and dock calls of tugs).
//   barge     exact barge name as Ecology's notices give it          mmsi / tugName  the tug as AIS reports it
//   ops       notified transfers of the barge at a tracked place     together / full  of those, the tug at the berth at all /
//                                                                                     through >= 80% of the notified window
//   source    a published page naming the pair, or null (AIS evidence only)
//   atb       true only for an articulated tug-barge unit a source confirms AND whose tug AIS shows at >= half its transfers:
//             then a transfer with no tug call counts as not seen. Otherwise a missing tug call = can't check.
//   note      internal review note (not shown on the site).
// Included: every proposal passing BARGE_TUG_RULE, plus source-confirmed pairs below it (marked in note).
export const BARGE_TUGS_VERSION = 'bt1'

const CROWLEY_650 = { name: 'Crowley, 650-class ATB specifications', url: 'https://www.crowley.com/wp-content/uploads/sites/7/2020/04/CM_Petro_650ATB_specsheet.pdf', short: 'Crowley' }
const CROWLEY_550 = { name: 'Crowley, 550-class ATB specifications', url: 'https://www.crowley.com/wp-content/uploads/sites/7/2020/04/CM_Petro_550ATB_specsheet.pdf', short: 'Crowley' }

export const BARGE_TUGS = [
  { barge: 'TANK BARGE NATHAN SCHMIDT', mmsi: '367741150', tugName: 'DR MILTON WANER', atb: false, ops: 188, together: 134, full: 97, source: null, note: 'AIS only' },
  { barge: 'ATB BARGE ALL ABOARD FOR A CURE', mmsi: '368013040', tugName: 'TODD E PROPHET', atb: true, ops: 171, together: 162, full: 84,
    source: { name: 'The Maritime Executive (2017), Harley Marine names articulated tug-barge units', url: 'https://maritime-executive.com/corporate/harley-marine-names-articulated-tug--barge-units', short: 'Maritime Executive' },
    note: 'source-confirmed; full share 0.49 just under the rule, together 0.95' },
  { barge: 'TANK BARGE DR. BONNIE W. RAMSEY', mmsi: '367741120', tugName: 'A J', atb: false, ops: 168, together: 159, full: 114, source: null, note: 'AIS only' },
  { barge: 'TANK BARGE DOTTIE', mmsi: '366811310', tugName: 'JAMES T QUIGG', atb: false, ops: 113, together: 88, full: 70, source: null, note: 'AIS only' },
  { barge: 'ATB BARGE THE PATSY PAULIE', mmsi: '367006570', tugName: 'JEFFREY S', atb: false, ops: 108, together: 98, full: 81, source: null, note: 'AIS only; no published pairing found' },
  { barge: 'ATB BARGE DR. ROBERT J. BEALL', mmsi: '367677130', tugName: 'BARRY SILVERTON', atb: false, ops: 90, together: 86, full: 57, source: null, note: 'AIS only; a 2015 source paired it with EMERY ZIDELL (older pairing)' },
  { barge: 'TANK BARGE BETSY ARNTZ', mmsi: '367705050', tugName: 'C E', atb: false, ops: 64, together: 56, full: 50, source: null, note: 'AIS only' },
  { barge: 'ATB BARGE DBL 185', mmsi: '338616000', tugName: 'DUBLIN SEA', atb: true, ops: 62, together: 60, full: 52,
    source: { name: 'Professional Mariner (2010), K-Sea nears end of building program', url: 'https://professionalmariner.com/k-sea-nears-end-of-building-program-expanding-tug-barge-company-awaits-recovery/', short: 'Professional Mariner' }, note: 'source-confirmed' },
  { barge: 'ATB BARGE 650-9', mmsi: '367771000', tugName: 'INNOVATION', atb: false, ops: 62, together: 28, full: 26, source: CROWLEY_650,
    note: 'source-confirmed but tug seen at only 0.45 of transfers, so not treated as a fixed unit (missing tug = can\'t check)' },
  { barge: 'ATB BARGE 650-7', mmsi: '366341000', tugName: 'PRIDE', atb: true, ops: 55, together: 34, full: 28, source: CROWLEY_650, note: 'source-confirmed' },
  { barge: 'TANK BARGE DRAKES BAY', mmsi: '366938510', tugName: 'KLIHYAM', atb: false, ops: 53, together: 48, full: 40, source: null, note: 'AIS only; a 2013 source paired it with TECUMSEH (older pairing)' },
  { barge: 'ATB BARGE 550-2', mmsi: '369580000', tugName: 'SOUND RELIANCE', atb: true, ops: 48, together: 27, full: 22, source: CROWLEY_550,
    note: 'source-confirmed; full share 0.46 under the rule, together 0.56' },
  { barge: 'ATB-116', mmsi: '367707480', tugName: 'AURORA', atb: false, ops: 44, together: 42, full: 35, source: null, note: 'AIS only (a different AURORA from QAMUN\'s)' },
  { barge: 'ATB BARGE ZIDELL MARINE 277', mmsi: '367770980', tugName: 'BILL GOBEL', atb: false, ops: 40, together: 40, full: 28, source: null, note: 'AIS only; a 2017 source paired it with JAKE SHEARER (older pairing)' },
  { barge: 'ATB BARGE 550-1', mmsi: '369567000', tugName: 'SEA RELIANCE', atb: true, ops: 37, together: 35, full: 29, source: CROWLEY_550, note: 'source-confirmed' },
  { barge: 'ATB BARGE SODO', mmsi: '368278830', tugName: 'MONTLAKE', atb: true, ops: 33, together: 27, full: 23,
    source: { name: 'NTSB (2024), news release on the ATB Montlake / Sodo', url: 'https://www.ntsb.gov/news/press-releases/Pages/NR20240924.aspx', short: 'NTSB' }, note: 'source-confirmed' },
  { barge: 'ATB BARGE EDWARD ITTA', mmsi: '367770990', tugName: 'MIN ZIDELL', atb: false, ops: 7, together: 6, full: 5, source: null, note: 'AIS only; a 2017 source paired it with ONECURE (older pairing)' },
  { barge: 'ATB BARGE QAMUN', mmsi: '338066000', tugName: 'AURORA', atb: true, ops: 7, together: 7, full: 4,
    source: { name: 'Marine Log (2021), 55,000-barrel ATB joins Crowley fleet', url: 'https://www.marinelog.com/news/55000-barrel-atb-joins-crowley-fleet/', short: 'Marine Log' }, note: 'source-confirmed' },
  { barge: 'ATB-811', mmsi: '368006870', tugName: 'ONECURE', atb: false, ops: 5, together: 5, full: 3, source: null, note: 'AIS only' },
  { barge: 'TANK BARGE COMMENCEMENT BAY', mmsi: '366759530', tugName: 'GUIDE', atb: false, ops: 5, together: 5, full: 5, source: null, note: 'AIS only' },
]
