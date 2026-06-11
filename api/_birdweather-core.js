/**
 * Shared core for the BirdWeather proxy — query builders + param sanitization.
 *
 * Imported by both the production Edge function (api/birdweather.js) and the
 * dev middleware (birdweatherProxyPlugin in vite.config.js) so /birdsong behaves
 * identically under `npm run dev`, `vercel dev`, and prod. The `_` prefix keeps
 * Vercel from treating this as its own serverless route.
 *
 * BirdWeather exposes one public GraphQL endpoint covering the entire global
 * network of PUC + BirdNET-Pi acoustic stations — no token needed for reads.
 * Rather than proxy arbitrary GraphQL (an open relay), we accept a small set of
 * typed params and build one of a few known, locked-down queries server-side.
 */

export const GRAPHQL_URL = 'https://app.birdweather.com/graphql'

// ─── Field selections (shared across queries) ───────────────────────────────
const SPECIES_FIELDS = `
  id commonName scientificName imageUrl thumbnailUrl color birdweatherUrl`
const DETECTION_FIELDS = `
  id timestamp confidence score certainty
  coords { lat lon }
  species { ${SPECIES_FIELDS} }
  soundscape { url duration }
  station { id name type }`
const STATION_FIELDS = `
  id name type coords { lat lon } country state location
  latestDetectionAt earliestDetectionAt
  counts { detections species }`

// ─── Operations: each builds { query, variables } from sanitized params ──────
const OPERATIONS = {
  stations({ ne, sw, first, query, period }) {
    return {
      query: `query($ne:InputLocation,$sw:InputLocation,$first:Int,$query:String,$period:InputDuration){
        stations(ne:$ne,sw:$sw,first:$first,query:$query,period:$period){
          totalCount
          nodes { ${STATION_FIELDS} }
        }
      }`,
      variables: { ne, sw, first, query, period },
    }
  },

  detections({ ne, sw, period, first, speciesId, stationIds }) {
    return {
      query: `query($ne:InputLocation,$sw:InputLocation,$period:InputDuration!,$first:Int,$speciesId:ID,$stationIds:[ID!]){
        detections(ne:$ne,sw:$sw,period:$period,first:$first,speciesId:$speciesId,stationIds:$stationIds,sortBy:"timestamp"){
          totalCount
          nodes { ${DETECTION_FIELDS} }
        }
      }`,
      variables: { ne, sw, period, first, speciesId, stationIds },
    }
  },

  topSpecies({ ne, sw, period, limit, stationIds }) {
    return {
      query: `query($ne:InputLocation,$sw:InputLocation,$period:InputDuration!,$limit:Int,$stationIds:[ID!]){
        topSpecies(ne:$ne,sw:$sw,period:$period,limit:$limit,stationIds:$stationIds){
          count
          species { ${SPECIES_FIELDS} }
        }
      }`,
      variables: { ne, sw, period, limit, stationIds },
    }
  },

  counts({ ne, sw, period, stationIds }) {
    return {
      query: `query($ne:InputLocation,$sw:InputLocation,$period:InputDuration!,$stationIds:[ID!]){
        counts(ne:$ne,sw:$sw,period:$period,stationIds:$stationIds){ detections species stations }
      }`,
      variables: { ne, sw, period, stationIds },
    }
  },

  station({ id }) {
    return {
      query: `query($id:ID!){
        station(id:$id){ ${STATION_FIELDS} }
      }`,
      variables: { id },
    }
  },
}

// Per-op edge cache. Detections move fast (new audio every few seconds), so a
// short TTL; stations/species shift slowly, so cache longer.
export const CACHE_CONTROL = {
  stations: 'public, s-maxage=300, stale-while-revalidate=600',
  detections: 'public, s-maxage=30, stale-while-revalidate=120',
  topSpecies: 'public, s-maxage=300, stale-while-revalidate=600',
  counts: 'public, s-maxage=300, stale-while-revalidate=600',
  station: 'public, s-maxage=120, stale-while-revalidate=600',
}

export const EMPTY = {
  stations: { stations: { totalCount: 0, nodes: [] } },
  detections: { detections: { totalCount: 0, nodes: [] } },
  topSpecies: { topSpecies: [] },
  counts: { counts: { detections: 0, species: 0, stations: 0 } },
  station: { station: null },
}

// ─── Param sanitizers ────────────────────────────────────────────────────────
function coord(latRaw, lonRaw) {
  const lat = parseFloat(latRaw)
  const lon = parseFloat(lonRaw)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { lat, lon }
}

function clampInt(raw, min, max, def) {
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

// Build an InputDuration from period-count (pc) + period-unit (pu). BirdWeather
// accepts units like 'hour' | 'day' | 'week' | 'month' | 'year'.
const ALLOWED_UNITS = new Set(['hour', 'day', 'week', 'month', 'year', 'all'])
function buildPeriod(pcRaw, puRaw, defCount) {
  const unit = ALLOWED_UNITS.has(puRaw) ? puRaw : 'day'
  if (unit === 'all') return { count: 100, unit: 'year' }
  const count = clampInt(pcRaw, 1, 365, defCount)
  return { count, unit }
}

/**
 * Resolve a sanitized GraphQL request from incoming query params.
 * @param {URLSearchParams} sp
 * @returns {{error:string,status:number} | {op:string,query:string,variables:object,cacheControl:string,empty:object}}
 */
export function resolveBirdweatherQuery(sp) {
  const op = sp.get('op')
  if (!op || !OPERATIONS[op]) {
    return { error: `unknown op; expected one of ${Object.keys(OPERATIONS).join(', ')}`, status: 400 }
  }

  const ne = coord(sp.get('nelat'), sp.get('nelng'))
  const sw = coord(sp.get('swlat'), sp.get('swlng'))
  const stationId = sp.get('stationId')
  const params = {
    ne: ne || undefined,
    sw: sw || undefined,
    first: clampInt(sp.get('first'), 1, 200, 50),
    limit: clampInt(sp.get('limit'), 1, 50, 10),
    query: sp.get('q') || undefined,
    speciesId: sp.get('speciesId') || undefined,
    stationIds: stationId ? [stationId] : undefined,
    id: sp.get('id') || undefined,
    period: buildPeriod(sp.get('pc'), sp.get('pu'), op === 'detections' ? 1 : 7),
  }

  // detections & topSpecies require a bounding box (or a station filter) so we
  // never ask BirdWeather for the entire planet's firehose.
  if ((op === 'detections' || op === 'topSpecies' || op === 'counts') && !(ne && sw) && !params.stationIds) {
    return { error: 'detections/topSpecies/counts require a bounding box (swlat/swlng/nelat/nelng) or stationId', status: 400 }
  }
  if (op === 'station' && !params.id) {
    return { error: 'station requires id', status: 400 }
  }

  const { query, variables } = OPERATIONS[op](params)
  return { op, query, variables, cacheControl: CACHE_CONTROL[op], empty: EMPTY[op] }
}
