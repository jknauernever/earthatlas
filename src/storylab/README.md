# Story Lab (/storylab) — PARKED

Parked 2026-11-12 by Josh: the build works, but the stories themselves need a
lot more work before this goes anywhere. This branch (`storylab`) is NOT to be
merged or pushed to main until Josh decides to resume.

Brief, screens and sketches: `docs/design/inmotion-lab/`.

## What is built
- One subsite, three modes on one shared globe / layer set / camera:
  Field Guide (`/storylab`), Chapters (`/storylab/chapters/N`), Here, Now (`/storylab/here`).
- `StoryGlobe.jsx` is a forwardRef fork of `src/systems/SystemsApp.jsx` as of
  b481f0b (~3,170 lines); it imports the /inmotion modules untouched.
- `state.js` URL scheme (layer keys = /inmotion's; lab keys lat, lng, z, br, pi,
  vw, lg, plat, plng, pn, tm, first). Mode changes push history.
- `layers.js` 21 toggles in four groups, plain-language copy, legends.
- `chapters.js` the five sketch chapters on real layers.
- `here.js` six real readings within 30 mi, 30-day slider.
- Layers with history auto-play from the 7-day window (Field Guide + Chapters);
  /inmotion still opens parked at Now.
- Only change outside this folder: the `/storylab/*` route in `src/main.jsx`.

## Known gaps
- No flat map: /inmotion renderers assume the globe (`globeGeom.js`).
- Wind has no history; fire count is live only (Here, Now slider).
- Chapter 4 baseline wording vs. Coral Reef Watch's own description: confirm.
- Chapter 2 camera follows where fires were on 2026-11-12 (seasonal).
- Phone Here, Now globe view lacks the sketch's selected-layer card.
- Trackpad / real-phone feel not physically tested.
- The fork will drift from SystemsApp; rebase it onto current /inmotion first.

## Resume
`git worktree add ../earthatlas-storylab storylab`, symlink node_modules, copy
.env.local, `npm run dev -- --port 5173`.
