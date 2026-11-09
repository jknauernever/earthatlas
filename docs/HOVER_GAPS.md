# Hover gaps: survey of 2026-11-09

Rule (Josh, 2026-11-09): every data visualization on earthatlas.org, maps included, gets mouseover info.
Shared machinery: maps use `src/lib/mapHoverTip.js` `installHoverTip` (frame `.ea-hover-tip` in index.css); HTML/SVG charts use `src/components/ChartTip.jsx`.
Today only spills, spillrisk, risks, shoreline and species-of-concern use `installHoverTip`. /inmotion has its own `probeHover`. Every other map is click-only.
"click only" = a click opens a popup, but hover shows nothing. Paths are under `src/`.

## /inmotion (systems/)
Hover covers the discrete items (storms, fires, quakes, Climate TRACE, Carbon Mapper, MARS, CO₂ and smoke plumes) through hoverProbe.js.
Fields are click-only by design (comments at hoverProbe.js:9-13 and SystemsApp.jsx:2421). Each field already has a sampler and `def.popup` formatter that the hover can reuse.
- Field value under the cursor (click only today): wind, currents, sst, sstanom, waves, airtemp, rain, rainRadar (async tile read, needs a tile cache), acidity, smoke, dust, pm25, co, co2, methane, birds (rate + flight heading), fungi, plus the `:flow` companion wind
- veg (tree-cover loss) and the cm-scene-tiles plume imagery have no readout at all, not even on click. clouds is imagery and low priority.
- fireraw: individual VIIRS detections. hitTest exists, but they aren't in PROBES.
- traceCard.js:109: the dash for a no-estimate month has no title
- legendBar ramps (low priority)

## /ships (ships/ShipsApp.jsx); `installHoverTip` unused, everything goes through the click picker
- Ship track lines (GFW/NOAA/aisstream): click only
- gfw-dark-fill dark-vessel cells; Climate TRACE oil & gas canvas; mpa-fill/line; srkw-fill/line; offshore-farm/-pt: click only
- ports-<tier> dots + labels; terminals-icon/label; projects-pt/fill/line; anchorage fill/line/label; anchorage-bunker badges: click only
- slick-focus-* (candidate track, closest-pass dot, image-time dot): none
- LiveShips TRAIL lines: none (the trail points have hover)
- noaa-edge-line: none (low priority)
- Charts: ScrubberReport "By country" bars have none. The facility×month cells have only a partial title.
- Native `title` only, should move to ChartTip: Scrubber DayChart + Spark, SlickCard NearChart + Strength meter, Bunkering and OilTransfers facet bars (no breakdown of the stacked segments) + MonthCharts, pcKpi tiles
- Bespoke tips, should move to ChartTip for consistency: Scrubber MonthChart `.tip`, PortCard MonthBars/LineChart, EstimatedVisits DayBars

## /whalewatch
- `ww` recent-whale dots + whale paths (lib/whalePathsLayer.js): click only
- ww-trail-line boat trails: none

## /shiptraffic
- st-*-line/-obs/-est ship tracks: none
- overlap squares, whale dots and counts, whale paths: click only

## Home + /whales, /birds… (explore/ExploreMap.jsx)
- sighting-circles / -counts / -id-ring: click only
- whale paths (whalePathsLayer): click only
- whale-journey stops + track (happywhale/whaleJourney.jsx): none
- GlobalStats top-countries bars: none

## /live, /live-local
- live-obs-dots: none (no click either)

## /quakes
- quakes-layer circles: click only
- ScatterChart (magnitude over time) and DailyChart (per day) bars: none

## /birdsong
- station clusters + stations-layer: click only
- TopSpeciesList bars: title shows only the scientific name, no count

## /happywhale
- hw-encounters-layer: click only; journey stops/track: none

## /species/:taxonId
- occ-dots: click only; heat-layer: none

## /fire (one shared click handler, no hover anywhere)
- usFires dots/labels/perimeters, FIRMS, HMS, InciWeb, NIFC, CWFIS, fire history, parcels, buildings: click only
- raster risk layers (whp, bp, cfl, rps, rrz, exposure, ndvi, lulc, mtbs, fwi, burnedarea): click only, by decision (Josh 2026-11-09: each reading is a server call)

## /forestmonitor
- opera-dist alert + heat; EXTRA_LAYERS rasters (radd, hansen, tmf, foresttype, canopy, cropland, efda) + commodity: click only
- AEF trajectory sparkline in the popup: none

## /carbon
- carbon-overlay-layer NDVI/land cover: none
- land-cover % bars: none

## /permits
- No installHoverTip. records dots, shell-fill, wq-fill, Friends habitat (fhab-*): click only. records-vio rings, records-tag: none
- /permits/dashboard `rows` dots: click only
- /permits/report marker: none (low)

## /sanjuan-docks
- docks, osm-points/fill/line: click only; docks-count, osm-count: none

## /spillrisk
- sr-reached, sr-float are missing from the hover layers list
- Run-1 oil budget bar: one title on the whole bar, nothing per segment

## /risks
- risks-lots parcels are missing from HOVER_LAYERS
- /risks/reports/land-value: "Land value underwater" bar column + share-band bars have none

## /spills/reports
- Pipeline-casualties barY has `title` without `tip: true`
- Released→recovered Plot.link: none (optional)
- PrecBar segments are title-only; they should use the page's data-tip

## /shoreline
- sl-parcels-fill highlights on hover, but shows no text
- Property popup greenery percentile marker: none
- Popup mini-map: low priority

## Already fine
/spills map, /species-of-concern map, /news, accounts. SpillsReport Plot charts, SeasonRibbon, species seasonality bars, WhaleWatch boats, slicks, the picked-ship track.
