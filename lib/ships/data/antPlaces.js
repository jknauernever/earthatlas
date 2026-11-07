// Hand-checked Ecology ANT dock locations → EarthAtlas terminals (lib/ships/oilTransfers.js rule 4).
// Hand-checked (2026-11-06, Claude for Josh): Washington Ecology Advance Notice of Transfer dock locations, as Ecology names them, -> the EarthAtlas terminals (lib/ships/data/salish-terminals.json ids) whose AIS berth calls show a ship at that dock (lib/ships/oilTransfers.js rule 4). [] = a dock EarthAtlas does not track (ferry terminals, marinas, shipyards, tug docks): its notices are 'can't be checked'. "gap" = EarthAtlas tracks a terminal there but its berth points do not catch the ships that use this dock: also 'can't be checked', never 'not seen'. Locations not listed here take the nearest terminal with a berth within 0.3 km of the notices' mean position, else none.
export const ANT_PLACES_VERSION = "ap1"
export const ANT_PLACES = {
  "SEATTLE PIER 15 (MAXUM, SHELL)": [
    "wa-maxum-pier15",
    "wa-shell-seattle"
  ],
  "SEATTLE PIER 15.5 (MAXUM)": [
    "wa-maxum-pier15",
    "wa-shell-seattle"
  ],
  "SEATTLE PIER 17": [],
  "SEATTLE PIER 91": "gap",
  "SEATTLE PIER 90": "gap",
  "SEATTLE PIER 66": [
    "wa-pos-pier66-bell-street"
  ],
  "SEATTLE TERMINAL 18 (SSA, KINDER MORGAN)": [
    "wa-nwsa-t18",
    "wa-km-harbor-island"
  ],
  "SEATTLE TERMINAL 18 (KINDER MORGAN)": [
    "wa-km-harbor-island",
    "wa-nwsa-t18"
  ],
  "SEATTLE TERMINAL 5": [
    "wa-nwsa-t5"
  ],
  "SEATTLE TERMINAL 25": [
    "wa-nwsa-t30"
  ],
  "SEATTLE TERMINAL 46": [
    "wa-nwsa-t46"
  ],
  "SEATTLE PIER 11 (SEAPORT HARBOR ISLAND)": [
    "wa-seaport-seattle"
  ],
  "SEATTLE PIER 28": [],
  "SEATTLE PIER 23 (CENTERLINE LOGISTICS)": [],
  "SEATTLE PIER 36 (USCG)": [],
  "SEATTLE ISLAND TUG & BARGE": [],
  "SEATTLE WESTERN TOWBOAT": [],
  "SEATTLE COVICH-WILLIAMS": [
    "wa-covich-williams"
  ],
  "SEATTLE PACIFIC FISHERMEN SHIPYARD": [],
  "SEATTLE STABBERT MARINE & INDUSTRIAL SHIPYARD": [],
  "SEATTLE VIGOR SHIPYARD FACILITY": [],
  "SEATTLE FOSS SHIPYARD": [],
  "SEATTLE TRIDENT SHIP REPAIR FACILITY": [],
  "SEATTLE ELLIOTT BAY MARINA": [],
  "SEATTLE LAFARGE CEMENT": [
    "wa-lafarge-seattle"
  ],
  "SEATTLE CALPORTLAND (ex-Glacier)": [],
  "BP CHERRY POINT REFINERY": [
    "wa-bp-cherry-point"
  ],
  "FERNDALE PHILLIPS 66": [
    "wa-p66-ferndale"
  ],
  "ANACORTES MARATHON REFINERY": [
    "wa-marathon-anacortes"
  ],
  "HF SINCLAIR PUGET SOUND REFINERY (MARCH POINT)": [
    "wa-hfs-puget-sound"
  ],
  "ANACORTES CURTIS WHARF": [
    "wa-anacortes-petcoke"
  ],
  "ANACORTES PIER 2/LOG DOCK": [
    "wa-anacortes-petcoke"
  ],
  "ANACORTES PIER 1": [
    "wa-anacortes-petcoke"
  ],
  "ANACORTES WYMAN'S MARINA": [
    "wa-anacortes-petcoke"
  ],
  "ANACORTES CAP SANTE MARINA": [],
  "ANACORTES FERRY TERM GUEMES ISLAND": [],
  "ANACORTES DAKOTA CREEK  INDUSTRIES SHIPYARD": [],
  "BELLINGHAM CRUISE TERMINAL": [],
  "BELLINGHAM MAXUM FAIRHAVEN": "gap",
  "BELLINGHAM SHIPPING TERMINAL": [
    "wa-pob-shipping-terminal"
  ],
  "TACOMA US OIL": [
    "wa-us-oil-tacoma"
  ],
  "TACOMA SEAPORT SOUND TERMINAL": [
    "wa-seaport-sound-tacoma"
  ],
  "TACOMA SSA MARINE": [
    "wa-nwsa-west-sitcum",
    "wa-pot-t7"
  ],
  "TACOMA HUSKY TERMINAL": [
    "wa-nwsa-husky"
  ],
  "TACOMA TERMINAL 7": [
    "wa-pot-t7"
  ],
  "TACOMA TOTE MARITIME ALASKAN TERMINAL": [
    "wa-tote-tacoma"
  ],
  "TACOMA BLAIR TERMINAL (PORT OF TACOMA RD)": [
    "wa-pot-blair"
  ],
  "TACOMA EAST BLAIR 1 (EB-1) ALEXANDER AVE ACCESS": [
    "wa-pot-blair"
  ],
  "TACOMA WASHINGTON UNITED TERMINALS (WUT)": [
    "wa-nwsa-wut"
  ],
  "TACOMA PIERCE COUNTY TERMINAL - PCT A&  B": [
    "wa-nwsa-pct"
  ],
  "TACOMA FOSS/MSRC DOCK": [],
  "TACOMA PIER 24/25 (TRIDENT)": [],
  "TACOMA VIGOR MARINE": [],
  "TACOMA QUIGG BROS.": [],
  "PORT ANGELES FERRY TERM": [],
  "PORT ANGELES MARINA": [],
  "PORT ANGELES TERMINAL NO. 1": [
    "wa-popa-marine-terminal"
  ],
  "PORT ANGELES TERMINAL NO. 3 \"T\" PIER": [
    "wa-popa-marine-terminal"
  ],
  "EVERETT PACIFIC TERMINAL": [
    "wa-poe-seaport"
  ],
  "EVERETT PIER 3 SOUTH": [
    "wa-poe-seaport"
  ],
  "EVERETT PIER 1 NORTH": [
    "wa-poe-seaport"
  ],
  "EVERETT PIER 1 SOUTH": [
    "wa-poe-seaport"
  ],
  "EVERETT SHIP REPAIR (NICHOLS BROS)": [],
  "EVERETT DUNLAP TOWING": [],
  "EVERETT PORT OF EVERETT MARINA": [],
  "NAVAL BASE KITSAP MANCHESTER": [
    "wa-nbk-manchester"
  ]
}
