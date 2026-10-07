-- /ships (numbered 031: 030 is another session's terminal land records): SEPA review per permit (Lovel 2026-10-07, "the SEPA reviews that should be associated with each permit"). Additive only:
-- one new table. Rules: docs/PERMITS_SOURCES.md §6; code lib/ships/permitSepa.js (pure) + lib/ships/permitSepaDb.js.
--
--   evidence        source_records:
--                     'wa-ecology-sepa-register'  kind sepa_record          (already stored; plus hits of the permit-number search)
--                     <the document's source>     kind document_sepa_text   (a permit's fact sheet / support document / Air Operating
--                                                                           Permit as read for SEPA: URL, SHA-256, page count, the
--                                                                           SEPA passages verbatim with page numbers, and for an air
--                                                                           permit the approvals it lists. The file is not kept.)
--   interpretation  permit_sepa (below)

CREATE TABLE {{S}}.permit_sepa (
  id                        bigserial PRIMARY KEY,
  permit_id                 bigint NOT NULL REFERENCES {{S}}.permits(id),
  facility_id               bigint NOT NULL REFERENCES {{S}}.facilities(id),   -- the facility whose SEPA records were searched
  kind                      text NOT NULL CHECK (kind IN ('review', 'statement', 'none_found')),
  entity_key                text NOT NULL,          -- review: the SEPA number; statement: document URL + '#p' + page; none_found: ''
  status                    text NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'candidate', 'retired')),
  method                    text NOT NULL,          -- review: names_permit | doc_cites_review | approval_in_permit | same_project |
                                                    --   register_related (several joined by '+') | same_lead_agency (candidate);
                                                    -- statement: exempt | relies | determination | mention; none_found: 'searched'
  sepa_record_id            bigint REFERENCES {{S}}.source_records(id),       -- review: the SEPA Register record
  doc_record_id             bigint REFERENCES {{S}}.source_records(id),       -- the permit document read (document_sepa_text)
  detail                    jsonb NOT NULL DEFAULT '{}',   -- review: { evidence: [{ method, says, quote?, doc_url?, page? }] };
                                                           -- statement: { quote, heading, page, doc_url, doc_title, doc_role };
                                                           -- none_found: { searched: { register: [...], documents: [...], records } }
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (permit_id, facility_id, kind, entity_key)
);
CREATE INDEX permit_sepa_permit_idx ON {{S}}.permit_sepa (permit_id) WHERE status = 'accepted';
