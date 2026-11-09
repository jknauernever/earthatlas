# /shoreline/reports — "What's mapped on the shoreline" (design, 2026-11-08)

Josh 2026-11-08: a first report for /shoreline that shows counts for all the data the site has, with an island filter at the top.

## Page

**Scope rule (Josh 2026-11-09):** only the datasets in the map's left-hand nav, plus summaries of them (e.g. properties with waterfront). Friends projects are not a map layer, so they are not in the report. Cards and row names follow the nav's names and order.

`/shoreline/reports` (same shape as `/spills/reports`, `/risks/reports/land-value`; shared report frame `ScrubberReport.module.css`).

- **Brand:** Friends of the San Juans logo on every host (Friends logo rule) + "Shoreline Ecosystems"; back link to `/shoreline`.
- **Island filter (top of the page; not sticky — the site's html/body `overflow-x: hidden` defeats `position: sticky`):** chips — All islands · San Juan · Orcas · Lopez · Shaw · Stuart · Waldron · Decatur ·
  Blakely · Henry · Center · Crane · Other islands. Same island list as the /risks land-value report (Assessor districts), so the
  two San Juan County reports agree. URL state `?i=Orcas`. Islands with no data are left out.
- **Headline tiles (4):** miles of shoreline mapped (shoreforms) · acres of bull kelp · miles of armored shoreline · shoreline
  structures (docks + buoys/floats + ramps + railways + groins + pilings).
- **Habitat card:** bull kelp (beds, acres) · deepwater eelgrass edge (miles) · herring spawning grounds (acres, how many grounds) ·
  smelt & sand lance documented beaches (beaches, miles) · potential habitat (miles).
- **Priority Shorelines for Fish card:** miles at each level (moderate / high / highest) for each of the seven species and for
  "highest of all seven", stacked bars in the map's tier colors.
- **Shoreline card:** shoreform groups, miles each, bars in the map's shoreform colors.
- **Shoreline modifications card:** armor (miles, pieces) · docks · mooring buoys & floats · boat ramps · marine railways · groins · pilings.
- **Property card:** tax parcels (count, acres) · waterfront parcels (Assessor waterfront length > 0) · building footprints (count, sq ft).
- **By island table** (All islands only): one row per island, key counts in columns; click a row = filter.
- **How this is counted** + Sources footer + BuiltByCredit.
- Every number carries its own source link (prime directive); American spelling; no caveat boxes up top; omit rows with no data.

## Data: `public/shoreline-data/report-counts.json` (baked, a few KB)

`scripts/shoreline/report-counts.py` (Python + shapely, like bake-parcels.py) reads the same files the map draws
(`public/shoreline-data/*`, `public/permits-data/friends-habitat.geojson` is the same habitat data) and the county parcels/buildings
(`data/shoreline/raw/`, from fetch-county.mjs).

**Which island a thing belongs to** — geometric, so marine features (kelp, buoys, eelgrass) get an island too:
1. Every tax parcel gets an island from its Assessor district (the /risks rule).
2. Parcels (UTM 10N) are buffered 15 m and unioned; each connected land mass is one island, named by the district its parcels mostly
   are (by area). This keeps a stray district code from claiming a piece of another island's coast.
3. Everything is assigned to the **nearest** land mass: points directly; lines cut into ≤20 m pieces, each piece by its midpoint
   (so a long line split between islands is split in its miles); kelp beds by their own point; herring grounds by a 50 m grid of
   points inside (acres split by nearest island); parcels and buildings by the land mass they sit on.

So island totals always add up to the county total (except "how many herring grounds", which counts a ground on every island it reaches).

Refresh: run the script after a new county fetch or a new Friends import; the yearly shoreline-bake Action can call it later.
Not wired into the Action in this first version.

## Self-review (before building)

- *Is "nearest island" honest for offshore features?* It's the only way kelp and buoys get an island; said plainly in "How this is
  counted". Friends' own ISLAND fields exist on only some layers, so they can't be the rule; a geometric rule is consistent.
- *Line feature counts* ("891 eelgrass segments") mean nothing to readers → lines are shown in miles; counts only for things people
  think of as items (beds, beaches, buoys, docks, parcels, buildings, projects).
- *Waterfront frontage in feet* — the Assessor field's unit isn't documented in the download → show waterfront parcel count only.
- *Print* → unchosen chips hidden; the chosen island prints, and the facts row says what's shown.
- *Load cost* → one small JSON; no map, no tiles, no extra Mapbox use.
- *Link from /shoreline* → one quiet line in the panel above the Sources footer ("Shoreline data by island — report").
