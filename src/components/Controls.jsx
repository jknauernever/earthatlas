import LocationSearch from './LocationSearch'
import SpeciesSearch from './SpeciesSearch'
import styles from './Controls.module.css'

// Search-area dropdown options. The 'narrow' choices stay capped at 50 km
// regardless of source so eBird (max 50) is always representable.
const AREA_OPTIONS = [
  { value: 'map',         label: 'Visible map area' },
  { value: 'narrow:1',    label: 'Within 1 km of center' },
  { value: 'narrow:5',    label: 'Within 5 km of center' },
  { value: 'narrow:10',   label: 'Within 10 km of center' },
  { value: 'narrow:25',   label: 'Within 25 km of center' },
  { value: 'narrow:50',   label: 'Within 50 km of center' },
  { value: 'worldwide',   label: 'Worldwide' },
]

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
  area, radius, onAreaSelect,
  timeWindow, onTimeChange,
  canSearch, onSearch,
  dataSource,
}) {
  const locating = geoStatus === 'loading'
  const isEBird = dataSource === 'eBird'
  const isGBIF  = dataSource === 'GBIF'
  const timeOptions   = isEBird ? TIME_OPTIONS_EBIRD   : isGBIF ? TIME_OPTIONS_GBIF   : TIME_OPTIONS_FULL

  // Current dropdown value: 'map' / 'worldwide' / 'narrow:<km>'
  const areaValue = area === 'narrow' ? `narrow:${radius}` : (area || 'map')

  const handleAreaChange = (e) => {
    const v = e.target.value
    if (v === 'map' || v === 'worldwide') {
      onAreaSelect({ area: v })
    } else if (v.startsWith('narrow:')) {
      onAreaSelect({ area: 'narrow', radius: parseInt(v.split(':')[1], 10) })
    }
  }

  const hasLocation = !!locationName || geoStatus === 'loading'

  return (
    <div className={styles.bar}>
      <div className={styles.inner}>
        {/* Species search — primary action */}
        <div className={styles.group} style={{ flex: '1.5', minWidth: '220px', maxWidth: '360px' }}>
          <label className={styles.label}>{isEBird ? 'Bird Species' : 'Species'}</label>
          <SpeciesSearch
            selectedSpecies={selectedSpecies}
            onSpeciesSelect={onSpeciesSelect}
            dataSource={dataSource}
          />
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

        {/* Search area — visible map by default; user can narrow to a fixed
            radius around the search center, or open up to a worldwide query.
            Only shown once a location is set (worldwide doesn't need one but
            the bbox/narrow modes do). */}
        {hasLocation && (
          <div className={styles.group}>
            <label className={styles.label}>Search area</label>
            <select value={areaValue} onChange={handleAreaChange}>
              {AREA_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Time window */}
        <div className={styles.group}>
          <label className={styles.label}>Time Window</label>
          <select value={timeWindow} onChange={e => onTimeChange(e.target.value)}>
            {timeOptions.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
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
