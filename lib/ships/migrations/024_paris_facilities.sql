-- /ships: PARIS by facility + Tesoro Logistics (Josh 2026-10-06). Additive only: CHECK constraints are widened, one column
-- and one table are added; every existing row still satisfies them. Rules: src/ships/CLAUDE.md; sources docs/PERMITS_SOURCES.md.
--
--   facilities.kind              + 'logistics_terminal'   (a company's crude/product storage + loading site, e.g. Tesoro Logistics
--                                                           Operations at the Anacortes refinery: rail off-loading, tanks, the wharf)
--   terminal_facilities.relation + 'owned_by'             (the terminal (dock) belongs to that facility's company, as a cited
--                                                           source states; 'serves' stays "the dock of that plant")
--   facility_links.role          + 'paris_facility'       (WA Ecology PARIS FacilityId the facility is, entity_key = the id)
--   permits.detail               PARIS facts per version (issue / effective / expiration dates, status) — values as listed
--   permit_terminal_coverage     a permit document says the permit covers the terminal (cited)
--   facility_permits             which permits a facility holds when that comes from a listing rather than an EPA FRS id
--                                (PARIS facility pages; state-only permits such as ST0045528 have no FRS id)

ALTER TABLE {{S}}.facilities DROP CONSTRAINT facilities_kind_check;
ALTER TABLE {{S}}.facilities ADD CONSTRAINT facilities_kind_check CHECK (kind IN ('refinery', 'logistics_terminal'));

ALTER TABLE {{S}}.terminal_facilities DROP CONSTRAINT terminal_facilities_relation_check;
ALTER TABLE {{S}}.terminal_facilities ADD CONSTRAINT terminal_facilities_relation_check CHECK (relation IN ('serves', 'owned_by'));
ALTER TABLE {{S}}.terminal_facilities ADD COLUMN detail jsonb NOT NULL DEFAULT '{}';   -- the cited source for the relation

ALTER TABLE {{S}}.facility_links DROP CONSTRAINT facility_links_role_check;
ALTER TABLE {{S}}.facility_links ADD CONSTRAINT facility_links_role_check CHECK (role IN (
  'epa_frs_primary', 'epa_frs_related', 'ct_refinery', 'sepa_review', 'paris_facility'));

ALTER TABLE {{S}}.permits ADD COLUMN detail jsonb NOT NULL DEFAULT '{}';

CREATE TABLE {{S}}.facility_permits (
  id                        bigserial PRIMARY KEY,
  facility_id               bigint NOT NULL REFERENCES {{S}}.facilities(id),
  permit_id                 bigint NOT NULL REFERENCES {{S}}.permits(id),
  method                    text NOT NULL,                     -- 'paris_facility' (listed on the facility's PARIS page)
  source_record_id          bigint NOT NULL REFERENCES {{S}}.source_records(id),
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_id, permit_id)
);

-- Does a facility's permit cover the terminal itself? Only where a cited permit document says so (hand-checked, named in
-- lib/ships/data/salish-facilities.json: the document, where in it, and its words). Absence = not shown to cover it.
CREATE TABLE {{S}}.permit_terminal_coverage (
  id                        bigserial PRIMARY KEY,
  permit_id                 bigint NOT NULL REFERENCES {{S}}.permits(id),
  terminal_id               bigint NOT NULL REFERENCES {{S}}.terminals(id),
  entry_source_record_id    bigint NOT NULL REFERENCES {{S}}.source_records(id),   -- the facility entry that states it
  detail                    jsonb NOT NULL DEFAULT '{}',       -- { doc_url, doc_title, where, says }
  status                    text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (permit_id, terminal_id)
);
