import { useState, useRef, useEffect, useCallback } from 'react'
import { searchTaxa } from '../services/iNaturalist'
import { fetchEBirdTaxonomy, searchEBirdTaxa } from '../services/eBird'
import { searchGBIFTaxa } from '../services/gbif'
import styles from './SpeciesSearch.module.css'

// Crude English stemmer — strips "s"/"es"/"ies" suffixes so "foxes"→"fox",
// "lions"→"lion", "jellies"→"jelly". Good enough for common-name matching;
// we don't need linguistic accuracy.
function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y'
  if (word.length > 3 && word.endsWith('es')) return word.slice(0, -2)
  if (word.length > 2 && word.endsWith('s')) return word.slice(0, -1)
  return word
}

// Score how well a query matches a taxon's common/scientific name. Higher is
// better. We use this to tier results *before* falling back to obs count —
// otherwise iNat's substring-heavy relevance conflates "Lion" (Panthera leo)
// with "dandelion", and "fox" with "foxglove". Last-word matches outrank
// first-word matches so that "Typical Foxes" (Vulpes) beats "Fox Spiders"
// (Alopecosa), and "Holarctic Bears" (Ursus) beats "Bear Spiders" — the
// canonical taxon for a common noun is usually named in the plural where the
// noun is the head word.
function matchQuality(taxon, queryStem) {
  const common = (taxon.name || '').toLowerCase()
  const sci = (taxon.scientificName || '').toLowerCase()
  const commonWords = common.split(/[^a-z]+/).filter(Boolean).map(stem)
  const sciWords = sci.split(/[^a-z]+/).filter(Boolean).map(stem)

  if (commonWords.length === 1 && commonWords[0] === queryStem) return 5
  if (commonWords[commonWords.length - 1] === queryStem) return 4
  if (commonWords[0] === queryStem) return 3
  if (commonWords.includes(queryStem)) return 3
  if (sciWords.includes(queryStem)) return 2
  if (common.includes(queryStem) || sci.includes(queryStem)) return 1
  return 0
}

// Ranks that count as "Groups" (broader than species) — genus + family-level
// containers users commonly mean when they type "bear" or "shark".
const GROUP_RANKS = new Set(['genus', 'subgenus', 'family', 'subfamily', 'tribe', 'subtribe', 'superfamily'])

// Organize taxa results into two sections — Genera first, Species below —
// with subspecies collapsed under their parent species. Within each section,
// sort by (match quality DESC, observations DESC) so whole-word hits always
// beat substring hits, then popularity breaks ties.
//
// Returns a flat list of entries: either { type: 'header', label } for
// section dividers, or { type: 'taxon', ...taxonFields } for selectable rows.
function groupAndSortResults(results, query = '') {
  const queryStem = stem(query.toLowerCase().trim())
  const sortByQualityThenObs = (a, b) => {
    const qa = matchQuality(a, queryStem)
    const qb = matchQuality(b, queryStem)
    if (qa !== qb) return qb - qa
    return (b.observationsCount || 0) - (a.observationsCount || 0)
  }
  const groups = [] // genus + family + subfamily + tribe + ...
  const speciesMap = new Map() // binomial → { parent, subspecies[] }
  const others = []

  for (const taxon of results) {
    const sci = (taxon.scientificName || '')
    const parts = sci.split(/\s+/)
    const binomial = parts.length >= 2 ? `${parts[0]} ${parts[1]}`.toLowerCase() : null
    const isHybrid = sci.includes('×')

    if (GROUP_RANKS.has(taxon.rank)) {
      groups.push(taxon)
    } else if (taxon.rank === 'species' && binomial && !isHybrid) {
      const existing = speciesMap.get(binomial)
      if (existing) existing.parent = taxon
      else speciesMap.set(binomial, { parent: taxon, subspecies: [] })
    } else if ((taxon.rank === 'subspecies' || taxon.rank === 'variety' || taxon.rank === 'form') && binomial) {
      const existing = speciesMap.get(binomial)
      if (existing) existing.subspecies.push(taxon)
      else speciesMap.set(binomial, { parent: null, subspecies: [taxon] })
    } else {
      others.push(taxon)
    }
  }

  groups.sort(sortByQualityThenObs)

  const species = []
  for (const { parent, subspecies } of speciesMap.values()) {
    if (parent) {
      species.push({ ...parent, subspeciesCount: subspecies.length })
    } else {
      // Orphan subspecies (parent wasn't returned) — surface them individually
      for (const sub of subspecies) species.push({ ...sub, subspeciesCount: 0 })
    }
  }
  species.sort(sortByQualityThenObs)

  const output = []
  const showHeaders = groups.length > 0 && species.length > 0
  if (groups.length) {
    if (showHeaders) output.push({ type: 'header', label: 'Groups' })
    for (const g of groups) output.push({ type: 'taxon', ...g })
  }
  if (species.length) {
    if (showHeaders) output.push({ type: 'header', label: 'Species' })
    for (const s of species) output.push({ type: 'taxon', ...s })
  }
  // Fallback: only higher ranks matched (rare) — show them ungrouped so the
  // search doesn't look empty.
  if (output.length === 0) {
    for (const o of others) output.push({ type: 'taxon', ...o })
  }
  return output
}

// Given a list with mixed header/taxon entries, find the next selectable
// (non-header) index in `direction`, wrapping around.
function nextSelectableIdx(entries, from, direction) {
  const len = entries.length
  if (!len) return -1
  let i = from
  for (let step = 0; step < len; step++) {
    i = (i + direction + len) % len
    if (entries[i]?.type === 'taxon') return i
  }
  return -1
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
        setResults(searchEBirdTaxa(val).map(t => ({ type: 'taxon', ...t })))
      }, 100)
    } else if (dataSource === 'GBIF') {
      // GBIF: species suggest API
      timerRef.current = setTimeout(async () => {
        const taxa = await searchGBIFTaxa(val)
        setResults(taxa.map(t => ({ type: 'taxon', ...t })))
      }, 300)
    } else {
      // iNaturalist / All: taxa autocomplete API — split into Genera/Species
      // sections, rank each by (match quality, observations), group
      // subspecies under their parent.
      timerRef.current = setTimeout(async () => {
        const taxa = await searchTaxa(val)
        setResults(groupAndSortResults(taxa, val))
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
      setActiveIdx(i => nextSelectableIdx(results, i, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => nextSelectableIdx(results, i < 0 ? 0 : i, -1))
    } else if (e.key === 'Enter' && activeIdx >= 0 && results[activeIdx]?.type === 'taxon') {
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
          {results.map((entry, i) => {
            if (entry.type === 'header') {
              return (
                <div key={`h-${i}`} className={styles.sectionHeader}>
                  {entry.label}
                </div>
              )
            }
            return (
              <button
                key={entry.id}
                className={`${styles.option} ${i === activeIdx ? styles.active : ''}`}
                onMouseDown={() => handleSelect(entry)}
              >
                {entry.photoUrl && (
                  <img className={styles.thumb} src={entry.photoUrl} alt="" />
                )}
                <span className={styles.optionText}>
                  <span className={styles.commonName}>{entry.name}</span>
                  <span className={styles.sciName}>
                    {entry.scientificName}
                    {entry.subspeciesCount > 0 && (
                      <span className={styles.subHint}> · includes subspecies</span>
                    )}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
