# Tropical-cyclone APIs — full catalog (verified 2026-09-22)

Two warning centres cover the planet between them: **NHC** (§1–4) for the
Atlantic and the eastern/central Pacific, **JTWC** (§7) for everywhere else.

Everything below was verified with live requests on 2026-09-22, when three
storms were active: **Polo** (EP17, Cat 5, 145 kt / 920 mb, off SW Mexico),
**Odalys** (EP16, TS) and **Fay** (AL06, TD).

## 1. `https://www.nhc.noaa.gov/CurrentStorms.json`

The plain-facts feed. `{ activeStorms: [...] }`, one object per storm.

| Field | Example | Notes |
|---|---|---|
| `id` | `ep172026` | basin + number + year |
| `binNumber` | `EP2` | **join key** to the GIS service's `binnumber` |
| `name` | `Polo` | |
| `classification` | `HU` | see code table below |
| `intensity` | `"145"` | kt, **string** |
| `pressure` | `"920"` | mb, **string** |
| `latitudeNumeric` / `longitudeNumeric` | `14.6` / `-101.6` | signed floats; the sibling `latitude`/`longitude` are strings like `"14.6N"` |
| `movementDir` / `movementSpeed` | `null` | **nullable** — null on Polo's 008a intermediate advisory |
| `lastUpdate` | ISO 8601 | |
| `publicAdvisory`, `forecastAdvisory`, `forecastDiscussion`, `windSpeedProbabilities` | `{advNum, issuance, url}` | **the human-readable advisory URLs — this is our inline provenance link** |
| `forecastTrack`, `trackCone`, `windWatchesWarnings`, `initialWindExtent`, `forecastWindRadiiGIS`, `bestTrackGIS`, `stormSurgeWatchWarningGIS`, `potentialStormSurgeFloodingGIS` | `{zipFile, kmzFile}` | shapefile zips / KMZ — **we do not parse these**; the ArcGIS service below serves the same geometry as GeoJSON |

**⚠ No CORS headers.** The browser cannot fetch this directly — it must go
through our own edge proxy. (The ArcGIS service below *does* send CORS.)

## 2. `https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer`

The geometry, as queryable GeoJSON. **Use the `_summary` service**, not
`NHC_tropical_weather`: the summary service merges every active storm into one
layer per product (filter by `binnumber`), while the non-summary service
splits per storm bin (AT1…CP5 = 15 bins × ~26 sublayers = hundreds of layers,
needing one query per storm).

Query shape:
`/{layer}/query?where=1%3D1&outFields=*&f=geojson`
(`f=geojson` returns real GeoJSON; `returnGeometry=false` for attributes only.)

Sends `access-control-allow-origin` echoing the request Origin, so it is
browser-fetchable. `cache-control: max-age=0,must-revalidate`.
`maxRecordCount` 2000 on every layer used here.

### Layers we use

| id | Name | Geometry | Key fields |
|---|---|---|---|
| 5 | Forecast Points | Point | `stormname, stormtype, maxwind, gust, mslp, ssnum, tau, datelbl, fldatelbl, tcdir, tcspd, validtime, advdate, advisnum, basin, binnumber` |
| 6 | Forecast Track | Polyline | `stormname, stormtype, advdate, advisnum, fcstprd` |
| 7 | Forecast Cone | Polygon | `stormname, stormtype, fcstprd` (120 = 5-day), `advdate` |
| 8 | Watch-Warning | Polyline | `stormname, tcww` (TWA/TWR/HWA/HWR), `advdate` |
| 10 | Past Points | Point | `stormname, stormtype, intensity, mslp, ss, dtg, lat, lon` |
| 11 | Past Track | Polyline | `stormtype, ss, binnumber` — **per-segment**, so the track can be colored by the intensity it had on that stretch |
| 16 | Advisory Wind Field | Polygon | `radii` (34/50/64 kt), `ne, se, sw, nw`, `tau`, `validtime` |

### Also available (not used yet)
1/2/3/33 Tropical Weather Outlook — `prob2day, risk2day, prob7day, risk7day`
on points, polygons and motion arrows: **disturbances that are not yet storms**.
12 Past Cumulative Wind Swath · 13 Past Wind Radii · 15 Forecast Wind Radii ·
17–20 TS-wind arrival times · 21–28 inundation · 29–32 probabilistic winds.
Separate services: `NHC_Breakpoints`, `NHC_PeakStormSurge`, `StormSurgeRisk`.

## 3. Gotchas found by testing (not documented upstream)

1. **`9999` is the missing-value sentinel**, not a real number. On Forecast
   Points every row past `tau=0` carries `mslp=9999`, `tcdir=9999`,
   `tcspd=9999`. Rendering these unfiltered prints "9999 hPa". **Filter
   `>= 9999` on every numeric field from layer 5.**
2. `movementDir` / `movementSpeed` in CurrentStorms.json are **null** on
   intermediate advisories (the `008a` suffix), not absent.
3. `intensity` and `pressure` in CurrentStorms.json are **strings**.
4. `ss` / `ssnum` (Saffir-Simpson) is `0` for anything below hurricane
   strength — it is not a null.
5. The forecast-point `tau` series is **not evenly spaced**: 0, 12, 24, 36,
   48, 60, 72, 96, 120 (no 84).
6. A 5-day cone polygon is ~1600 vertices per storm.

## 4. `stormtype` / `classification` codes

`DB` disturbance · `LO` low · `WV` tropical wave · `TD` tropical depression ·
`TS` tropical storm · `HU` hurricane · `MH` major hurricane (Cat 3+; appears
in the GIS `stormtype` but not in CurrentStorms.json's `classification`) ·
`SD` subtropical depression · `SS` subtropical storm · `STD`/`STS` subtropical
· `EX` extratropical · `PT` post-tropical · `IN` inland.

`tcww` (watch/warning): `TWA` tropical-storm watch · `TWR` tropical-storm
warning · `HWA` hurricane watch · `HWR` hurricane warning.

## 5. NHC's coverage limit

NHC covers the **Atlantic, eastern Pacific and central Pacific** only. Western
Pacific typhoons and Indian Ocean / Southern Hemisphere cyclones need JTWC
(§7). IBTrACS was evaluated and rejected as a live source — see §8.

## 6. Worked example — Polo's rapid intensification (from layer 10)

| DTG | Type | kt | mb | Cat |
|---|---|---|---|---|
| 2026-09-17 12Z | DB | 20 | 1010 | — |
| 2026-09-20 18Z | TD | 30 | 1007 | — |
| 2026-09-21 00Z | TS | 35 | 1004 | — |
| 2026-09-21 18Z | HU | 70 | 978 | 1 |
| 2026-09-22 00Z | HU | 90 | 967 | 2 |
| 2026-09-22 06Z | HU | 120 | 945 | 4 |
| 2026-09-22 12Z | HU | 140 | 926 | 5 |

20 kt to 140 kt in five days. Layer 11 carries this as per-segment
`stormtype`+`ss`, so the past track can be drawn as a line that changes color
as the storm intensifies — the storm's whole life in one stroke.

Forecast (layer 5): peaks at 155 kt tonight, then weakens to 115 kt by
Saturday while tracking WNW toward southern Baja.


---

## 7. JTWC — Joint Typhoon Warning Center

US Navy/Air Force. Covers the **western Pacific, Indian Ocean and Southern
Hemisphere**. No GIS service, no JSON, no API — but it publishes structured
files that parse cleanly.

### 7.1 Discovery: the RSS feed

`https://www.metoc.navy.mil/jtwc/rss/jtwc.rss`

One fetch returns **all basins** (4 items: NW Pacific/N Indian, C/E Pacific,
Southern Hemisphere, Significant Tropical Weather Advisories). The item bodies
are HTML inside CDATA — they carry **no positions and no intensities**, only
storm names and product links. Its real job is telling you which storms are
active:

    products/([a-z]{2}\d{4})web.txt   →  wp2426, io0126, ep1726, wp9126 …

Sends `access-control-allow-origin: *` (browser-readable, unlike NHC's
CurrentStorms.json), but we still fetch it server-side to merge and cache.

### 7.2 The data: `.tcw` (JMV 3.0), NOT the prose warning

`https://www.metoc.navy.mil/jtwc/products/<id>.tcw` — **5 KB**, and its first
lines are a compact machine-readable summary, followed by the full warning
text:

    WARNING    ATCG MIL 17E NEP 260922145852
    2026092212 17E POLO       008  02 090 04 SATL 020
    T000 147N 1016W 140 R064 025 NE QD 030 SE QD 030 SW QD 025 NW QD R034 …
    T012 150N 1015W 155 R064 030 NE QD …

| Token | Meaning |
|---|---|
| `2026092212` | synoptic time YYYYMMDDHH (UTC) |
| `17E` / `POLO` / `008` | ATCF id, name, warning number |
| `02` | count of active TCs in the basin |
| `090 04` | movement bearing (°) and speed (kt) |
| `SATL 020` | position basis, accuracy (nm) |
| `T000` | forecast hour (000, 012, 024, 036, 048, 072, 096, 120) |
| `147N 1016W` | lat/lon in **TENTHS of a degree** → 14.7N, 101.6W |
| `140` | max sustained wind, kt (**1-minute average**, same basis as NHC) |
| `R064 025 NE QD …` | wind radii: threshold kt, then NE/SE/SW/NW extent in nm |

Prefer this over `<id>web.txt` (prose, 3–8 KB) and over `<id>.kmz`
(**437 KB**, mostly icon PNGs; the `doc.kml` inside is 56 KB and does carry
past best-track points, a storm-track line, a "34-knot danger swath" and
wind-radii polygons — the upgrade path if past tracks are wanted, at the cost
of ZIP parsing in the edge runtime). `<id>.kml` is **403**; only the KMZ
exists.

### 7.3 Gotchas

1. **Storm numbers 90–99 are INVESTS.** `wp9126` is not a storm — its product
   is a `TROPICAL CYCLONE FORMATION ALERT`, free prose with **no
   `WARNING POSITION` block and no T-lines**. Parsing it as a warning yields
   garbage. Filter to numbers 01–89.
2. **No central pressure.** JTWC warnings carry no MSLP at all. (Invest
   formation alerts mention an estimated one in prose; numbered warnings do
   not.) Render as "not reported" — never derive one from wind speed.
3. **No track-uncertainty cone.** The KMZ's "34-knot danger swath" answers a
   different question (where wind may reach, not where the centre may go) and
   must not be substituted for a cone.
4. **No past track** in the `.tcw` — current plus forecast only.
5. **Basin overlap with NHC.** JTWC issues on `ep`/`cp` too, cut at a
   different synoptic hour: on 2026-09-22 NHC had Polo at 155 kt (19Z) while
   JTWC's 12Z warning said 140 kt. **NHC wins in al/ep/cp**, or the same storm
   appears twice with contradictory intensities.
6. `www.metoc.navy.mil/jtwc/jtwc.html` returns **403** to plain curl; the
   product and RSS paths do not. A 403 on a product path usually means the
   filename is wrong, not that access is blocked.
7. Longitudes are unsigned with a hemisphere letter — `1016W` must become
   −101.6, or the storm lands in the Pacific off Vietnam.

### 7.4 Naming

The Saffir-Simpson number is universal; the noun is not. The western Pacific
says **typhoon**, the Indian Ocean and Southern Hemisphere say **cyclone**.
Calling Dujuan a hurricane is quietly wrong.

---

## 8. IBTrACS — evaluated, not used

`https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.ACTIVE.list.v04r01.csv`

200 OK, ~154 KB, 174 columns, global. Rejected as a live source on 2026-09-22
because its newest row was **2026-09-22 00:00Z — roughly 21 hours stale** —
and it was **missing the brand-new North Indian cyclone 01B entirely**. It
does carry full past tracks for storms in every basin (DUJUAN had 53 points),
so it remains the best candidate if JTWC storms are ever to get the same
category-colored life-story track NHC storms have. Its lag would need
labeling per storm.
