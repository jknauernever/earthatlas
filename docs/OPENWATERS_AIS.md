# Open Waters AIS

Second live AIS source for the Salish Sea recorder (`scripts/ships/aisstream/sources/openwaters.mjs`), alongside
aisstream.io and WSF ferries. Approved for EarthAtlas use by Open Waters by email (2026-11-10: free personal token for
mapping ship traffic to protect whales); Josh authorized the integration 2026-11-10. Catalogued 2026-11-10 from
https://openwaters.io/api/ais/, https://openwaters.io/ais/ and https://ais.openwaters.io/openapi.json.

## What it is
- Open Water Software, LLC. Server is open-source `aiscast` (MIT, github.com/openwatersio/aiscast).
- One deduplicated stream merging AISHub, volunteer receivers (`station:`/`udp:`), aisstream.io, and government feeds
  (Kystverket, BarentsWatch, Digitraffic). Terrestrial only; no satellite AIS mentioned.
- AISHub positions arrive as periodic snapshots, about a minute behind; the others stream as heard.
- Coverage map (7 days, by H3 cell): https://openwaters.io/ais/network; tiles `/v1/coverage/tiles.json`.

## Token and limits (personal tier)
- `OPENWATERS_AIS_TOKEN` (`ak1.…`, never expires) in `.env.local` and as a Fly secret on `earthatlas-aisstream`.
- Sent as `Authorization: Bearer`. 2 concurrent streams, 50 msgs/s per stream (excess thinned), 400 sq° of subscribed
  boxes (summed; multiple boxes ORed), 50 MMSIs per stream, 120 HTTP requests/min, 20 connects/min.
- The salish-v6 box is ~10.8 sq°. A Santa Barbara Channel box (33.3–34.8 N, 121.0–118.4 W) is ~3.9 sq°: both fit.

## Endpoints used / useful
- `wss://ais.openwaters.io/v1/stream`: `{"type":"subscribe","bbox":[[minLat,minLon,maxLat,maxLon]]}`; frames `welcome`
  (limits), `ack`, `error`, `event` {id, time, source, station, channel, nmea, mmsi, msg_type (aisstream names), lat, lon,
  message (aisstream/go-ais field names), synthesized}. Optional `snapshot: true` replays last-known state (≤30 min).
- `wss://ais.openwaters.io/v0/stream`: aisstream.io-compatible drop-in.
- `GET /v1/vessels?bbox=minLat,minLon,maxLat,maxLon&max_age=30m`: GeoJSON last-known positions (≤500 past 30 min).
- `GET /v1/vessels/{mmsi}/track?from&to`: up to 366 days per request, GeoJSON or GPX. See **Archive** below.
- MCP server (no auth): https://ais.openwaters.io/mcp.

## License and credit
- Aggregate database: ODbL 1.0. Maps/pages built from it (produced works) need attribution; a publicly shared derived
  database would have to be ODbL.
- Per upstream (https://openwaters.io/ais/#license): AISHub — credit "AISHub contributors" with a link to aishub.net;
  volunteer receivers CC0; Digitraffic CC BY 4.0 ("Source: Fintraffic / digitraffic.fi, license CC 4.0 BY");
  Kystverket/BarentsWatch NLOD 2.0; aisstream.io no published terms.
- Recorder rows carry `source = openwaters/<upstream>`; `src/ships/liveSources.js` turns that into the inline credit.
- Personal use free; commercial use by arrangement. EarthAtlas is non-commercial conservation use.

## First test (localhost, 2026-11-11 03:59–04:01 UTC, salish-v6 box, 2 min)
- 424 vessels recorded vs 291 from aisstream.io directly: +106 via volunteer receivers, +27 via Open Waters' own
  aisstream.io relay. ~12 msgs/s.
- No AISHub events in that window; Open Waters' 30-minute snapshot listed 891 AISHub-sourced vessels (852 stopped),
  all last seen just before the run, consistent with periodic AISHub batches. To confirm from the deployed recorder.

## Archive (tested 2026-11-11) and the stop-count backfill

- History starts **2026-08-20 ~18:00 UTC** (two ships checked: a WSF ferry and a tanker). Nothing before.
- `interval=60` → at most one position a minute (personal tokens: requests starting > 48 h ago are rounded to whole minutes;
  ranges > 31 days keep ≤ 1/min). A ship sitting still keeps one position every 30 minutes. Impossible-speed fixes are dropped.
- `limit` ≤ 1,000 positions per request (personal); when `truncated`, the newest come back: page back by moving `to` to the
  first `times` value. 120 HTTP requests/min per address.
- One ship per request: no area history. Tracks carry `name` but no type/IMO/length and no per-position upstream (only an
  `attribution` map per track).
- Cost seen: a tanker (in the box 23 of 58 days) 15 requests; a ferry (every day) 42 requests for Aug 20 – Oct 17.

Backfill (lib/ships/recordedStops.js, Josh 2026-11-11): terminal calls + anchorage stays for Aug 21 – Oct 17, 2026 (before
the live recorder), counted with the NOAA rules and credited as recorded live AIS:
1. `node --env-file=.env.local scripts/ships/aisstream/owarchive-mmsis.mjs` → ships to ask (every MMSI in our stop counts and
   GFW estimates, with its last broadcast identity) → `scripts/ships/bake-ais/cache/owarchive/mmsis.json` (5,183 on dev).
2. `python3 scripts/ships/bake-ais/owarchive.py fetch` (resumable; log in cache/owarchive/fetch.log) then `… build`.
3. `node --env-file=.env.local scripts/ships/aisstream/owarchive-upload.mjs` → Blob `ships/bake-inputs/salish-v6/owarchive/`.
4. `ships-aisstream-month` (dispatch with months) reads them via `fetch_owarchive_points.py` after the map tracks are built, so
   archive days feed only the stop counts, never the map's recorded tracks.

## Also from Open Waters (not integrated)
- Seascape bathymetry tiles, CC BY 4.0 "© Open Waters: Seascape", no key: style
  https://tiles.openwaters.io/seascape/style.json; TileJSON raster.json (Terrarium DEM), vector.json (contours,
  soundings, drying areas), coverage.json. ~450 m global, to ~8 m regionally (incl. GSC West Coast 10 m, NOAA).
- Tides and Currents APIs (https://openwaters.io/api/tides/, /api/currents/): open, no auth, 100 req/min, 10k/day per IP.
