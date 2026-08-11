/**
 * Canonical iNaturalist place IDs for the countries shown in the
 * "top countries" leaderboard. Single source of truth for both the
 * runtime service (src/services/iNaturalist.js) and the build-time
 * prebuild script (scripts/prebuild-stats.js) — the two previously
 * carried diverging copies where several IDs pointed at the wrong
 * country (e.g. 7142 is Rwanda, not Japan; 8057 is Austria, not Brazil).
 *
 * IDs verified against iNaturalist's own published country data
 * (github.com/inaturalist/inaturalist.github.io, map.json).
 */
export const INAT_COUNTRIES = [
  { placeId: 1,    name: 'United States',  flag: '🇺🇸' },
  { placeId: 6712, name: 'Canada',         flag: '🇨🇦' },
  { placeId: 6744, name: 'Australia',      flag: '🇦🇺' },
  { placeId: 7161, name: 'Russia',         flag: '🇷🇺' },
  { placeId: 6793, name: 'Mexico',         flag: '🇲🇽' },
  { placeId: 6857, name: 'United Kingdom', flag: '🇬🇧' },
  { placeId: 6986, name: 'South Africa',   flag: '🇿🇦' },
  { placeId: 7207, name: 'Germany',        flag: '🇩🇪' },
  { placeId: 6681, name: 'India',          flag: '🇮🇳' },
  { placeId: 6878, name: 'Brazil',         flag: '🇧🇷' },
  { placeId: 6803, name: 'New Zealand',    flag: '🇳🇿' },
  { placeId: 6753, name: 'France',         flag: '🇫🇷' },
  { placeId: 6774, name: 'Spain',          flag: '🇪🇸' },
  { placeId: 6973, name: 'Italy',          flag: '🇮🇹' },
  { placeId: 6737, name: 'Japan',          flag: '🇯🇵' },
]
