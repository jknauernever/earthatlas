-- /ships: the DOCUMENTS behind each permit (layer 1 = a list with links; nothing is downloaded). Josh 2026-10-06; sources in
-- docs/PERMITS_SOURCES.md §5. Additive only. Rules: src/ships/CLAUDE.md.
--
--   evidence        source_records, one per listing page as read (fields parsed from the page):
--                     'wa-ecology-paris'        kind paris_permit_documents  (PARIS PermitDocumentSearch, all pages, per permit number)
--                     'wa-ecology-industrial'   kind ecology_facility_page   (Ecology Industrial Section page for one facility)
--                     'nwcaa-aop'               kind nwcaa_aop_row           (one facility's row on NWCAA's Air Operating Permits page)
--   claim           documents (one per URL, with the title / date / type the listing gives)
--   interpretation  document_links (which permit or facility a document belongs to, and by what rule)

CREATE TABLE {{S}}.documents (
  id                        bigserial PRIMARY KEY,
  source_id                 text NOT NULL REFERENCES {{S}}.sources(id),
  url                       text NOT NULL UNIQUE,
  title                     text NOT NULL,                     -- file name or link text, as listed
  doc_type                  text,                              -- the listing's own type / label (e.g. 'Permit Documents', 'SOB')
  description               text,                              -- the listing's description (e.g. 'Permit, issued March 18, 2024; ...')
  doc_date                  date,                              -- only when the listing states one
  size_bytes                bigint,                            -- only when the listing states it
  source_record_id          bigint NOT NULL REFERENCES {{S}}.source_records(id),   -- newest listing it was read from
  status                    text NOT NULL DEFAULT 'listed' CHECK (status IN ('listed', 'unlisted')),  -- unlisted = gone from the listing; kept
  detail                    jsonb NOT NULL DEFAULT '{}',
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE {{S}}.document_links (
  id                        bigserial PRIMARY KEY,
  document_id               bigint NOT NULL REFERENCES {{S}}.documents(id),
  permit_id                 bigint REFERENCES {{S}}.permits(id),
  facility_id               bigint REFERENCES {{S}}.facilities(id),
  method                    text NOT NULL,     -- 'paris_permit_number' | 'ecology_page_section' | 'nwcaa_location' | 'ecology_page_other'
  detail                    jsonb NOT NULL DEFAULT '{}',
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now(),
  CHECK ((permit_id IS NULL) <> (facility_id IS NULL))
);
CREATE UNIQUE INDEX document_links_permit_uniq ON {{S}}.document_links (document_id, permit_id) WHERE permit_id IS NOT NULL;
CREATE UNIQUE INDEX document_links_facility_uniq ON {{S}}.document_links (document_id, facility_id) WHERE facility_id IS NOT NULL;
