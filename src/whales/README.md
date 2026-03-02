# EarthAtlas / Whales

> *Find whales. Near you. Whenever you go.*

A focused mini-app within [EarthAtlas.org](https://earthatlas.org) for discovering cetacean sightings and planning whale-watching trips. Lives at **earthatlas.org/whales**.

---

## Table of Contents

1. [What This Is](#what-this-is)
2. [Design Concept](#design-concept)
3. [Features](#features)
4. [Data Sources](#data-sources)
5. [Architecture](#architecture)
6. [File Structure](#file-structure)
7. [Running Locally](#running-locally)
8. [Future Roadmap](#future-roadmap)
9. [Happywhale Partnership Plan](#happywhale-partnership-plan)
10. [Design System Reference](#design-system-reference)

---

## What This Is

Two questions drive this entire product:

1. **"Have whales been seen near me recently?"**
2. **"I'm going to [place] in [month] — what are my odds of seeing a whale?"**

Nothing on the web currently answers both of these well in one place. Whale Museum and Happywhale are excellent scientific resources but are not designed for casual trip planning. iNaturalist has the data but no cetacean-specific experience. This app fills that gap.

The target user is someone planning a coastal trip who has never used a biodiversity platform — they're curious, excited, and want to feel wonder, not parse a database.

---

## Design Concept

### The Core Aesthetic Idea

The app should feel like the ocean, not like software. A magazine spread, not a dashboard. The experience should make you want to look out a window.

### Visual Language

| Element | Choice | Rationale |
|---|---|---|
| Background | Near-black navy (`#030c18`) | Not generic dark mode gray — this is *deep water* |
| Accent | Bioluminescent teal (`#4dd9c0`) | Warm, organic, not sterile blue |
| Display font | Fraunces (serif, variable) | Nature documentary title card energy; elegant without being stuffy |
| Body font | DM Sans | Clean, unpretentious, pairs beautifully with Fraunces |
| Whale graphics | SVG silhouettes, opacity ~4% | Ambient, not illustrative — you feel them more than see them |
| Motion | Unhurried, spring physics | Wonder doesn't rush |

### The One Thing Users Should Remember

**"This felt like the ocean."**

Not "this had a lot of data." Not "the map was interactive." The emotional residue is what matters.

### Motion Principles

- Hero content fades up from below on load (`heroFadeUp` keyframe, 1.1s)
- Whale silhouettes drift slowly on a 18–26 second cycle (`whaleDrift`)
- Species cards slide in from the right, staggered by 70ms each
- Seasonal bars animate with spring overshoot on first render
- Season bar glow pulses on hover — like something alive underwater
- Everything transitions at 200–350ms. Nothing snaps.

---

## Features

### Phase 1 (Current) — "Now" View
- Location detection (GPS or place name search via Mapbox Geocoding)
- Map of cetacean sightings in the past 90 days within ~300km
- Species cards showing count, likelihood bar, species fact, and last-seen date
- Seasonal pattern chart (all-time monthly density, 12-bar chart)
- Click any month to reload map and species cards with historical data for that month
- Mode toggle: "Recent sightings" vs. "Seasonal patterns"

### Phase 2 (Planned) — Trip Planning
- Destination-first flow: "I'm going to Santa Cruz in June" 
- Confidence score per species per month derived from GBIF historical records
- Shareable links: `earthatlas.org/whales?place=monterey&month=6`

### Phase 3 (Planned) — Species Detail Pages
- Individual species pages: `/whales/species/humpback`
- Migration map, size comparison chart, best places globally, best months
- Pure education — no new API calls needed beyond what Phase 1 already collects

### Phase 4 (Planned) — Happywhale Integration
- Named individual whales with sighting history and migration tracks
- "Comet, a humpback first identified in 2019, was last seen 40km from here in February"
- Requires direct partnership with Ted Cheeseman at Happywhale (see below)

---

## Data Sources

### GBIF (Global Biodiversity Information Facility)
- **URL:** https://api.gbif.org/v1
- **Auth:** None required for read operations
- **Taxon:** Order Cetacea, backbone key `733`
- **What it provides:** Decades of cetacean occurrence records from museums, research institutions, and citizen science aggregators including Happywhale data via OBIS-SEAMAP
- **Limitation:** Individual whale IDs and match history don't survive normalization into GBIF's schema
- **Attribution:** Data from GBIF.org — CC BY 4.0

### Whale Museum Hotline API
- **URL:** https://hotline.whalemuseum.org/api
- **Auth:** None required
- **Coverage:** Pacific Northwest coast (primarily Puget Sound and surrounding waters)
- **What it provides:** Very recent, community-reported sightings with species and quantity
- **How used:** Supplementary "now" data layered on top of GBIF. If Hotline fails, the app degrades gracefully.
- **Attribution:** The Whale Museum, Friday Harbor, WA

### Mapbox
- **Used for:** Map rendering, location search (Geocoding API), reverse geocoding
- **Auth:** `VITE_MAPBOX_TOKEN` environment variable
- **Style:** `mapbox://styles/mapbox/dark-v11` — dark base map appropriate to the aesthetic

### iNaturalist (future)
- Already integrated in the main EarthAtlas app
- Could be added as a third cetacean sighting layer for community photos
- iNaturalist's `iconic_taxa=Mammalia` filter with marine environment tag

---

## Architecture

### How It Lives in the EarthAtlas Codebase

`/whales` is a separate React page within the same Vite app — not a separate project, not an iframe. It shares:
- The Mapbox token (`VITE_MAPBOX_TOKEN`)
- The production deployment (Vercel)
- The `main.jsx` entry point and React Router setup

It does **not** share:
- CSS / design system (completely separate aesthetic)
- Components (all whale-specific components are self-contained)
- State (no shared React context with the main app)
- The GBIF service module (`src/services/gbif.js`) is not reused — the whale service is its own file that makes its own GBIF calls with cetacean-specific filters

### Routing

React Router is configured in `src/main.jsx`:

```
/whales     → WhalesApp
/*          → existing EarthAtlas App (fallback)
```

### Data Flow

```
User grants location
       │
       ▼
WhalesApp.jsx (state machine: hero → loading → explore)
       │
       ├─► fetchRecentSightings()    ─► GBIF /occurrence/search (Cetacea, past 90 days)
       ├─► fetchSeasonalPattern()    ─► GBIF /occurrence/search (facet: month, all years)
       └─► fetchHotlineSightings()   ─► Whale Museum Hotline API

All three run in parallel via Promise.allSettled()
Results normalized → aggregateSpecies() → SpeciesCard list
```

### State Machine

`WhalesApp` manages a simple `phase` variable:

| Phase | What's shown |
|---|---|
| `'hero'` | Full-bleed entry screen |
| `'loading'` | Whale emoji + "Scanning the ocean near you…" |
| `'explore'` | Map + species cards + season chart |

Within `'explore'`, a `mode` variable switches between:
- `'now'` — recent 90-day sightings
- `'patterns'` — historical by month (clicking a season bar reloads data for that month)

---

## File Structure

```
src/whales/
├── README.md                    ← this file
├── WhalesApp.jsx                ← main page component, state machine
├── WhalesApp.module.css         ← full design system (CSS Modules)
├── components/
│   ├── WhaleMap.jsx             ← Mapbox map with cetacean pin rendering
│   ├── SpeciesCard.jsx          ← single species card with likelihood bar + fact
│   ├── SeasonChart.jsx          ← 12-bar monthly sighting density chart
│   └── LocationSearch.jsx       ← geocoding input with dropdown suggestions
└── services/
    └── whales.js                ← all data fetching (GBIF + Hotline), species metadata
```

### Key files explained

**`whales.js`** — The data layer. Contains:
- `SPECIES_META` — curated common names, colors, facts for 97 recognized cetacean species, keyed by GBIF species key
- `fetchRecentSightings()` — past N days within radius
- `fetchMonthSightings()` — historical sightings for a specific month (1–12) across all years
- `fetchSeasonalPattern()` — single GBIF facet query returning all 12 monthly counts
- `fetchHotlineSightings()` — Whale Museum Hotline API
- `aggregateSpecies()` — groups sightings by species, computes count + last-seen

**`WhalesApp.module.css`** — All styling in one file, organized as:
- Design tokens (CSS custom properties on `.whalesApp`)
- Hero section
- Navigation
- Content grid
- Map wrapper
- Season chart
- Species cards
- Loading states
- Footer

**`WhaleMap.jsx`** — Mapbox map component. Renders colored dot markers per sighting, popup on click, fly-to animation when center changes. Marker color is species-specific from `SPECIES_META`.

**`SpeciesCard.jsx`** — Receives an aggregated species object and total sighting count. Computes `likelihood = species.count / totalCount` and renders a proportional fill bar. Shows curated fact from `SPECIES_META` if available.

**`SeasonChart.jsx`** — 12-column bar chart. Highlights current real-world month in amber. Active/selected month glows teal. Clicking a bar triggers `onMonthChange` in parent which reloads data.

---

## Running Locally

```bash
# From the earthatlas project root
npm run dev

# Navigate to:
http://localhost:5173/whales
```

Required environment variables (same as main EarthAtlas app):
```
VITE_MAPBOX_TOKEN=your_mapbox_token_here
```

No additional API keys needed. GBIF and Whale Museum Hotline are both open without auth.

---

## Future Roadmap

### Near-term (next sprint)

- [ ] **Shareable URLs** — `?lat=36.97&lng=-122.02&month=6` so users can share a specific place/time view
- [ ] **Species confidence labels** — "High likelihood · Moderate · Rare but possible" derived from monthly frequency ratio vs. annual total
- [ ] **Trip planning CTA** — after viewing seasonal patterns, a prompt: "Planning a trip? Here's your best window for [top species]"
- [ ] **Hotline data geofencing** — only show Hotline data when user is in Pacific Northwest (avoids irrelevant Puget Sound reports for someone on Cape Cod)
- [ ] **iNaturalist photos layer** — pull cetacean community photos with coordinates to enrich species cards

### Medium-term

- [ ] **Species detail pages** (`/whales/species/humpback-whale`)
  - Migration range map (static SVG or Mapbox layer)
  - Size comparison visualization
  - Best months globally (from GBIF seasonal pattern, worldwide bounding box)
  - Best places to see it (top 5 regions by historical density)
  - Conservation status badge
- [ ] **"When should I go?" tool** — input a destination → returns a ranked month-by-month calendar view per species
- [ ] **Whale watching operators directory** — curated list of reputable tour operators near common sighting hotspots
- [ ] **Email / calendar alerts** — "You're going to Monterey in July — here's what's been seen this week"

### Long-term (post-Happywhale partnership)

- [ ] **Named individual whales** — "This is Comet (HW-1234), a humpback. She was last seen 40km from here."
- [ ] **Migration tracks** — animated lines showing an individual whale's journey over multiple years
- [ ] **Sighting submission flow** — allow users to report sightings that feed back into Happywhale and GBIF
- [ ] **Whale ID guide** — help users distinguish common species from a boat

---

## Happywhale Partnership Plan

[Happywhale](https://happywhale.com) is a non-profit photo-ID platform run by Ted Cheeseman out of Monterey, CA. They have identified tens of thousands of individual cetaceans across 50+ species and are one of the world's most significant contributors to cetacean science.

### Why it matters

Happywhale's data flows to GBIF via OBIS-SEAMAP (Duke University), so we already display some of it. But the individual ID data — which animal this is, where it was last seen, its full sighting history — doesn't survive GBIF normalization. Direct API access would allow:

- "This humpback was identified in 2019 off Iceland and has been seen 14 times since"
- Migration track lines on the map
- Named whale profiles linked from species cards

### How to approach

Ted Cheeseman is a scientist who cares deeply about data visibility and public engagement. He's not running a SaaS company — Happywhale is funded by his expedition business (Cheesemans' Ecology Safaris) and donations.

**The pitch:** Build the product first. Email Ted with a working demo at `/whales`. The ask is a memorandum of agreement for data collaboration, similar to what Happywhale has with research institutions. EarthAtlas in return provides visibility for Happywhale and a public-facing tool that encourages sighting submissions.

**Contact:** ted@happywhale.com

**What not to do:** Do not use the unofficial CLI at `happywhale.openoceans.xyz` — it's reverse-engineered, not endorsed by Happywhale, and ethically inappropriate for a production app.

---

## Design System Reference

All tokens are CSS custom properties on `.whalesApp`. Override at this level to retheme.

```css
--deep:        #030c18   /* page background */
--dark:        #061528   /* secondary background */
--mid:         #0b2040   /* inputs, nav */
--card:        #0d2545   /* card background */
--card-hover:  #112d52   /* card hover state */
--glow:        #4dd9c0   /* primary accent (bioluminescent teal) */
--glow-dim:    rgba(77, 217, 192, 0.18)
--amber:       #f0b429   /* current month highlight */
--text:        #deeef8   /* primary text */
--text-sub:    rgba(180, 215, 235, 0.65)
--text-muted:  rgba(120, 165, 195, 0.45)
--serif:       'Fraunces', Georgia, serif
--sans:        'DM Sans', system-ui, sans-serif
```

### Component tree

```
WhalesApp
├── <nav>                    WhalesNav
├── [phase === 'hero']
│   ├── Hero background      WhaleSilhouette SVGs, heroGlow
│   ├── Hero content         heroTitle, heroSub
│   └── LocationSearch       geocoding input + dropdown
├── [phase === 'loading']
│   └── Full-screen loading  whale emoji + message
└── [phase === 'explore']
    ├── Topbar               locationLabel, modeBar toggle
    ├── statusStrip          sighting count + mode context
    └── contentGrid (CSS Grid, 2-col on desktop)
        ├── mapWrap          WhaleMap
        ├── seasonSection    SeasonChart
        └── speciesPanel     SpeciesCard × N
```

---

*Part of [EarthAtlas](https://earthatlas.org) — a biodiversity data visualization project.*  
*Data: GBIF (CC BY 4.0) · Whale Museum Hotline · Mapbox*
