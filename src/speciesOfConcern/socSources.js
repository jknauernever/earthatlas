// "How this is sourced" rollup for /species-of-concern (SourcesFooter). Each record and status in the panel also
// links to its own source; this is the summary.

export const SOC_SOURCES_INTRO =
  'Click a spot and EarthAtlas lists every species on a Washington State or federal list that has been recorded within the distance and time you choose. Only listed species are asked for, so nothing else appears. Every status links to the list that sets it, and every record links to the page where it was reported.'

const WA_PUBLIC = 'Washington State public record'
const USC105 = 'https://www.law.cornell.edu/uscode/text/17/105'

export const SOC_SOURCES = [
  {
    heading: 'Status lists',
    sources: [
      { name: 'Washington State Endangered, Threatened and Sensitive species (WAC 220-610-010, WAC 220-200-100) and state Candidate species',
        href: 'https://wdfw.wa.gov/species-habitats/at-risk/listed', publisher: 'Washington Department of Fish and Wildlife', licence: WA_PUBLIC,
        method: 'Endangered list as amended effective 2026-01-24; Threatened and Sensitive effective 2023-12-28; Candidate list of 2024-03.' },
      { name: 'Federal Endangered Species Act listings for Washington, and USFWS Species of Concern', href: 'https://ecos.fws.gov/ecp/report/species-listings-by-state?stateAbbrev=WA&stateName=Washington&statusCategory=Listed',
        publisher: 'U.S. Fish and Wildlife Service (ECOS), with NOAA Fisheries listings', licence: 'U.S. Government work, public domain (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Listed, proposed, candidate and under-review species whose ECOS range includes Washington, plus the NOAA-led populations in Washington waters (salmon, steelhead, orcas, whales, rockfish, sea turtles) and the sunflower sea star (NOAA proposal). "Species of Concern" is an informal USFWS label with no ESA protection.' },
      { name: 'Washington Vascular Plant Species of Conservation Concern (2024)', href: 'https://dnr.wa.gov/natural-heritage-program/rare-species/species-lists',
        publisher: 'Washington Department of Natural Resources, Natural Heritage Program', licence: WA_PUBLIC,
        method: 'State status for plants: Endangered, Threatened, Sensitive and Possibly extirpated.' },
      { name: "Species of Greatest Conservation Need, Washington's State Wildlife Action Plan 2025-2035", href: 'https://wdfw.wa.gov/species-habitats/at-risk/swap',
        publisher: 'Washington Department of Fish and Wildlife', licence: WA_PUBLIC,
        method: 'Tables A (254 animals) and B (plants). A planning designation; it carries no legal protection by itself.' },
      { name: 'Priority Habitats and Species List (2026)', href: 'https://wdfw.wa.gov/publications/00165',
        publisher: 'Washington Department of Fish and Wildlife', licence: WA_PUBLIC,
        method: 'Priority species only; the reason each is listed is shown with it. Priority habitats and concentration areas are places, not species, and are not included.' },
    ],
  },
  {
    heading: 'Agency mapping (the regulatory record)',
    sources: [
      { name: 'ESA critical habitat, all designations (NMFS ESA Critical Habitat)', href: 'https://www.fisheries.noaa.gov/national/endangered-species-conservation/critical-habitat',
        publisher: 'NOAA Fisheries', licence: 'U.S. Government work, public domain (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Designated critical habitat polygons and stream lines within the circle, and whether the spot itself is inside, each with its Federal Register rule and 50 CFR section.' },
      { name: 'Critical habitat for threatened and endangered species (final and proposed)', href: 'https://ecos.fws.gov/ecp/report/critical-habitat',
        publisher: 'U.S. Fish and Wildlife Service', licence: 'U.S. Government work, public domain (17 U.S.C. § 105)', licenceHref: USC105,
        method: 'Same, for USFWS-designated critical habitat.' },
      { name: 'Priority Habitats and Species on the Web (public layers)', href: 'https://geodataservices.wdfw.wa.gov/hp/phs/',
        publisher: 'Washington Department of Fish and Wildlife', licence: 'Public; WDFW asks to be credited',
        method: 'Priority species occurrences and priority habitats within the circle. WDFW generalizes sensitive species to a section, quarter township or township; those are shown at that resolution. The layer combines several datasets that can overlap, each named on its entry: WDFW’s own regional mapping and survey records, the U.S. Fish and Wildlife Service’s National Wetlands Inventory, and forage fish spawning surveys by WDFW and partners (Marine Resources Committees, tribes, Friends of the San Juans).' },
    ],
  },
  {
    heading: 'Records',
    sources: [
      { name: 'iNaturalist observations', href: 'https://www.inaturalist.org', publisher: 'iNaturalist (California Academy of Sciences and National Geographic Society)',
        licence: 'Each observation carries its own license (CC0, CC BY or CC BY-NC); see the observation page',
        method: 'Research-grade and needs-ID observations of listed taxa, captive and cultivated excluded. Locations iNaturalist blurs to protect a sensitive species are shown as blurred.' },
      { name: 'GBIF occurrence records', href: 'https://www.gbif.org', publisher: 'Global Biodiversity Information Facility, from the datasets named on each record',
        licence: 'Per dataset (CC0, CC BY or CC BY-NC); see the record page',
        method: 'Occurrences of listed taxa within the circle, minus the copies of iNaturalist and Happywhale records that are read directly. Includes eBird checklists up to the date GBIF last received them.' },
      { name: 'eBird', href: 'https://ebird.org', publisher: 'Cornell Lab of Ornithology', licence: 'eBird API terms of use', licenceHref: 'https://www.birds.cornell.edu/home/ebird-api-terms-of-use/',
        method: 'The latest sighting of each listed bird within the circle over the last 30 days (the longest eBird allows). The location is the checklist site, not the bird.' },
      { name: 'Whale and marine-mammal sightings (EarthAtlas whales database)', href: '/whalewatch',
        publisher: 'Whale Alert (Conserve.io, via the Acartia data cooperative), Happywhale, SalishSea.io, OBIS, Orcasound',
        licence: 'Whale Alert CC BY 4.0; SalishSea.io CC BY-NC 4.0; others per record',
        method: 'Sightings within the circle, read from the database EarthAtlas keeps of these feeds. Observers’ remarks (for example a killer whale ecotype such as "Bigg’s T19s") are shown with each record.' },
    ],
  },
]

export const SOC_SOURCES_NOTES = [
  { heading: 'Listed populations and subspecies', body: 'Some listings cover only part of a species: Southern Resident killer whales (federal), Western North Pacific gray whales, five steelhead populations, or a subspecies such as the streaked horned lark. Record sources name the species, not the population, so such a record shows as "species recorded; listed population not confirmed". Where every member of a species in Washington belongs to the listed subspecies (for example the northern spotted owl), species records count.' },
  { heading: 'Killer whale ecotypes', body: 'Only Southern Resident killer whales (J, K and L pods) are federally listed. No record source has a field for that, so EarthAtlas reads the observer’s own words: Orca Network and SalishSea.io remarks, iNaturalist notes and Happywhale individual labels. A remark naming J, K or L pod or a member (J35), or "SRKW", counts; "Biggs" or a T-number means Bigg’s killer whales. A hedged identification ("likely J pod") is shown as tentative and confirms nothing.' },
  { heading: 'Humpback whale populations', body: 'Humpbacks feeding off Washington come from three populations: Central America (federally endangered), Mexico (threatened) and Hawaii (not listed). A sighting does not say which, so humpback records do not confirm the federal listing. Washington lists all humpbacks as endangered.' },
  { heading: 'Blurred locations', body: 'iNaturalist hides the true location of many sensitive species somewhere inside a 0.2° grid square (about 22 by 15 km here). A blurred record is listed when its square touches your circle; it may be up to about 28 km from the spot.' },
  { heading: 'Absence of records', body: 'No records does not mean a species is absent. It means none was reported to these sources in the chosen time. Many listed species are rarely reported, and some surveys are not published.' },
]
