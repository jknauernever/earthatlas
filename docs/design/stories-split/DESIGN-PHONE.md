# Stories, Split layout on a phone: design reference

Status: approved by Josh, 12 Nov 2026. The rough edges listed at the end still need fixing in the build.

This is the Split layout turned on its side. The photo takes the top of the screen, the map takes the bottom, the gold seam runs across between them, and the stat circle sits on the seam at the left. Colors, fonts, map look, layer settings per chapter and motion are the same as `DESIGN.md`. This file lists only what differs.

## What is here

- `phone.html`: the phone design as a self-contained page. On a wide screen it shows a 390 x 720 phone frame; on a real phone it fills the screen. Swipe left and right, tap the rail, or use the buttons. `#chapter-1` to `#chapter-7` open a chapter directly.
- `screens-phone/01-shoreline.png` to `07-act.png`: each chapter at 390 x 720 (a 390 x 844 phone less browser bars). Captured at 1x, so use them for layout and proportion and take exact values from `phone.html`.

As on desktop, everything outside the map is to be matched; the map is rebuilt on the live map component.

## When this layout applies

Viewport width under 700px, or portrait orientation under 900px wide. Landscape phones and tablets at 700px and wider get the desktop Split layout, which already scales down through its `--u` unit.

## Sizing unit

```css
.stage { --s: calc(100vw / 390); height: 100dvh; overflow: hidden; }
```

Every size is `calc(var(--s) * N)`, so N is the pixel value on a 390px-wide phone. Vertical split: photo pane is the top 44% of the height, map pane the bottom 56%. Use `dvh` so browser bars do not cause scrolling, and add `env(safe-area-inset-top)` to the header and text offsets and `env(safe-area-inset-bottom)` to the footer offset.

## Elements

| Element | Position and size (N on a 390px phone) | Notes |
|---|---|---|
| Photo pane | top 0, full width, 44% of height | image sized to at least 125% of the pane height and positioned so its focal point lands at 60% across and 78% down the pane, clamped so no edge shows. This keeps the subject below the text. Top 16% of the image fades out with a mask |
| Photo gradient | over the photo | `linear-gradient(180deg, rgba(4,12,20,.95) 0%, rgba(4,12,20,.82) 40%, rgba(4,12,20,.5) 58%, rgba(4,12,20,0) 76%)` plus a bottom fade `rgba(4,12,20,.55)` to clear at 14% |
| Seam | full width, 2px, at 44% of height | gold, opacity .85 |
| Stat circle | left 18, vertically centered on the seam, diameter 116 | number 36, unit at .36em, label 9.5 with line-height 1.25 and max-width 94; ring shadow 5, drop shadow `0 10 30 rgba(0,0,0,.6)`; hidden when the chapter has no stat |
| Header | top 12, left and right 18 | wordmark 17; "Open the full map" glass pill, height 34, radius 17, padding 0 13, text 12 |
| Text block | top 60, left and right 18, gap 8 | kicker 10.5 with `letter-spacing: .2em`; headline 30, line-height 1.04; body 15, line-height 1.4. Headline may run to two lines and body to three |
| Photo caption | right 18, left 150 (clear of the stat circle), right-aligned, 7 above the seam | 8.5, `rgba(255,255,255,.55)`, may wrap to two lines |
| Action buttons (last chapter) | top of the map pane, 14 below the seam, left 18, max-width 260, wrap, gap 8 | height 40, radius 20, padding 0 15, text 13; the first is gold at 14, weight 600. They take the place of the stat circle, which the last chapter does not have |
| Map pane | bottom 56% of height | bottom gradient: `rgba(4,12,20,.96)` at 0, `.9` at 16%, clear at 34%, so the key and controls sit on dark |
| Map key and scale bar | one row, 4 above the rail, left and right 18 | key text 10, swatches 13 x 4, gap 11; scale bar at the right with its label above, text 9 |
| Chapter rail | full width less 18 each side, above the controls | seven bars 3px high, gap 5, each in a 22-high tap target; colors as on desktop. No labels on the bars |
| Controls row | bottom 14, left and right 18 | left: "1 / 7" in `rgba(255,255,255,.55)` then the chapter's rail label in gold, 13. Right: Play (icon only, 44 circle), back (44 circle), Next (gold pill, height 44, padding 0 22, text 14, weight 600; reads "Start over" on the last chapter), gap 8 |

## Map on a phone

- County view: the islands sit in the right two thirds of the pane, clear of the stat circle at the top left, framed as in `screens-phone/01-shoreline.png`. Fisherman Bay view as in `screens-phone/06-fisherman-bay.png`.
- Only three island labels show (San Juan Island, Orcas Island, Lopez Island), at about 10px on screen. Line weights are about 1.8 times the desktop values relative to the map so they read at this size.
- The map is locked to the chapter's view: no pan, pinch or tap. A horizontal swipe anywhere, including on the map, changes chapter. "Open the full map" is the way into free exploration.
- The satellite credit goes in the map pane at the top right, just under the seam, in the caption style. It is not in the mockup.

## Behavior

- Swipe left for the next chapter, right for the previous one (40px threshold, mostly horizontal). The page never scrolls.
- Rail bars, back and Next also work. Play story is the same as desktop: 6.5s per chapter, stops at the end.
- Transitions and reduced-motion handling as in `DESIGN.md`.

## Known rough edges for review

- Chapter 2 and chapter 5: the third line of body text runs over a bright part of the photo and is harder to read than the rest.
- Chapter 6: the caption sits close to a figure in the photo.
- Not checked: screens shorter than 640px, where three lines of body text and the stat circle may collide, and real devices (only viewed in a 390 x 720 frame in desktop Chrome).
