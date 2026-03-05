import { useState, useEffect } from 'react'

/**
 * LocationSearch — geocoding input using Mapbox Geocoding API.
 * Shows a dropdown of suggestions, calls onSelect({ name, lat, lng }) on pick.
 *
 * Props:
 *   onSelect     — ({ name, lat, lng }) => void
 *   placeholder  — string
 *   styles       — CSS module from parent
 */

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

export default function LocationSearch({ onSelect, placeholder = 'Enter a place or coastline…', styles }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&types=place,region,locality,district,neighborhood,country,poi&limit=5`
        )
        if (!res.ok) throw new Error()
        const data = await res.json()
        setResults(data.features || [])
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 280)
    return () => clearTimeout(t)
  }, [query])

  function handleSelect(f) {
    const [lng, lat] = f.center
    onSelect({ name: f.place_name, lat, lng })
    setQuery('')
    setResults([])
    setOpen(false)
  }

  function handleSearch() {
    if (results.length > 0) {
      handleSelect(results[0])
    } else if (query.length >= 2) {
      // Force an immediate search
      setLoading(true)
      fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&types=place,region,locality,district,neighborhood,country,poi&limit=5`
      )
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(data => {
          const features = data.features || []
          if (features.length > 0) handleSelect(features[0])
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    }
  }

  return (
    <div className={styles.locationSearchWrap}>
      <div className={styles.heroSearch}>
        <input
          className={styles.heroSearchInput}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSearch() } }}
        />
        <button className={styles.heroSearchBtn} type="button" onClick={handleSearch}>
          {loading ? '…' : 'Search'}
        </button>
      </div>
      {open && results.length > 0 && (
        <div className={styles.locationDropdown}>
          {results.map(f => (
            <div key={f.id} className={styles.locationOption} onMouseDown={() => handleSelect(f)}>
              {f.place_name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
