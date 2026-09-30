/**
 * The PUBLIC licence label for a source (Josh 2026-09-30: never show our internal notes on the site).
 * ships.sources.license is written for us: it can hold permission caveats, "UNVERIFIED", quotes of terms, who gave
 * permission. None of that belongs on a public page. Every place the site shows or tooltips a licence goes through here.
 *
 * Rules: an explicit label per source where the stored text is a note; otherwise only a recognised standard licence name
 * (CC0 / CC BY / CC BY-NC / CC BY-SA / Open Government Licence / public domain / US Government work / Apache-2.0);
 * anything else → '' (the credit link is shown on its own).
 */
const BY_ID = {
  'imo-gisis-scrubbers': 'IMO',
  'imo-gisis-port-facilities': 'IMO',
  'mep-alliance-voyages': 'MEP Alliance',
  'mep-alliance-fitted-ships': 'MEP Alliance',
  'imf-portwatch': 'IMF PortWatch',
  'wa-ecology-spills': 'Washington State Dept. of Ecology',
  'emsa-thetis-mrv': 'EMSA',
}

const STANDARD = [
  [/\bCC0\b/i, 'CC0 1.0'],
  [/CC BY-NC-SA/i, 'CC BY-NC-SA'],
  [/CC BY-NC 4\.0/i, 'CC BY-NC 4.0'],
  [/CC BY-NC/i, 'CC BY-NC'],
  [/CC BY-SA 4\.0/i, 'CC BY-SA 4.0'],
  [/CC BY 4\.0/i, 'CC BY 4.0'],
  [/Open Government Licence\s*[–-]\s*British Columbia/i, 'Open Government Licence – BC'],
  [/Open Government Licence\s*[–-]\s*Canada/i, 'Open Government Licence – Canada'],
  [/ODbL/i, 'ODbL'],
  [/Apache-2\.0/i, 'Apache-2.0'],
  [/US Government work|U\.S\. Government work|17 U\.S\.C/i, 'US Government work (public domain)'],
  [/public domain/i, 'Public domain'],
]

export function publicLicense(src) {
  if (!src) return ''
  if (src.id && BY_ID[src.id] !== undefined) return BY_ID[src.id]
  const t = String(src.license || '')
  for (const [re, label] of STANDARD) if (re.test(t)) return label
  return ''
}
