#!/usr/bin/env node
/**
 * Spawning-season conditions in WDFW Hydraulic Project Approvals (HPAs), for /permits records at forage fish spawning
 * beaches or herring spawning areas (Josh 2026-10-15, for Friends' CWA watchdog work: does the permit carry the
 * condition the species there needs?). Reads the permit's own text and states what it says; it never judges the
 * condition sufficient.
 *
 *   node scripts/permits/hpa-conditions.mjs <input.json>
 *
 * input.json: [{ permit, record (HPA record page), file (the permit PDF's WDFW share link), pdf (local copy),
 *               issued, evidence: [file names] }]. Writes data/permits/hpa-conditions.json (merged by permit number).
 * Fetching the permit PDFs from WDFW's site (a Salesforce page rendered by script) is not automated yet.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const OUT = 'data/permits/hpa-conditions.json'

// The numbered provisions of an HPA ("1. TIMING LIMITATION: …"), each as one line of plain text.
function provisions(text) {
  const body = text.split(/\n\s*PROVISIONS\s*\n/)[1] || text
  // A provision starts a line with its number; the section ends at the first all-caps heading after them.
  const end = body.search(/\n\s*(APPLY TO ALL HYDRAULIC PROJECT APPROVALS|EMERGENCY|LOCATION #|MINOR MODIFICATIONS)/)
  return (end > 0 ? body.slice(0, end) : body).split(/\n\s*(?=\d{1,2}\.\s+\S)/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => /^\d{1,2}\.\s/.test(p))
}
const SPECIES = { smelt: /surf smelt/i, sandlance: /sand lance/i, herring: /herring/i }
const firstSentence = (p, re) => (p.split(/(?<=\.)\s+(?=[A-Z])/).find((s) => re.test(s)) || '').trim()

export function parseHpa(text) {
  const ps = provisions(text)
  const timing = ps.filter((p) => /^\d+\.\s+TIMING LIMITATION/.test(p)).map((p) => p.replace(/^\d+\.\s+TIMING LIMITATION:\s*/, ''))
  const species = {}
  for (const [k, re] of Object.entries(SPECIES)) {
    const p = ps.find((x) => re.test(x))
    species[k] = p ? { provision: Number(p.match(/^(\d+)/)[1]), quote: firstSentence(p, re) } : null
  }
  const survey = ps.find((p) => /forage fish spawning (beach )?survey|spawning protocol|eggs during a beach survey/i.test(p))
  return { timing, species, eggSurvey: survey ? { provision: Number(survey.match(/^(\d+)/)[1]), quote: firstSentence(survey, /survey/i) } : null, provisions: ps.length }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
  for (const x of input) {
    const text = execFileSync('pdftotext', ['-layout', x.pdf, '-'], { encoding: 'utf8' })
    out[x.permit] = { permit: x.permit, record: x.record, file: x.file, issued: x.issued, read: new Date().toISOString().slice(0, 10),
      ...parseHpa(text), evidence: (x.evidence || []).filter((f) => /forage fish|\bFFS\b|egg ?survey/i.test(f)) }
    console.log(x.permit, JSON.stringify(out[x.permit], null, 1).slice(0, 900))
  }
  writeFileSync(OUT, JSON.stringify(out, null, 1))
}
