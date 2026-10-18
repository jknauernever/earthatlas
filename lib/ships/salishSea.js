/**
 * Which of our terminals are in the Salish Sea (scrubber report's "Salish Sea" area, Lovel 2026-10-13).
 *
 * The terminal list (lib/ships/terminals.js SALISH_BBOX) also holds Washington coast and lower Columbia River terminals
 * (Grays Harbor, Longview, Kalama, Vancouver WA), all south of 47.0°N; the Salish Sea's southern end (Olympia) is 47.05°N.
 * The west limit keeps Vancouver Island's outer coast (e.g. Port Alberni, -124.8°) out; the Strait of Juan de Fuca stays in.
 * Pure: shared by the report page and the server.
 */
export const SALISH_SEA_LIMITS = { south: 47.0, west: -124.75 }

export function inSalishSea({ lat, lon }) {
  const y = Number(lat), x = Number(lon)   // Postgres numeric arrives as a string
  return lat != null && lon != null && Number.isFinite(y) && Number.isFinite(x) && y >= SALISH_SEA_LIMITS.south && x >= SALISH_SEA_LIMITS.west
}
