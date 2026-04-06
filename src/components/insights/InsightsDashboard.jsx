import { useState, useEffect, useRef } from 'react'
import { fetchInsightsData, resolveGBIFSpecies, resolveGBIFSpeciesPhotos, resolveGBIFClasses, resolveGBIFDatasets } from '../../services/insights'
import { fetchGBIFFacets } from '../../services/gbif'
import { getDateRangeStart } from '../../utils/taxon'
import TopSpecies from './TopSpecies'
import SeasonalityChart from './SeasonalityChart'
import YearTrendChart from './YearTrendChart'
import RecentTrendChart from './RecentTrendChart'
import TaxonomyBreakdown from './TaxonomyBreakdown'
import ConservationStatus from './ConservationStatus'
import DataSources from './DataSources'
import RecordTypes from './RecordTypes'
import SpeciesDetailModal from './SpeciesDetailModal'
import styles from './Insights.module.css'

export default function InsightsDashboard({ coords, radiusKm, timeWindow, activeTaxon, selectedSpecies, dataSource }) {
  const [data, setData] = useState(null)
  const [species, setSpecies] = useState(null)
  const [classes, setClasses] = useState(null)
  const [datasets, setDatasets] = useState(null)
  const [loading, setLoading] = useState(true)
  const [speciesLoading, setSpeciesLoading] = useState(true)
  const [classesLoading, setClassesLoading] = useState(true)
  const [datasetsLoading, setDatasetsLoading] = useState(true)
  const [selectedYear, setSelectedYear] = useState(null)
  const [focusedSpecies, setFocusedSpecies] = useState(null)
  const fetchId = useRef(0)

  // ─── Main fetch ─────────────────────────────────────────────────
  useEffect(() => {
    if (!coords && !selectedSpecies) return
    const id = ++fetchId.current

    setLoading(true)
    setSpeciesLoading(true)
    setClassesLoading(true)
    setDatasetsLoading(true)
    setData(null)
    setSpecies(null)
    setClasses(null)
    setDatasets(null)
    setSelectedYear(null)

    const d1 = getDateRangeStart(timeWindow)
    const d2 = d1 ? new Date().toISOString().split('T')[0] : undefined

    const params = {
      lat: coords?.lat,
      lng: coords?.lng,
      radiusKm: coords ? radiusKm : undefined,
      d1,
      d2,
      // GBIF-specific
      taxonKey: selectedSpecies?.gbifKey || selectedSpecies?.id,
      iconicTaxa: activeTaxon !== 'all' ? activeTaxon : undefined,
      // iNaturalist-specific
      taxonId: selectedSpecies?.id,
      // eBird-specific
      timeWindow,
      speciesCode: selectedSpecies?.speciesCode || selectedSpecies?.id,
    }

    fetchInsightsData(dataSource, params).then(async (result) => {
      if (id !== fetchId.current) return
      setData(result)
      setLoading(false)

      // GBIF: progressive species resolution
      if (result._speciesKeys?.length > 0) {
        const resolved = await resolveGBIFSpecies(result._speciesKeys)
        if (id !== fetchId.current) return
        setSpecies(resolved)
        setSpeciesLoading(false)

        const withPhotos = await resolveGBIFSpeciesPhotos(resolved)
        if (id !== fetchId.current) return
        setSpecies(withPhotos)
      } else if (result.species) {
        // iNat / eBird: species already resolved
        setSpecies(result.species)
        setSpeciesLoading(false)
      } else {
        setSpeciesLoading(false)
      }

      // GBIF: progressive class resolution
      if (result._classKeys?.length > 0) {
        const resolved = await resolveGBIFClasses(result._classKeys)
        if (id !== fetchId.current) return
        setClasses(resolved)
        setClassesLoading(false)
      } else if (result.classes) {
        setClasses(result.classes)
        setClassesLoading(false)
      } else {
        setClassesLoading(false)
      }

      // GBIF: progressive dataset resolution
      if (result._datasetKeys?.length > 0) {
        const resolved = await resolveGBIFDatasets(result._datasetKeys)
        if (id !== fetchId.current) return
        setDatasets(resolved)
        setDatasetsLoading(false)
      } else {
        setDatasetsLoading(false)
      }
    }).catch(() => {
      if (id !== fetchId.current) return
      setLoading(false)
      setSpeciesLoading(false)
      setClassesLoading(false)
      setDatasetsLoading(false)
    })
  }, [coords, radiusKm, timeWindow, activeTaxon, selectedSpecies, dataSource])

  // ─── Year click drill-down (GBIF only) ─────────────────────────
  const handleYearClick = (year) => {
    if (year === null || year === selectedYear) {
      setSelectedYear(null)
    } else {
      setSelectedYear(year)
    }
  }

  useEffect(() => {
    if (!coords || !selectedYear || !data || dataSource !== 'GBIF') return
    const id = ++fetchId.current

    setSpeciesLoading(true)
    setClassesLoading(true)
    setDatasetsLoading(true)

    fetchGBIFFacets({
      lat: coords.lat,
      lng: coords.lng,
      radiusKm,
      d1: `${selectedYear}-01-01`,
      d2: `${selectedYear}-12-31`,
      taxonKey: selectedSpecies?.gbifKey || selectedSpecies?.id,
      iconicTaxa: activeTaxon !== 'all' ? activeTaxon : undefined,
    }).then(async (facetData) => {
      if (id !== fetchId.current) return
      setData(prev => ({
        ...prev,
        totalCount: facetData.totalCount,
        totalSpecies: facetData.totalSpecies,
        months: facetData.months,
        iucnCategories: facetData.iucnCategories,
        basisOfRecord: facetData.basisOfRecord,
        datasets: facetData.datasets,
      }))

      if (facetData.speciesKeys.length > 0) {
        const resolved = await resolveGBIFSpecies(facetData.speciesKeys)
        if (id !== fetchId.current) return
        setSpecies(resolved)
        setSpeciesLoading(false)
        const withPhotos = await resolveGBIFSpeciesPhotos(resolved)
        if (id !== fetchId.current) return
        setSpecies(withPhotos)
      } else {
        setSpecies([])
        setSpeciesLoading(false)
      }

      if (facetData.classKeys.length > 0) {
        const resolved = await resolveGBIFClasses(facetData.classKeys)
        if (id !== fetchId.current) return
        setClasses(resolved)
        setClassesLoading(false)
      } else {
        setClasses([])
        setClassesLoading(false)
      }

      if (facetData.datasets?.length > 0) {
        const resolved = await resolveGBIFDatasets(facetData.datasets)
        if (id !== fetchId.current) return
        setDatasets(resolved)
        setDatasetsLoading(false)
      } else {
        setDatasets([])
        setDatasetsLoading(false)
      }
    }).catch(() => {
      if (id !== fetchId.current) return
      setSpeciesLoading(false)
      setClassesLoading(false)
      setDatasetsLoading(false)
    })
  }, [selectedYear]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Derived values ─────────────────────────────────────────────
  const uniqueSpecies = data?.totalSpecies || 0
  const hasYears = data?.years != null
  const sortedYears = hasYears ? [...data.years].map(y => Number(y.name)).sort((a, b) => a - b) : []
  const yearRange = sortedYears.length >= 2
    ? `${sortedYears[0]}–${sortedYears[sortedYears.length - 1]}`
    : sortedYears[0] || '—'
  const yearSpan = sortedYears.length

  const periodLabel = selectedYear ? String(selectedYear) : 'all time'

  // Counter labels per source
  const counterLabels = {
    obs: selectedYear
      ? `Observations in ${selectedYear}`
      : dataSource === 'eBird'
        ? 'Individuals Counted'
        : 'Total Observations Reported',
    species: selectedYear
      ? `Species in ${selectedYear}`
      : 'Species Detected',
  }

  if (dataSource === 'eBird' && !coords) {
    return (
      <div className={styles.wrap}>
        <div className={styles.emptyMsg}>
          eBird insights require a location. Use <strong>Locate Me</strong> or search for a place to see eBird data.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {/* Year filter banner — GBIF only */}
      {selectedYear && (
        <div className={styles.yearBanner}>
          <span>Showing data for <strong>{selectedYear}</strong></span>
          <button className={styles.yearBannerClear} onClick={() => handleYearClick(null)}>
            Show All Years
          </button>
        </div>
      )}

      {/* Summary counters */}
      <div className={styles.counters}>
        <div className={styles.counter}>
          <div className={styles.counterValue}>
            {loading ? '…' : (data?.totalCount || 0).toLocaleString()}
          </div>
          <div className={styles.counterLabel}>{counterLabels.obs}</div>
        </div>
        <div className={styles.counter}>
          <div className={styles.counterValue}>
            {loading ? '…' : uniqueSpecies.toLocaleString()}
          </div>
          <div className={styles.counterLabel}>{counterLabels.species}</div>
        </div>
        {hasYears && (
          <div className={styles.counter}>
            <div className={styles.counterValue}>
              {loading ? '…' : yearRange}
            </div>
            <div className={styles.counterLabel}>{yearSpan > 1 ? `${yearSpan} Years of Data` : 'Year'}</div>
          </div>
        )}
      </div>

      {/* Observation trend — GBIF: year chart */}
      {hasYears && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Observation Trend</h2>
          <p className={styles.cardSub}>Click a year to filter all insights below</p>
          <YearTrendChart
            years={data?.years}
            loading={loading}
            activeYear={selectedYear}
            onYearClick={handleYearClick}
          />
        </div>
      )}

      {/* Recent trend — eBird: hour-by-hour or day-by-day */}
      {(data?.recentTrend != null || (loading && dataSource === 'eBird')) && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Recent Activity</h2>
          <p className={styles.cardSub}>
            {(timeWindow === 'hour' || timeWindow === 'day')
              ? 'Observations by hour of day'
              : 'Observations by day'}
          </p>
          <RecentTrendChart
            data={data?.recentTrend}
            loading={loading}
            hourly={timeWindow === 'hour' || timeWindow === 'day'}
          />
        </div>
      )}

      {/* Masonry layout for viz cards */}
      <div className={styles.masonry}>
        {/* Top species — always shown */}
        <div className={`${styles.card} ${styles.cardWide}`}>
          <h2 className={styles.cardTitle}>Top Species</h2>
          <p className={styles.cardSub}>
            {selectedYear ? `Most observed in ${selectedYear}` : 'Most observed in this area'}
          </p>
          <TopSpecies species={species} loading={speciesLoading} onSpeciesClick={setFocusedSpecies} />
        </div>

        {/* Seasonality — GBIF + eBird */}
        {(data?.months != null || loading) && (
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Seasonality</h2>
            <p className={styles.cardSub}>
              {selectedYear ? `Monthly breakdown for ${selectedYear}` : `Occurrences by month — ${periodLabel}`}
            </p>
            <SeasonalityChart months={data?.months} loading={loading} />
          </div>
        )}

        {/* Taxonomy breakdown — all sources */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>
            {dataSource === 'eBird' ? 'Family Breakdown' : 'Taxonomy Breakdown'}
          </h2>
          <p className={styles.cardSub}>
            {selectedYear
              ? `Classes observed in ${selectedYear}`
              : dataSource === 'eBird'
                ? 'By bird family'
                : dataSource === 'iNaturalist'
                  ? 'By iconic taxon'
                  : 'By taxonomic class'}
          </p>
          <TaxonomyBreakdown classes={classes} loading={classesLoading} />
        </div>

        {/* Conservation status — GBIF only */}
        {(data?.iucnCategories != null || (loading && dataSource === 'GBIF')) && (
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Conservation Status</h2>
            <p className={styles.cardSub}>
              {selectedYear ? `IUCN categories in ${selectedYear}` : 'IUCN Red List categories'}
            </p>
            <ConservationStatus categories={data?.iucnCategories} loading={loading} />
          </div>
        )}

        {/* Data Sources — GBIF only */}
        {(datasets != null || data?._datasetKeys != null || (loading && dataSource === 'GBIF')) && (
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Data Sources</h2>
            <p className={styles.cardSub}>
              {selectedYear ? `Top contributing datasets in ${selectedYear}` : 'Top contributing datasets'}
            </p>
            <DataSources datasets={datasets} loading={datasetsLoading} />
          </div>
        )}

        {/* Record Types — GBIF only */}
        {(data?.basisOfRecord != null || (loading && dataSource === 'GBIF')) && (
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Record Types</h2>
            <p className={styles.cardSub}>
              {selectedYear ? `How observations were made in ${selectedYear}` : 'How observations were made'}
            </p>
            <RecordTypes basisOfRecord={data?.basisOfRecord} loading={loading} />
          </div>
        )}
      </div>

      <SpeciesDetailModal
        species={focusedSpecies}
        dataSource={dataSource}
        coords={coords}
        radiusKm={radiusKm}
        onClose={() => setFocusedSpecies(null)}
      />
    </div>
  )
}
