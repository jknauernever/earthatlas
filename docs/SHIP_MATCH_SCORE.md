# Same-MMSI records: rules and match score

Two vessel records that share an MMSI may be one ship (GFW fragments, renames, typos) or several (reused, default
or shared numbers). A wrong merge is worse than an unresolved record. Code: `lib/ships/matchRules.js` (rules),
`lib/ships/matchScore.js` (score), `scripts/ships/match/` (export → profile → apply / score → label → evaluate → store).

## Rules (decide first; `judgePair`)

| Verdict | When | Action |
|---|---|---|
| `two_ships` | different registry ids; call sign AND length differ; both broadcast at once ≥ 5 km apart (3+ minutes) | link marked, card: "A different ship has also used MMSI …" |
| `blank_mmsi` | default/invalid MMSI | links retired |
| `lumped` | a record holds 2+ lifelong registry numbers | nothing (B2 splits them) |
| `merge_r1/r2/r3` | same registry id / exact name, nothing conflicting / nameless stub inside the named record's dates | merged (reversible) |
| `numbered_fleet` (C) | names differ only by their number: SANDEMARINE68/95, BLACKFISH II/III, MISTY K II/III | marked `two_ships` (rule kept) |
| `shared_mmsi` (C) | 6+ records on the MMSI AND 3+ numbered-fleet names or a 98x number | marked; card: "MMSI … is shared by N records" |
| `open` | none of the above | scored (below) |

C details (2026-10-20): Roman numerals and runs of ones read as numbers (WHISKERS111 = WHISKERS III); a number that
starts the other (…96 / …96133) is a cut-off name, not another hull; call signs don't count toward "many boats"
(USCGC Waesche and RCMSAR 31 carry 3+ spellings); R3 no longer merges a stub whose dates fit inside two or more named
records (it could be either). Prod history: 76 earlier R3 merges on 25 MMSIs went to 2+ different records; worth a review.

Dev (2026-10-20 export, 6,248 pairs): numbered_fleet 661, shared_mmsi 654, R3 held back 44, open 2,605.

## Score (what the rules leave open)

Fellegi–Sunter: each feature's value adds log2(m/u) bits (how much more often it occurs for one ship than for two).

Features: name (exact / one-letter typo / prefix / different / missing), call sign, length, type family (GFW "passenger"
= pleasure craft), flag, dates (nested / stick out ≤ 180 d / > 180 d / disjoint), fragment size, records on the MMSI,
and GFW port visits over the shared dates (same port at the same time / impossible travel / both seen, never together).
Missing values carry no weight.

**Why hand labels.** Weights learned from the rule-decided pairs repeat the rules (R3 needs "no name", so "no name"
looked like strong evidence of a match); unlabeled EM split stubs from full records instead of same from different.
So the weights come from 200 hand-labeled dev pairs (stratified by evidence pattern; dossiers with every claim, GFW
identity detail and GFW port visits; 149 GFW calls + 11 web lookups). Labels: 71 same, 24 different, 105 unclear.

**Bands** (model `b-score-v1`, p = probability same ship):

| Band | Rule | Leave-one-out on the labels | Card |
|---|---|---|---|
| merge | p ≥ 0.8, a one-letter typo plus same call sign or length, nothing conflicting | 1 of 1 | listed for Josh, never auto-merged |
| probably | p ≥ 0.8, no conflict, names not different | 15 of 16 same (95% range 72–99%); 38 more unverifiable | "Probably the same ship … Not merged. 15 of 16 pairs like this checked by hand were the same ship." |
| separate | p ≤ 0.3 | 7 of 7 two ships (65–100%) | "Probably a different ship has also used MMSI …" |
| unknown | the rest | 55 same / 16 different: the evidence doesn't decide | unchanged ("may be the same ship") |

Dev open pairs by band (without port visits, which are fetched only for the sample so far): probably 626,
merge 5 (HOLDFAST, AMPARO, LABELLAVITA, GOODOMEN, CORMORANT typos with the same call sign), separate 21,
unknown 1,953. Port visits for every open pair ≈ 1 GFW call per pair with overlapping dates.

**Reviewed by Josh (2026-10-21):** all 5 merge-band pairs and 15 more one-letter typo pairs are the same boat (20 in
all); merged on dev by `scripts/ships/match/merge-reviewed.mjs` from `lib/ships/data/matchReviewed.json` (reviewed ids
where they exist, else MMSI + names, so the file replays on production). Not reviewed: the two generic "US GOVT
VESSEL" pairs (MMSIs 369970850, 368926095) and SANTA SUSANNA / SANTA SUZANNA.

## Where results live

`match_pair_scores` (migration 041): one row per pair and model version (features, each feature's weight, p, band,
the model's weights and precision). The band and reasons are copied onto the pair's candidate links
(`evidence.match`); the card reads them there. No claim, raw record or link status changes; refreshReview is unchanged
by scores (shared_mmsi links stop counting toward "needs review").
