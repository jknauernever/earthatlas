/**
 * Who a whale sighting came from — the one list every site uses for labels,
 * links and credits (sightings' `origin`, plus the channels Maplify carries).
 */
export const WHALE_SOURCES = {
  maplify: { label: 'Whale Alert', url: 'https://conserve.io', publisher: 'Conserve.io', license: 'CC-BY-4.0', note: 'via the Acartia data cooperative' },
  inaturalist: { label: 'iNaturalist', url: 'https://www.inaturalist.org', license: 'per observation' },
  happywhale: { label: 'HappyWhale', url: 'https://happywhale.com' },
  obis: { label: 'OBIS', url: 'https://obis.org', license: 'per dataset' },
  salishsea: { label: 'SalishSea.io', url: 'https://salishsea.io', license: 'CC-BY-NC-4.0' },
  orcasound: { label: 'Orcasound', url: 'https://live.orcasound.net', note: 'hydrophone detections, via SalishSea.io' },
}

export const ORIGINS = Object.keys(WHALE_SOURCES)
