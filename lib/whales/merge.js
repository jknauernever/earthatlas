/**
 * Records → one sighting per canonical key (pure; no I/O).
 *
 * The feed that owns a key's namespace is its base (maplify:<id> → maplify,
 * inat:<id> → inaturalist, …). SalishSea.io's copy of a Maplify record adds its
 * curated species, channel, organization and observer on top. A key whose
 * records were all removed upstream yields { key, removed: true }.
 */
import { locationQuality } from './land.js'

const OWNER = { maplify: 'maplify', inat: 'inaturalist', hw: 'happywhale', obis: 'obis', salishsea: 'salishsea', orcasound: 'salishsea' }
const ORIGIN = { maplify: 'maplify', inat: 'inaturalist', hw: 'happywhale', obis: 'obis', salishsea: 'salishsea', orcasound: 'orcasound' }
const ENRICH_FROM_SALISHSEA = ['channel', 'organization', 'organization_url', 'observer']

export function prefixOf(key) {
  return key.slice(0, key.indexOf(':'))
}

/**
 * @param key   canonical key
 * @param recs  [{ feed, norm, removed_at }]
 * @param groupOfTaxon  inat_id → animal_group
 */
export function mergeSighting(key, recs, groupOfTaxon = () => null) {
  const prefix = prefixOf(key)
  const live = recs.filter((r) => !r.removed_at)
  const owner = OWNER[prefix]
  const base = live.find((r) => r.feed === owner) || (prefix === 'maplify' ? live.find((r) => r.feed === 'salishsea') : null)
  if (!base) return { key, removed: true }

  const n = { ...base.norm }
  if (prefix === 'maplify') {
    const ss = live.find((r) => r.feed === 'salishsea')
    if (ss) {
      if (ss.norm.inat_id) n.inat_id = ss.norm.inat_id
      for (const f of ENRICH_FROM_SALISHSEA) if (ss.norm[f]) n[f] = ss.norm[f]
    }
  }

  const quality = n.test ? 'test' : locationQuality(n.lon, n.lat)
  return {
    key,
    origin: ORIGIN[prefix],
    via: [...new Set(live.map((r) => r.feed))].sort(),
    kind: n.kind || 'sighting',
    inat_id: n.inat_id ?? null,
    raw_name: n.raw_name,
    animal_group: (n.inat_id && groupOfTaxon(n.inat_id)) || 'unknown',
    observed_at: n.observed_at,
    observed_date: n.observed_date,
    time_precision: n.time_precision,
    lat: n.lat,
    lon: n.lon,
    accuracy_m: n.accuracy_m,
    location_obscured: !!n.obscured,
    count_min: n.count_min,
    count_max: n.count_max,
    channel: n.channel,
    organization: n.organization,
    organization_url: n.organization_url,
    observer: n.observer,
    attribution: n.attribution,
    url: n.url,
    license: n.license,
    photo_url: n.photo_url,
    photo_thumb_url: n.photo_thumb_url,
    photo_license: n.photo_license,
    photo_attribution: n.photo_attribution,
    individual_id: n.individual_id,
    individual_label: n.individual_label,
    remarks: n.remarks,
    trusted: n.trusted,
    occurrence_id: n.occurrence_id ?? null,
    quality,
  }
}
