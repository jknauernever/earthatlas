# Site content admin (left-panel editing)

Admins edit a map page's left panel in place. First site: `/shoreline` (sanjuans.earthatlas.org/shoreline). Built 2026-11-09.

## What an admin can do
- **Categories and the items inside them** (e.g. Shoreline Modifications → Docks; Forage Fish → Herring): move up/down, rename, edit the (i) text, change colors, pin icon (from the existing glyphs) and pin color, change "shows from zoom", remove, restore.
- **Legend classes** (fish priority levels, shoreform groups): move, rename, recolor. They can't be removed.
- **Removed list** at the bottom of the panel while editing: every removed category or item, each with **Restore** (it goes back to its old place).
- **Popup images per dataset**: upload (resized in the browser to ≤1600 px WebP), caption and credit required, optional credit link, reorder, remove/restore. A switch keeps or drops the built-in photos after them.
- **Reset to original** for any node.
- The source link after the (i) text is always kept (provenance rule).

## How to get in
Admin role + two-step verification + an authenticator unlock (same gate as `/admin/users`, 12 h). On a map page, **Edit panel** shows at the top of the panel once this browser has visited `/admin/users`, or with `?edit` in the URL. Visitors never call the admin status endpoint.

## Where things live
- Tables: `content.nav_node`, `content.media` in the users DB (`lib/accounts/sql/004_site_content.sql`; `node scripts/accounts/migrate.mjs --apply`).
- Server: `lib/content/siteContent.js`, routed in `api/auth.js`:
  - `GET /api/auth/ea/content?site=` public, CDN `s-maxage=60` (changes reach visitors within about a minute).
  - `/api/auth/ea/admin/content`, `content-action`, `content-upload`: unlocked admins only, same-origin POSTs, every write in `auth.audit_log` as `content.*`.
- Images: Vercel Blob `site-content/<site>/<node>/<uuid>.webp`.
- Client: `src/lib/siteContent.js` (fetch, `resolveTree`, admin hook), `src/components/panel/NavAdmin.jsx` (the editing UI), per site a tree of defaults (`src/shoreline/shorelineTree.js`).
- Node ids (`kelp`, `mods/docks`, `fish/tier-3`) are database keys: never rename one.

## Per-record editing (later)
`content.media.record_id` is already there (null = the whole dataset). Per-record images and fields hang off the same tables and the same tools.

## Adding another site
Write its tree of defaults (like `shorelineTree.js`), render its panel from `resolveTree`, feed the resolved colors/zooms to its layers, and drop in `NavAdminBar` / `NodeTools` / `RemovedList`.

## Known limits
- Kelp's chart-squiggle overlay, the herring school and the beach-fish overlays keep their built-in drawing colors (only the kelp pin, lines and fills follow edits). Below their built-in zoom, those overlays don't draw even if an admin lowers the zoom; the lines and pins do.
- Fish priority colors in the popup's own pills stay the built-in ones.
- Brand-new categories need code (a map layer); the admin can only edit, move, remove and restore what exists.
