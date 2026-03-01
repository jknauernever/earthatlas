import LocationSearch from './LocationSearch'
import SpeciesSearch from './SpeciesSearch'
import styles from './Controls.module.css'

const RADIUS_OPTIONS_FULL  = [1, 5, 10, 25, 50, 100]
const RADIUS_OPTIONS_EBIRD = [1, 5, 10, 25, 50] // eBird max 50km
const RADIUS_OPTIONS_GBIF  = [1, 5, 10, 25, 50, 100] // GBIF — no hard limit

const TIME_OPTIONS_FULL = [
  { value: 'hour',  label: 'Past hour'  },
  { value: 'day',   label: 'Past day'   },
  { value: 'week',  label: 'Past week'  },
  { value: 'month', label: 'Past month' },
  { value: 'year',  label: 'Past year'  },
  { value: 'all',   label: 'All time'   },
]
const TIME_OPTIONS_EBIRD = [
  { value: 'hour',  label: 'Past hour'  },
  { value: 'day',   label: 'Past day'   },
  { value: 'week',  label: 'Past week'  },
  { value: 'month', label: 'Past month' },
] // eBird max 30 days

const TIME_OPTIONS_GBIF = TIME_OPTIONS_FULL // GBIF supports full date range

const COUNT_OPTIONS = [20, 50, 100, 200]

const LocateIcon = ({ spinning }) => (
  <svg className={spinning ? 'spin' : ''} xmlns="http://www.w3.org/2000/svg" width="13" height="13"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    {spinning
      ? <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      : <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></>}
  </svg>
)

const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
  </svg>
)

const PinIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"/>
  </svg>
)

export default function Controls({
  locationName, geoStatus, onLocate, onLocationSelect,
  selectedSpecies, onSpeciesSelect,
  radius, onRadiusChange,
  timeWindow, onTimeChange,
  perPage, onPerPageChange,
  canSearch, onSearch,
  dataSource,
}) {
  const locating = geoStatus === 'loading'
  const isEBird = dataSource === 'eBird'
  const isGBIF  = dataSource === 'GBIF'
  const radiusOptions = isEBird ? RADIUS_OPTIONS_EBIRD : isGBIF ? RADIUS_OPTIONS_GBIF : RADIUS_OPTIONS_FULL
  const timeOptions   = isEBird ? TIME_OPTIONS_EBIRD   : isGBIF ? TIME_OPTIONS_GBIF   : TIME_OPTIONS_FULL

  // Clamp radius if switching to eBird with radius > 50
  const effectiveRadius = isEBird && radius > 50 ? 50 : radius

  return (
    <div className={styles.bar}>
      <div className={styles.inner}>
        {/* Location search */}
        <div className={styles.group} style={{ flex: '1', minWidth: '200px', maxWidth: '340px' }}>
          <label className={styles.label}>Location</label>
          <LocationSearch
            locationName={locationName || (geoStatus === 'loading' ? 'Detecting…' : null)}
            onLocationSelect={onLocationSelect}
          />
        </div>

        {/* Locate Me */}
        <div className={styles.group}>
          <label className={styles.label}>&nbsp;</label>
          <button
            className="btn btn-primary"
            onClick={onLocate}
            disabled={locating}
          >
            <LocateIcon spinning={locating} />
            {locating ? 'Locating…' : locationName ? 'Re-Locate' : 'Locate Me'}
          </button>
        </div>

        {/* Species search */}
        <div className={styles.group} style={{ flex: '1', minWidth: '160px', maxWidth: '260px' }}>
          <label className={styles.label}>{isEBird ? 'Bird Species' : 'Species'}</label>
          {/* GBIF: uses GBIF species suggest; iNat: uses iNaturalist taxa autocomplete */}
          <SpeciesSearch
            selectedSpecies={selectedSpecies}
            onSpeciesSelect={onSpeciesSelect}
            dataSource={dataSource}
          />
        </div>

        {/* Radius */}
        <div className={styles.group}>
          <label className={styles.label}>Radius</label>
          <select value={effectiveRadius} onChange={e => onRadiusChange(Number(e.target.value))}>
            {radiusOptions.map(r => (
              <option key={r} value={r}>{r} km</option>
            ))}
          </select>
        </div>

        {/* Time window */}
        <div className={styles.group}>
          <label className={styles.label}>Time Window</label>
          <select value={timeWindow} onChange={e => onTimeChange(e.target.value)}>
            {timeOptions.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Result count */}
        <div className={styles.group}>
          <label className={styles.label}>Show</label>
          <select value={perPage} onChange={e => onPerPageChange(Number(e.target.value))}>
            {COUNT_OPTIONS.map(c => (
              <option key={c} value={c}>{c} results</option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className={styles.group}>
          <label className={styles.label}>&nbsp;</label>
          <button
            className="btn btn-secondary"
            onClick={onSearch}
            disabled={!canSearch}
          >
            <SearchIcon />
            Search
          </button>
        </div>
      </div>
    </div>
  )
}
