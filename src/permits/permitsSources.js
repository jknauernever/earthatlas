/**
 * /permits "How this is sourced" rollup (SourcesFooter). Same shape and rules as src/ships/shipsSources.js: every fact
 * here describes a source the bake (scripts/permits/bake-permits.mjs) or the hand-compiled file (data/permits/curated.json)
 * actually uses. The rollup is in addition to each value's own inline source link, never a replacement. Every href is a
 * page a person can read (agency page or /permits/source/<key>), never a service endpoint.
 * When a source changes, change it here too.
 */
const USC105 = 'https://www.law.cornell.edu/uscode/text/17/105'
const ECY_TERMS = 'https://ecology.wa.gov/About-us/Accountability-transparency/Website-information/Copyright-information'
const ECY_LICENCE = 'Use allowed with credit and a link; commercial and political use prohibited'
const CC_BY = 'https://creativecommons.org/licenses/by/4.0/'
const CC_BY_SA = 'https://creativecommons.org/licenses/by-sa/4.0/'

export const PERMITS_SOURCES_INTRO =
  'Clean Water Act permits and related actions in San Juan County, Washington, from public agency records. ' +
  'Every value on the map and in each popup carries its own source link; this is the full list in one place.'

export const PERMITS_SOURCES = [
  {
    heading: 'Fill, dredge and in-water structures (Clean Water Act §404, Rivers and Harbors Act §10)',
    sources: [
      { name: 'USACE Regulatory permit database (ORM2), public interface', href: 'https://permits.ops.usace.army.mil/orm-public',
        publisher: 'U.S. Army Corps of Engineers, Seattle District records', licence: 'U.S. Government work, public domain (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Read at each bake: every action the public permit database holds in the county box (−123.25, 48.40, −122.75, 48.80), all years and categories: individual permits and Letters of Permission (issued, denied, pending), emergency actions, jurisdictional determinations, environmental assessments, Section 408 requests and WSDOT-funded verifications. Positions, dates and decisions are the database’s own. Thirteen 2026 projects are also hand-joined to their Washington State Department of Ecology, county and NOAA records in data/permits/curated.json. The database does not hold most Nationwide or General Permit verifications, which cover many small docks.' },
      { name: 'USACE Regulatory Request System: public notices', href: 'https://rrs.usace.army.mil/rrs/public-notices?district=NWS',
        publisher: 'U.S. Army Corps of Engineers, Seattle District', licence: 'U.S. Government work, public domain (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Read at each bake: the U.S. Army Corps of Engineers lists a notice only while its comment period is open. San Juan notices (the notice’s own point in the county, or county named San Juan) are archived for good with a copy of the notice PDF, attached to the matching U.S. Army Corps of Engineers record by file number, or mapped as a new record if the permit database doesn’t hold the project yet.' },
      { name: 'USACE public library: approved jurisdictional determinations', href: 'https://publibrary.sec.usace.army.mil/',
        publisher: 'U.S. Army Corps of Engineers', licence: 'U.S. Government work (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'The JD document for NWS-2025-00697.' },
      { name: 'Seattle District public notices', href: 'https://www.nws.usace.army.mil/Missions/Civil-Works/Regulatory/Public-Notices/',
        publisher: 'U.S. Army Corps of Engineers, Seattle District', licence: 'U.S. Government work (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Read for 2026: no San Juan County notice document was found for any project here.' },
    ],
  },
  {
    heading: 'State water quality certification and coastal consistency (§401, CZMA)',
    sources: [
      { name: 'Washington State Department of Ecology Aquatics public viewer: decisions', href: 'https://apps.ecology.wa.gov/aquatics/decisions/',
        publisher: 'Washington State Department of Ecology, Shorelands and Environmental Assistance', licence: ECY_LICENCE, licenceHref: ECY_TERMS,
        method: 'Every SAN JUAN row (9 rows, 5 projects) and the order PDF each links to. Project facts, dates, work windows, and the other agencies’ approvals listed in each order’s supporting-documents table are taken from the order as written; where an order reports another agency’s action, the popup says so. The table is a rolling window (23 Feb to 21 Aug 2026 when read), so earlier 2026 decisions are not shown.',
        citation: 'Washington State Department of Ecology, Aquatics public viewer' },
    ],
  },
  {
    heading: 'Discharges (§402, NPDES)',
    sources: [
      { name: 'U.S. Environmental Protection Agency ECHO NPDES facilities and outfalls', href: 'https://echo.epa.gov/facilities/facility-search',
        publisher: 'U.S. Environmental Protection Agency, from ICIS-NPDES; Washington permits are issued by Washington State Department of Ecology', licence: 'U.S. Government work, public domain (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Read live at each bake: every NPDES permit or general-permit coverage with a point in the county that is not terminated (individual wastewater permits, boatyard, sand-and-gravel and stormwater coverages). The kind of permit is read from the permit number and U.S. Environmental Protection Agency’s industry codes only.' },
      { name: 'U.S. Environmental Protection Agency ECHO Detailed Facility Reports (violations and enforcement)', href: 'https://echo.epa.gov/facilities/facility-search',
        publisher: 'U.S. Environmental Protection Agency', licence: 'U.S. Government work (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Violations and enforcement per permit, read from U.S. Environmental Protection Agency’s Detailed Facility Report for each facility at each bake: missed or late deadlines, effluent limit exceedances by month, missing or late monitoring reports by quarter, warning letters and other informal actions, formal actions, penalties and inspections. ECHO reports by facility; each row names its permit, so a popup shows only that permit’s own. Plain words are EarthAtlas’s; U.S. Environmental Protection Agency’s own code and text are on hover.' },
      { name: 'Washington State Department of Ecology quarterly penalty release, May 2026', href: 'https://ecology.wa.gov/about-us/who-we-are/news/2026/may-20-quarterly-penalties',
        publisher: 'Washington State Department of Ecology', licence: ECY_LICENCE, licenceHref: ECY_TERMS,
        method: 'The West Sound Marina penalty.' },
      { name: 'Washington State Department of Ecology Puget Sound Nutrient General Permit page', href: 'https://ecology.wa.gov/Regulations-Permits/Permits-certifications/nutrient-permit',
        publisher: 'Washington State Department of Ecology', licence: ECY_LICENCE, licenceHref: ECY_TERMS,
        method: 'Why the treatment plant renewals are pending.' },
      { name: 'Town of Friday Harbor Wastewater Facilities Plan', href: 'https://www.fridayharbor.org/2369/Wastewater-Facilities-Plan',
        publisher: 'Town of Friday Harbor', licence: 'Public agency record; terms not stated',
        method: 'The treatment plant’s history as the Town describes it.' },
    ],
  },
  {
    heading: 'Joined from other sources',
    sources: [
      { name: 'Washington State Department of Ecology PARIS permit documents', href: 'https://apps.ecology.wa.gov/paris/PermitDocumentSearch.aspx',
        publisher: 'Washington State Department of Ecology', licence: ECY_LICENCE, licenceHref: ECY_TERMS,
        method: 'Read at each bake for every discharge permit: Washington State Department of Ecology’s document list (permits, fact sheets, approval letters, reports), newest first, each linked to its PDF. Washington State Department of Ecology’s automatic notices are shown by the report name Washington State Department of Ecology gives them.' },
      { name: 'EarthAtlas Docks (/sanjuan-docks)', href: '/sanjuan-docks',
        publisher: 'EarthAtlas, from San Juan County SmartGov and pre-SmartGov permits and Washington Department of Fish and Wildlife Hydraulic Project Approvals', licence: 'See the sources on /sanjuan-docks',
        method: 'A record is joined to a dock there only when the dock lies within 300 m AND its permits name the same applicant (the record’s surname or company name, or two shared name words). Position alone never joins. The join is EarthAtlas’s, not the agencies’, and the popup says so.' },
      { name: 'U.S. Code and Revised Code of Washington', href: 'https://www.law.cornell.edu/uscode/text/33/1344',
        publisher: 'Legal Information Institute (Cornell); Washington State Legislature', licence: 'Public law',
        method: '“Why it needs a permit” is EarthAtlas’s plain summary of the law behind each record, chosen from the record’s own type and documents; each line links the law it summarizes.' },
    ],
  },
  {
    heading: 'Receiving waters',
    sources: [
      { name: 'Washington State Department of Ecology Water Quality Assessment, Category 5 (303(d))', href: 'https://apps.ecology.wa.gov/waterqualityatlas/wqa/map',
        publisher: 'Washington State Department of Ecology', licence: ECY_LICENCE, licenceHref: ECY_TERMS,
        method: 'Read live at each bake: impaired waters intersecting the county bounding box, drawn as Washington State Department of Ecology’s own polygons with listing number, impairment and waterbody. Each links to Washington State Department of Ecology’s page for that listing and to it on Washington State Department of Ecology’s map.' },
      { name: 'Washington State Department of Health Commercial Shellfish Growing Areas and annual reports', href: 'https://doh.wa.gov/bs/node/5891',
        publisher: 'Washington State Department of Health, Office of Environmental Health and Safety', licence: 'Public agency record; terms not read',
        method: 'Read live at each bake: San Juan growing areas with classification, reason and acres, as of the layer’s own update date. Each area links to Washington State Department of Health’s annual report for it, matched by name from Washington State Department of Health’s reports page.' },
    ],
  },
  {
    heading: 'Local permits and related actions',
    sources: [
      { name: 'Town of Friday Harbor development applications', href: 'https://fridayharbor.org/2346/Development-Applications',
        publisher: 'Town of Friday Harbor', licence: 'Public agency record; terms not stated',
        method: 'Staff report and SEPA notice PDFs for the Port’s marina repairs.' },
      { name: 'San Juan County news releases', href: 'https://sanjuancountywa.gov/CivicAlerts.aspx',
        publisher: 'San Juan County', licence: 'Public agency record; terms not stated',
        method: 'Orcas Landing and Waldron float items. The county’s Hearing Examiner, agenda and notice-of-application pages refuse automated reading.' },
      { name: 'NOAA Fisheries incidental take authorization (Washington State Parks)', href: 'https://www.fisheries.noaa.gov/action/incidental-take-authorization-washington-state-parks-and-recreation-commissions-marine',
        publisher: 'NOAA Fisheries', licence: 'U.S. Government work (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Notice of receipt and program schedule.' },
      { name: 'Federal Register 2026-16329', href: 'https://www.federalregister.gov/documents/2026/08/11/2026-16329/takes-of-marine-mammals-incidental-to-specified-activities-taking-marine-mammals-incidental-to-the',
        publisher: 'Office of the Federal Register', licence: 'U.S. Government work (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Proposed rule: sites, in-water days, species.' },
      { name: 'Washington State Parks, Clean Vessel Act grants', href: 'https://parks.wa.gov/node/3650',
        publisher: 'Washington State Parks and Recreation Commission', licence: 'Public agency record; terms not stated',
        method: 'Reid Harbor pumpout barge grant.' },
      { name: 'RCO Climate Commitment Act ESRP applications, 2026', href: 'https://rco.wa.gov/wp-content/uploads/2026/06/CCA-ESRPRestoreProtectApplications-2026.pdf',
        publisher: 'Washington Recreation and Conservation Office', licence: 'Public agency record; terms not stated',
        method: 'Blind Bay and False Bay road relocation applications.' },
      { name: 'Salish Current; OPALCO blog; ConstructConnect; San Juan Journal', href: 'https://salish-current.org/',
        publisher: 'Salish Current; Orcas Power and Light Cooperative; ConstructConnect; Sound Publishing', licence: 'Linked only; summarised in EarthAtlas’s own words',
        method: 'Jackson Beach, Center Island cable, Madrona Point bid and Friday Harbor plant upgrade items, each linked where it is used.' },
    ],
  },
  {
    heading: 'Positions',
    sources: [
      { name: 'US Census Bureau Geocoder', href: 'https://geocoding.geo.census.gov/geocoder/',
        publisher: 'U.S. Census Bureau', licence: 'U.S. Government work, public domain (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Address matches for 485 Broken Point Road and 1165 West Valley Road.' },
      { name: 'OpenStreetMap', href: 'https://www.openstreetmap.org/copyright', publisher: 'OpenStreetMap contributors', licence: 'ODbL 1.0', licenceHref: 'https://opendatacommons.org/licenses/odbl/1-0/',
        method: 'Named places (Madrona Point, Blind Bay Road, False Bay Drive, Jackson Beach, Center Island, Waldron Island, Olga) for actions whose source names a place but no point; each is marked approximate and links to its OpenStreetMap page.' },
      { name: 'GeoNames', href: 'https://www.geonames.org', publisher: 'GeoNames', licence: 'CC BY 4.0', licenceHref: CC_BY,
        method: 'Named-feature points (Bell Island, Indian Cove, Friday Harbor Marina).' },
      { name: 'Wikipedia: Double Island (Washington)', href: 'https://en.wikipedia.org/wiki/Double_Island_(Washington)',
        publisher: 'Wikipedia contributors', licence: 'CC BY-SA 4.0', licenceHref: CC_BY_SA,
        method: 'The island’s coordinates, used where the cable landfall could not be geocoded (marked approximate).' },
      { name: 'WSDOT Ferries terminal locations', href: '/permits/source/wsdot-terminals',
        publisher: 'Washington State Department of Transportation', licence: 'Public agency record; terms not read',
        method: 'Orcas terminal point, used for the adjacent county dock (marked approximate).' },
      { name: 'BLM PLSS (CadNSDI)', href: 'https://www.blm.gov/programs/lands-and-realty/cadastral-survey',
        publisher: 'Bureau of Land Management', licence: 'U.S. Government work (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Checks that each address point falls in the section, township and range the Washington State Department of Ecology order states.' },
    ],
  },
]

export const PERMITS_SOURCES_NOTES = [
  { heading: 'How to read it',
    body: 'A fact stated by the issuing agency links to that agency’s document. Where one agency’s document reports another agency’s action (an Washington State Department of Ecology order listing the Washington Department of Fish and Wildlife approval date or the county’s SEPA determination), the link goes to the document that states it and the text says so. Where two sources disagree, both claims are kept. Arithmetic EarthAtlas did itself is labeled. A missing record is reported as “no record found” in a named source, never as proof that no review or permit exists.' },
  { heading: 'What kind of data each part is, and how current',
    body: 'NPDES permits, compliance, impaired waters and shellfish areas are read live from the agencies’ services at each bake (the date is in the panel). U.S. Army Corps of Engineers, Washington State Department of Ecology 401/CZM, county, town and NOAA records are hand-compiled from the documents they link to (data/permits/curated.json, 13 Oct 2026) and cover calendar year 2026.' },
  { heading: 'Not covered yet',
    body: 'Washington Department of Fish and Wildlife Hydraulic Project Approvals: Washington Department of Fish and Wildlife’s public layer was last edited 2024-12-02, so 2026 HPA dates appear only as listed in Washington State Department of Ecology orders. San Juan County SmartGov permits (2010 onward, read per parcel on /sanjuan-docks) are not joined here yet. The Washington State Department of Ecology SEPA Register refuses automated search. Washington State Department of Ecology PARIS permit documents are linked per permit, not read. Washington State Department of Ecology’s Aquatics notices page loads by script and was not read.' },
]
