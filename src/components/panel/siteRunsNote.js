// "How this site runs" — last note in "How this is sourced" on every EarthAtlas site (Josh, 2026-10-16).
// Scoped to how the site RUNS: keep "runs" / "when you use this page".
export const SITE_RUNS_NOTE = {
  heading: 'How this site runs',
  body: 'No AI runs on this site. When you use this page, everything you see is read from published public data and calculated by fixed, documented methods, with each source credited where it appears.',
}

// Short form beside the built-by credit on pages with no sources popup.
export const SITE_RUNS_SHORT = 'No AI runs on this site.'

// Sites with AI-written summaries (/inmotion, /forestmonitor) — those can't say "No AI runs on this site",
// so they carry this data note plus an experiment note naming what the AI writes.
export const SITE_DATA_NOTE = {
  heading: 'How this site runs',
  body: 'Every number here comes from published public data, credited where it appears, and is calculated by fixed, documented methods. We don’t use AI to produce or change any of the data.',
}

export function aiExperimentNote(what) {
  return {
    heading: 'Experimenting with AI summaries',
    body: `We’re experimenting with AI-generated summaries that help make sense of what the maps are showing. ${what} written by an AI model (Anthropic’s Claude) from the numbers already on screen: it puts the data into words and doesn’t add numbers of its own. We’re constantly evaluating these summaries for accuracy and deciding whether they’re effective, and we’ll keep, improve or retire them based on what we find.`,
  }
}
