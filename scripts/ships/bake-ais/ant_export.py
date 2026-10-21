#!/usr/bin/env python3
"""
Washington Ecology Advance Notice of Transfer (ANT) release → JSON rows for scripts/ships/import-ecology-ant.mjs
(lib/ships/ecologyAnt.js; Josh 2026-10-20). Every cell is read as text, exactly as in the release (phone numbers and IDs stay
text); StartDateTime stays the Excel serial the release holds (Pacific local), converted in ecologyAnt.js.

Run (from this directory):
  python3 ant_export.py cache/ecology-ant/ant-2026-03.xlsx                    # every row
  python3 ant_export.py cache/ecology-ant/ant-2026-03.xlsx --anchorages       # only Location 'Anchor - …' rows (the report)
Output: cache/ecology-ant/ant-rows.json  ([{ row_no, AntID, Company, … }]) + ant-meta.json (file, sheet, size, sha256, rows).
"""
import os, sys, json, hashlib
import duckdb

SHEET = "Vessel Oil Transfer (42)"


def main():
    args = sys.argv[1:]
    src = args[0]
    only_anch = "--anchorages" in args
    out_dir = os.path.dirname(os.path.abspath(src))
    con = duckdb.connect()
    con.execute("INSTALL excel; LOAD excel")
    q = f"read_xlsx('{src.replace(chr(39), chr(39) * 2)}', sheet='{SHEET}', all_varchar=true)"
    cols = [d[0] for d in con.execute(f"SELECT * FROM {q} LIMIT 0").description]
    rows = con.execute(f"SELECT row_number() OVER () AS row_no, * FROM {q}").fetchall()
    data = [dict(zip(["row_no"] + cols, r)) for r in rows]
    total = len(data)
    if only_anch:
        data = [r for r in data if (r.get("Location") or "").startswith("Anchor - ")]
    with open(os.path.join(out_dir, "ant-rows.json"), "w") as f:
        json.dump(data, f)
    sha = hashlib.sha256(open(src, "rb").read()).hexdigest()
    meta = dict(file=os.path.basename(src), sheet=SHEET, bytes=os.path.getsize(src), sha256=sha, columns=cols,
                rows_in_sheet=total, rows_exported=len(data), filter="anchorages" if only_anch else "all")
    with open(os.path.join(out_dir, "ant-meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"{len(data):,} of {total:,} rows → {out_dir}/ant-rows.json")


if __name__ == "__main__":
    main()
