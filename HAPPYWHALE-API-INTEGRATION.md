# EarthAtlas ⇄ Happywhale API Integration

**For:** Ken Southerland, Happywhale
**From:** Josh Knauer, EarthAtlas
**Date:** April 23, 2026

---

## What EarthAtlas sends when a user searches

A user search on EarthAtlas boils down to three inputs: a **species** (or taxonomic group), a **location** (point + radius, or bounding box), and a **time window**. We fan those inputs out to iNaturalist, eBird, and GBIF in parallel. Here's what each call looks like.

### iNaturalist

`GET https://api.inaturalist.org/v1/observations`

Parameters we send:

- `taxon_id` — iNat taxon ID (e.g. `41753` for Humpback, `152871` for all Cetacea)
- `lat`, `lng`, `radius` — point + km radius, **or** `nelat` / `nelng` / `swlat` / `swlng` for a bounding box
- `d1`, `d2` — date range, `YYYY-MM-DD`
- `per_page` — up to 200
- `order=desc`, `order_by=created_at`
- `quality_grade=any`, `captive=false`

### eBird

`GET https://api.ebird.org/v2/data/obs/geo/recent/{speciesCode}` (or `.../recent` for all species)

Parameters we send:

- `lat`, `lng` — center point only (no bbox support)
- `dist` — radius in km, **capped at 50**
- `back` — lookback in days, **capped at 30**
- `maxResults` — up to 10,000
- `includeProvisional=true`
- Header: `x-ebirdapitoken: {key}`

### GBIF

`GET https://api.gbif.org/v1/occurrence/search`

Parameters we send:

- `taxonKey` — GBIF backbone key (e.g. `2440735` for Humpback, `733` for all Cetacea)
- `decimalLatitude={minLat},{maxLat}` and `decimalLongitude={minLng},{maxLng}` — bounding box
- `eventDate={from},{to}` — date range
- `hasCoordinate=true`, `occurrenceStatus=PRESENT`
- `limit` — up to 300 per page; we paginate up to 5 pages

---

## What EarthAtlas receives from each source

Every source is normalized into a single internal shape before it hits the UI. Here are the fields we actually consume from each response:

### From iNaturalist

- `id`
- `taxon.id`, `taxon.name` (scientific), `taxon.preferred_common_name`, `taxon.iconic_taxon_name`
- `taxon.default_photo.square_url` — species thumbnail
- `photos[].url` — observation photos
- `observed_on`, `quality_grade`
- `place_guess` — free-text locality
- `geojson.coordinates` → `[lng, lat]`
- `user.login` — observer handle
- `num_identification_agreements`, `num_identification_disagreements`

### From eBird

- `subId` (checklist ID), `speciesCode`, `sciName`, `comName`, `familyComName`
- `obsDt` (datetime), `obsValid`
- `locName`, `lat`, `lng`
- `howMany` — individual count

eBird doesn't provide photos. We look them up from iNat's `/taxa/autocomplete` endpoint using `sciName` and cache per-species.

### From GBIF

- `key`, `taxonKey`, `speciesKey`
- `species`, `genus`, `vernacularName`, `taxonRank`
- `class`, `kingdom` — used to derive an iNat-style iconic taxon
- `media[]` where `type=StillImage` → `identifier` is the image URL
- `eventDate`
- `decimalLatitude`, `decimalLongitude`
- `locality`, `stateProvince`, `country`
- `recordedBy`, `institutionCode`, `datasetName`, `datasetKey`
- `basisOfRecord` — used to filter out zoo/aquarium records

---

## What an optimized Happywhale call would look like

The core request is the same across all three existing sources: **given a species, a location, and a time window, return sightings.** Happywhale's version could be as simple as:

```
GET /api/v1/sightings
  ?species={scientificName or Happywhale species key}
  &bbox={minLng},{minLat},{maxLng},{maxLat}
  &from={YYYY-MM-DD}
  &to={YYYY-MM-DD}
  &limit=300
```

Returning an array of objects shaped roughly like this:

```json
{
  "id":              "hw-12345",
  "speciesKey":      "mn",
  "sciName":         "Megaptera novaeangliae",
  "commonName":      "Humpback Whale",
  "date":            "2026-04-19",
  "lat":             36.6177,
  "lng":             -121.9166,
  "location":        "Monterey Bay, California",
  "observer":        "Happywhale contributor",
  "photoUrl":        "https://...",

  "individualId":    "HW-MN-9821",
  "individualUrl":   "https://happywhale.com/individual/9821",
  "encounterUrl":    "https://happywhale.com/encounter/12345",
  "matchedFluke":    true,
  "sightingCount":   23
}
```

The first ten fields are what every EarthAtlas source provides — enough to render a pin on the map with a basic popup. The five fields below the break are what Happywhale would uniquely contribute: individual-level identity and history. Those are what would make a whales visualization genuinely different from anything else available.

---

*Prepared April 23, 2026 for Ken Southerland, Happywhale. Questions: josh@knauernever.com*
