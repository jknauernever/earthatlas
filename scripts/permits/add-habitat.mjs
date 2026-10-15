#!/usr/bin/env node
/**
 * The joins that follow the bake, on the existing public/permits-data/permits.json, without re-reading any agency
 * source (bake-permits.mjs exports each): county SEPA reviews (sepa-fetch.mjs), WDFW applications (hpa-search.mjs),
 * waters and habitat, WDFW permit conditions (hpa-fetch.mjs) and "needs review". The weekly bake runs it after those
 * fetches; run it by hand after any of them, or after import-friends-habitat.mjs.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { attachFactors, attachConditions, attachReview, attachSepa, attachHpaApps } from './bake-permits.mjs'

const FILE = 'public/permits-data/permits.json'
const d = JSON.parse(readFileSync(FILE, 'utf8'))
attachSepa(d)
attachHpaApps(d)
const read = (f) => JSON.parse(readFileSync(`public/permits-data/${f}`, 'utf8'))
attachFactors([...d.projects, ...d.npdes], read('wq303d.geojson'), read('shellfish.geojson'))
attachConditions(d.projects)
attachReview([...d.projects, ...d.npdes])
writeFileSync(FILE, JSON.stringify(d))
const all = [...d.projects, ...d.npdes]
console.log(`waters or habitat within 300 m: ${all.filter((r) => r.near).length} of ${all.length} records; WDFW conditions read: ${all.filter((r) => r.conditions).length}; needs review: ${['now', 'watch', 'record'].map((t) => `${t} ${all.filter((r) => r.review?.tier === t).length}`).join(', ')}`)
