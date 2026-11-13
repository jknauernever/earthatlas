# In Motion lab: build brief for Claude Code

Status: ready for review, 12 Nov 2026. Nothing is built yet.

## Goal

Build an experimental redesign of `/inmotion` at a new URL, `/inmotion-lab`, leaving the current `/inmotion` untouched. The redesign follows National Geographic's "Mapping Our Changing Ocean" explorer: simple, plain-language, with the data sourcing and complexity out of the way so a visitor can just see and explore.

It is one subsite with three modes that share one globe, one set of layers and one camera. Moving between modes never loses the visitor's place.

## Design reference

This folder holds sketches, not finished designs. Build to their structure, wording, grouping and navigation. Do not copy them pixel for pixel.

- `screens/a-field-guide.png`, `screens/b-chapters.png`, `screens/c-here-now.png`: desktop captures of the three modes.
- `sketches/Main.dc.html` (A), `Chapters.dc.html` (B), `HereNow.dc.html` (C), and `MainPhone`, `ChaptersPhone`, `HereNowPhone`: the source of each sketch. They use a design-tool template format (`{{holes}}`, `<sc-for>`, a `Component` class) and will not run in a browser on their own. Read them for layout, inline styles, copy, layer lists, legend text and the phone arrangements.

What is placeholder in the sketches and must come from the real site: the globe (drawn as a few ellipses), every value in square brackets (`[max] mph`, `[dataset]`, `[time]`), and the layer list, which must match the layers `/inmotion` actually has.

Look: near-black blue ground (`#0A0E16`), Source Serif 4 for headlines, Inter for everything else, amber accent (`#F2B544`), quiet bordered panels. Details are in the sketch files.

## The three modes

A. Field Guide (the hub). A left panel with a headline, one short paragraph, a Globe / One Ocean / Flat map switch, and layers as simple toggles grouped under plain headings: How Earth moves, What is in the air, What we are changing, Life on the move. The globe fills the rest. One legend card at the bottom right shows the active layer's title, measure, color bar, low and high values and a one-line source, with an info button that reveals a two-sentence plain-language description. Top right: "Explain this view" and a "Fly to a place" search.

B. Chapters (guided story). A row of numbered chapter pills, the globe, and one card with chapter number, headline, a short paragraph, chips naming the layers now on the globe, Back, Next, "Explore this view yourself", and a one-line data credit. The camera moves for the visitor in each chapter. Five starter chapters are written in `Chapters.dc.html`.

C. Here, Now (place-first). A place search, "Use my location", a row of jump-to places, a small globe centered on the place with a 30-day time slider, and a grid of cards answering "What is moving around [place]" within 50 km: wind, fine particles, sea temperature, ocean acidity, fires and quakes, bird migration. Each card shows a value and one line of context.

## How the modes link

All three read and write one shared state: active layers, camera, mode, and place. Every state has its own URL so any view can be shared and reopened.

- A to B: a "Stories" entry in the Field Guide header opens Chapters. If the active layer features in a chapter, open at that chapter.
- B to A: "Explore this view yourself" and "Skip to free explore" return to the Field Guide with that chapter's layers on and the same camera.
- A to C: clicking anywhere on the globe, choosing a search result, or "Use my location" opens Here, Now for that spot.
- C to A: tapping a card in Here, Now turns that layer on in the Field Guide, centered on the place.
- B to C: a chapter can end with "See this where you live", which opens Here, Now with that chapter's layer first.

"Explain this view" is not a link to Chapters. It is the existing `/inmotion` feature that opens AI-written text interpreting what is on the current map. Keep it, working as it does today, and make it available in the Field Guide. Whether it also appears in the other two modes is a question for the plan.

## Requirements carried over from review

- Globe handling: Josh finds rotating and zooming the globe on the NatGeo site too coarse and difficult. Rotation, zoom and tilt must be smooth and fine-grained with mouse, trackpad and touch, with sensible zoom limits and inertia. Reuse and tune the existing `/inmotion` globe; do not add a second globe or map library.
- Phones: each mode has a phone sketch. A becomes a full-screen globe with a bottom sheet for layers and the legend. B becomes a globe with a swipeable chapter card. C becomes a List / Globe switch. Nothing may require hover.
- Plain language throughout. Sources stay one line on the legend, with detail behind "How we get this data".
- US units (mph, °F, miles).

## Build order, with a checkpoint after each step

1. Repo survey and a short written plan: how `/inmotion` is built (globe component, layer registry, data fetching, the "Explain this view" feature), which sketch layers exist today and which do not, how routing would add `/inmotion-lab`, and a proposed shared state and URL scheme. Stop for approval.
2. `/inmotion-lab` shell with the shared state and URL scheme, and the Field Guide mode on the real globe and real layers, including the legend card and "Explain this view".
3. Globe handling pass (smooth rotate, zoom, touch), checked on a trackpad and a phone.
4. Here, Now mode and the A to C and C to A links.
5. Chapters mode with the five starter chapters and the A to B, B to A and B to C links.
6. Phone layouts for all three modes.
7. Review on a laptop, a very wide monitor and a phone before linking from anywhere on the site.

Out of scope for now: replacing `/inmotion`, new data sources beyond what `/inmotion` already has (list any sketch layer that has no data as a gap in the plan), and the Friends stories work, which has its own brief in `docs/design/stories-split/`.
