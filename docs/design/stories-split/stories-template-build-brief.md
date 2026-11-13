# Stories template: build brief for Claude Code

Status: ready for review, 12 Nov 2026. Nothing is built yet.

Design reference: the `stories-split` design package (this brief ships inside it). `index.html` is the approved Split layout as a self-contained page, `screens/` holds a capture of each chapter at 1315 x 880, and `DESIGN.md` lists every measurement, color and timing. `phone.html`, `screens-phone/` and `DESIGN-PHONE.md` are the same for phones (approved 12 Nov 2026). Commit the package to the repo (suggested `docs/design/stories-split/`) and build against it. Everything outside the map must match the package exactly; the map is rebuilt on the live map component to the same look.

## Goal

Add data stories to EarthAtlas as a reusable template. The first story is "The beaches that feed orcas" for the shoreline subsite, in the Split layout (photo on the left half, live map on the right half). Any later story must be buildable by supplying new photos, text, data and map settings, with no new layout code.

## Where stories live

Stories sit under each subsite, not in a subsite of their own.

- `/{subsite}/stories` lists that subsite's stories.
- `/{subsite}/stories/{slug}` is one story. First one: `/shoreline/stories/beaches-that-feed-orcas`.
- Each chapter is linkable (`#eggs`, `#armoring`) so a chapter can be shared directly.

Decided by Josh (12 Nov 2026): the story appears on both hosts from day one, earthatlas.org and explore.sanjuans.org. The same routes and the same story file serve both. A story belongs to the organization that created it. A Friends story shows Friends' wordmark, wording and calls to action on both hosts, including earthatlas.org. Only "Open the full map" follows the host, so the visitor stays on the site they are on.

## Template architecture

Start by reading the repo to learn the routing, the map component, the layer registry for `/shoreline`, the brand system, and how `/shoreline/reports` gets its counts. Follow those conventions. Do not introduce a second map stack.

A story is one content file plus its images. The page is a generic renderer.

Story file (JSON, validated against a schema checked into the repo):

- `slug`, `subsite`, `title`, `layout` (`"split"` now; `"atlas"` and `"cinema"` reserved), `author` (the brand id of the organization that owns the story, required; `friends` for story 1), `sources[]`.
- `chapters[]`, each with:
  - `id`, `railLabel`, `kicker`, `headline`, `body` (one or two short sentences).
  - `photo`: `src`, `alt`, `caption`, `credit`, `focalPoint` (x, y in percent, used for cropping).
  - `stat` (optional): `label`, plus either a literal `value` and `unit`, or a `dataKey` that resolves to a published count.
  - `map`: a camera (`bounds`, or `center` and `zoom`), and `layers[]`, each naming a layer id from the subsite's registry with an `emphasis` (`off`, `dim`, `on`, `glow`) and optional filter.
  - `actions[]` (optional): label and link, for the closing chapter.

Rules that make this a template:

1. No story-specific code. Everything a story needs is in its file.
2. Numbers bind to data. A `dataKey` reads from the same counts that feed `/{subsite}/reports`, so a story can never disagree with the report. Literal values are allowed only for facts that are not in the data (for example a legal distance), and each needs a source in `sources[]`.
3. Layers are referenced by id, never redefined. A story can only switch on layers its subsite already has.
4. The schema is the contract for the authoring interface that comes later. Keep it flat, explicit and validated at build time, with clear error messages for a missing photo, an unknown layer id or an unknown `dataKey`.
5. Layouts are interchangeable. A story file must render in any supported layout without edits.
6. Branding follows the author, not the host. The renderer takes the wordmark and brand tokens from the story's `author` through the existing brand system and renders the story identically on every host. Nothing in the renderer is tied to one host or one organization.

No authoring interface in this phase. Stories are added by committing a file.

## The Split layout

Exact values are in `DESIGN.md` and `index.html`. In outline, on desktop, one screen, no scrolling:

- Left half: one still photo, cropped to cover, positioned by `focalPoint`. Kicker, headline and body sit at the top of the photo over a dark gradient. A tiny, dim photo credit sits at the bottom left.
- Right half: the live map on a dark satellite basemap, with the chapter's layers. Bold island labels. A true scale bar in miles and the satellite credit sit inside the map pane, bottom left.
- A thin gold line divides the halves. The chapter's stat sits in a dark circle centered on that line.
- Top left: the story author's wordmark. Top right: one link, "Open the full map", which opens the subsite explorer on the current host with the current chapter's layers on and the same camera.
- Bottom: chapter rail (seven labelled segments in story 1), Play story, back, Next. A small map key sits above the rail on the map side.

Behavior:

- Changing chapter fades the photo once and flies the map camera. Photos never cycle on their own.
- Play story advances a chapter every 6.5 seconds and stops at the end.
- Everything scales with the viewport (text, photo, stat, map) and fits without scrolling from common laptop sizes up to large monitors.
- Honor reduced-motion: no camera flight, no pulsing, instant chapter changes.
- Keyboard: left and right arrows change chapter. All controls are real buttons and links with labels.
- Miles and feet only. No unit switch.

Map styling in story mode: shoreline as a thin bright line; spawning beaches gold with a soft glow; juvenile Chinook shoreline teal; armoring red with a glow (colors in `DESIGN.md`). Use the site's existing layer data and Friends' own priority levels. The mockup's teal lines used an invented cutoff and its red lines dropped 24 pieces marked removed; the build must use the "highest priority" level and the full armor layer so the map matches the numbers.

Phone layout: the approved design is in the package (`phone.html`, `screens-phone/`, `DESIGN-PHONE.md`). It is the Split layout turned on its side: photo on top, map below, the stat circle on the seam, swipe to change chapter, map locked to the chapter's view. Everything outside the map must match it exactly, as on desktop. Fix the rough edges listed at the end of `DESIGN-PHONE.md` in the build.

## Story 1 content

Terminology: "Southern Resident orcas" for general audiences, with "orca" lowercase. Wording follows Friends' stewardship guide and 2021 to 2025 impact report; mapped numbers come from the explore site.

| # | Rail label | Kicker | Headline | Body | Stat | Stat source |
|---|---|---|---|---|---|---|
| 1 | Shoreline | San Juan Islands · Salish Sea | The beaches that feed orcas | Choices made on the shoreline affect the entire marine food web, from forage fish to orca. | 407 mi of shoreline mapped | reports: shoreline miles |
| 2 | Eggs | Living with the Shoreline | Forage fish feed the marine food web | Surf smelt and Pacific sand lance lay their eggs in sand and small gravel, on the upper third of the beach. | 218 beaches with eggs found | reports: documented beaches |
| 3 | Young salmon | Living with the Shoreline | Shorelines are a nursery for salmon | Young salmon feed, grow and shelter along these shores on their way to the open ocean. | 78 mi highest-priority shoreline for juvenile Chinook | reports: Chinook, highest |
| 4 | Orcas | Keystone species spotlight | Critically endangered orca | Southern Resident orcas rely almost entirely on Chinook salmon. Their survival depends on abundant fish from healthy habitats. | 1,000 yd boats must stay this far from Southern Resident orcas | literal; impact report |
| 5 | Armoring | Hard armoring | Feeder bluffs are beach builders | 29.5 miles of feeder bluffs supply the sand and gravel that build beaches. Hard armoring starves nearby beaches. | 27.2 mi of armored shoreline, in 1,006 mapped pieces | reports: armor miles, pieces, feeder bluff miles |
| 6 | Fisherman Bay | Fisherman Bay, Lopez Island | Rebuilding resilient shores | Friends is restoring marsh and beach habitat here, where sand lance eggs were found in 2018 and 2019. | armoring pieces around the bay | computed from the armor layer within the chapter's bounds |
| 7 | Act | Our strength comes from you | Protect this Place with us | 6,000 feet of shoreline restored for forage fish and eelgrass. Small actions on your own shore can make a big difference. | none | impact report |

Map per chapter: 1 shoreline only; 2 spawning beaches; 3 Chinook priority with spawning dimmed; 4 spawning and Chinook; 5 armoring with spawning, and a dashed frame around Fisherman Bay; 6 zoom to Fisherman Bay with armoring, spawning and Chinook; 7 everything, armoring dimmed. Exact layer opacities per chapter are in `DESIGN.md`.

Closing actions: Become a member (sanjuans.org/member), Volunteer, Sign up for action alerts.

Photos (all from sanjuans.org/wp-content/uploads; use the original files, not the reduced captures in the design package):

1. `2016/09/SM_sji_orca_010.jpg`, orcas in the Salish Sea, credit Friends of the San Juans.
2. `2016/09/SM_Forage-Fish-Sampling.jpg`, sampling a beach for forage fish eggs, credit Friends.
3. `2016/09/SM_4-juvenile-chinookbyPeter-K.jpg`, juvenile Chinook, credit "Peter K." (full name needed).
4. `2022/03/OrcafromLImeKilnAndrewReding.jpg`, J26 "Mike" off Lime Kiln Point, credit Andrew Reding.
5. `2022/11/armor-article-image-scaled.jpg`, armored shoreline, credit Friends.
6. `2021/02/Fisherman-Bay-21.jpg`, Fisherman Bay restoration, credit Friends (low resolution; ask for the original).
7. `2021/09/ForageFishVolunteerPic_smaller-scaled1.jpg`, forage fish survey volunteers, credit Friends.

## Open items for Friends before launch

- Rights and credits for each photo. None is confirmed. Photo 1 is not confirmed as Southern Residents, so its caption does not say so.
- The story title and the Fisherman Bay sentence are not Friends' wording.
- The Fisherman Bay count has no published figure. The mockup showed 104 inside a hand-drawn frame; the build should compute it from the chapter bounds and Friends should confirm the framing.
- Satellite basemap credit line must be shown, as on the explorer.

## Build order, with a checkpoint after each step

1. Repo survey and a short written plan: routes, map component, layer ids, report counts, brand tokens, and how the two hosts share routes. Stop for approval.
2. Story schema, validator and the story 1 file with the content above.
3. Split layout rendering story 1 on desktop, with live map and chapter camera. Checkpoint: side-by-side captures of all seven chapters at 1315 x 880 against `screens/`.
4. Data-bound stats wired to the report counts; map layers matched to Friends' levels.
5. Phone layout per `DESIGN-PHONE.md`, reduced motion, keyboard, chapter links, "Open the full map" hand-off. Checkpoint: captures of all seven chapters at 390 x 720 against `screens-phone/`.
6. `/shoreline/stories` index page.
7. Review on both hosts, on a laptop, a very wide monitor and a phone, before anything is linked from the explorer.

Out of scope for now: the story authoring interface, the Atlas and Cinema layouts, a miles and kilometers switch, and stories for other subsites.
