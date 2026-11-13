# Story content

Content for EarthAtlas stories, kept apart from display. Layouts (`src/stories/`) never read these files; the story
page assembles a story from them and hands the layout plain data, so any story renders in any layout without edits.

Everything is a record with an id. Records point at each other by id, so one photo, stat, map view or whole chapter
can be used in many stories. To change wording, edit its one record: every story using it changes with it.

## Folders: who owns what

- `content/<organization>/` (a `src/lib/brand.js` id, e.g. `friends`): what the organization says and shows.
  `photos.json`, `texts.json`, `stats.json` (literal facts, each with a source), `actions.json`, `sources.json`,
  `chapters.json`, and `stories/<slug>.json`.
- `content/<subsite>/` (e.g. `shoreline`): that subsite's map and data. `views.json`, `places.json`, `labels.json`,
  `stats.json` (numbers bound to the subsite's published report counts), `sources.json`.

## Record types

| Type | Holds |
|---|---|
| photo | file, alt, caption, credit, focal point, rights (`unconfirmed` blocks publishing) |
| text | kicker, headline, body; `{{shoreline.shoreform_feeder\|1}}` in the body inserts a published count |
| stat | the number in the circle: a `dataKey` into the subsite's report counts, or a literal `value` with its `source` |
| action | a call to action: label and link |
| source | a citation: name, publisher, link |
| place | a named area: camera target, dashed frame, and counted in the report counts as `places.<id>` |
| labels | map labels (island names) |
| view | camera (a place, bounds, or center and zoom), the subsite's layers by id with an emphasis, labels, frames |
| chapter | rail label plus a text, photo, view, and optionally a stat and actions; its id is its link anchor |
| story | slug, subsite, title, layout, author, status, and its chapters in order |

The schema is `schema/content.schema.json`. `npm run stories:check` (also the first step of `npm run build`) checks
every file against it, then checks ids, references, photo files, layer ids against the subsite's registry, data keys
against its report counts, and that no story is published while any of its photos' rights are unconfirmed.
