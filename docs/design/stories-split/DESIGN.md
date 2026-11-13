# Stories, Split layout: design reference

This folder is the approved design for the Split story layout, story 1 ("The beaches that feed orcas"). It is the visual source of truth for the build. The build brief (`stories-template-build-brief.md`) covers routes, the story schema and build order.

## What is here

- `index.html`: the design as one self-contained page (plain HTML, CSS and a short script, no framework). Open it in a browser. Left and right arrow keys, the rail and the Next button change chapter. `#chapter-1` to `#chapter-7` open a chapter directly.
- `img/`: the seven chapter photos and two satellite stills used by the mockup.
- `screens/01-shoreline.png` to `07-act.png`: each chapter captured at a 1315 x 880 viewport. Compare the build against these at the same viewport size.

## What to match exactly, and what to replace

Match exactly: everything outside the map. Layout, sizes, type, colors, gradients, the seam and stat circle, header, rail, buttons, map key, caption, and the chapter transition timing. Copy values from `index.html`; the tables below list them for convenience. If the two disagree, `index.html` wins.

Replace: the map. In `index.html` the map is a static satellite image with SVG lines drawn over it, zoomed with a CSS transform. The build uses the site's live map component and layer registry. Reproduce its look (basemap darkness, line colors, glows, label style, framing per chapter) and ignore its mechanics (`#map`, the nested `<svg>`, `.map.zoom`).

Replace: the photos. `img/*.jpg` are screen captures at reduced size. Use the originals listed in the brief.

Known differences between the mockup map and the data, which the build must not copy: the teal Chinook lines use an invented cutoff (use Friends' "highest priority" level), the red armoring lines omit 24 pieces marked removed (use the full layer), and the Fisherman Bay figure of 104 was counted by hand (compute it from the chapter bounds). The mockup has no scale bar and no satellite credit; the build adds both inside the map pane, bottom left, styled like the map key (scale bar in miles).

## Sizing unit

Every size derives from one unit so the layout fills any screen without scrolling:

```css
.ea-stage { --u: min(1vw, 1.72vh); height: 100vh; min-height: 480px; overflow: hidden; }
```

Sizes are written `max(Npx, calc(var(--u) * k))`. At the 1315 x 880 reference viewport, `--u` is 13.15px.

## Color and type

| Token | Value | Used for |
|---|---|---|
| Background | `#040C14` | stage, stat circle fill |
| Map pane background | `#061624` | behind the map |
| Gold | `#FFE7A3` | kicker, stat number, seam, circle border, current rail segment, primary buttons |
| Text on gold | `#1A1406` | primary button label |
| Text | `#F2F7FA` | headline, wordmark |
| Body text | `#E3ECF3` | chapter body |
| Stat label | `#D5E0E8` | text under the stat number |
| Glass | `rgba(4,12,20,0.55)` fill, `1px solid rgba(255,255,255,0.22)`, `backdrop-filter: blur(8px)`, text `#E6EEF5` | secondary buttons |

Fonts: Source Serif 4 (weight 300 for headline, stat and wordmark; italic 400 for "of the San Juans") and Inter (400, 500, 600) for everything else.

## Elements

Positions are relative to the stage. `k` is the multiplier of `--u`; the px figure is the minimum.

| Element | Position and size | Style |
|---|---|---|
| Photo pane | left 0, width 50%, full height | `object-fit: cover`, `object-position` from the chapter's focal point; one image per chapter, cross-fade `opacity .9s ease` |
| Photo gradient | over the photo | `linear-gradient(180deg, rgba(4,12,20,.92) 0%, rgba(4,12,20,.62) 30%, rgba(4,12,20,0) 56%)` plus `linear-gradient(0deg, rgba(4,12,20,.9) 0%, rgba(4,12,20,0) 22%)` |
| Map pane | right 0, width 50%, full height | gradient over map: bottom `rgba(4,12,20,.9)` to clear at 20%, top `rgba(4,12,20,.55)` to clear at 14%; `pointer-events: none` |
| Seam | left 50%, 2px wide, full height | gold, opacity .85 |
| Stat circle | center at left 50%, top 52%; diameter k 17 (min 150px) | fill `#040C14`, `2px solid` gold, shadow `0 0 0 calc(u*.6) rgba(4,12,20,.55), 0 calc(u*1.5) calc(u*5) rgba(0,0,0,.6)`; hidden when the chapter has no stat |
| Stat number | inside circle | Source Serif 4, 300, k 5.4 (min 40px), gold, line-height .9, nowrap; unit at .36em with .12em left margin |
| Stat label | under the number, gap k .5 | Inter, k .82 (min 11px), line-height 1.3, max-width k 12.5 (min 116px), centered |
| Text block | left k 3.4 (min 20px), top k 7 (min 70px), width k 36 (min 280px) | column, gap k 1.1 (min 8px), `text-shadow: 0 2px 18px rgba(0,0,0,.65)` |
| Kicker | | Inter, k .85 (min 11px), `letter-spacing: .22em`, gold, uppercase in content |
| Headline | | Source Serif 4, 300, k 4.6 (min 30px), line-height 1, `letter-spacing: -.015em` |
| Body | | Inter, k 1.45 (min 15px), line-height 1.45, max-width k 32 |
| Action buttons (last chapter) | under the body, wrap, gap 10px | height 46px, radius 23px, padding 0 20px, 15px; first is gold with weight 600, the others glass |
| Photo caption | left k 3.4 (min 20px), bottom k 6.8 (min 74px) | "Photo: caption · credit", k .62 (min 10px), `rgba(255,255,255,.55)` |
| Map key | right k 3.4 (min 20px), bottom k 6.8 (min 74px) | pill, padding 7px 14px, radius 18px, fill `rgba(4,12,20,.6)`, k .8 (min 11px), text `rgba(255,255,255,.82)`; swatches 16 x 4px, radius 2px: `#FFEFC2` (with `0 0 8px #FFC74D` glow), `#7CF5E6`, `#FF6A5C` |
| Header | top k 1.6 (min 12px), left and right k 3.4 (min 20px) | wordmark k 1.5 (min 17px); "Open the full map" glass pill, height 40px, radius 20px, padding 0 16px, 13px |
| Chapter rail | bottom k 1.5 (min 12px), left and right k 3.4, to the left of the controls | equal columns, gap 8px; each a button, min-height 44px, with a 3px bar (radius 2px) above a label at k .8 (min 11px), `letter-spacing: .04em`. Bar: past `rgba(255,255,255,.75)`, current gold, upcoming `rgba(255,255,255,.28)`. Label: current gold, others `rgba(255,255,255,.7)` |
| Controls | bottom right, gap 8px, k 2 (min 14px) from the rail | "Play story" glass pill 44px high, padding 0 16px, 13px; back button glass circle 44px; "Next" gold pill 44px high, padding 0 24px, 14px, weight 600 (reads "Start over" on the last chapter) |

Layer order, back to front: photo and map panes, seam (2), text block and caption (3), stat circle and map key (4), header and rail (5).

## Map look to reproduce

Basemap: dark satellite imagery (the explorer's Sentinel-2 cloudless tiles), water near black, land muted green.

| Layer | Core line | Glow |
|---|---|---|
| Shoreline | `#CFEFFF`, thin, opacity .9, with a faint moving white sparkle | `#7FD0F0`, soft, opacity .35 |
| Spawning beaches | `#FFEFC2` | `#FFC74D`, wide and blurred, slow pulse (3.4s, opacity .55 to 1) |
| Juvenile Chinook, highest priority | `#D8FFFA` dashed, flowing (1.8s) | `#7CF5E6`, blurred, opacity .6 |
| Juvenile Chinook, high | `#2FD0C4`, opacity .9 | none |
| Armoring | `#FF6A5C` | `#FF4A3D`, blurred, opacity .55 |
| Island labels | Inter 600, uppercase, `letter-spacing` about .15em, fill `#E4F0F8`, halo `#04101A` | |
| Fisherman Bay frame (chapter 5) | white dashed rectangle, 2px, dash 7 6, radius 6 | |

Layer opacity per chapter (1 is full, 0 is hidden), from the `CH` array in `index.html`:

| Chapter | Shoreline | Spawning | Chinook | Armoring | Bay frame | Camera |
|---|---|---|---|---|---|---|
| 1 Shoreline | 1 | 0 | 0 | 0 | 0 | county |
| 2 Eggs | .5 | 1 | 0 | 0 | 0 | county |
| 3 Young salmon | .5 | .35 | 1 | 0 | 0 | county |
| 4 Orcas | .5 | .8 | .8 | 0 | 0 | county |
| 5 Armoring | .45 | .7 | 0 | 1 | 1 | county |
| 6 Fisherman Bay | full, in detail | full | full | full | 0 | Fisherman Bay; island labels hidden |
| 7 Act | 1 | 1 | .8 | .35 | 0 | county |

Cameras: the county view frames the islands as in `screens/01-shoreline.png` (mockup image covers longitude -123.25 to -122.73, latitude 48.405 to 48.80, shown right-aligned in the pane and shifted up 4%). The Fisherman Bay view is centered near -122.9248, 48.5114, framed as in `screens/06-fisherman-bay.png`.

## Motion

- Chapter change: photo cross-fade .9s; text block rises 1.2vh and fades in over .8s, `cubic-bezier(.2,.7,.2,1)`; layer opacity 1.1s ease; rail bar color .5s.
- Camera move to and from Fisherman Bay: 2.4s, `cubic-bezier(.65,0,.2,1)`. Detail layers fade in over 1.2s after a .6s delay.
- Play story: one chapter every 6.5s, stops on the last chapter.
- `prefers-reduced-motion`: no animation and no transitions.
