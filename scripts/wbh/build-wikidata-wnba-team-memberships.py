#!/usr/bin/env python3
"""Build rights-clean WNBA team-membership evidence from Wikidata P54 statements."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = "PropBetEdge-History/1.0 (support@proptechusa.ai; Wikidata CC0 P54 membership evidence)"
SPARQL = "https://query.wikidata.org/sparql"
API = "https://www.wikidata.org/w/api.php"


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def http_json(url: str, *, data: bytes | None = None, raw_hash=None, raw_size=None, attempts: int = 5):
    last = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(
                url,
                data=data,
                headers={"User-Agent": UA, "Accept": "application/sparql-results+json, application/json"},
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read()
            if raw_hash is not None:
                raw_hash.update(len(raw).to_bytes(8, "big"))
                raw_hash.update(raw)
            if raw_size is not None:
                raw_size[0] += len(raw)
            return json.loads(raw)
        except Exception as exc:
            last = exc
            if attempt + 1 == attempts:
                raise
            time.sleep(min(2 ** attempt * 2, 30))
    raise last


def chunks(items, n=45):
    for i in range(0, len(items), n):
        yield items[i : i + n]


def sqls(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def qid(uri: str) -> str:
    return uri.rsplit("/", 1)[-1]


def parse_precision(raw_time: str | None, raw_precision: str | None):
    if not raw_time or not raw_precision:
        return None
    try:
        precision = int(raw_precision)
    except Exception:
        return None
    m = re.match(r"^\+?(\d{4,})-(\d{2})-(\d{2})T", raw_time)
    if not m:
        return None
    y, mo, d = map(int, m.groups())
    if precision >= 11:
        return {"date": f"{y:04d}-{mo:02d}-{d:02d}", "precision": "day", "raw": raw_time, "wikibase_precision": precision}
    if precision == 10:
        return {"date": f"{y:04d}-{mo:02d}-01", "precision": "month", "raw": raw_time, "wikibase_precision": precision}
    if precision == 9:
        return {"date": f"{y:04d}-01-01", "precision": "year", "raw": raw_time, "wikibase_precision": precision}
    return None


def one_temporal(candidates):
    uniq = {}
    for c in candidates:
        if c:
            uniq[(c["date"], c["precision"], c["raw"], c["wikibase_precision"])] = c
    vals = list(uniq.values())
    return vals[0] if len(vals) == 1 else None, vals


def statement_rank(uri: str) -> str:
    if uri.endswith("PreferredRank"):
        return "preferred"
    return "normal"


def make_claim_id(statement_id: str) -> str:
    return "mbr_" + hashlib.sha256(statement_id.encode("utf-8")).hexdigest()[:24]


def label_lookup(team_qids, raw_hash, raw_size):
    labels = {}
    for batch in chunks(sorted(team_qids), 50):
        url = API + "?" + urllib.parse.urlencode(
            {
                "action": "wbgetentities",
                "ids": "|".join(batch),
                "props": "labels",
                "languages": "en|mul",
                "languagefallback": "1",
                "format": "json",
                "formatversion": "2",
            }
        )
        data = http_json(url, raw_hash=raw_hash, raw_size=raw_size)
        for team_id, entity in data.get("entities", {}).items():
            label = None
            for lang in ("en", "mul"):
                if entity.get("labels", {}).get(lang, {}).get("value"):
                    label = entity["labels"][lang]["value"]
                    break
            labels[team_id] = label
        time.sleep(0.15)
    return labels


def build_query(person_qids, team_qids):
    people = " ".join(f"wd:{x}" for x in person_qids)
    teams = " ".join(f"wd:{x}" for x in team_qids)
    return f"""
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pqv: <http://www.wikidata.org/prop/qualifier/value/>
PREFIX wikibase: <http://wikiba.se/ontology#>
SELECT ?person ?statement ?team ?rank ?start ?startPrecision ?end ?endPrecision WHERE {{
  VALUES ?person {{ {people} }}
  VALUES ?team {{ {teams} }}
  ?person p:P54 ?statement .
  ?statement ps:P54 ?team ; wikibase:rank ?rank .
  FILTER (?rank != wikibase:DeprecatedRank)
  OPTIONAL {{
    ?statement pqv:P580 ?startNode .
    ?startNode wikibase:timeValue ?start ; wikibase:timePrecision ?startPrecision .
  }}
  OPTIONAL {{
    ?statement pqv:P582 ?endNode .
    ?endNode wikibase:timeValue ?end ; wikibase:timePrecision ?endPrecision .
  }}
}}
ORDER BY ?person ?statement
""".strip()


def generate_sql(manifest):
    claims = manifest["claims"]
    cap = manifest["capture"]
    counts = manifest["totals"]
    out = [
        "-- PropBetEdge — Women's Basketball History",
        "-- Wikidata CC0 P54 evidence for canonical WNBA teams. Evidence only; not a season-roster endpoint.",
        "begin;",
        "do $seed$",
        "declare",
        "  v_doc uuid;",
        "  v_run uuid;",
        "  v_existing integer;",
        "begin",
        "  perform public.wbh_assert_ingestible('wikidata');",
        "  select count(*) into v_existing from public.wbh_ingestion_runs where scope->>'dataset'='wikidata_wnba_team_memberships_v1' and status='ok';",
        "  if v_existing > 0 then",
        f"    if (select count(*) from public.wbh_person_team_membership_claims) >= {len(claims)} then return; end if;",
        "    raise exception 'wbh: P54 membership run exists but evidence counts are incomplete; refusing implicit repair' using errcode='P0001';",
        "  end if;",
        "  insert into public.wbh_source_documents (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,content_type,byte_size,storage_state,transformation_version,notes)",
        f"  values ('wikidata','wikidata:P54:canonical_wnba_team_memberships_v1','https://query.wikidata.org/sparql + https://www.wikidata.org/w/api.php','GET',{sqls(cap['captured_at'])},200,{sqls(cap['raw_capture_sha256'])},'application/json',{cap['raw_bytes']},'hash_only','wbh_wikidata_wnba_membership_v1','Length-framed raw Wikidata responses were hashed and not retained; normalized CC0 P54 statements are committed in the manifest.') returning document_id into v_doc;",
        "  insert into public.wbh_ingestion_runs (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)",
        f"  values ('wikidata','wikidata_p54_wnba_membership','1.0.0','wbh_wikidata_wnba_membership_v1','ingest',{sqls(cap['captured_at'])},jsonb_build_object('dataset','wikidata_wnba_team_memberships_v1','claims',{len(claims)},'people_with_claims',{counts['people_with_claims']},'qualified_overlap_2024',{counts['qualified_overlap_2024']},'undated_claims',{counts['undated_claims']},'raw_capture_sha256',{sqls(cap['raw_capture_sha256'])})) returning run_id into v_run;",
    ]
    for batch in chunks(claims, 180):
        vals = []
        for c in batch:
            evidence = json.dumps(
                {
                    "source_property": "P54",
                    "source_team_label": c.get("source_team_label"),
                    "start_candidates": c.get("start_candidates", []),
                    "end_candidates": c.get("end_candidates", []),
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
            vals.append(
                "(" + ",".join(
                    [
                        sqls(c["membership_claim_id"]),
                        sqls(c["person_id"]),
                        sqls(c["source_team_qid"]),
                        sqls(c["team_id"]),
                        sqls(c["source_statement_id"]),
                        sqls(c["statement_rank"]),
                        sqls(c.get("started_on")),
                        sqls(c.get("started_on_precision")),
                        sqls(c.get("ended_on")),
                        sqls(c.get("ended_on_precision")),
                        sqls(evidence) + "::jsonb",
                        "v_doc",
                        "v_run",
                        "'wbh_wikidata_wnba_membership_v1'",
                    ]
                ) + ")"
            )
        out.append(
            "  insert into public.wbh_person_team_membership_claims "
            "(membership_claim_id,person_id,source_team_qid,team_id,source_statement_id,statement_rank,started_on,started_on_precision,ended_on,ended_on_precision,qualifier_evidence,source_document_id,ingestion_run_id,transformation_version) values\n    "
            + ",\n    ".join(vals)
            + ";"
        )
    by_team = json.dumps(counts["by_team"], separators=(",", ":"))
    out.append(
        "  update public.wbh_ingestion_runs set status='ok', counts=jsonb_build_object("
        + f"'claims',{len(claims)},'people_with_claims',{counts['people_with_claims']},'dated_claims',{counts['dated_claims']},'undated_claims',{counts['undated_claims']},'qualified_overlap_2024',{counts['qualified_overlap_2024']},'outside_2024',{counts['outside_2024']},'by_team',{sqls(by_team)}::jsonb) where run_id=v_run;"
    )
    out += ["end $seed$;", "commit;", ""]
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--identity-manifest", required=True)
    ap.add_argument("--team-crosswalk", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--migration", required=True)
    ap.add_argument("--min-claims", type=int, default=300)
    args = ap.parse_args()

    identity = json.loads(Path(args.identity_manifest).read_text("utf-8"))
    teams_doc = json.loads(Path(args.team_crosswalk).read_text("utf-8"))
    person_by_qid = {p["wikidata_qid"]: p["person_id"] for p in identity["people"]}
    team_by_qid = {t["qid"]: t["team_id"] for t in teams_doc["teams"]}
    person_qids = sorted(person_by_qid, key=lambda x: int(x[1:]))
    team_qids = sorted(team_by_qid, key=lambda x: int(x[1:]))

    raw_hash = hashlib.sha256()
    raw_size = [0]
    captured_at = utc_now()
    grouped = {}

    for batch in chunks(person_qids, 45):
        query = build_query(batch, team_qids)
        body = urllib.parse.urlencode({"query": query, "format": "json"}).encode()
        data = http_json(SPARQL, data=body, raw_hash=raw_hash, raw_size=raw_size)
        for row in data.get("results", {}).get("bindings", []):
            person_qid = qid(row["person"]["value"])
            team_qid = qid(row["team"]["value"])
            statement_id = row["statement"]["value"]
            if person_qid not in person_by_qid or team_qid not in team_by_qid:
                continue
            rec = grouped.setdefault(
                statement_id,
                {
                    "person_qid": person_qid,
                    "person_id": person_by_qid[person_qid],
                    "source_team_qid": team_qid,
                    "team_id": team_by_qid[team_qid],
                    "source_statement_id": statement_id,
                    "statement_rank": statement_rank(row["rank"]["value"]),
                    "starts": [],
                    "ends": [],
                },
            )
            if rec["person_qid"] != person_qid or rec["source_team_qid"] != team_qid:
                raise SystemExit(f"statement identity collision: {statement_id}")
            rec["starts"].append(parse_precision(row.get("start", {}).get("value"), row.get("startPrecision", {}).get("value")))
            rec["ends"].append(parse_precision(row.get("end", {}).get("value"), row.get("endPrecision", {}).get("value")))
        time.sleep(0.2)

    if len(grouped) < args.min_claims:
        raise SystemExit(f"only {len(grouped)} canonical-team P54 statements found; expected at least {args.min_claims}")

    labels = label_lookup(team_qids, raw_hash, raw_size)
    claims = []
    people_with_claims = set()
    by_team = {team_by_qid[q]: 0 for q in team_qids}
    dated = undated = overlap = outside = 0
    for statement_id in sorted(grouped):
        r = grouped[statement_id]
        start, start_candidates = one_temporal(r.pop("starts"))
        end, end_candidates = one_temporal(r.pop("ends"))
        r["membership_claim_id"] = make_claim_id(statement_id)
        r["source_team_label"] = labels.get(r["source_team_qid"])
        r["started_on"] = start["date"] if start else None
        r["started_on_precision"] = start["precision"] if start else None
        r["ended_on"] = end["date"] if end else None
        r["ended_on_precision"] = end["precision"] if end else None
        r["start_candidates"] = start_candidates
        r["end_candidates"] = end_candidates
        people_with_claims.add(r["person_id"])
        by_team[r["team_id"]] += 1
        if not start and not end:
            r["evidence_class_2024"] = "undated_claim"
            undated += 1
        else:
            dated += 1
            starts_before_end = start is None or r["started_on"] <= "2024-12-31"
            ends_after_start = end is None or r["ended_on"] >= "2024-01-01"
            if starts_before_end and ends_after_start:
                r["evidence_class_2024"] = "qualified_overlap"
                overlap += 1
            else:
                r["evidence_class_2024"] = "outside_2024"
                outside += 1
        claims.append(r)

    manifest = {
        "dataset": "wikidata_wnba_team_memberships_v1",
        "license": "CC0-1.0",
        "source": "Wikidata structured data only",
        "scope": "P54 team-membership statements for the 1,314-player identity spine where the team is one of the 12 canonical 2024 WNBA teams",
        "semantics": "Source-backed membership evidence only. It is not treated as a complete season roster and does not populate wbh_roster_stints.",
        "capture": {
            "captured_at": captured_at,
            "property": "P54",
            "qualifiers": ["P580", "P582"],
            "raw_capture_sha256": raw_hash.hexdigest(),
            "raw_bytes": raw_size[0],
            "raw_retained": False,
        },
        "totals": {
            "claims": len(claims),
            "people_with_claims": len(people_with_claims),
            "dated_claims": dated,
            "undated_claims": undated,
            "qualified_overlap_2024": overlap,
            "outside_2024": outside,
            "by_team": by_team,
        },
        "claims": claims,
    }

    manifest_path = Path(args.manifest)
    migration_path = Path(args.migration)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    migration_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    migration_path.write_text(generate_sql(manifest), encoding="utf-8")
    print(json.dumps(manifest["totals"], indent=2))
    print(json.dumps({"raw_capture_sha256": raw_hash.hexdigest(), "raw_bytes": raw_size[0], "manifest": str(manifest_path), "migration": str(migration_path)}, indent=2))


if __name__ == "__main__":
    main()
