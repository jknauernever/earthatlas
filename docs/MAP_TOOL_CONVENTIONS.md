# EarthAtlas map-tool conventions

**Read this before building or changing any map tool on earthatlas.org**
(`/forestmonitor`, `/fire`, `/quakes`, and every future one). These are the
shared conventions that make the suite feel like one product. Each new map tool
must satisfy all of them — they are requirements, not suggestions.

Reference implementations: `src/fire/FireApp.jsx`, `src/forestmonitor/ForestMonitor.jsx`,
`src/quakes/QuakesApp.jsx`.

---

## 1. Shareable URL state (required)

Every map tool round-trips its **full view** into the query string via
`history.replaceState`, so a copied link reproduces exactly what the user sees,
and reading the URL on mount restores that state. No exceptions — if a control
changes what's on screen, it belongs in the URL.

Pattern (see any of the three tools):

- Module-scope `readUrlState()` (parse `URLSearchParams` → typed object) and
  `writeUrlQuery(qs)` (`replaceState`, and bail if unchanged).
- Hydrate component state from `readUrlState()` in the initializers
  (`useState(() => …)`), once, on mount.
- A single `useEffect` that rebuilds the query string from all view state and
  calls `writeUrlQuery` — depends on every piece of shareable state.
- **Omit params at their default** to keep links clean (e.g. don't write
  `bm=satellite`, the default basemap).
- Track the **map camera** (`lat`/`lng`/`z`) on `moveend` into a `mapView`
  state and include it. On cold load, initialize the map at the hydrated camera
  and **suppress the first auto-`flyTo`** (a `suppressFlyRef`) so you don't
  override the shared view.

Use short, stable param names (`bm`, `z`, `lat`, `lng`, plus per-tool keys).
`replaceState` — never `pushState` — so panning doesn't spam browser history.

## 2. Default basemap = Satellite (required)

`DEFAULT_BASEMAP_ID = 'satellite'` (`mapbox://styles/mapbox/satellite-streets-v12`).
Offer a basemap picker (Satellite / Dark / Light / Streets, + others as needed),
but satellite is the default everywhere.

## 3. Live zoom indicator (required)

Render the shared `<ZoomIndicator map={mapRef.current} />`
(`src/components/ZoomIndicator.jsx`) once the map exists:

```jsx
<div className={styles.container}>
  <div ref={containerRef} className={styles.mapWrap} />
  {mapReady && <ZoomIndicator map={mapRef.current} />}
  …
```

It self-subscribes to zoom changes and sits top-right, just below the Mapbox
`NavigationControl`. Don't reimplement it per tool — use the shared component so
every map reads identically.

## 4. Set `mapReady` from `style.load`, not `load` (gotcha)

Wire readiness in the `style.load` handler:

```js
map.on('style.load', () => { addLayers(); setMapReady(true) })
```

`style.load` fires on the initial style **and after every basemap switch**, so
it both asserts readiness and re-adds your sources/layers when the style
changes. The one-shot `'load'` event can be **missed under React StrictMode's
mount/unmount with heavier styles like satellite**, leaving `mapReady` stuck
false (no layers, no zoom badge). Always set `setMapReady(false)` in the init
effect's cleanup.

## 5. Shared building blocks (required)

- **Token:** `const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN` — never
  hardcode a token. Guard for its absence.
- **Place search:** reuse `src/components/GeoSearch.jsx` (the `/api/geo` proxy).
  Don't roll your own geocoder.
- **Chrome:** dark-glass panels — `rgba(10,14,23,0.85)`, `1px solid
  rgba(255,255,255,0.08)`, `backdrop-filter: blur(8px)`, ~8–10px radius. Root is
  `position: fixed; inset: 0`. Top-left EarthAtlas wordmark + a tool sub-badge;
  `GeoSearch` top-right; basemap picker below it.

## 6. Route wiring — the 5 places (required)

It's a client-side React Router SPA (not a multi-page Vite build). To add a
tool at `/<tool>`, touch exactly five places:

1. `src/<tool>/<Tool>.jsx` (+ `.module.css`) — self-contained component.
2. `src/main.jsx` — import + `<Route path="/<tool>" element={<Tool />} />`.
3. `vercel.json` — `{ "source": "/<tool>", "destination": "/<tool>.html" }`,
   above the SPA catch-all rewrite.
4. `scripts/generate-route-html.js` — a `ROUTES` entry (SEO-patches
   `dist/index.html` → `<tool>.html` so crawlers get real title/OG tags).
5. `scripts/generate-sitemap.js` — `addUrl('/<tool>')`.

## Deploy

Commit straight to `main`; `git push origin main` → Vercel git integration
auto-builds production. (All feature commits go direct to main.)

---

_When you add or change a convention here, update this file in the same change
so it stays the single source of truth._
