/**
 * GeoSearch — canonical earthatlas.org geo autocomplete.
 *
 * Behavioral parity with /forestmonitor: Mapbox Search Box v1 via the
 * /api/geo proxy, the same `types`, categorization, zoom presets, keyboard
 * nav, and result shape. Drop into any earthatlas.org React surface that
 * needs a place/address/POI lookup.
 *
 * Usage:
 *   <GeoSearch onSelect={(r) => map.flyTo({ center: [r.lng, r.lat], zoom: r.zoom })} />
 *
 * Props:
 *   onSelect(result)    Required. Called with the normalized result:
 *                       { id, name, type, category, lat, lng, bbox, zoom,
 *                         place_formatted, full_address, feature, suggestion }
 *   proximity           Bias suggestions toward this location. Accepts
 *                       {lng,lat}, [lng,lat], or () => {lng,lat}. A function
 *                       is re-evaluated for each suggest call so callers can
 *                       bias to a live map's current center.
 *   placeholder         Input placeholder text.
 *   autoFocus           Focus the input on mount.
 *   endpoint            Override the /api/geo proxy URL (default '/api/geo').
 *                       Use 'https://earthatlas.org/api/geo' from non-EA hosts.
 *   accessToken         Bypass the proxy and call Mapbox directly. Local-dev
 *                       escape hatch only — production should use the proxy.
 *   language            Mapbox `language` param (e.g. 'en', 'es').
 *   className           Extra class applied to the wrapper.
 *   inputName           HTML `name` for the input (default 'ea-geo-q').
 */

import { useEffect, useRef, useState } from 'react'
import {
  suggest as eaSuggest,
  retrieve as eaRetrieve,
  searchCategoryOf,
  searchResultMeta,
  searchTypeLabel,
  highlightMatch,
  newSessionToken,
  SEARCH_ICON_PATHS,
  DEFAULTS,
} from '../lib/eaGeoSearch.js'
import styles from './GeoSearch.module.css'

function resolveProximity(proximity) {
  if (!proximity) return undefined
  if (typeof proximity === 'function') {
    try { return proximity() } catch { return undefined }
  }
  return proximity
}

export default function GeoSearch({
  onSelect,
  proximity,
  placeholder = 'Search a place, address, park, or feature…',
  autoFocus = false,
  endpoint,
  accessToken,
  language,
  className,
  inputName = 'ea-geo-q',
}) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const sessionTokenRef = useRef(null)
  const debounceRef = useRef(null)
  const abortRef = useRef(null)
  const inputRef = useRef(null)
  const containerRef = useRef(null)

  if (sessionTokenRef.current == null) sessionTokenRef.current = newSessionToken()

  useEffect(() => {
    clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < DEFAULTS.minQueryLength) {
      setSuggestions([])
      setLoading(false)
      abortRef.current?.abort()
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      try {
        const results = await eaSuggest(q, {
          sessionToken: sessionTokenRef.current,
          proximity: resolveProximity(proximity),
          endpoint,
          accessToken,
          language,
          signal: ac.signal,
        })
        if (ac.signal.aborted) return
        setSuggestions(results)
        setOpen(true)
        setActiveIdx(-1)
      } catch (err) {
        if (err.name === 'AbortError') return
        console.error('[GeoSearch] suggest failed', err)
        setSuggestions([])
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    }, DEFAULTS.debounceMs)
    return () => clearTimeout(debounceRef.current)
  }, [query, proximity, endpoint, accessToken, language])

  useEffect(() => {
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = async (suggestion) => {
    try {
      const result = await eaRetrieve(suggestion, {
        sessionToken: sessionTokenRef.current,
        endpoint,
        accessToken,
        language,
      })
      if (!result) return
      onSelect?.(result)
      setQuery(result.name || suggestion.name || '')
      setOpen(false)
      setSuggestions([])
      sessionTokenRef.current = newSessionToken()
      inputRef.current?.blur()
    } catch (err) {
      console.error('[GeoSearch] retrieve failed', err)
    }
  }

  const handleKeyDown = (e) => {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const idx = activeIdx >= 0 ? activeIdx : 0
      if (suggestions[idx]) handleSelect(suggestions[idx])
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const handleClear = () => {
    setQuery('')
    setSuggestions([])
    setOpen(false)
    inputRef.current?.focus()
  }

  return (
    <div className={[styles.searchBox, className].filter(Boolean).join(' ')} ref={containerRef}>
      <div className={styles.searchInputWrap}>
        <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          name={inputName}
          className={styles.searchInput}
          style={{
            backgroundColor: '#3d5a3e',
            color: '#fff',
            WebkitTextFillColor: '#fff',
          }}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />
        {query && (
          <button type="button" className={styles.searchClear} onClick={handleClear} aria-label="Clear">×</button>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <ul className={styles.searchResults} role="listbox">
          {suggestions.map((s, i) => {
            const cat = searchCategoryOf(s)
            const typeLabel = searchTypeLabel(s)
            const meta = searchResultMeta(s)
            return (
              <li
                key={s.mapbox_id}
                role="option"
                aria-selected={i === activeIdx}
                className={i === activeIdx ? styles.searchResultActive : styles.searchResult}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(s) }}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <div className={`${styles.searchResultIcon} ${styles[`searchIcon_${cat}`]}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d={SEARCH_ICON_PATHS[cat]} />
                  </svg>
                </div>
                <div className={styles.searchResultText}>
                  <div
                    className={styles.searchResultName}
                    dangerouslySetInnerHTML={{ __html: highlightMatch(s.name, query) }}
                  />
                  <div className={styles.searchResultMeta}>
                    <span className={styles.searchResultType}>{typeLabel}</span>
                    {meta && (
                      <>
                        <span className={styles.searchResultSep}>·</span>
                        <span className={styles.searchResultContext}>{meta}</span>
                      </>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {open && loading && suggestions.length === 0 && (
        <div className={styles.searchEmpty}>
          <span className={styles.searchSpinner}></span> Searching…
        </div>
      )}
      {open && !loading && query.trim().length >= DEFAULTS.minQueryLength && suggestions.length === 0 && (
        <div className={styles.searchEmpty}>No results found</div>
      )}
    </div>
  )
}
