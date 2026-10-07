/**
 * /ships "How this is sourced" rollup (SourcesFooter). Every fact here is taken from the source rows the
 * importers record in ships.sources (lib/ships/*.js *_SOURCE: licence, attribution, notes) and the bake
 * headers (scripts/ships/bake-*), not written fresh. When a source row changes, change it here too.
 * The rollup is in addition to each value's own inline source link, never a replacement.
 */
const CC_BY_NC = 'https://creativecommons.org/licenses/by-nc/4.0/'
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/'
const USC105 = 'https://www.law.cornell.edu/uscode/text/17/105'
const OGL_CA = 'https://open.canada.ca/en/open-government-licence-canada'

export const SHIPS_SOURCES_INTRO =
  'Ships, their identities over time, where they went, and the places they pass: all from open public data. ' +
  'Every value on the map, the cards and the popups carries its own source link; this is the full list in one place.'

export const SHIPS_SOURCES = [
  {
    heading: 'Ship tracks',
    sources: [
      { name: 'MarineCadastre AIS', href: 'https://hub.marinecadastre.gov/pages/vesseltraffic',
        publisher: 'NOAA Office for Coastal Management / BOEM; data from the U.S. Coast Guard Navigation Center',
        licence: 'CC0 1.0', licenceHref: CC0,
        method: 'Salish Sea tracks: EarthAtlas builds lines from the daily AIS points (gap, jump and over-land rules written into each bake’s manifest). US terrestrial receivers only; Alaska removed; static fields may be USCG-corrected without marking which.' },
      { name: 'US-wide tracks (EarthAtlas bake of MarineCadastre’s monthly track files)', href: 'https://hub.marinecadastre.gov/pages/vesseltraffic',
        publisher: 'derived by EarthAtlas', licence: 'CC0 1.0 (source data)', licenceHref: CC0,
        method: 'NOAA’s monthly lines, split wherever two points are impossibly far apart, parked boats’ GPS jitter dropped, simplified to about 18 m; kind of ship from the broadcast AIS type code. Over-land rules are not yet applied US-wide.' },
      { name: 'Global Fishing Watch hourly AIS positions', href: 'https://globalfishingwatch.org/our-apis/',
        publisher: 'Global Fishing Watch, Inc.', licence: 'CC BY-NC 4.0 (non-commercial)', licenceHref: CC_BY_NC,
        method: 'One position per ship per hour, about 4 days behind. Drawn as lines for British Columbia, Alaska and the US West Coast, and for the Salish Sea in months NOAA has not published yet (then replaced by NOAA’s lines). Where two hourly positions are joined along the water instead of a straight line, the line is dashed (an EarthAtlas estimate).',
        citation: 'Powered by Global Fishing Watch.' },
    ],
  },
  {
    heading: 'Ship identity',
    sources: [
      { name: 'Global Fishing Watch Vessels API', href: 'https://globalfishingwatch.org/our-apis/documentation/docs/v3/vessels',
        publisher: 'Global Fishing Watch, Inc.', licence: 'CC BY-NC 4.0 (non-commercial)', licenceHref: CC_BY_NC,
        method: 'Names, flags, numbers and registry owners over time. Registry data is as processed by GFW (GFW does not disclose raw registry records).',
        citation: 'Powered by Global Fishing Watch.' },
      { name: 'Wikidata (ship items)', href: 'https://www.wikidata.org/wiki/Wikidata:WikiProject_Ships',
        publisher: 'Wikimedia Foundation; edited by the Wikidata community', licence: 'CC0 1.0', licenceHref: CC0,
        method: 'Community-edited ship facts, always shown as community-curated, never as a registry.' },
      { name: 'Wikimedia Commons (ship photos)', href: 'https://commons.wikimedia.org',
        publisher: 'files by their individual authors', licence: 'Per file: CC0, public domain, CC BY or CC BY-SA only', licenceHref: 'https://commons.wikimedia.org/wiki/Commons:Licensing',
        method: 'Photos from a ship’s Wikidata image or its Commons “IMO” category (tied only through a registry IMO). Each photo is credited with its own author and licence.' },
      { name: 'USCG Port State Information Exchange (PSIX)', href: 'https://cgmix.uscg.mil/psix/',
        publisher: 'U.S. Coast Guard (MISLE data via CGMIX)', licence: 'U.S. Government work, public domain (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Weekly snapshot of Coast Guard vessel records (no MMSI, no owner); values as observed when retrieved.' },
      { name: 'FCC Universal Licensing System: ship radio station licences', href: 'https://www.fcc.gov/uls/transactions/daily-weekly',
        publisher: 'U.S. Federal Communications Commission', licence: 'U.S. Government work, public domain (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Call signs, MMSIs and particulars declared by the applicant. The licensee is the radio licence holder, not stated to be the owner; personal data of individuals is withheld before storage.' },
      { name: 'Transport Canada: Canadian Register of Vessels (large vessels)', href: 'https://open.canada.ca/data/en/dataset/bf00b7f4-e370-46b7-94e4-0bdedc98531b',
        publisher: 'Transport Canada, Marine Safety and Security', licence: 'Open Government Licence – Canada 2.0', licenceHref: OGL_CA,
        method: 'Canadian registry records. No owners, call signs or MMSIs are published.',
        citation: 'Contains information licensed under the Open Government Licence – Canada (Transport Canada, Canadian Register of Vessels).' },
    ],
  },
  {
    heading: 'Incidents',
    sources: [
      { name: 'USCG Incident Investigation Reports (CGMIX)', href: 'https://cgmix.uscg.mil/IIR/Default.aspx',
        publisher: 'U.S. Coast Guard', licence: 'U.S. Government work, public domain (17 U.S.C. § 105); no licence stated on CGMIX', licenceHref: USC105,
        method: 'Reportable marine casualties closed after October 2002, redacted by the Coast Guard. Open investigations are not published.' },
      { name: 'National Response Center incident reports', href: 'https://nrc.uscg.mil/',
        publisher: 'U.S. Coast Guard, National Response Center', licence: 'U.S. Government work (17 U.S.C. § 105); no licence stated', licenceHref: USC105,
        method: 'Initial reports the NRC has not validated or investigated. They name vessels only, so matches to a ship are candidates only.' },
      { name: 'Washington State Department of Ecology: reported spills to water',
        href: 'https://ecology.wa.gov/spills-cleanup/spills/spill-preparedness-response/responding-to-spill-incidents/spill-incidents',
        publisher: 'WA Ecology, Spill Prevention, Preparedness & Response',
        licence: 'Use allowed with credit and a link; commercial and political use prohibited',
        licenceHref: 'https://ecology.wa.gov/About-us/Accountability-transparency/Website-information/Copyright-information',
        method: 'Spills of one gallon or more to water since 1 July 2015. No vessel identifiers, so matches by name are candidates only.',
        citation: 'Washington State Department of Ecology (reported spills to water)' },
      { name: 'NOAA IncidentNews', href: 'https://incidentnews.noaa.gov/',
        publisher: 'NOAA Office of Response and Restoration', licence: 'Public domain (“no copyright restriction”)', licenceHref: 'https://incidentnews.noaa.gov/',
        method: 'Incidents where NOAA gave scientific support; locations may be approximate. Vessel names come from titles, so matches are candidates only.' },
    ],
  },
  {
    heading: 'Dark vessels and port visits',
    sources: [
      { name: 'Global Fishing Watch 4Wings: SAR vessel detections (public-global-sar-presence)', href: 'https://globalfishingwatch.org/our-apis/',
        publisher: 'Global Fishing Watch, Inc.', licence: 'CC BY-NC 4.0 (non-commercial)', licenceHref: CC_BY_NC,
        method: 'Sentinel-1 radar detections not matched to any AIS broadcast, counted per grid cell and month. About 5–6 days behind; misses most boats under 15 m.',
        citation: 'Powered by Global Fishing Watch.' },
      { name: 'Global Fishing Watch Events API: port visits', href: 'https://globalfishingwatch.org/our-apis/documentation/docs/v3/events',
        publisher: 'Global Fishing Watch, Inc.', licence: 'CC BY-NC 4.0 (non-commercial)', licenceHref: CC_BY_NC,
        method: '“Apparent” port visits derived by GFW from AIS: entering within 3 km of an anchorage, stopping, leaving beyond 4 km.',
        citation: 'Powered by Global Fishing Watch.' },
    ],
  },
  {
    heading: 'Ports',
    sources: [
      { name: 'World Port Index (NGA Pub 150)', href: 'https://msi.nga.mil/Publications/WPI',
        publisher: 'National Geospatial-Intelligence Agency', licence: 'U.S. Government work, no copyright claimed (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Every port’s position and harbour size (coordinates rounded to whole arc-minutes); also names the stops in port visits.' },
      { name: 'GFW pipe-anchorages: anchorage overrides list', href: 'https://github.com/GlobalFishingWatch/pipe-anchorages',
        publisher: 'Global Fishing Watch, Inc.', licence: 'Apache-2.0 (repository licence)', licenceHref: 'https://github.com/GlobalFishingWatch/pipe-anchorages/blob/main/LICENSE',
        method: 'The reviewed anchorage names GFW applies first; used to name ports not in the World Port Index.' },
      { name: 'GeoNames country info', href: 'https://www.geonames.org',
        publisher: 'GeoNames', licence: 'CC BY 4.0', licenceHref: 'https://creativecommons.org/licenses/by/4.0/',
        method: 'One English country name for the ISO codes the other sources use.' },
      { name: 'Climate TRACE Emissions Inventory', href: 'https://climatetrace.org', publisher: 'Climate TRACE coalition',
        licence: 'CC BY 4.0', licenceHref: 'https://creativecommons.org/licenses/by/4.0/',
        method: 'Oil & gas facilities layer: Climate TRACE fossil-fuel-operations sources, drawn and carded as on /inmotion. Port cards: Climate TRACE port estimates within 10 km (30 km with the same name), matched to our nearest port; monthly ship-voyage emissions read live from the release /inmotion uses. Modelled from AIS; each voyage split half to each end port; not port operations. Ship cards: each ship’s trips and port stays (Salish Sea, 2024–2025), who tracked it for Climate TRACE (OceanMind or Global Fishing Watch), its deadweight and modelled CO₂ per nautical mile. Terminal cards: Climate TRACE port stays whose every position lies within 750 m of one terminal’s berth (none equally near another), counted only for the kinds of ship the terminal serves (chemical tankers count at refinery and oil docks).' },
      { name: 'IMF PortWatch', href: 'https://portwatch.imf.org',
        publisher: 'International Monetary Fund with the University of Oxford; AIS from Kpler via the UN Global Platform',
        licence: 'IMF PortWatch terms: non-commercial display with its citation (commercial redistribution: copyright@imf.org)', licenceHref: 'https://portwatch.imf.org/pages/faqs',
        method: 'Daily port calls and import/export estimates for the ports it covers, as 7-day trends. Relative trends, not official statistics; EarthAtlas shows derived trends and does not republish the raw series.',
        citation: 'Sources: Kpler; UN Global Platform; IMF PortWatch (portwatch.imf.org).' },
      { name: 'UN/LOCODE code list', href: 'https://unlocode.unece.org',
        publisher: 'UNECE', licence: 'CC BY 4.0 per the site footer (conflicts with the general UN terms; flagged)', licenceHref: 'https://creativecommons.org/licenses/by/4.0/',
        method: 'Used only as a key to match ports between sources; nothing from it is shown.' },
    ],
  },
  {
    heading: 'Ship emissions (verified)',
    sources: [
      { name: 'EU MRV: EMSA THETIS-MRV publication of information', href: 'https://mrv.emsa.europa.eu/#public/emission-report',
        publisher: 'European Maritime Safety Agency; reports by shipping companies under Regulation (EU) 2015/757, checked by accredited verifiers',
        licence: 'EMSA: “Reproduction is authorised, provided the source is acknowledged, save where otherwise stated.”', licenceHref: 'https://www.emsa.europa.eu/disclaimer.html',
        method: 'Ship cards (Emissions tab): each ship’s published annual report, 2018 onward: CO₂ (from 2024 also CH₄, N₂O and CO₂-equivalent), fuel burned, hours at sea, CO₂ per nautical mile, design efficiency, verifier. Only voyages to, from and between EU/EEA ports and time at berth in them, for ships over 5,000 GT; not the ship’s whole year. Figures copied as published, matched to our ships by registry IMO only; a part-year report after a change of company is shown on its own line, never added in.',
        citation: 'Source: EMSA THETIS-MRV, EU MRV publication of information.' },
    ],
  },
  {
    heading: 'Anchorages at stops',
    sources: [
      { name: 'Anchorages (MarineCadastre.gov)', href: 'https://www.fisheries.noaa.gov/inport/item/48849',
        publisher: 'NOAA Office for Coastal Management; U.S. Coast Guard', licence: 'U.S. Government work, public domain', licenceHref: USC105,
        method: 'The 33 CFR Part 110 anchorage areas as polygons (compiled from the CFR of 17 Nov 2022); used to say which official anchorage a stop lies in.' },
      { name: 'eCFR version history of 33 CFR Part 110', href: 'https://www.ecfr.gov/current/title-33/chapter-I/subchapter-I/part-110',
        publisher: 'Office of the Federal Register', licence: 'U.S. Government work (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Flags anchorages whose section was amended after 17 Nov 2022 as an older boundary.' },
      { name: 'Active Commercial Shipping Anchorages in Pacific Canada', href: 'https://open.canada.ca/data/en/dataset/2ccbf2d7-0b1c-4ee5-8d8f-43acc16ef1e1',
        publisher: 'Fisheries and Oceans Canada (DFO), Pacific Region', licence: 'Open Government Licence – Canada 2.0', licenceHref: OGL_CA,
        method: '117 anchorage points with swing radius; EarthAtlas draws each as a circle of that radius. Not suitable for navigation.',
        citation: 'Contains information licensed under the Open Government Licence – Canada (DFO, Active Commercial Shipping Anchorages in Pacific Canada).' },
      { name: 'Puget Sound non-designated anchorages: proposed rule 82 FR 10313',
        href: 'https://www.federalregister.gov/documents/2017/02/10/2017-02683/anchorages-captain-of-the-port-puget-sound-zone-wa',
        publisher: 'U.S. Coast Guard (Federal Register)', licence: 'U.S. Government work (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'The only published boundaries for these anchorages: a 2017 proposed rule, withdrawn in 2018 (83 FR 18491) and never in force.' },
    ],
  },
  {
    heading: 'Terminals, calls and scrubbers',
    sources: [
      { name: 'USACE Navigation Facilities (Docks)', href: 'https://geospatial-usace.opendata.arcgis.com/datasets/23d91bd988ac4fc9943128965bddfa37_0',
        publisher: 'U.S. Army Corps of Engineers (WCSC)', licence: 'Public, no use restrictions', licenceHref: 'https://geospatial-usace.opendata.arcgis.com/datasets/23d91bd988ac4fc9943128965bddfa37_0',
        method: 'US berth positions, berth lengths and the dock owner (owner text is often decades old; a port district owner makes a terminal a port-authority terminal).' },
      { name: 'Terminal calls (EarthAtlas count from NOAA AIS)', href: 'https://hub.marinecadastre.gov/pages/vesseltraffic',
        publisher: 'derived by EarthAtlas', licence: 'CC0 1.0 (source data)', licenceHref: CC0,
        method: 'A call is a ship stopped (under 0.5 knots) within a berth’s radius for at least 15 minutes; a gap of more than 6 hours starts a new call. Counted from NOAA’s minute-by-minute positions for the Salish Sea, Grays Harbor and the lower Columbia River.' },
      { name: 'IMO GISIS: MARPOL Annex VI Regulation 4.2 notifications', href: 'https://gisis.imo.org/Public/MARPOL6/Notifications.aspx?Reg=4.2',
        publisher: 'International Maritime Organization (as notified by flag administrations)', licence: 'IMO',
        method: 'Scrubbers (exhaust gas cleaning systems) that flag states have approved and notified to the IMO, matched to our ships by registry IMO number. Re-imported monthly.' },
      { name: 'MEP Alliance scrubber-fitted ship lists', href: 'https://www.mepalliance.org/list-of-scrubber-fitted-ships',
        publisher: 'Marine Environmental Protection Alliance', licence: 'MEP Alliance',
        method: 'Ships MEP Alliance lists as scrubber-fitted, matched by IMO number, or by name and size where no IMO is given (marked “inferred”).' },
      { name: 'US Census Bureau Geocoder (TIGER boundaries)', href: 'https://geocoding.geo.census.gov/geocoder/',
        publisher: 'U.S. Census Bureau', licence: 'U.S. Government work, public domain (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'The county and city or town each US terminal lies in, for the scrubber report’s place breakdown.' },
    ],
  },
  {
    heading: 'Protected areas',
    sources: [
      { name: 'NOAA Marine Protected Areas Inventory (2024)', href: 'https://marineprotectedareas.noaa.gov/dataanalysis/mpainventory/',
        publisher: 'NOAA National Marine Protected Areas Center', licence: 'U.S. Government work, public domain', licenceHref: USC105,
        method: 'Every US marine protected area meeting the IUCN definition, with its protection level and fishing, vessel and anchoring rules. Not for navigation and not a legal boundary.' },
    ],
  },
]

export const SHIPS_SOURCES_NOTES = [
  { heading: 'What kind of data each part is, and how current',
    body: 'NOAA AIS (MarineCadastre): a position every minute or so from US shore receivers; NOAA publishes each month about three months later, in batches. It draws the detailed Salish Sea tracks and counts every terminal call and anchorage stay. ' +
      'Global Fishing Watch: one position per ship per hour, about 4 days behind. It fills the months NOAA has not published yet; terminal visits from it are estimates, shown as such until NOAA’s month arrives. ' +
      'Radar (dark vessel) detections: about 5–6 days behind. Scrubber lists: IMO notifications re-imported monthly; MEP Alliance lists as each list is published. Terminal permits and SEPA reviews: as the agencies list them when last read.' },
  { heading: 'Tugs',
    body: 'Tugs are counted at terminals only from NOAA’s minute-by-minute positions. Tugs moor at their company bases a few hundred metres from the terminals they work, and hourly positions on a ~1 km grid cannot tell a tug at the berth from a tug at its base, so no tug counts are estimated for months NOAA has not published yet.' },
  { heading: 'How to read it',
    body: 'A value a ship broadcast over AIS, a value a registry recorded, a community-edited value and an inference are always kept apart and labelled as such. ' +
      'An MMSI on its own never ties two records together: MMSIs get reused. Where two sources disagree, both claims are kept.' },
]
