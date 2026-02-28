# EarthAtlas 🌿

Discover what species of plants, animals, and fungi are living around you — right now.

## Stack
- **React 18 + Vite** — component architecture ready for React Native migration
- **iNaturalist API v1** — live observation data
- **OpenStreetMap Nominatim** — reverse geocoding (no API key needed)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Project Structure

```
src/
├── components/       # UI components
│   ├── Header.jsx
│   ├── Controls.jsx
│   ├── TaxonFilter.jsx
│   ├── SpeciesGrid.jsx
│   ├── SpeciesCard.jsx
│   ├── SpeciesList.jsx
│   ├── ObservationModal.jsx
│   ├── LoadingState.jsx
│   └── EmptyState.jsx
├── services/
│   └── iNaturalist.js    # API calls (add eBird, GBIF here later)
├── hooks/
│   └── useGeolocation.js # Geolocation hook
├── utils/
│   └── taxon.js          # Taxon color/emoji/label maps
├── App.jsx
├── App.css
└── main.jsx
```

## Planned Data Sources
- [x] iNaturalist
- [ ] eBird (birds)
- [ ] GBIF (Global Biodiversity Information Facility)

## Roadmap
- [ ] Map view (Leaflet)
- [ ] PWA (offline support, add-to-home-screen)
- [ ] iOS/Android (React Native)
