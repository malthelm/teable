#!/usr/bin/env python3
"""Load a saved Songstats snapshot into a dedicated Teable base via its public API.

The default command is an offline plan. Real data and credentials stay outside git.
This adapter uses the existing packages/openapi contracts; it does not modify v2 core.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SOURCES = ["Profiles", "Tracks", "Radio Stations", "Source Links", "Current Metrics",
           "Daily History", "Track Stations", "Radio Plays", "Activities",
           "Detailed Records", "Raw Responses", "Import Log"]
DATE_FIELDS = {"Release_Date", "Date", "Played_At_UTC", "First_Play", "Last_Play", "Fetched_At"}
PRIMARY = {"Artists": "Name", "Labels": "Name", "Platforms": "Name", "Tracks": "Track",
           "Radio Stations": "Station", "Radio Plays": "Track", "Track Stations": "Track",
           "Activities": "Title", "Current Metrics": "Metric", "Raw Responses": "File",
           "Import Log": "File", "Detailed Records": "Name", "Daily History": "Track",
           "Source Links": "Track"}


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def date_value(value):
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        if len(value) != 10:
            raise ValueError("Timestamp has no timezone")
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def infer_fields(name, rows):
    columns = {"Record_Key"} | {key for row in rows for key in row}
    primary = PRIMARY.get(name, "Record_Key")
    if primary not in columns:
        primary = "Record_Key"
    fields = []
    for key in sorted(columns, key=lambda k: (k != primary, k != "Record_Key", k)):
        values = [row[key] for row in rows if row.get(key) not in (None, "")]
        kind = "singleLineText"
        if values and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values):
            kind = "number"
        elif key.endswith("_JSON"):
            kind = "longText"
        elif key in DATE_FIELDS and values and all(isinstance(v, str) for v in values):
            try:
                for value in values:
                    date_value(value)
                kind = "date"
            except ValueError:
                pass  # Preserve non-date provider strings as text.
        field = {"name": key, "type": kind}
        if key == primary:
            field["isPrimary"] = True
        if kind == "date":
            field["options"] = {"formatting": {"date": "YYYY-MM-DD", "time": "HH:mm", "timeZone": "UTC"}}
        fields.append(field)
    return fields


def build_plan(snapshot):
    snapshot = Path(snapshot)
    manifest = json.loads((snapshot / "manifest.json").read_text())
    digest = hashlib.sha256()
    digest.update((snapshot / "manifest.json").read_bytes())
    source = {}
    for name in SOURCES:
        raw = (snapshot / "normalized" / (name + ".jsonl")).read_bytes()
        digest.update(name.encode() + b"\0" + raw)
        source[name] = [json.loads(line) for line in raw.splitlines() if line.strip()]
        if len(source[name]) != manifest["counts"][name]:
            raise ValueError("Snapshot count differs from manifest: " + name)
    if any(row["Profile_Type"] not in ("artist", "artist reference", "label") for row in source["Profiles"]):
        raise ValueError("Unknown profile type")
    data = {
        "Artists": [r for r in source["Profiles"] if r["Profile_Type"] in ("artist", "artist reference")],
        "Labels": [r for r in source["Profiles"] if r["Profile_Type"] == "label"],
        "Platforms": [{"Record_Key": key, "Name": key} for key in sorted({
            r["Source"] for rows in source.values() for r in rows if r.get("Source")
        })],
        **{name: source[name] for name in SOURCES if name != "Profiles"},
    }
    tables = {}
    for name, rows in data.items():
        keys = [r.get("Record_Key") for r in rows]
        if any(not isinstance(k, str) or not k for k in keys) or len(keys) != len(set(keys)):
            raise ValueError("Missing or duplicate Record_Key: " + name)
        fields = infer_fields(name, rows)
        kinds = {f["name"]: f["type"] for f in fields}
        values = []
        for row in rows:
            scalar = {}
            for key, value in row.items():
                if value is None or value == "":
                    scalar[key] = None
                elif kinds[key] == "date":
                    scalar[key] = date_value(value)
                elif kinds[key] == "number" or isinstance(value, str):
                    scalar[key] = value
                else:
                    scalar[key] = canonical(value)
            values.append({"fields": scalar, "links": {}})
        tables[name] = {"name": name, "fields": fields, "links": {}, "rows": values}
    keysets = {name: {r["fields"]["Record_Key"] for r in table["rows"]} for name, table in tables.items()}

    def link(table, row, field, target, keys, many=False, bidirectional=False):
        if any(key not in keysets[target] for key in keys):
            raise ValueError(f"Orphan relationship: {table}.{field}")
        tables[table]["links"][field] = {"target": target, "many": many, "bidirectional": bidirectional}
        row["links"][field] = keys

    for name, table in tables.items():
        for original, row in zip(data[name], table["rows"]):
            if name == "Tracks":
                artists = json.loads(original["Metadata_JSON"]).get("artists", [])
                keys = list(dict.fromkeys(a["songstats_artist_id"] for a in artists))
                link(name, row, "Artist records", "Artists", keys, many=True, bidirectional=True)
            elif original.get("Track_ID"):
                link(name, row, "Track record", "Tracks", [original["Track_ID"]], bidirectional=name in ("Radio Plays", "Track Stations"))
            elif original.get("Entity_Type") in ("track", "label", "artist"):
                entity = original["Entity_Type"]
                target = {"track": "Tracks", "label": "Labels", "artist": "Artists"}[entity]
                link(name, row, entity.title() + " record", target, [original["Entity_ID"]])
            if name != "Radio Stations" and original.get("Station_ID"):
                link(name, row, "Station record", "Radio Stations", [original["Station_ID"]], bidirectional=name in ("Radio Plays", "Track Stations"))
            if original.get("Source"):
                link(name, row, "Platform record", "Platforms", [original["Source"]])
    return {"version": 1, "digest": digest.hexdigest(), "scope": manifest["scope"],
            "created_at": manifest["created_at"], "notes": manifest.get("notes", []), "tables": tables}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Refusing API redirect; use the exact Teable origin")


class TeableAPI:
    def __init__(self, origin, token):
        parsed = urllib.parse.urlsplit(origin)
        if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Invalid Teable origin")
        if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
            raise ValueError("HTTP credentials are only allowed over loopback")
        if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise ValueError("Use an origin without a path, query, or fragment")
        if not token:
            raise ValueError("Set TEABLE_TOKEN in the process environment")
        self.origin, self.token = origin.rstrip("/"), token
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, method, path, body=None):
        payload = canonical(body).encode() if body is not None else None
        request = urllib.request.Request(self.origin + "/api" + path, data=payload, method=method,
                    headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        try:
            with self.opener.open(request, timeout=120) as response:
                content = response.read()
                return json.loads(content) if content else None
        except urllib.error.HTTPError as error:
            # Provider errors may echo values or credentials; keep them out of logs.
            raise RuntimeError(f"Teable {method} {path.split('?')[0]} returned HTTP {error.code}") from None

    def records(self, table_id):
        result, skip = [], 0
        while True:
            page = self.request("GET", f"/table/{table_id}/record?fieldKeyType=name&take=1000&skip={skip}")["records"]
            result.extend(page)
            if len(page) < 1000:
                return result
            skip += len(page)


def save_state(path, state):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with open(temporary, "w", opener=lambda p, flags: os.open(p, flags, 0o600)) as file:
        file.write(canonical(state) + "\n")
    os.replace(temporary, path)


def field_matches(actual, expected):
    if actual.get("type") != expected["type"] or actual.get("isComputed"):
        return False
    if expected.get("isPrimary") and not actual.get("isPrimary"):
        return False
    if expected["type"] == "date":
        return actual.get("options", {}).get("formatting") == expected["options"]["formatting"]
    return True


def comparable(value, kind):
    # Teable trims single-line text on write; raw provider JSON remains untouched.
    if kind == "singleLineText" and isinstance(value, str):
        value = value.strip()
    if value in (None, ""):
        return None
    if kind == "date":
        return date_value(value)
    if kind == "link":
        return sorted(v["id"] for v in (value if isinstance(value, list) else [value]))
    return value


def apply_plan(plan, api, base_id, state_path, pressure=lambda: None, batch_size=100):
    if not 1 <= batch_size <= 500:
        raise ValueError("Batch size must be between 1 and 500")
    if not base_id.startswith("bse") or not base_id.isalnum():
        raise ValueError("Invalid Teable base ID")
    state_path = Path(state_path)
    marker = "True Nature Songstats import " + plan["digest"]
    identity = {"origin": api.origin, "base_id": base_id, "snapshot_digest": plan["digest"]}
    if state_path.exists():
        state = json.loads(state_path.read_text())
        if any(state.get(k) != v for k, v in identity.items()):
            raise ValueError("Checkpoint belongs to a different origin, base, or snapshot")
    else:
        if api.request("GET", f"/base/{base_id}/table"):
            raise ValueError("First import requires a dedicated empty base")
        state = {**identity, "tables": {}, "verified": {}}
        save_state(state_path, state)
    listed = api.request("GET", f"/base/{base_id}/table")
    if any(t["name"] not in plan["tables"] or (
        t.get("description") != marker and not (
            not t.get("description") and state["tables"].get(t["name"]) == t["id"]
        )) for t in listed):
        raise ValueError("Destination contains unrelated tables")
    if len({t["name"] for t in listed}) != len(listed):
        raise ValueError("Duplicate destination table names")
    named = {t["name"]: t for t in listed}
    for name, table in plan["tables"].items():
        pressure()
        if name not in named:
            named[name] = api.request("POST", f"/base/{base_id}/table/", {
                "name": name, "description": marker, "fields": table["fields"],
                "views": [{"name": "All records", "type": "grid"}], "records": [], "fieldKeyType": "name"})
        tid = named[name]["id"]
        if name in state["tables"] and state["tables"][name] != tid:
            raise ValueError("Destination table ID changed")
        actual = {f["name"]: f for f in api.request("GET", f"/table/{tid}/field")}
        for field in table["fields"]:
            if field["name"] not in actual or not field_matches(actual[field["name"]], field):
                raise ValueError("Destination field differs: " + name + "." + field["name"])
        state["tables"][name] = tid
        save_state(state_path, state)
        # Some CE create paths omit description despite accepting it in the contract.
        # Persist the returned ID first; only our checkpointed table may be repaired.
        if named[name].get("description") != marker:
            pressure()
            api.request("PUT", f"/base/{base_id}/table/{tid}/description", {"description": marker})
            confirmed = api.request("GET", f"/base/{base_id}/table/{tid}")
            if confirmed.get("description") != marker:
                raise ValueError("Destination did not retain the import marker: " + name)
    for name, table in plan["tables"].items():
        tid = state["tables"][name]
        actual = {f["name"]: f for f in api.request("GET", f"/table/{tid}/field")}
        for field, spec in table["links"].items():
            options = {"foreignTableId": state["tables"][spec["target"]],
                       "relationship": "manyMany" if spec["many"] else "manyOne",
                       "isOneWay": not spec["bidirectional"]}
            if field not in actual:
                pressure()
                api.request("POST", f"/table/{tid}/field", {"name": field, "type": "link", "options": options})
            elif actual[field]["type"] != "link" or any(actual[field].get("options", {}).get(k) != v for k, v in options.items()):
                raise ValueError("Destination relationship differs: " + name + "." + field)
    ids = {}
    report = {}
    for name, table in plan["tables"].items():
        pressure()
        tid = state["tables"][name]
        kinds = {f["name"]: f["type"] for f in table["fields"]}
        kinds.update({f: "link" for f in table["links"]})
        expected = {}
        for row in table["rows"]:
            fields = {key: None for key in kinds}
            fields.update(row["fields"])
            for field, keys in row["links"].items():
                spec = table["links"][field]
                resolved = [{"id": ids[spec["target"]][key]} for key in keys]
                fields[field] = resolved if spec["many"] and resolved else resolved[0] if resolved else None
            expected[fields["Record_Key"]] = fields

        def read_and_check():
            actual = api.records(tid)
            bykey = {r["fields"].get("Record_Key"): r for r in actual}
            if len(bykey) != len(actual) or set(bykey) - set(expected):
                raise ValueError("Duplicate or unexpected destination records: " + name)
            for key, record in bykey.items():
                if any(comparable(record["fields"].get(k), kinds[k]) != comparable(v, kinds[k]) for k, v in expected[key].items()):
                    raise ValueError("Destination values differ; refusing overwrite: " + name)
            return bykey

        existing = read_and_check()
        pending = [v for key, v in expected.items() if key not in existing]
        # Both a row limit and payload-byte limit keep raw JSON chunks bounded.
        batch, size = [], 0

        def flush():
            nonlocal batch, size
            if batch:
                pressure()
                api.request("POST", f"/table/{tid}/record", {"fieldKeyType": "name", "typecast": False,
                            "records": [{"fields": v} for v in batch]})
                batch, size = [], 0
                time.sleep(0.1)

        for fields in pending:
            length = len(canonical(fields).encode())
            if batch and (len(batch) >= batch_size or size + length > 350000):
                flush()
            batch.append(fields)
            size += length
        flush()
        verified = read_and_check()
        if len(verified) != len(expected):
            raise ValueError("Readback count mismatch: " + name)
        ids[name] = {k: r["id"] for k, r in verified.items()}
        report[name] = len(verified)
        state["verified"][name] = len(verified)
        save_state(state_path, state)
        print(f"Verified {name}: {len(verified)}", flush=True)
    state["complete"] = True
    save_state(state_path, state)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path, help="Directory containing manifest.json and normalized/")
    parser.add_argument("--apply", action="store_true", help="Create and populate tables in a dedicated empty base")
    parser.add_argument("--url", help="Exact Teable origin")
    parser.add_argument("--base", help="Dedicated empty base ID")
    parser.add_argument("--state", type=Path, default=Path(".true-nature/import-state.json"))
    parser.add_argument("--resource-check", help="Optional resource-admission executable (no shell arguments)")
    parser.add_argument("--batch-size", type=int, default=100, help="Records per request, 1–500 (byte cap still applies)")
    parser.add_argument("--schema", type=Path, help="Write schema only; does not include record values")
    args = parser.parse_args()
    plan = build_plan(args.snapshot)
    if args.schema:
        args.schema.write_text(json.dumps({n: {"fields": t["fields"], "links": t["links"]} for n, t in plan["tables"].items()}, indent=2) + "\n")
    summary = {"snapshot_digest": plan["digest"], "scope": plan["scope"],
               "tables": {n: len(t["rows"]) for n, t in plan["tables"].items()},
               "relationship_fields": sum(len(t["links"]) for t in plan["tables"].values())}
    if not args.apply:
        print(json.dumps(summary, indent=2))
        return
    if not args.url or not args.base:
        parser.error("--apply requires --url and --base")
    api = TeableAPI(args.url, os.environ.get("TEABLE_TOKEN"))

    def pressure():
        if args.resource_check:
            result = subprocess.run([args.resource_check], capture_output=True, text=True, check=False)
            if result.returncode not in (0, 10) or "state=red" in result.stdout:
                print("Import paused by resource guard: " + result.stdout.strip(), file=sys.stderr)
                raise SystemExit(75)

    args.state.parent.mkdir(parents=True, exist_ok=True)
    with args.state.with_suffix(".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        apply_plan(plan, api, args.base, args.state, pressure, args.batch_size)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError) as exc:
        print(f"Import stopped: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
