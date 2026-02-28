import { useState, useRef, useEffect, useCallback } from 'react'
import { searchTaxa } from '../services/iNaturalist'
import styles from './SpeciesSearch.module.css'

export default function SpeciesSearch({ selectedSpecies, onSpeciesSelect }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef(null)
  const timerRef = useRef(null)

  const displayValue = open ? query : ''
  const placeholder = selectedSpecies ? selectedSpecies.name : 'Any species…'

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
      const taxa = await searchTaxa(val)
      setResults(taxa)
    }, 300)
  }, [])

  const handleSelect = useCallback((taxon) => {
    onSpeciesSelect(taxon)
    setQuery('')
    setResults([])
    setOpen(false)
    inputRef.current?.blur()
  }, [onSpeciesSelect])

  const handleClear = useCallback((e) => {
    e.stopPropagation()
    onSpeciesSelect(null)
    setQuery('')
    setResults([])
  }, [onSpeciesSelect])

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

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return (
    <div className={styles.wrapper}>
      <div className={styles.inputWrap}>
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
        {selectedSpecies && !open && (
          <button className={styles.clear} onMouseDown={handleClear} title="Clear species filter">
            &times;
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className={styles.dropdown}>
          {results.map((taxon, i) => (
            <button
              key={taxon.id}
              className={`${styles.option} ${i === activeIdx ? styles.active : ''}`}
              onMouseDown={() => handleSelect(taxon)}
            >
              {taxon.photoUrl && (
                <img className={styles.thumb} src={taxon.photoUrl} alt="" />
              )}
              <span className={styles.optionText}>
                <span className={styles.commonName}>{taxon.name}</span>
                <span className={styles.sciName}>{taxon.scientificName}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
