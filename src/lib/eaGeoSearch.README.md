# ea-geo-search — canonical earthatlas.org geo autocomplete

Mirrors the `/forestmonitor` search behavior so every earthatlas.org property
returns the same results in the same order with the same UI.

Two pieces live here:

- `src/lib/eaGeoSearch.js` — framework-free library (suggest/retrieve, categorization, helpers).
- `src/components/GeoSearch.jsx` — React component built on the library. Used by `/forestmonitor`.

The proxy lives at:

- `api/geo/suggest.js` — `GET /api/geo/suggest?q=…&session_token=…`
- `api/geo/retrieve.js` — `GET /api/geo/retrieve?id=…&session_token=…`

The Mapbox token stays server-side in `MAPBOX_TOKEN` (Vercel env). No browser
ever sees it.

---

## Drop into a React site (this repo or a sibling Vite project)

Copy `src/lib/eaGeoSearch.js`, `src/components/GeoSearch.jsx`, and
`src/components/GeoSearch.module.css` into the target repo. Then:

```jsx
import GeoSearch from './components/GeoSearch.jsx'

<GeoSearch
  onSelect={(r) => {
    // r = { id, name, type, category, lat, lng, bbox, zoom,
    //       place_formatted, full_address, feature, suggestion }
    map.flyTo({ center: [r.lng, r.lat], zoom: r.zoom })
  }}
  proximity={() => {
    const c = map.getCenter()
    return { lng: c.lng, lat: c.lat }
  }}
/>
```

If the site is on a different domain than earthatlas.org, point the proxy at us:

```jsx
<GeoSearch endpoint="https://earthatlas.org/api/geo" onSelect={…} />
```

---

## Drop into a vanilla / WordPress site (no React)

The library is pure ESM. Import the helpers and wire up your own input.

```html
<script type="module">
  import {
    suggest, retrieve, newSessionToken,
    searchCategoryOf, searchTypeLabel, searchResultMeta,
  } from 'https://earthatlas.org/lib/eaGeoSearch.js'

  let session = newSessionToken()
  let timer

  const input = document.querySelector('#q')
  const list  = document.querySelector('#results')

  input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const items = await suggest(input.value, {
        sessionToken: session,
        endpoint: 'https://earthatlas.org/api/geo',
      })
      list.innerHTML = items.map((s) =>
        `<li data-id="${s.mapbox_id}">${s.name} — ${searchResultMeta(s)}</li>`
      ).join('')
    }, 220)
  })

  list.addEventListener('click', async (e) => {
    const id = e.target.closest('li')?.dataset.id
    if (!id) return
    const r = await retrieve(id, {
      sessionToken: session,
      endpoint: 'https://earthatlas.org/api/geo',
    })
    session = newSessionToken()  // new session after each transaction
    // r.lat, r.lng, r.bbox, r.zoom — do what you want with them
  })
</script>
```

> The library file at `https://earthatlas.org/lib/eaGeoSearch.js` would need to
> be published as a static asset (e.g. copied into `public/lib/` and a Vercel
> rewrite added) for the CDN-style import above to work. Until then, copy the
> file into the WordPress theme directly.

---

## Server side (Node)

```js
// Same library works in Node — set endpoint to the absolute URL.
import { suggest, retrieve, newSessionToken } from './eaGeoSearch.js'

const session = newSessionToken()
const items = await suggest('Yellowstone', {
  sessionToken: session,
  endpoint: 'https://earthatlas.org/api/geo',
})
```

---

## Required env vars (on the host of the proxy)

| Variable        | Purpose                                                     |
| --------------- | ----------------------------------------------------------- |
| `MAPBOX_TOKEN`  | Server-side Mapbox token. No URL referrer restrictions —    |
|                 | the proxy is the caller, not the browser. Restrict by IP    |
|                 | at Vercel if needed.                                        |

A `VITE_MAPBOX_TOKEN` fallback is honored so existing local dev keeps working.

---

## Result shape (what `onSelect` / `retrieve` returns)

```ts
{
  id: string,              // mapbox_id
  name: string,            // "Yellowstone National Park"
  type: string,            // 'poi' | 'place' | 'country' | …
  category: string,        // 'nature' | 'poi' | 'region' | 'city' | 'address' | 'pin'
  lat: number,
  lng: number,
  bbox: [w,s,e,n] | null,  // when present, callers should fitBounds instead of flyTo
  zoom: number,            // sensible default zoom for this feature type
  place_formatted: string, // "Wyoming, United States"
  full_address: string,
  feature: object,         // raw GeoJSON feature from Mapbox
  suggestion: object,      // the original /suggest entry that produced this
}
```

---

## Tuning knobs

Defaults match `/forestmonitor` exactly:

- 220ms debounce
- 2-char minimum query
- 8 result limit
- `types=country,region,district,postcode,place,locality,neighborhood,street,address,poi`

To change any of those, call `suggest()` directly with overrides instead of
using the component, or fork the component.

---

## Migrating legacy callers in this repo

Three call sites still use the older Mapbox Geocoding v5 flow and should
migrate to `<GeoSearch>` once the new component is verified:

- `src/components/LocationSearch.jsx` (used by `src/components/Controls.jsx`)
- `src/explore/components/LocationSearch.jsx` (used by `src/explore/ExploreApp.jsx`)
- `src/live/LiveLocal.jsx` (uses `searchPlaces` from `src/services/mapbox.js` inline)

After migration, `src/services/mapbox.js`'s `searchPlaces` export can be deleted.
