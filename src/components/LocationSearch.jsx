/**
 * LocationSearch — thin wrapper around the canonical GeoSearch component.
 *
 * Kept for backward compatibility with existing callers (Controls.jsx) that
 * pass `{ locationName, onLocationSelect }`. New code should use GeoSearch
 * directly for richer access to type/zoom/bbox.
 */

import GeoSearch from './GeoSearch.jsx'

export default function LocationSearch({ locationName, onLocationSelect }) {
  const placeholder = locationName ? `Currently: ${locationName}` : 'Search a location…'
  return (
    <GeoSearch
      placeholder={placeholder}
      onSelect={(r) => onLocationSelect?.({ name: r.name, lat: r.lat, lng: r.lng })}
    />
  )
}
