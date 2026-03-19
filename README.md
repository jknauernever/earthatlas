# EarthAtlas

**Discover what species of plants, animals, and fungi are living around you — right now.**

EarthAtlas is an open biodiversity explorer that aggregates real-time observation data from the world's largest citizen science platforms. It makes global biodiversity data accessible, visual, and engaging — whether you're a researcher, a nature enthusiast, or just curious about the wildlife near you.

Live at [earthatlas.org](https://earthatlas.org)

---

## Why EarthAtlas Exists

Billions of wildlife observations are collected every year by citizen scientists, researchers, and institutions around the world. This data lives across fragmented platforms — iNaturalist, eBird, GBIF, museum databases — each with different APIs, data formats, and access patterns. EarthAtlas brings these sources together into a single, unified interface that lets anyone explore biodiversity by location, species group, or time period without needing to understand the underlying data infrastructure.

The goal is to make biodiversity data feel immediate and personal. Not "there are 2.4 billion records in GBIF" but "a Brown-throated Three-toed Sloth was spotted 3 km from where you're standing, 6 days ago."

---

## What EarthAtlas Does

### Homepage — Universal Species Explorer

The homepage at [earthatlas.org](https://earthatlas.org) is a general-purpose species explorer. Users can:

- **Search by location** — browser geolocation, manual search (Nominatim geocoding), or "Anywhere" mode
- **Filter by data source** — iNaturalist, eBird, GBIF, or All (merged + deduplicated)
- **Filter by taxon** — Aves, Mammalia, Insecta, Reptilia, Amphibia, Fungi, Plantae, Arachnida
- **Adjust search radius** — 0.5 km to 50 km
- **Adjust time window** — last hour, day, week, month, year, or all time
- **Search by species** — autocomplete powered by iNaturalist taxa search
- **View results** in four modes:
  - **Grid** — photo cards with observation details
  - **List** — compact tabular view
  - **Map** — Mapbox GL map with species sidebar and clickable markers
  - **Insights** — analytics dashboard with seasonality charts, year-over-year trends, conservation status breakdowns, and taxonomic composition

The homepage also displays:
- **Global stats** — total occurrences (GBIF), species documented (iNaturalist), active observers in the last 90 days
- **Most Observed Species** — top species on iNaturalist, filterable by time period (24h / 30d / all time)
- **Top Reporting Countries** — ranked by observation count
- **Explore by Group** — card grid linking to each animal group subsite

### Explore Subsites — Focused Animal Group Explorers

EarthAtlas has 14 dedicated group explorers, each at its own route:

| Route | Group | GBIF Taxon | Species Tracked |
|---|---|---|---|
| `/whales` | Whales & Cetaceans | Order Cetacea (key 733) | 100+ species |
| `/sharks` | Sharks | Class Chondrichthyes (key 121) | 25+ species |
| `/butterflies` | Butterflies & Moths | Order Lepidoptera (key 797) | 40+ species |
| `/tigers` | Tigers | Species *Panthera tigris* (key 5219404) | 6 subspecies |
| `/lions` | Lions | Species *Panthera leo* (key 5219426) | 2 subspecies |
| `/dolphins` | Dolphins | Infraorder Delphinida (iNat 1317261) | 15+ species |
| `/elephants` | Elephants | Family Elephantidae (key 5965) | 3 species |
| `/bears` | Bears | Family Ursidae (key 9678) | 8 species |
| `/monkeys` | Monkeys & Primates | Order Primates (key 798) | 10+ species |
| `/hippos` | Hippos | Family Hippopotamidae (key 4833) | 2 species |
| `/wolves` | Wolves & Wild Canids | Family Canidae (key 9701) | 6 species |
| `/condors` | Condors | Family Cathartidae (key 3242141) | 2 species |
| `/sloths` | Sloths | Order Pilosa (key 1494) | 6 species |
| `/fungi` | Fungi | Kingdom Fungi (key 5) | 10 species |

Each subsite provides:

- **Hero landing page** — full-bleed image, search bar, geolocation, curated hotspot buttons (e.g., "Manuel Antonio, Costa Rica" for sloths)
- **Recent sightings mode** — observations from the past 90 days, shown on an interactive map
- **Seasonal patterns mode** — historical monthly distribution, scrubbable month-by-month with a slider
- **Species sidebar** — aggregated species list with photo, observation count, IUCN status, and click-to-highlight on map
- **Per-species seasonal chart** — click a species to see its specific monthly activity pattern
- **Time slider** — filter displayed sightings by date range within the loaded data

### Live Globe — Real-Time Observation Visualizer

The live globe at [earthatlas.org/live](https://earthatlas.org/live) displays a real-time 3D globe showing biodiversity observations as they are reported worldwide.

- **Mapbox GL globe projection** with dark basemap and atmospheric fog/stars
- **Real-time polling** — fetches recent observations from iNaturalist and eBird every 60 seconds
- **Drip-in animation** — new observations appear one at a time with staggered timing rather than all at once
- **Orange dot markers** — bright and opaque when new, fading to near-transparent over 5 minutes before disappearing
- **Yellow glow** — new observations pulse with a yellow halo for the first 5 seconds
- **Photo thumbnails** — observations with photos show a 50x50px thumbnail above their dot (front-side of globe only), with hover-to-expand cards showing species name, scientific name, location, and source
- **Camera modes:**
  - **Rotate** — slow continuous rotation (default)
  - **Fly-to** — automatically flies to random observations every 5 seconds
  - **Fixed** — user-controlled pan/zoom only
- **Source filter** — toggle between All, iNaturalist, and eBird
- **Basemap selector** — Mapbox styles (Dark, Satellite, Light, Outdoors, Streets) plus third-party tilesets (ESRI, CartoDB, Stadia, Google)
- **Live stats** — observation count and unique species count displayed in real time

**Key files:**
- `src/live/LiveGlobe.jsx` — main component (map init, data polling, rendering)
- `src/live/LiveGlobe.module.css` — layout and UI overlay styles
- `src/live/liveService.js` — data fetching from iNaturalist and eBird APIs, with Macaulay Library photo lookup for birds

### Species Detail Pages

Each species has a dedicated page at `/species/:taxonId` with:

- Taxonomy, IUCN conservation status, and photos
- Wikipedia extract
- Monthly seasonality chart (GBIF occurrence facets)
- Recent observations (past 30 days)
- Distribution map (GBIF heatmap or point data)
- Links to source records on iNaturalist and GBIF

Species pages use **preloaded data bundles** (generated at build time) for instant loading, with fallback to live API calls.

---

## Data Sources

EarthAtlas aggregates data from three primary sources. No proprietary data is stored — all data is fetched live from public APIs or cached at build time.

### iNaturalist

**What it is:** The world's largest citizen science biodiversity platform. Users photograph organisms in the wild, and the community collaboratively identifies them to species.

**API:** `https://api.inaturalist.org/v1`

**How EarthAtlas uses it:**
- **Observations search** — location-based queries with taxon, date, and geo filters
- **Taxa search** — autocomplete for species name lookup
- **Global stats** — total observations, species count, active observers
- **Top species** — most-observed species globally within time windows
- **Top countries** — observation counts by country
- **Species photos** — taxon default photos and observation photos
- **Taxon taxonomy** — for cross-referencing with GBIF

**Key parameters:** `taxon_id`, `lat`, `lng`, `radius`, `d1`/`d2` (date range), `nelat`/`nelng`/`swlat`/`swlng` (bounding box), `geo=true`, `captive=false`

**User-Agent:** All iNaturalist requests include `User-Agent: EarthAtlas/1.0 (https://earthatlas.org)`

### GBIF (Global Biodiversity Information Facility)

**What it is:** An international data infrastructure that aggregates biodiversity occurrence records from hundreds of sources worldwide — museums, research institutions, citizen science platforms (including iNaturalist and eBird), and government agencies.

**API:** `https://api.gbif.org/v1`

**How EarthAtlas uses it:**
- **Occurrence search** — `taxonKey`, `hasCoordinate=true`, `occurrenceStatus=PRESENT`, bounding box via `decimalLatitude`/`decimalLongitude` ranges, `eventDate` ranges
- **Monthly facets** — `facet=month` with `month.facetLimit=12` for seasonal distribution charts
- **Global stats** — total occurrence count via GBIF API
- **Species detail pages** — occurrence data for distribution maps

**Deduplication:** GBIF includes iNaturalist as a data source (dataset key `50c9509d-22c7-4a22-a47d-8c48425ef4a7`). To avoid double-counting when merging sources, EarthAtlas filters out records from this dataset in GBIF results. Records with `basisOfRecord: 'LIVING_SPECIMEN'` (zoo/aquarium animals) are also excluded.

**Raster tile heatmaps:** For butterflies, EarthAtlas uses GBIF's map tile API (`api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png`) to render all-time and recent observation density as raster overlays on the Mapbox map.

### eBird (Cornell Lab of Ornithology)

**What it is:** The world's largest bird observation database, managed by the Cornell Lab of Ornithology. Birders submit checklists of species observed at specific locations.

**API:** `https://api.ebird.org/v2` (requires API key)

**How EarthAtlas uses it:**
- **Recent observations** — nearby observations within a radius and time window
- **Taxonomy** — full eBird taxonomy download, cached locally for autocomplete
- **Photo lookup** — cross-references bird species to iNaturalist for photos

**Constraints:** eBird API limits searches to 50 km radius and time windows up to ~30 days. Only available for birds (Aves). EarthAtlas handles these constraints in the UI when eBird is the selected source.

### Supporting Services

- **Mapbox GL** — map rendering, geocoding (reverse geocoding for map pan events)
- **OpenStreetMap Nominatim** — reverse geocoding for location search (no API key required)
- **Wikipedia API** — article extracts for species detail pages

---

## Architecture

### Tech Stack

- **React 18** + **React Router 7** — component architecture
- **Vite 5** — build tool and dev server
- **Mapbox GL 3** — map rendering (native GL heatmaps, circle layers, popups)
- **CSS Modules** — component-scoped styling with global design tokens
- **PostHog** — product analytics
- **Vercel** — hosting and deployment
- **Google Analytics** — page-level analytics

### Design System

EarthAtlas uses a warm, natural-feeling design language:

- **Fonts:** Playfair Display (serif headings), DM Sans (body), DM Mono (data)
- **Colors:** Ink (#1a1610), Parchment (#f5f0e8), Moss (#3d5a3e), Amber (#b8842a), Rust (#8b4513)
- **Mobile-first** responsive layout with breakpoints at 600px and 768px

### Config-Driven Subsite Architecture

All 14 group explorers share the same `ExploreApp` component. Each is parameterized by a **config object** that defines:

```
config = {
  slug           — URL path ('whales', 'sharks', etc.)
  name           — display name
  emoji          — representative emoji
  gbifTaxonKey   — GBIF backbone taxon key for API queries
  theme          — glow colors for UI accents
  hero           — background image, title text, accent colors
  seo            — page title, description, OG image
  defaults       — radiusKm, days, maxSightings, zoom
  fallback       — defaults for unknown species (color, emoji, name)
  loading/empty  — loading and empty state messaging
  hotspots       — curated notable locations with lat/lng
  heatmapLayers  — GBIF raster tile URLs (butterflies only)
  postFilter     — function to filter API results to target species
  service        — API service instance (created by shared-service factory)
}
```

Each config has a corresponding **species-data file** that defines:
- `GBIF_TAXON_KEY` and `INAT_TAXON_ID` for API queries
- `SPECIES_META` — per-species metadata (common name, scientific name, color, emoji, fun fact, photo URL, IUCN status)
- Optional `postFilter` function for taxonomic precision (e.g., `isShark` filters Chondrichthyes to only shark orders, `isCondor` filters Cathartidae to only condors excluding other vultures, `isSloth` filters Pilosa to only sloths excluding anteaters)

### Shared Service Factory

`createExploreService()` creates a parameterized API client for each animal group:

```javascript
createExploreService({
  gbifTaxonKey,  // GBIF backbone key
  inatTaxonId,   // iNaturalist taxon ID
  speciesMeta,   // { [speciesKey]: { common, scientific, color, ... } }
  fallback,      // defaults for unrecognized species
  postFilter,    // optional taxonomic filter
})
```

Returns:
- `fetchRecentSightings()` — GBIF occurrences within a bounding box and date range
- `fetchMonthSightings()` — GBIF + iNaturalist data for a specific month (parallel fetch)
- `fetchSeasonalPattern()` — 12-month histogram via GBIF occurrence facets
- `fetchINatSightings()` — iNaturalist observations (merged with GBIF for broader coverage)
- `aggregateSpecies()` — groups sightings by species, counts, last-seen dates
- `getSpeciesMeta()` — lookup species metadata by GBIF key

All services normalize GBIF occurrences and iNaturalist observations into a common sighting shape with: `id`, `speciesKey`, `common`, `scientific`, `color`, `emoji`, `fact`, `iucn`, `lat`, `lng`, `date`, `place`, `observer`, `photos`, `source`.

### Map Rendering

ExploreMap uses two rendering paths:

**GL Layers path** (all subsites except butterflies):
- **GeoJSON source** with sighting points
- **Heatmap layer** at low zoom (z < 7) — bright yellow/orange density blobs using GPU-rendered `heatmap` layer type
- **Circle layer** at high zoom (z > 10) — individual clickable dots with data-driven color from species metadata
- **Crossfade zone** (z 7–10) — heatmap fades out via `heatmap-opacity` interpolation while circles fade in via `circle-opacity` interpolation, all evaluated on the GPU
- **Click-to-popup** on circle features with species info, photos, IUCN status, links to source records
- **Active species highlighting** via `setPaintProperty` — selected species dots grow and glow yellow, others dim

**DOM markers path** (butterflies only):
- GBIF raster tile heatmap for all-time and recent observation density
- Individual DOM marker elements toggled by zoom threshold
- Preserved for butterflies because GBIF's pre-rendered tile heatmap provides continent-scale density visualization that would require millions of points to replicate with GeoJSON

### Data Flow

**Homepage:**
```
User action → URL params (useQueryParams) → handleSearch()
  → Promise.all([ iNaturalist, eBird, GBIF ]) → normalize → deduplicate
  → display in grid / list / map / insights
```

**Explore subsites:**
```
Location entered → center map → loadData()
  → Promise.all([ GBIF recent, seasonal pattern, iNaturalist ])
  → normalize → merge → postFilter → aggregate species
  → display on map + species sidebar + season chart

Map pan/zoom → viewport bounds → re-fetch with new bounds
  → update map layers + sidebar
```

### URL State

All search state is encoded in the URL for shareability and bookmarkability:

**Homepage:** `?lat=&lng=&source=&radius=&time=&taxon=&species=&view=`

**Explore subsites:** `?lat=&lng=&name=&mode=&month=&species=`

### Build-Time Data

Two prebuild scripts run before `vite build`:

- **`prebuild-stats.js`** — fetches global stats from iNaturalist/GBIF and writes to `src/data/preloaded-stats.json` for instant homepage rendering
- **`prebuild-species.js`** — fetches taxonomy, photos, seasonality, and recent observations for 150+ species and writes bundles to `src/data/species/` for instant species detail page loads

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Environment Variables

Create a `.env` file:

```bash
VITE_MAPBOX_TOKEN=pk_...          # Mapbox GL access token (required for maps)
VITE_EBIRD_API_KEY=...            # eBird API key (required for bird data)
VITE_POSTHOG_KEY=phc_...          # PostHog analytics key (optional)
VITE_POSTHOG_HOST=https://...     # PostHog host (optional)
```

### Development

```bash
npm install
npm run dev
```

Opens [http://localhost:5173](http://localhost:5173)

### Production Build

```bash
npm run build    # runs prebuild scripts + vite build
npm run preview  # preview the production build locally
```

### Deployment

Deployed on Vercel. Push to `main` triggers automatic deployment to [earthatlas.org](https://earthatlas.org).

---

## Project Structure

```
earthatlas/
├── public/                         Static assets (hero images, favicon, sitemap)
├── scripts/
│   ├── prebuild-stats.js           Fetch global stats at build time
│   └── prebuild-species.js         Fetch species bundles at build time
├── src/
│   ├── main.jsx                    React router setup, PostHog init
│   ├── App.jsx                     Homepage component
│   ├── App.css                     Homepage styles
│   ├── index.css                   Global design tokens and shared styles
│   │
│   ├── components/                 Homepage UI components
│   │   ├── GlobalStats.jsx         Global counters + explore-by-group grid
│   │   ├── Controls.jsx            Search filters (location, radius, time, taxon)
│   │   ├── MapView.jsx             Homepage map view
│   │   ├── SpeciesGrid.jsx         Card-based results
│   │   ├── SpeciesList.jsx         List-based results
│   │   ├── SpeciesMapModal.jsx     Species detail modal with map
│   │   ├── ObservationModal.jsx    Observation detail modal
│   │   └── insights/              Analytics dashboard components
│   │
│   ├── explore/                    Unified explore subsite system
│   │   ├── ExploreApp.jsx          Core explore component (hero → loading → explore)
│   │   ├── shared-service.js       API service factory (GBIF + iNaturalist)
│   │   ├── configs/                13 animal group config files
│   │   ├── species-data/           13 species metadata + GBIF/iNat IDs
│   │   └── components/             Explore-specific UI
│   │       ├── ExploreMap.jsx      Mapbox map (heatmap ↔ dots crossfade)
│   │       ├── SpeciesListItem.jsx Species sidebar items
│   │       ├── SeasonChart.jsx     Monthly distribution bar chart
│   │       ├── LocationSearch.jsx  Location autocomplete
│   │       └── TimeSlider.jsx      Date range / month scrubber
│   │
│   ├── live/                       Live globe visualization
│   │   ├── LiveGlobe.jsx           Real-time 3D globe (/live)
│   │   ├── LiveGlobe.module.css    Globe layout and overlay styles
│   │   └── liveService.js          iNaturalist + eBird polling, photo lookup
│   │
│   ├── species/                    Species detail pages
│   │   ├── SpeciesDetailPage.jsx   Single-species page (/species/:taxonId)
│   │   └── speciesService.js       Species data fetching
│   │
│   ├── services/                   API integrations
│   │   ├── iNaturalist.js          iNaturalist API v1
│   │   ├── gbif.js                 GBIF Occurrence API v1
│   │   ├── eBird.js                eBird API 2.0
│   │   ├── taxonCrosswalk.js       Cross-reference GBIF ↔ iNat ↔ eBird IDs
│   │   ├── insights.js             Analytics aggregations
│   │   └── mapbox.js               Mapbox utilities
│   │
│   ├── hooks/
│   │   ├── useGeolocation.js       Browser geolocation
│   │   ├── useQueryParams.js       URL state management
│   │   └── useSEO.js               Meta tag injection
│   │
│   ├── utils/
│   │   ├── taxon.js                Taxon color/emoji/label maps
│   │   └── cache.js                In-memory caching with TTL
│   │
│   └── data/
│       ├── preloaded-stats.json    Build-time global stats snapshot
│       └── species/                150+ preloaded species bundles
```

---

## Key Design Decisions

1. **Config-driven subsites over code duplication.** All 13 animal explorers share one `ExploreApp` component. Adding a new animal group means creating a config file and a species-data file — no new components needed.

2. **PostFilter pattern for taxonomic precision.** When the target group doesn't map cleanly to a single GBIF taxon (e.g., condors are in family Cathartidae with vultures, sloths are in order Pilosa with anteaters), a `postFilter` function narrows results after fetching. This lets us query at a broader taxonomic level for better API coverage while displaying only the target species.

3. **Multi-source deduplication.** iNaturalist data exists in GBIF as a dataset. When merging sources, GBIF results are filtered to exclude the iNaturalist dataset (`50c9509d-22c7-4a22-a47d-8c48425ef4a7`) to prevent double-counting.

4. **GPU-rendered map layers over DOM markers.** Heatmap and circle layers are rendered as native Mapbox GL layers (evaluated on the GPU) rather than DOM elements. This scales to hundreds of points without performance degradation and enables smooth zoom-based crossfade animations.

5. **Viewport-based data fetching on explore pages.** When users pan or zoom the map, data is re-fetched using the actual map viewport bounds rather than a fixed radius. This means zooming out naturally reveals observations across a wider area.

6. **Preloaded species bundles.** Species detail pages load build-time-generated JSON bundles for instant rendering, with live API fallback. This avoids visible loading states for the most-visited species.

7. **URL as source of truth.** All search parameters are encoded in the URL, making every view shareable and bookmarkable. The `useQueryParams` hook syncs React state with URL search params.

---

## Data Attribution

EarthAtlas is built on open biodiversity data. All observation records are sourced from and attributed to:

- **[iNaturalist](https://www.inaturalist.org)** — A joint initiative of the California Academy of Sciences and the National Geographic Society
- **[GBIF](https://www.gbif.org)** — The Global Biodiversity Information Facility, an international network and data infrastructure
- **[eBird](https://ebird.org)** — Managed by the Cornell Lab of Ornithology

Individual observations link back to their source records on the originating platform.
