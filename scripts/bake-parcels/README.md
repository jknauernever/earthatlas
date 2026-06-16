# Parcel bake pipeline

Turns a region's parcel data into a single **PMTiles** file hosted on **Vercel Blob**.
Mapbox GL JS v3.21+ reads the `.pmtiles` URL directly (native vector source, HTTP
range requests), so there is **no tile server and no per-tile runtime cost** — the
FireApp just points a vector source at the Blob URL.

The win of baking: **field names are normalized once, here**, so every region's
PMTiles shares one canonical schema and the client needs no per-region fieldMap.

## Canonical schema (tile properties)

`apn, owner, owner2, addr, city, zip, land_use, acres, county, structures, tax_year, region_id`
(plus `assessed_value` where a region exposes it — NM does not.)

## Run it (per region)

```bash
# 1. extract + normalize -> build/<region>-<version>.ndjson
node scripts/bake-parcels/extract.mjs nm

# 2. tile -> build/<region>-<version>.pmtiles   (source-layer = "parcels")
node scripts/bake-parcels/tile.mjs nm

# 3. upload to Blob + update src/fire/parcelSources.json
BLOB_READ_WRITE_TOKEN=... node scripts/bake-parcels/upload.mjs nm
```

`build/` is git- and vercel-ignored (artifacts are large; they live on Blob).

## Adding a region

1. Drop a `configs/<region>.json` (copy `nm.json`): set `source`, `fieldMap`
   (source field → canonical key), `constants.region_id`, `citation`, `bbox`, `minZoom`.
2. If the source is an ArcGIS service, the existing `arcgis` adapter handles it.
   If it's a downloadable file, implement `lib/adapters/file.mjs` (stubbed).
3. Run the three steps above. The FireApp's `PARCEL_PROVIDERS` registry + the
   manifest pick it up.

## Local development (seeing parcels on localhost)

In production, parcels are served by `/api/parcel-tiles` reading from Vercel Blob,
fronted by the CDN — fast, cached, no setup. But under **`vercel dev`** that
function is slow per tile (~1.5s/screenful), which starves Mapbox's tile loader
and renders parcels inconsistently as you pan. So for local QA, run the dedicated
tile server alongside `vercel dev`:

```bash
npm run dev:parcel-tiles     # serves tiles from build/*.pmtiles on :8100, ~instant
```

and point the local client at it (already in `.env.local` if you set it up):

```
VITE_PARCEL_TILES_BASE=http://localhost:8100
```

This is **dev-only** — `VITE_PARCEL_TILES_BASE` is unset in production, so the app
falls back to `/api/parcel-tiles`. If parcels don't load locally, check that
`npm run dev:parcel-tiles` is running. (The function also reads the local
`build/*.pmtiles` directly when present, so even `/api/parcel-tiles` is faster in
dev than hitting Blob — but the standalone server is faster still and handles
concurrent panning.)

## Notes

- Versioned Blob path (`parcels/<region>-<version>.pmtiles`): bump `version` in the
  config to cut a fresh immutable URL when assessors update.
- NM source: `gis.ose.nm.gov` County Parcels 2025, 33 county layers, ~1.58M parcels,
  no Extract extension → paged `f=geojson` query (~317 pages). No assessed value field.
