import { useState, useRef, useEffect, useCallback } from 'react'
import { searchTaxa } from '../services/iNaturalist'
import { fetchEBirdTaxonomy, searchEBirdTaxa } from '../services/eBird'
import { searchGBIFTaxa } from '../services/gbif'
import styles from './SpeciesSearch.module.css'

// Group taxa results by species-level binomial name, collapsing subspecies.
// Preserves the original API relevance ordering.
function groupBySpecies(results) {
  const groups = new Map()
  // Track insertion order — each entry is either a group key or a standalone taxon
  const order = []
  const seen = new Set()

  for (const taxon of results) {
    const sci = taxon.scientificName || ''
    const parts = sci.split(/\s+/)
    const binomial = parts.length >= 2 ? `${parts[0]} ${parts[1]}`.toLowerCase() : null
    const isSubspecies = binomial && !sci.includes('×') &&
      (taxon.rank === 'subspecies' || taxon.rank === 'variety' || taxon.rank === 'form')

    if (isSubspecies) {
      if (!groups.has(binomial)) {
        groups.set(binomial, { parent: null, subspecies: [] })
        order.push({ type: 'group', key: binomial })
      }
      groups.get(binomial).subspecies.push(taxon)
    } else if (binomial && taxon.rank === 'species') {
      if (groups.has(binomial)) {
        groups.get(binomial).parent = taxon
      } else {
        groups.set(binomial, { parent: taxon, subspecies: [] })
        order.push({ type: 'group', key: binomial })
      }
    } else {
      order.push({ type: 'standalone', taxon: { ...taxon, subspeciesCount: 0 } })
    }
  }

  const output = []
  for (const entry of order) {
    if (entry.type === 'standalone') {
      output.push(entry.taxon)
    } else {
      const { parent, subspecies } = groups.get(entry.key)
      if (parent) {
        output.push({ ...parent, subspeciesCount: subspecies.length })
      } else {
        for (const sub of subspecies) output.push({ ...sub, subspeciesCount: 0 })
      }
    }
  }

  return output
}

export default function SpeciesSearch({ selectedSpecies, onSpeciesSelect, dataSource }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef(null)
  const timerRef = useRef(null)

  const displayValue = open ? query : ''
  const placeholder = selectedSpecies ? selectedSpecies.name : 'Any species…'

  // Pre-load eBird taxonomy when source switches to eBird
  const taxonomyLoaded = useRef(false)
  useEffect(() => {
    if (dataSource === 'eBird' && !taxonomyLoaded.current) {
      taxonomyLoaded.current = true
      fetchEBirdTaxonomy().catch(() => {})
    }
  }, [dataSource])

  const handleChange = useCallback((e) => {
    const val = e.target.value
    setQuery(val)
    setActiveIdx(-1)
    clearTimeout(timerRef.current)

    if (!val.trim()) {
      setResults([])
      return
    }

    if (dataSource === 'eBird') {
      // eBird: client-side filter of cached taxonomy (instant)
      timerRef.current = setTimeout(() => {
        setResults(searchEBirdTaxa(val))
      }, 100)
    } else if (dataSource === 'GBIF') {
      // GBIF: species suggest API
      timerRef.current = setTimeout(async () => {
        const taxa = await searchGBIFTaxa(val)
        setResults(taxa)
      }, 300)
    } else {
      // iNaturalist / All: taxa autocomplete API — group subspecies
      timerRef.current = setTimeout(async () => {
        const taxa = await searchTaxa(val)
        setResults(groupBySpecies(taxa))
      }, 300)
    }
  }, [dataSource])

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
                <span className={styles.sciName}>
                  {taxon.scientificName}
                  {taxon.subspeciesCount > 0 && (
                    <span className={styles.subHint}> · includes subspecies</span>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
