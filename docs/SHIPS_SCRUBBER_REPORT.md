# Scrubber-ship calls report — plan

Asked for by Lovel Pratt (Friends of the San Juans), email 2026-10-07 "Port, terminal, and refinery data wish list":
a report for the WA legislature on scrubber-equipped ships calling at WA ports, terminals and refineries,
Jan 1 2025 – Jun 30 2026. For each place: scrubber-ship calls per month, and the number of distinct scrubber ships.

Josh's decisions (2026-10-07):
- **Permanent URL**, not tied to the map: a report page that looks great on its own.
- **Live page + frozen editions.** `earthatlas.org/ships/reports/scrubbers` is always current; dated editions
  (`…/scrubbers/2026-10`) are snapshots whose numbers never change, so figures cited to the legislature stay stable.
- **Time:** headline totals for the selected period, then drill down: period → month → day where the data allows.
- **Place:** WA State → county → city/municipality → port / terminal → ships. Not limited to WA: the same report
  works for any geography we hold data for (BC terminals, US West Coast, and worldwide at port level).
- **Add WA cruise, container and ro-ro terminals** (Lovel's own example is cruise ships at Seattle).
- **Backfill NOAA Jan–Jun 2025** and **add the Columbia River + Grays Harbor** so all WA deep-draft ports are covered.

## What we already have

| Piece | State today |
|---|---|
| Scrubber ships | `lib/ships/scrubberFilter.js`: IMO GISIS scrubber notifications OR MEP Alliance lists (accepted links; name-only matches flagged "inferred") |
| Terminal calls, per-minute AIS | `terminal_calls` (bake `tc4`), NOAA MarineCadastre, **Jul 2025 – Jun 2026**, Salish box only (S edge 47.0°N) |
| Terminal visits, recent | GFW hourly estimates (`activityEstimates.js`), Jul 2026 → now. Good for cargo/tankers, not tugs |
| Port visits, worldwide | GFW port-visit events per ship (`port_visits`), port level only |
| Terminals | 59 (26 WA + 33 BC): oil, bulk, LNG, grain, etc. **No cruise, container or ro-ro berths** |
| Permits / SEPA | 27 WA facilities with permits (Ecology, PSCAA, SEPA) on the terminal Permits tab |

## Gaps to close, in order

1. **Terminals.** Migration widens `terminals.kind` (`cruise_terminal`, `container_terminal`, `roro_terminal`,
   `general_cargo_terminal`). Add WA berths with the existing evidence pipeline (USACE docks + OSM berths):
   Seattle Smith Cove/Pier 91 and Bell St/Pier 66, NWSA Seattle + Tacoma container terminals, Everett, Port Angeles,
   Anacortes, Bellingham, Olympia, Port Townsend; then Columbia River (Longview, Kalama, Vancouver WA) and Grays Harbor.
2. **Places.** Each terminal gets its county and city/municipality from Census TIGER boundaries (public domain),
   stored with source. Unincorporated land is labelled as such, never left blank.
3. **NOAA coverage.**
   - Jan–Jun 2025 for the Salish box: same bake as today, GitHub Actions only. Prove on one day, then the full run
     on Josh's go-ahead, with time and cost stated first.
   - A second, small box for the Columbia River + Grays Harbor coast, Jan 2025 → latest NOAA month. Runs terminal
     calls only (no new track tiles).
4. **Report numbers.** One server query: calls and distinct ships by place × month (× day for drill-down) for
   scrubber ships, plus all-ship totals so a share can be shown. Source per row: NOAA per-minute where it exists,
   GFW estimate after NOAA's latest month, always labelled.
5. **Worldwide section.** "Where else these ships call": GFW port visits for the same scrubber ships, port level.
6. **Page.** `/ships/reports/scrubbers`. Headline numbers, a monthly chart, a place table that drills
   county → city → terminal → ship list (each ship links to its card). Every number carries its source inline.
   Print and PDF friendly. Share card. Shareable URL state (period, place, granularity).
7. **Editions.** A snapshot job freezes the query results as JSON on Blob under an edition id; the edition page reads
   only that file and shows the edition date and the sources' "as of" dates.

## Caveats the page must state (plainly, once)

- "Scrubber-fitted" means a scrubber was notified to the IMO or listed by MEP Alliance. Not being on either list
  doesn't prove a ship has none.
- A call means a ship stopped at a berth (NOAA rule: under 0.5 kn within the berth radius for 15+ minutes), not that
  it ran its scrubber there.
- Months after NOAA's latest release are GFW estimates (hourly positions), shown separately and labelled.

## Settled (Josh 2026-10-07)
- **Cruise ships count every call** (a ship at Pier 91 every week = one call per week).
- **Port-authority terminals are split from private docks** (refineries, private industrial docks): each terminal
  carries an ownership class (`port_authority` / `private`) with its source, and the report totals both separately.
