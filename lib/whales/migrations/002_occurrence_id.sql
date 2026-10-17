-- The record's original Darwin Core occurrenceID (OBIS rows), so a page that also
-- shows GBIF can drop GBIF's copy of the same record: every report shown once.
ALTER TABLE {{S}}.sightings ADD COLUMN occurrence_id text;
