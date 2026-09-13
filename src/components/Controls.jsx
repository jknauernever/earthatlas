import LocationSearch from './LocationSearch'
import SpeciesSearch from './SpeciesSearch'
import styles from './Controls.module.css'


const TIME_OPTIONS_FULL = [
  { value: 'hour',  label: 'Past hour'  },
  { value: 'day',   label: 'Past day'   },
  { value: 'week',  label: 'Past week'  },
  { value: 'month', label: 'Past month' },
  { value: 'year',  label: 'Past year'  },
  { value: 'all',   label: 'All time'   },
]



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
  timeWindow, onTimeChange,
  canSearch, onSearch,
  // Subsite mode: a curated species catalog replaces the global
  // autocomplete (scoped, instant, zero network), custom time options
  // replace the fetch-window ones, and the Search button hides (subsites
  // search on selection).
  speciesOptions = null,
  timeOptions: timeOptionsProp = null,
  showSearchButton = true,
}) {
  const locating = geoStatus === 'loading'
  const timeOptions = timeOptionsProp || TIME_OPTIONS_FULL

  return (
    <div className={styles.bar}>
      <div className={styles.inner}>
        {/* Species search — primary action */}
        <div className={styles.group} style={{ flex: '1.5', minWidth: '220px', maxWidth: '360px' }}>
          <label className={styles.label}>Species</label>
          {speciesOptions ? (
            <select
              value={selectedSpecies || ''}
              onChange={(e) => onSpeciesSelect(e.target.value || null)}
            >
              <option value="">All species</option>
              {speciesOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : (
            <SpeciesSearch
              selectedSpecies={selectedSpecies}
              onSpeciesSelect={onSpeciesSelect}
            />
          )}
        </div>

        {/* Location search */}
        <div className={styles.group} style={{ flex: '1', minWidth: '180px', maxWidth: '300px' }}>
          <label className={styles.label}>Location <span className={styles.optional}>(optional)</span></label>
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


        {/* Time window */}
        <div className={styles.group}>
          <label className={styles.label}>Time Window</label>
          <select value={timeWindow} onChange={e => onTimeChange(e.target.value)}>
            {timeOptions.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {showSearchButton && (
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
        )}
      </div>
    </div>
  )
}
