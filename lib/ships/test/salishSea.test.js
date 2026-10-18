// Salish Sea area for the scrubber report: berths read from lib/ships/data/salish-terminals.json (2026-10-16).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inSalishSea } from '../salishSea.js'

test('Salish Sea terminals are in, Columbia River / Washington coast are out', () => {
  assert.equal(inSalishSea({ lat: 48.86, lon: -122.76 }), true)         // Cherry Point
  assert.equal(inSalishSea({ lat: 49.70, lon: -124.58 }), true)         // Texada Quarrying
  assert.equal(inSalishSea({ lat: '47.06', lon: '-122.90' }), true)     // Olympia, numeric as string
  assert.equal(inSalishSea({ lat: 46.026499, lon: -122.868692 }), false) // Kalama Export
  assert.equal(inSalishSea({ lat: 46.964722, lon: -123.85 }), false)    // Port of Grays Harbor T2
  assert.equal(inSalishSea({ lat: 49.23, lon: -124.81 }), false)        // Port Alberni (outer coast)
  assert.equal(inSalishSea({ lat: null, lon: null }), false)
})
