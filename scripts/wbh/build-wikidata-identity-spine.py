#!/usr/bin/env python3
"""Build the rights-clean Wikidata WNBA identity spine and SQL migration."""
from __future__ import annotations

import argparse, datetime as dt, hashlib, json, re, secrets, time, unicodedata
import urllib.parse, urllib.request
from pathlib import Path

UA = "PropBetEdge-History/1.0 (support@proptechusa.ai; Wikidata CC0 identity spine)"
SPARQL = "https://query.wikidata.org/sparql"
API = "https://www.wikidata.org/w/api.php"
EN_LANGS = ("en", "mul", "en-us", "en-gb", "en-ca")
EXTERNAL_PROPS = (
    "P3588", "P4561", "P4790", "P3542", "P12338", "P8286",
    "P5815", "P3957", "P3527", "P4382", "P8548", "P3696",
)
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def utc_now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def http_json(url, *, data=None, attempts=5, raw_hash=None, raw_size=None):
    last = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as resp:
                raw = resp.read()
            if raw_hash is not None:
                raw_hash.update(len(raw).to_bytes(8, "big")); raw_hash.update(raw)
            if raw_size is not None:
                raw_size[0] += len(raw)
            return json.loads(raw)
        except Exception as exc:
            last = exc
            if attempt + 1 == attempts:
                raise
            time.sleep(min(2 ** attempt * 2, 30))
    raise last


def best_claims(claims, pid):
    vals = [c for c in claims.get(pid, []) if c.get("rank") != "deprecated" and c.get("mainsnak", {}).get("datavalue")]
    preferred = [c for c in vals if c.get("rank") == "preferred"]
    return preferred or vals


def claim_strings(claims, pid):
    out = []
    for c in best_claims(claims, pid):
        v = c["mainsnak"]["datavalue"]["value"]
        if isinstance(v, str): out.append(v)
    return sorted(set(out))


def claim_items(claims, pid):
    out = []
    for c in best_claims(claims, pid):
        v = c["mainsnak"]["datavalue"]["value"]
        if isinstance(v, dict) and "id" in v: out.append(v["id"])
    return sorted(set(out))


def claim_time(claims, pid):
    rows = []
    for c in best_claims(claims, pid):
        v = c["mainsnak"]["datavalue"]["value"]
        if isinstance(v, dict) and "time" in v: rows.append((v["time"], int(v.get("precision", 0))))
    rows = sorted(set(rows))
    if len(rows) != 1: return None, None, rows
    raw, precision = rows[0]
    m = re.match(r"^\+?(\d{4,})-(\d{2})-(\d{2})T", raw)
    if not m: return None, None, rows
    year, month, day = map(int, m.groups())
    if precision >= 11: return f"{year:04d}-{month:02d}-{day:02d}", "day", rows
    if precision == 10: return f"{year:04d}-{month:02d}-01", "month", rows
    if precision == 9: return f"{year:04d}-01-01", "year", rows
    return None, None, rows


def norm_alias(s):
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.casefold().replace("-", " ")
    s = re.sub(r"[^a-z0-9 ]+", "", s)
    return re.sub(r"\s+", " ", s).strip()


def random_person_id():
    n = secrets.randbits(60); chars = []
    for _ in range(12): chars.append(CROCKFORD[n & 31]); n >>= 5
    return "gp_" + "".join(reversed(chars))


def sqls(v):
    if v is None: return "null"
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def chunks(items, n=200):
    for i in range(0, len(items), n): yield items[i:i+n]


def generate_sql(manifest):
    people = manifest["people"]; captured = manifest["capture"]["captured_at"]
    raw_sha = manifest["capture"]["raw_capture_sha256"]; raw_bytes = manifest["capture"]["raw_bytes"]
    count = len(people); alias_rows = []; id_rows = []; person_rows = []
    for p in people:
        person_rows.append((p["person_id"], p["primary_full_name"], p.get("birth_date"), p.get("birth_date_precision"), p.get("sport_country_code")))
        seen = set()
        for name in [p["primary_full_name"], *p.get("aliases", [])]:
            n = norm_alias(name)
            if not n or n in seen: continue
            seen.add(n); alias_rows.append((p["person_id"], name, n, "display"))
        id_rows.append((p["person_id"], p["wikidata_qid"], "wikidata:QID", "T1", 1.0, "wikidata_entity"))
        id_rows.append((p["person_id"], p["wnba_com_id"], "wikidata:P3588", "T1", 1.0, "wikidata_P3588_claim"))

    out = [
        "-- PropBetEdge — Women's Basketball History",
        "-- Wikidata CC0 WNBA identity spine v1. No Wikipedia prose, ESPN data, WNBA payloads, or restricted provider pages.",
        "begin;\n",
        "do $seed$",
        "declare\n  v_doc uuid;\n  v_run uuid;\n  v_existing integer;\nbegin",
        "  perform public.wbh_assert_ingestible('wikidata');",
        "  select count(*) into v_existing from public.wbh_ingestion_runs where scope->>'dataset'='wikidata_wnba_identity_v1' and status='ok';",
        "  if v_existing > 0 then",
        f"    if (select count(*) from public.wbh_persons) >= {count} and (select count(*) from public.wbh_entity_source_ids where entity_type='person' and source_id='wikidata' and id_space='wikidata:P3588' and status='linked') >= {count} then return; end if;",
        "    raise exception 'wbh: Wikidata identity spine run exists but canonical counts are incomplete; refusing to guess' using errcode='P0001';",
        "  end if;",
        "  if exists (select 1 from public.wbh_persons) then raise exception 'wbh: persons already exist before first identity-spine load; refusing to merge implicitly' using errcode='P0001'; end if;",
        "  insert into public.wbh_source_documents (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,content_type,byte_size,storage_state,transformation_version,notes)",
        f"  values ('wikidata','wikidata:P3588:wnba_identity_snapshot_v1','https://query.wikidata.org/sparql + https://www.wikidata.org/w/api.php','GET',{sqls(captured)},200,{sqls(raw_sha)},'application/json',{raw_bytes},'hash_only','wbh_wikidata_identity_v1','Exact raw response bytes were length-framed, hashed, and not retained; normalized CC0 claims are committed in the manifest.') returning document_id into v_doc;",
        "  insert into public.wbh_ingestion_runs (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)",
        f"  values ('wikidata','wikidata_p3588_snapshot','1.0.0','wbh_wikidata_identity_v1','ingest',{sqls(captured)},jsonb_build_object('dataset','wikidata_wnba_identity_v1','people',{count},'raw_capture_sha256',{sqls(raw_sha)})) returning run_id into v_run;\n",
    ]
    for chunk in chunks(person_rows, 200):
        vals = [f"({sqls(pid)},{sqls(name)},{sqls(dob)},{sqls(prec)},{sqls(country)},v_doc,v_run,'wbh_wikidata_identity_v1')" for pid,name,dob,prec,country in chunk]
        out.append("  insert into public.wbh_persons (person_id,primary_full_name,birth_date,birth_date_precision,sport_country_code,source_document_id,ingestion_run_id,transformation_version) values\n    " + ",\n    ".join(vals) + ";\n")
    for chunk in chunks(alias_rows, 250):
        vals = [f"({sqls(pid)},{sqls(alias)},{sqls(norm)},{sqls(kind)},v_doc,v_run,'wbh_wikidata_identity_v1')" for pid,alias,norm,kind in chunk]
        out.append("  insert into public.wbh_person_aliases (person_id,alias,alias_norm,alias_type,source_document_id,ingestion_run_id,transformation_version) values\n    " + ",\n    ".join(vals) + ";\n")
    for chunk in chunks(id_rows, 250):
        vals = []
        for pid,ext,space,tier,conf,method in chunk:
            evidence = json.dumps({"source":"Wikidata structured data","property":space.split(":",1)[1]}, separators=(",",":"))
            vals.append(f"('person',{sqls(pid)},'wikidata',{sqls(ext)},null,{sqls(space)},'linked',{sqls(tier)},{conf},{sqls(method)},{sqls(evidence)}::jsonb,null,null,v_doc,v_run,'wbh_wikidata_identity_v1')")
        out.append("  insert into public.wbh_entity_source_ids (entity_type,entity_id,source_id,external_id,external_url,id_space,status,tier,confidence,method,evidence,reviewed_by,reviewed_at,source_document_id,ingestion_run_id,transformation_version) values\n    " + ",\n    ".join(vals) + ";\n")
    out.append("  update public.wbh_ingestion_runs set status='ok', counts=jsonb_build_object(" + f"'persons',{count},'aliases',{len(alias_rows)},'linked_source_ids',{len(id_rows)},'dob_day',{manifest['totals']['dob_day']},'dob_partial',{manifest['totals']['dob_partial']},'dob_absent',{manifest['totals']['dob_absent']},'sport_country_iso3',{manifest['totals']['sport_country_iso3']}) where run_id=v_run;")
    out.append("end $seed$;\n\ncommit;\n")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--manifest", required=True); ap.add_argument("--migration", required=True); ap.add_argument("--min-count", type=int, default=1300); args = ap.parse_args()
    manifest_path = Path(args.manifest); migration_path = Path(args.migration)
    manifest_path.parent.mkdir(parents=True, exist_ok=True); migration_path.parent.mkdir(parents=True, exist_ok=True)
    existing_ids = {}
    if manifest_path.exists():
        try:
            old = json.loads(manifest_path.read_text("utf-8")); existing_ids = {p["wikidata_qid"]:p["person_id"] for p in old.get("people", [])}
        except Exception: existing_ids = {}

    raw_hash = hashlib.sha256(); raw_size = [0]; captured_at = utc_now()
    query = "SELECT ?item ?wnba WHERE { ?item wdt:P3588 ?wnba . ?item wdt:P31 wd:Q5 . } ORDER BY ?item"
    body = urllib.parse.urlencode({"query":query,"format":"json"}).encode()
    data = http_json(SPARQL, data=body, raw_hash=raw_hash, raw_size=raw_size)
    qid_to_wnba = {}; wnba_to_qid = {}
    for r in data["results"]["bindings"]:
        qid = r["item"]["value"].rsplit("/",1)[-1]; wid = r["wnba"]["value"]
        qid_to_wnba.setdefault(qid,set()).add(wid)
        if wid in wnba_to_qid and wnba_to_qid[wid] != qid: raise SystemExit(f"duplicate P3588 {wid}: {wnba_to_qid[wid]} and {qid}")
        wnba_to_qid[wid] = qid
    qids = sorted(qid_to_wnba, key=lambda x:int(x[1:]) if x[1:].isdigit() else x)
    if len(qids) < args.min_count: raise SystemExit(f"Wikidata returned only {len(qids)} WNBA identities; expected at least {args.min_count}")
    if any(len(qid_to_wnba[q]) != 1 for q in qids): raise SystemExit("ambiguous P3588 claim(s)")

    entities = {}
    for i in range(0,len(qids),50):
        batch=qids[i:i+50]
        url=API+"?"+urllib.parse.urlencode({"action":"wbgetentities","ids":"|".join(batch),"props":"labels|aliases|claims","languages":"|".join(EN_LANGS),"languagefallback":"1","format":"json","formatversion":"2"})
        d=http_json(url,raw_hash=raw_hash,raw_size=raw_size); entities.update(d.get("entities",{})); time.sleep(0.2)

    country_qids=set()
    for qid in qids: country_qids.update(claim_items(entities.get(qid,{}).get("claims",{}),"P1532"))
    country_iso={}; cq=sorted(country_qids,key=lambda x:int(x[1:]) if x[1:].isdigit() else x)
    for i in range(0,len(cq),50):
        batch=cq[i:i+50]
        url=API+"?"+urllib.parse.urlencode({"action":"wbgetentities","ids":"|".join(batch),"props":"claims","format":"json","formatversion":"2"})
        d=http_json(url,raw_hash=raw_hash,raw_size=raw_size)
        for cid,e in d.get("entities",{}).items():
            vals=claim_strings(e.get("claims",{}),"P298")
            if len(vals)==1 and re.fullmatch(r"[A-Z]{3}",vals[0]): country_iso[cid]=vals[0]
        time.sleep(0.2)

    used_ids=set(existing_ids.values()); people=[]; totals={"dob_day":0,"dob_partial":0,"dob_absent":0,"sport_country_iso3":0}
    for qid in qids:
        e=entities.get(qid)
        if not e or e.get("missing"): raise SystemExit(f"missing entity payload for {qid}")
        claims=e.get("claims",{}); labels=e.get("labels",{}); aliases=e.get("aliases",{}); primary=None
        for lang in EN_LANGS:
            if lang in labels and labels[lang].get("value"): primary=labels[lang]["value"]; break
        if not primary: raise SystemExit(f"no English/multilingual label for {qid}")
        names=[]
        for lang in EN_LANGS:
            if lang in labels and labels[lang].get("value"): names.append(labels[lang]["value"])
            for a in aliases.get(lang,[]):
                if a.get("value"): names.append(a["value"])
        alt=[]; seen={norm_alias(primary)}
        for name in names:
            n=norm_alias(name)
            if not n or n in seen: continue
            seen.add(n); alt.append(name)
            if len(alt)>=20: break
        dob,precision,dob_candidates=claim_time(claims,"P569")
        if precision=="day": totals["dob_day"]+=1
        elif precision in ("month","year"): totals["dob_partial"]+=1
        else: totals["dob_absent"]+=1
        sport_items=claim_items(claims,"P1532"); sport_codes=sorted({country_iso[c] for c in sport_items if c in country_iso}); sport_code=sport_codes[0] if len(sport_codes)==1 else None
        if sport_code: totals["sport_country_iso3"]+=1
        pid=existing_ids.get(qid)
        if not pid:
            while True:
                pid=random_person_id()
                if pid not in used_ids: used_ids.add(pid); break
        external={prop:claim_strings(claims,prop) for prop in EXTERNAL_PROPS}; wid=next(iter(qid_to_wnba[qid]))
        if wid not in external.get("P3588",[]): raise SystemExit(f"{qid} lost anchor P3588 {wid}")
        people.append({"person_id":pid,"wikidata_qid":qid,"wnba_com_id":wid,"primary_full_name":primary,"aliases":alt,"birth_date":dob,"birth_date_precision":precision,"birth_date_candidates":dob_candidates,"sport_country_code":sport_code,"sport_country_items":sport_items,"external_ids":external})

    manifest={"dataset":"wikidata_wnba_identity_v1","license":"CC0-1.0","source":"Wikidata structured data only","scope":"All human Wikidata items carrying P3588 (WNBA.com player ID) at capture time","capture":{"captured_at":captured_at,"query":query,"user_agent":UA,"raw_capture_sha256":raw_hash.hexdigest(),"raw_bytes":raw_size[0],"raw_retained":False},"totals":{"people":len(people),**totals},"external_id_properties":list(EXTERNAL_PROPS),"people":people}
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    migration_path.write_text(generate_sql(manifest),encoding="utf-8")
    print(json.dumps({"people":len(people),**totals,"raw_capture_sha256":raw_hash.hexdigest(),"manifest":str(manifest_path),"migration":str(migration_path)},indent=2))


if __name__ == "__main__": main()
