# Global Fishing Watch — Vessels API (reference for /ships)

Studied 2026-09-24 from GFW's own documentation, fetched as plain text from
<https://globalfishingwatch.org/our-apis/documentation/llms-full.txt> (every docs
page in one file) plus the rendered OpenAPI parameter tables on the
`/docs/v3/vessels/*` pages. The raw OpenAPI document (`apiv3`) is not publicly
served — `gateway.api.globalfishingwatch.org/v3/api-docs` and `/v3/openapi.json`
return 401 without a token.

Facts below are from those pages. Anything not yet confirmed against a live
response is marked **UNVERIFIED (needs token)**.

## Access, license, limits

| Item | Fact |
|---|---|
| Base URL | `https://gateway.api.globalfishingwatch.org/v3` |
| Auth | `Authorization: Bearer <token>` on every request. Token from <https://globalfishingwatch.org/our-apis/tokens>; tokens do not expire. |
| Token secrecy | Terms §2.G: the token must not be published or embedded in a public web interface. **All GFW calls are server-side only** (import scripts; never the browser). |
| Who may register | Terms §2.B: on behalf of an organization that supports sustainable use of ocean resources, from that organization's email, one registration per organization. |
| License | **CC BY-NC 4.0, non-commercial only** (Terms §1.C): use must not be "primarily or materially" for commercial advantage or monetary compensation. GFW can revoke access. |
| Attribution (websites) | "Powered by Global Fishing Watch." linked to <https://globalfishingwatch.org> on every page or visual that uses the data (Terms §3.A.1). Must be passed on to downstream users (§3.B). |
| Storing data | Allowed and encouraged: the rate-limit guidance says "Store frequently accessed data locally to avoid repeated requests". |
| Registry raw data | GFW does "not publicly disclose the raw information that we collect" from registries. We only ever see GFW's processed fields. |
| Rate limits | 50,000 requests/day and 1,500,000/month **per user** (shared by up to 5 tokens). Exceeding them returns `429` and blocks the user for 24 h (daily) or 30 days (monthly). |
| Rate-limit headers | `x-ratelimit-daily-remaining-requests`, `x-ratelimit-monthly-remaining-requests`, `…-current-usage`, `…-reset-hours/days`. Recomputed every 30 minutes. |
| Dataset versions | Use `public-global-vessel-identity:latest`. As of 2026-02-25 `latest` → v4.0. The resolved version comes back in the `x-datasets` response header. Old versions live ≤3 months, then return `422`. |

## Endpoints

### `GET /v3/vessels/search`
| Param | Notes |
|---|---|
| `datasets[0]` * | `public-global-vessel-identity:latest` |
| `query` | Free text (MMSI, IMO, callsign, name…), at least 3 characters. Cannot be combined with `where`. |
| `where` | Advanced filter over `id`, `ssvid` (=MMSI), `imo`, `callsign`, `flag`, `shipname`, `normalized_shipname`, `firstTransmissionDate`, `lastTransmissionDate`; supports `AND`, `OR`, `=`, `>=`, `<`. The docs contradict each other on `LIKE` (the spec says unsupported; an example uses it). |
| `match-fields` | `ID_MATCH_ONLY`, `SEVERAL_FIELDS`, `NO_MATCH`, `ALL` (only with `query`). |
| `includes` | `MATCH_CRITERIA`, `OWNERSHIP`, `AUTHORIZATIONS` |
| `limit` | ≤ 50 (default 30) |
| `since` | Cursor from the previous page (the search response carries `since`; the general pagination page describes `offset/nextOffset` for other collections). |

**Search returns only each vessel's LATEST registry record.** In the documented
example, `registryInfoTotalRecords: 3` but `registryInfo` holds 1 item. Getting
the history requires the endpoints below.

### `GET /v3/vessels?ids[]=…` (batch) and `GET /v3/vessels/{id}` (single)
| Param | Notes |
|---|---|
| `datasets[0]` * / `dataset` * | same identity dataset |
| `ids[n]` | GFW vessel ids (`selfReportedInfo[].id`) |
| `registries-info-data` | `NONE` (default), `DELTA` (only records that change over time), `ALL` |
| `includes` | `POTENTIAL_RELATED_SELF_REPORTED_INFO`: groups every AIS identity GFW believes belongs to the same physical vessel, based on registry information |
| `match-fields`, `binary`, `vessel-groups` | not used by us |

The batch response returns `metadata.idsFound` / `metadata.idsNotFound`.

## Response object (one entry = one GFW vessel grouping)

```
dataset                        e.g. "public-global-vessel-identity:v3.0"
registryInfoTotalRecords       count of registry records GFW holds for the vessel
selfReportedInfo[]             AIS identity segments (AIS self-reported)
  id                           GFW vessel id (links all GFW APIs; the key we store)
  ssvid                        MMSI as transmitted
  shipname / nShipname         raw / GFW-normalized (alnum, no spaces)
  flag                         ISO3, derived from the MMSI MID
  callsign, imo                as transmitted (imo often null even when the registry has one)
  geartype, shiptype, shiptypesByYear[{shiptype, years[]}]
  messagesCounter, positionsCounter
  sourceCode[]                 ["AIS"]
  matchFields                  ID_MATCH_ONLY | SEVERAL_FIELDS | NO_MATCH
  transmissionDateFrom/To      first/last AIS message seen under this identity
registryInfo[]                 registry records matched to the vessel
  id, vesselInfoReference      (matchCriteria points at vesselInfoReference)
  sourceCode[]                 registry codes, e.g. ["IMO","USA"] (table below)
  ssvid, flag, shipname, nShipname, callsign, imo
  geartype[] (also seen as geartypes[]), lengthM, tonnageGt
  latestVesselInfo             bool
  transmissionDateFrom/To      AIS window the record was matched to (NOT registry validity)
  extraFields[]                source-specific extras
registryOwners[]               {name, flag, ssvid, sourceCode, dateFrom, dateTo}
registryAuthorizations[] / registryPublicAuthorizations[]   (the docs use both names)
                               {sourceCode, ssvid, dateFrom, dateTo}
combinedSourcesInfo[]          GFW's fused classification, each item with source + yearFrom/yearTo:
  vesselId, shiptypes[], geartypes[], inferredVesselClassAgNnet[],
  onFishingListSr[], prodGeartypeSource[], registryVesselClass[]
matchCriteria[]                (with includes=MATCH_CRITERIA) why each sub-record was matched:
  {reference, property, source, matches[{property,value}], period{dateFrom,dateTo}, latestVesselInfo}
```

Documented response quirks our normalizer must handle:
- **Two timestamp formats**: `"2019-04-06T13:12:43Z"` and `"2012-05-25 15:16:29 UTC"`. Both state UTC explicitly. Anything without a zone marker is rejected, never guessed.
- `geartype` vs `geartypes`, and `registryAuthorizations` vs `registryPublicAuthorizations`: the docs use both spellings.
- Both `yearFrom: "2012"` (string) and `yearFrom: 2012` (number) appear.

### Why one vessel has several GFW ids
GFW creates a new `selfReportedInfo` record whenever the AIS-reported identity
changes: a real change (new flag, name or MMSI) or just a change in which fields
are transmitted. The documented example is **GABU REEFER, IMO 8300949**:

| GFW vessel id | MMSI | Callsign | AIS window |
|---|---|---|---|
| 58cf536b1-1fca-dac3-ad31-7411a3708dcd | 616852000 | D6FJ2 | 2012-01-02 → 2019-02-23 |
| 0b7047cb5-58c8-6e63-4bfd-96a6af515c91 | 214182732 | ER2732 | 2019-02-22 → 2022-09-19 |
| 1da8dbc23-3c48-d5ce-95f1-1ffb6cc00161 | 613590000 | TJMC996 | 2022-01-24 → (ongoing) |

The windows overlap (2019-02-22/23 and 2022-01..09). A time-aware lookup can
therefore return two identities for one instant. For the same vessel that is
harmless; across vessels it has to be reported as ambiguous.

## Semantics we adopt (see src/ships/CLAUDE.md)
- `selfReportedInfo` → evidence class `ais_self_reported`. Its transmission
  window is an **observed** period, stored as an inclusive `[first, last]`
  range, not as a validity period.
- `registryInfo` → evidence class `registry`, taken from GFW-processed registry
  data (the original registries are listed in `sourceCode`). Its transmission
  window is also **observed** (the AIS window it was matched to).
- `registryOwners` → owner as listed by a registry. GFW does not say whether
  this is the registered or the beneficial owner, so we store `registry_owner`
  and never upgrade it to either.
- `combinedSourcesInfo` → evidence class `inferred` (GFW's models plus registry).
- Grouping all of this into one entry is GFW's identity claim → evidence class
  `derived_identity`.

## Registry source codes (as documented)
AUS, CAN, CCAMLR, CCSBT, CRUISE, ECU, ESP, EU, FFA, FRO, GFCM, GFW-REVIEW,
IATTC, ICCAT, IMO (GISIS), IOTC, ISL, ISSF, IUU (TMT combined IUU list), KOR,
MDG, MYS, NAFO, NEAFC, NOR, NPFC, OPRT, PER, RESEARCH-PAPER, RUS, SEAFO,
SEISMIC, SIOFA, SNP (S&P Global ships data), SPRFMO, SPSHIPBASE, TMT,
TMT_National, TMT_Other, TMT_Other_Official (includes US OFAC sanctions list),
TMT_RFMO (as TMT_<RFMO>), TWN, USA (US merchant vessels / FCC licenses), WCPFC.

Vessel types: carrier, seismic_vessel, passenger, other, support, bunker, gear,
cargo, fishing, discrepancy.

## Other GFW APIs relevant to later /ships phases (not used in Phase 1)
- **4Wings** `public-global-presence:latest`: AIS vessel presence for ALL vessel
  types, one position per vessel per hour, 2012 → about 96 h ago; tiles
  (PNG/MVT), reports and per-cell interaction (which vessels are in a cell).
- **4Wings** `public-global-sar-presence:latest`: satellite-radar vessel
  detections, 2017 → 5 days ago, matched and unmatched to AIS ("dark" vessels).
- **Events**: port visits (v3.1 method, confidence 2–4), encounters, loitering
  and AIS-off gaps (prototype).
- **Insights**: IUU list membership, AIS-off, fishing in no-take MPAs.
- **Context layers**: EEZ, MPA and RFMO regions; offshore fixed infrastructure.

## Verified live (2026-09-24, first token call: GABU REEFER, IMO 8300949)
- `latest` resolved to **`public-global-vessel-identity:v4.0`**.
- **Search can return NO registry data** even when some exists: the search
  entry had `registryInfo: []` and `registryInfoTotalRecords: 0`, while the
  detail call (`registries-info-data=ALL`) returned the IMO registry record and
  its owner. This confirms that we ingest the detail response, never search.
- Search pagination uses `since` (null on the last page). Neither `offset` nor
  `nextOffset` appears. `where` with `imo = '…'` is rewritten server-side to
  `(selfReportedInfo.imo=… OR registryInfo.imo=…)`.
- The live authorizations key is `registryPublicAuthorizations`. Registry
  records use `geartypes` (plural) and carry `extraFields`.
- Owner `sourceCode` is an array (e.g. `["IMO","SNP"]`).
- Registry `shipname` can arrive already compacted (`"GABUREEFER"`).
- Real data differs from the documentation's table: four AIS identities now
  (plus MMSI 629009266, GMB, 2024-08-07 → ongoing), and the docs' windows have
  been revised. Treat documentation examples as illustrative only.
- The rate-limit header `x-ratelimit-daily-remaining-requests` is present.

## Still unverified
- The exact shape of multi-record registry history (GABU REEFER has only one
  registry record).
