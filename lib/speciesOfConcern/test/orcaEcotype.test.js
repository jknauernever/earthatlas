import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orcaEcotype } from '../orcaEcotype.js'

// Real remarks from the whales database (Orca Network via Maplify, SalishSea.io, Happywhale labels, iNaturalist notes).
const cases = [
  ['[Orca Network] Biggs T19s northbound (DM)  Submitted by a Cascadia Trusted Observer Via Webmap', 'biggs', false],
  ['[SSCH Discord] Via Ferry: 8 including T19s (Bethany)', 'biggs', false],
  ['T065A5 · Indy (Bigg\'s KW)', 'biggs', false],
  ['T038C Borrowman born 2008  With T137A Jack in picture two.', 'biggs', false],
  ['[Orca Network] Biggs T36A1s and T49As southbound (edited from SRKWs) (Alisa Lemire Brooks)', 'biggs', false],
  ['[Orca Network] J pod all have passed by Bush Point now, spread in groups, east of mid channel.', 'southern-resident', false],
  ['[Orcasound] J pod, calls heard on Sunset Bay hydrophone after no calls 0600-0800 (Ariel Yseth)', 'southern-resident', false],
  ['[Orca Network] group of Js foraging here, includes a male.', 'southern-resident', false],
  ['[Orca Network] Orcas, likely members of J pod, quickly northbound (Jennifer Greiner Clark)', 'southern-resident', true],
  ['J35 Tahlequah with calf', 'southern-resident', false],
  ['[Orca Network] Biggs T46s and presumed T124Ds southbound (Orca Conservancy)', 'biggs', false],
  ['[Orca Network] 4 orcas EB (SS)  Submitted by a Cascadia Trusted Observer Via App', null, false],
  ['[Orca Network] Orca viewed from WSF, numbers & direction unknown (Rebecca JS)', null, false],
  ['A pod of a male, a female and a juvenile', null, false],
  ['Washington, United States', null, false],
]

test('reads the ecotype the observer names', () => {
  for (const [text, ecotype, tentative] of cases) {
    const r = orcaEcotype(text)
    assert.equal(r.ecotype, ecotype, text)
    if (ecotype) assert.equal(r.tentative, tentative, `tentative: ${text}`)
  }
})

test('a remark naming both ecotypes is mixed, not a confirmation', () => {
  assert.equal(orcaEcotype('J pod passed, then Biggs T19s an hour later').ecotype, 'mixed')
})
