import { useState, useRef, useEffect, useCallback } from 'react'
import { searchPlaces } from '../services/mapbox'
import styles from './LocationSearch.module.css'

export default function LocationSearch({ locationName, onLocationSelect }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef(null)
  const timerRef = useRef(null)

  const displayValue = open ? query : ''
  const placeholder = locationName || 'Search a location…'

  // Debounced search
  const handleChange = useCallback((e) => {
    const val = e.target.value
    setQuery(val)
    setActiveIdx(-1)
    clearTimeout(timerRef.current)

    if (!val.trim()) {
      setResults([])
      return
    }

    timerRef.current = setTimeout(async () => {
      const places = await searchPlaces(val)
      setResults(places)
    }, 300)
  }, [])

  // Select a result
  const handleSelect = useCallback((place) => {
    onLocationSelect({ lat: place.lat, lng: place.lng, name: place.name })
    setQuery('')
    setResults([])
    setOpen(false)
    inputRef.current?.blur()
  }, [onLocationSelect])

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (!results.length) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      handleSelect(results[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setResults([])
      inputRef.current?.blur()
    }
  }, [results, activeIdx, handleSelect])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (!inputRef.current?.parentElement?.contains(e.target)) {
        setOpen(false)
        setResults([])
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Cleanup timer
  useEffect(() => () => clearTimeout(timerRef.current), [])

  return (
    <div className={styles.wrapper}>
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        value={displayValue}
        placeholder={placeholder}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && results.length > 0 && (
        <div className={styles.dropdown}>
          {results.map((place, i) => (
            <button
              key={i}
              className={`${styles.option} ${i === activeIdx ? styles.active : ''}`}
              onMouseDown={() => handleSelect(place)}
            >
              {place.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
