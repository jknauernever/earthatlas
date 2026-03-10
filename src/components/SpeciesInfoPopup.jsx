import { useRef, useEffect, useCallback, useState } from 'react'
import { Link } from 'react-router-dom'

const inatCache = {}
async function resolveInatTaxon(scientificName) {
  if (!scientificName) return null
  if (inatCache[scientificName] !== undefined) return inatCache[scientificName]
  try {
    const res = await fetch(`https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(scientificName)}&per_page=1`)
    const data = await res.json()
    const t = data.results?.[0]
    const id = t?.name === scientificName ? t.id : (t?.id || null)
    inatCache[scientificName] = id
    return id
  } catch { inatCache[scientificName] = null; return null }
}

function toSlug(name) {
  return name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || ''
}

const IUCN_LABEL = {
  CR: 'Critically Endangered',
  EN: 'Endangered',
  VU: 'Vulnerable',
  NT: 'Near Threatened',
  LC: 'Least Concern',
}
const IUCN_COLOR = {
  CR: '#e74c3c', EN: '#e67e22', VU: '#f39c12', NT: '#27ae60', LC: '#2ecc71',
}

export default function SpeciesInfoPopup({ species, styles, openInfoKey, setOpenInfoKey }) {
  const popupRef = useRef(null)
  const btnRef = useRef(null)
  const [inatId, setInatId] = useState(null)

  const infoKey = species.speciesKey || species.common
  const open = openInfoKey === infoKey

  // Resolve iNaturalist taxon ID when popup opens
  useEffect(() => {
    if (!open || inatId) return
    resolveInatTaxon(species.scientific).then(id => { if (id) setInatId(id) })
  }, [open, species.scientific, inatId])

  const meta = species.meta || {}
  const photo = meta.photoUrl || (species.photos && species.photos[0]) || null

  const iucn = species.iucn || meta.iucn
  const iucnLabel = IUCN_LABEL[iucn]
  const iucnColor = IUCN_COLOR[iucn]

  const close = useCallback(() => {
    setOpenInfoKey?.(prev => prev === infoKey ? null : prev)
  }, [infoKey, setOpenInfoKey])

  const toggle = useCallback(() => {
    setOpenInfoKey?.(prev => prev === infoKey ? null : infoKey)
  }, [infoKey, setOpenInfoKey])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (popupRef.current?.contains(e.target)) return
      if (btnRef.current?.contains(e.target)) return
      close()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, close])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handleKey(e) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, close])

  // Reposition if overflowing viewport
  useEffect(() => {
    if (!open || !popupRef.current) return
    const el = popupRef.current
    // Reset positioning before measuring
    el.style.left = '-80px'
    el.style.right = 'auto'
    el.style.top = '100%'
    el.style.bottom = 'auto'
    el.style.marginTop = '8px'
    el.style.marginBottom = '0'

    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth - 12) {
      el.style.left = 'auto'
      el.style.right = '0'
    }
    if (rect.bottom > window.innerHeight - 12) {
      el.style.top = 'auto'
      el.style.bottom = '100%'
      el.style.marginTop = '0'
      el.style.marginBottom = '8px'
    }
  }, [open])

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', zIndex: open ? 60 : 1 }}
      onClick={e => e.stopPropagation()}
    >
      <button
        ref={btnRef}
        className={styles.infoBtn}
        onClick={toggle}
        title="Species info"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M8 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="8" cy="5" r="0.75" fill="currentColor"/>
        </svg>
      </button>
      {open && (
        <div ref={popupRef} className={styles.infoPopup}>
          {photo && (
            <div className={styles.infoPopupPhoto}>
              <img
                src={photo}
                alt={species.common}
                onError={e => { e.target.parentElement.style.display = 'none' }}
              />
            </div>
          )}
          <div className={styles.infoPopupBody}>
            <div className={styles.infoPopupName}>
              {species.common}
            </div>
            {species.scientific && (
              <div className={styles.infoPopupSci}>{species.scientific}</div>
            )}
            {iucnLabel && (
              <span className={styles.infoPopupIucn} style={{ background: iucnColor }}>
                {iucnLabel}
              </span>
            )}
            {meta.lengthM && (
              <div className={styles.infoPopupStat}>
                Typical length: <strong>{meta.lengthM}m</strong>
              </div>
            )}
            {species.count > 0 && (
              <div className={styles.infoPopupStat}>
                Sightings nearby: <strong>{species.count}</strong>
                {species.lastSeen && <> · Last seen: <strong>{species.lastSeen}</strong></>}
              </div>
            )}
            {meta.fact && (
              <div className={styles.infoPopupFact}>{meta.fact}</div>
            )}
            {inatId && (
              <Link
                to={`/species/${inatId}-${toSlug(species.scientific)}`}
                style={{ display: 'inline-block', marginTop: 8, fontSize: 12, fontWeight: 600, color: '#3d5a3e' }}
              >
                View full profile →
              </Link>
            )}
          </div>
        </div>
      )}
    </span>
  )
}
