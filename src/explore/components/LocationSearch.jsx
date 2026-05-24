/**
 * LocationSearch — thin wrapper around the canonical GeoSearch component.
 *
 * Kept for backward compatibility with ExploreApp.jsx. New code should use
 * GeoSearch directly for richer access to type/zoom/bbox.
 */

import GeoSearch from '../../components/GeoSearch.jsx'

export default function LocationSearch({ onSelect, placeholder = 'Search a place, park, or coastline…' }) {
  return (
    <GeoSearch
      placeholder={placeholder}
      onSelect={(r) => onSelect?.({ name: r.name, lat: r.lat, lng: r.lng })}
    />
  )
}
