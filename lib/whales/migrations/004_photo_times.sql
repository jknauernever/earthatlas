-- Photo capture times read from EXIF (lib/whales/exif.js), so each photo is fetched once. Josh 2026-10-18: HappyWhale
-- encounters carry a date only; their photos keep the camera's capture time. taken_at is set only when the photo pins
-- the moment down (GPS time, or a local time with its UTC offset); how = gps | offset | local-only | none | error.
CREATE TABLE IF NOT EXISTS {{S}}.photo_times (
  url        text PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now(),
  taken_at   timestamptz,
  how        text NOT NULL,
  local      text
);
