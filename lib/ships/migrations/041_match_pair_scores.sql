-- /ships: the same-MMSI match score (A, Josh 2026-10-20). Additive only: one new table, nothing existing is altered.
-- Code: lib/ships/matchScore.js (features, weights, bands), scripts/ships/match/score.mjs + evaluate.mjs (fit and measure),
-- scripts/ships/match/store-scores.mjs (writes rows + the band onto the pair's candidate links).
--
-- Interpretation, never evidence: a row says what one model version concluded about one pair of vessel records from their
-- claims; no claim, raw record or link is changed by it. Rows are kept per model version (history), so a band shown on a card
-- can always be traced to the model, its weights and the features it saw. The card reads the band from the candidate link's
-- evidence ("match": { band, p, model, reasons }), written in the same transaction.

CREATE TABLE {{S}}.match_pair_scores (
  id            bigserial PRIMARY KEY,
  vessel_a      uuid NOT NULL REFERENCES {{S}}.vessels(id),
  vessel_b      uuid NOT NULL REFERENCES {{S}}.vessels(id),
  mmsi          text NOT NULL,
  model         text NOT NULL,                 -- matchScore.js SCORE_MODEL
  model_detail  jsonb NOT NULL,                -- weights, prior, band thresholds, what it was trained on
  features      jsonb NOT NULL,                -- pairFeatures() output
  parts         jsonb NOT NULL,                -- each feature's weight in this pair (why the score is what it is)
  total_bits    numeric NOT NULL,
  p_same        numeric NOT NULL,              -- probability the two records are one ship, under this model
  band          text NOT NULL CHECK (band IN ('merge', 'probably', 'unknown', 'separate')),
  scored_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (vessel_a < vessel_b)
);
CREATE UNIQUE INDEX match_pair_scores_uniq ON {{S}}.match_pair_scores (vessel_a, vessel_b, mmsi, model);
CREATE INDEX match_pair_scores_band_idx ON {{S}}.match_pair_scores (model, band);
