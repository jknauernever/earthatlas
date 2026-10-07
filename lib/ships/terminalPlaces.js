/**
 * The county and city / town each US terminal lies in (migration 028; scrubber-ship calls report, Josh 2026-10-07: the WA report breaks
 * down to county and municipal level). Read from the US Census Bureau geocoder's coordinates lookup (TIGER boundaries, public domain)
 * at the terminal's display point. The raw response is kept as evidence (source 'census-geocoder'); the columns are the claim.
 * A point in no incorporated place or CDP is unincorporated county land (place columns NULL, never guessed).
 */
import { upsertSource } from './store.js'
import { storeRawRecords } from './ports.js'

export const CENSUS_GEOCODER_SOURCE = {
  id: 'census-geocoder',
  name: 'US Census Bureau Geocoder (geographies by coordinates; TIGER boundaries)',
  publisher: 'U.S. Census Bureau',
  homepage_url: 'https://geocoding.geo.census.gov/geocoder/',
  license: 'Public domain (U.S. Government work)',
  license_url: 'https://www.census.gov/about/policies/open-gov/open-data.html',
  commercial_use: true,
  attribution_text: 'U.S. Census Bureau, TIGER/Line boundaries via the Census Geocoder',
  attribution_url: 'https://geocoding.geo.census.gov/geocoder/',
  notes: 'Coordinates lookup, benchmark Public_AR_Current, vintage Current_Current, layers States, Counties, Incorporated Places, Census Designated Places.',
}
export const CENSUS_KIND = 'point_geographies'
export const geocoderUrl = (lat, lon) => 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates?'
  + new URLSearchParams({ x: String(lon), y: String(lat), benchmark: 'Public_AR_Current', vintage: 'Current_Current',
    layers: 'States,Counties,Incorporated Places,Census Designated Places', format: 'json' })

/** A geocoder response → { state_code, county_name, county_fips, place_name, place_geoid, place_kind } (pure). */
export function placesOf(body) {
  const g = body?.result?.geographies || {}
  const st = g.States?.[0], co = g.Counties?.[0], inc = g['Incorporated Places']?.[0], cdp = g['Census Designated Places']?.[0]
  const place = inc || cdp || null
  return {
    state_code: st?.STUSAB || null,
    county_name: co?.NAME || null, county_fips: co?.GEOID || null,
    place_name: place?.NAME || null, place_geoid: place?.GEOID || null, place_kind: inc ? 'incorporated' : cdp ? 'cdp' : null,
  }
}

/** Store one terminal's geocoder response (evidence) and its places (claim). */
export async function storeTerminalPlaces(c, S, { key, url, retrievedAt, body, runId = null }) {
  await upsertSource(c, S, CENSUS_GEOCODER_SOURCE)
  const { byKey } = await storeRawRecords(c, S, CENSUS_GEOCODER_SOURCE.id, CENSUS_KIND,
    [{ key: `terminal ${key}`, payload: { url, retrieved_at: retrievedAt, body } }], { runId, retrievalUrl: url })
  const recId = (byKey.get(`terminal ${key}`) || []).at(-1)
  const p = placesOf(body)
  await c.query(`UPDATE ${S}.terminals SET state_code = $2, county_name = $3, county_fips = $4, place_name = $5, place_geoid = $6, place_kind = $7,
                   admin_source_record_id = $8 WHERE key = $1`,
    [key, p.state_code, p.county_name, p.county_fips, p.place_name, p.place_geoid, p.place_kind, recId ?? null])
  return p
}

/** "Seattle city" → "Seattle"; "Port Angeles city" → "Port Angeles"; CDPs keep their name without the suffix. */
export const placeLabel = (name) => (name ? name.replace(/\s+(city|town|CDP|village)$/i, '') : null)
