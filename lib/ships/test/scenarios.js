/**
 * GFW-shaped entries for tests. See fixtures/README.md for which values are
 * real (GABU REEFER, from GFW's docs) and which are synthetic (`TEST …`).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
export const fixture = (name) => JSON.parse(readFileSync(path.join(FIX, name), 'utf8'))

/** A checksum-valid IMO from a 6-digit stem (synthetic scenarios only). */
export function imo(stem) {
  let s = 0
  for (let i = 0; i < 6; i++) s += Number(stem[i]) * (7 - i)
  return `${stem}${s % 10}`
}

const ais = (id, ssvid, shipname, callsign, flag, from, to, extra = {}) => ({
  id, ssvid, shipname, nShipname: shipname.replace(/\W/g, ''), callsign, flag, imo: null,
  sourceCode: ['AIS'], matchFields: 'SEVERAL_FIELDS', transmissionDateFrom: from, transmissionDateTo: to, ...extra,
})
const reg = (ref, codes, fields) => ({ id: `reg-${ref}`, vesselInfoReference: ref, sourceCode: codes, latestVesselInfo: true, ...fields })

/** GABU REEFER, IMO 8300949: three AIS identities (documented), as one GFW entry. */
export function gabuReefer({ split = false } = {}) {
  const ids = [
    ais('58cf536b1-1fca-dac3-ad31-7411a3708dcd', '616852000', 'GABU REEFER', 'D6FJ2', 'COM', '2012-01-02T00:00:00Z', '2019-02-23T00:00:00Z'),
    ais('0b7047cb5-58c8-6e63-4bfd-96a6af515c91', '214182732', 'GABU REEFER', 'ER2732', 'MDA', '2019-02-22T00:00:00Z', '2022-09-19T00:00:00Z'),
    ais('1da8dbc23-3c48-d5ce-95f1-1ffb6cc00161', '613590000', 'GABU REEFER', 'TJMC996', 'CMR', '2022-01-24T00:00:00Z', '2023-10-19T00:00:00Z'),
  ]
  const registry = (a) => reg(`gabu-${a.ssvid}`, ['IMO'], {
    ssvid: a.ssvid, flag: a.flag, shipname: 'GABU REEFER', callsign: a.callsign, imo: '8300949',
    transmissionDateFrom: a.transmissionDateFrom, transmissionDateTo: a.transmissionDateTo })
  const entry = (list) => ({ dataset: 'public-global-vessel-identity:v3.0', registryInfo: list.map(registry),
    registryOwners: [], registryAuthorizations: [], selfReportedInfo: list })
  return split ? ids.map((a) => entry([a])) : entry(ids)
}

/** Synthetic: one vessel, renamed and reflagged, with an owner change and a second registry that disagrees on flag. */
export function renamedVessel() {
  const I = imo('900001')
  return {
    dataset: 'test',
    selfReportedInfo: [
      ais('test-a1', '366000001', 'TEST OCEAN WIND', 'TST1', 'USA', '2015-01-01T00:00:00Z', '2021-12-31T23:00:00Z'),
      ais('test-a2', '538000001', 'TEST PACIFIC STAR', 'TST2', 'MHL', '2022-01-01T00:00:00Z', '2025-06-30T00:00:00Z'),
    ],
    registryInfo: [
      reg('test-r1', ['USA'], { ssvid: '366000001', flag: 'USA', shipname: 'TEST OCEAN WIND', callsign: 'TST1', imo: I,
        lengthM: 120.5, tonnageGt: 9000, transmissionDateFrom: '2015-01-01T00:00:00Z', transmissionDateTo: '2021-12-31T23:00:00Z' }),
      reg('test-r2', ['IMO'], { ssvid: '538000001', flag: 'MHL', shipname: 'TEST PACIFIC STAR', callsign: 'TST2', imo: I,
        lengthM: 120.5, tonnageGt: 9000, transmissionDateFrom: '2022-01-01T00:00:00Z', transmissionDateTo: '2025-06-30T00:00:00Z' }),
      // A second registry that disagrees on the flag for the same period.
      reg('test-r3', ['TMT'], { ssvid: '538000001', flag: 'PAN', shipname: 'TEST PACIFIC STAR', imo: I,
        transmissionDateFrom: '2022-01-01T00:00:00Z', transmissionDateTo: '2025-06-30T00:00:00Z' }),
    ],
    registryOwners: [
      { name: 'TEST SHIPPING LLC', flag: 'USA', ssvid: '366000001', sourceCode: ['USA'], dateFrom: '2015-01-01T00:00:00Z', dateTo: '2022-01-01T00:00:00Z' },
      { name: 'Test Maritime S.A.', flag: 'MHL', ssvid: '538000001', sourceCode: ['IMO'], dateFrom: '2022-01-01T00:00:00Z', dateTo: null },
    ],
    registryAuthorizations: [],
  }
}

/** Synthetic: two different ships (different IMOs) that both transmitted MMSI 999000111 in overlapping windows. */
export function sharedMmsiPair() {
  const mk = (n, stem, from, to) => ({
    dataset: 'test',
    selfReportedInfo: [ais(`test-shared-${n}`, '999000111', `TEST TWIN ${n}`, `TW${n}`, 'XXX', from, to)],
    registryInfo: [reg(`test-shared-r${n}`, ['USA'], { ssvid: '999000111', shipname: `TEST TWIN ${n}`, imo: imo(stem),
      transmissionDateFrom: from, transmissionDateTo: to })],
    registryOwners: [], registryAuthorizations: [],
  })
  return [mk(1, '900002', '2020-01-01T00:00:00Z', '2021-06-30T00:00:00Z'), mk(2, '900003', '2021-01-01T00:00:00Z', '2022-12-31T00:00:00Z')]
}

/** Synthetic: an entry whose registries give two different checksum-valid IMOs. */
export function conflictingImos() {
  return {
    dataset: 'test',
    selfReportedInfo: [ais('test-conflict-a', '366000009', 'TEST CONFLICT', 'TCF', 'USA', '2019-01-01T00:00:00Z', '2020-01-01T00:00:00Z')],
    registryInfo: [
      reg('test-conflict-r1', ['USA'], { ssvid: '366000009', shipname: 'TEST CONFLICT', imo: imo('900004'),
        transmissionDateFrom: '2019-01-01T00:00:00Z', transmissionDateTo: '2020-01-01T00:00:00Z' }),
      reg('test-conflict-r2', ['IMO'], { ssvid: '366000009', shipname: 'TEST CONFLICT', imo: imo('900005'),
        transmissionDateFrom: '2019-01-01T00:00:00Z', transmissionDateTo: '2020-01-01T00:00:00Z' }),
    ],
    registryOwners: [], registryAuthorizations: [],
  }
}
