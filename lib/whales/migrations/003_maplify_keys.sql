-- Maplify keys now carry the Maplify source (ids repeat across sources, and rwsas/mmag_HSL reuse them):
-- maplify:<source>:<id>[:<yyyymmddhhmmss>]. Rows stored under the old maplify:<id> keys (the first days in
-- production) are dropped; the hourly refresh and the backfill reload them under the new keys.
DELETE FROM {{S}}.records WHERE key ~ '^maplify:-?[0-9]+$';
DELETE FROM {{S}}.sightings WHERE key ~ '^maplify:-?[0-9]+$';
