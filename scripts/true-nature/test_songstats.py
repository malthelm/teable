"""Importer recovery and data-integrity tests; all records are synthetic."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import urlsplit

import songstats as s


def snapshot(path):
    data = {name: [] for name in s.SOURCES}
    data["Profiles"] = [
        {"Record_Key": "artist-1", "Profile_ID": "artist-1", "Profile_Type": "artist reference", "Name": "Example Artist"},
        {"Record_Key": "label-1", "Profile_ID": "label-1", "Profile_Type": "label", "Name": "Example Label"},
    ]
    data["Tracks"] = [{"Record_Key": "track-1", "Track_ID": "track-1", "Track": "Example Track",
        "Release_Date": "2026-01-01", "Metadata_JSON": json.dumps({"artists": [{"songstats_artist_id": "artist-1"}]})}]
    data["Radio Stations"] = [{"Record_Key": "station-1", "Station_ID": "station-1", "Station": "Example Radio"}]
    data["Radio Plays"] = [{"Record_Key": "play-1", "Track_ID": "track-1", "Station_ID": "station-1",
        "Track": "Example Track", "Played_At_UTC": "2026-01-03T05:00:00+01:00", "Country": "", "Timestamp": 1767412800}]
    data["Daily History"] = [
        {"Record_Key": "history-1", "Entity_ID": "track-1", "Entity_Type": "track", "Track": "Example Track",
         "Date": "2026-01-03", "Source": "example", "streams_total": 0},
        {"Record_Key": "history-2", "Entity_ID": "label-1", "Entity_Type": "label", "Track": "Example Label",
         "Date": "2026-01-03", "Source": "example", "streams_total": None},
    ]
    write_snapshot(path, data)
    return data


def write_snapshot(path, data):
    (path / "normalized").mkdir(exist_ok=True)
    for name, rows in data.items():
        (path / "normalized" / (name + ".jsonl")).write_text("".join(json.dumps(row) + "\n" for row in rows))
    (path / "manifest.json").write_text(json.dumps({"counts": {n: len(r) for n, r in data.items()},
        "scope": "Synthetic test only", "created_at": "2026-01-04T00:00:00Z"}))


class FakeAPI:
    origin = "http://127.0.0.1:39999"

    def __init__(self):
        self.tables = {}
        self.rows = {}
        self.writes = 0
        self.interrupt_records_once = False
        self.interrupt_table_once = False
        self.omit_create_description = False

    def request(self, method, path, body=None):
        bits = urlsplit(path).path.strip("/").split("/")
        if bits[0] == "base":
            if len(bits) == 5 and method == "PUT":
                self.writes += 1
                self.tables[bits[3]]["description"] = body["description"]
                return None
            if len(bits) == 4 and method == "GET":
                return self.tables[bits[3]]
            if method == "GET":
                return list(self.tables.values())
            self.writes += 1
            tid = f"tbl{len(self.tables) + 1}"
            table = {"id": tid, **copy.deepcopy(body)}
            if self.omit_create_description:
                table.pop("description", None)
            table["fields"] = [{"id": f"fld{i}", **f} for i, f in enumerate(table["fields"])]
            self.tables[tid] = table
            self.rows[tid] = []
            if self.interrupt_table_once:
                self.interrupt_table_once = False
                raise RuntimeError("Connection lost after table commit")
            return table
        tid, resource = bits[1:3]
        if resource == "field":
            if method == "GET":
                return self.tables[tid]["fields"]
            self.writes += 1
            field = {"id": f"fld{len(self.tables[tid]['fields'])}", **copy.deepcopy(body)}
            self.tables[tid]["fields"].append(field)
            return field
        if resource == "record" and method == "POST":
            self.writes += 1
            added = []
            for row in body["records"]:
                record = {"id": f"rec{tid}{len(self.rows[tid])}", **copy.deepcopy(row)}
                self.rows[tid].append(record)
                added.append(record)
            if self.interrupt_records_once:
                self.interrupt_records_once = False
                raise RuntimeError("Connection lost after record commit")
            return {"records": added}
        raise AssertionError((method, path))

    def records(self, table_id):
        return copy.deepcopy(self.rows[table_id])


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.data = snapshot(self.path)
        self.plan = s.build_plan(self.path)
        self.api = FakeAPI()
        self.state = self.path / "state.json"

    def apply(self):
        return s.apply_plan(self.plan, self.api, "bseExample", self.state)

    def test_links_resolve_by_ids_and_preserve_scope_and_zero(self):
        result = self.apply()
        self.assertEqual(result["Radio Plays"], 1)
        tables = {t["name"]: t["id"] for t in self.api.tables.values()}
        radio = self.api.rows[tables["Radio Plays"]][0]["fields"]
        track_id = self.api.rows[tables["Tracks"]][0]["id"]
        self.assertEqual(radio["Track record"], {"id": track_id})
        self.assertEqual(radio["Played_At_UTC"], "2026-01-03T04:00:00.000Z")
        history = self.api.rows[tables["Daily History"]]
        self.assertEqual(history[0]["fields"]["streams_total"], 0)
        self.assertIsNone(history[1]["fields"]["streams_total"])
        self.assertIsNone(history[1]["fields"]["Track record"])
        self.assertIsNotNone(history[1]["fields"]["Label record"])

    def test_second_run_has_no_writes(self):
        self.apply()
        writes = self.api.writes
        self.apply()
        self.assertEqual(self.api.writes, writes)

    def test_resume_accepts_server_trimmed_text_but_preserves_raw_json(self):
        self.plan["tables"]["Artists"]["rows"][0]["fields"]["Name"] = " Example Artist  "
        self.apply()
        tid = next(t["id"] for t in self.api.tables.values() if t["name"] == "Artists")
        self.api.rows[tid][0]["fields"]["Name"] = "Example Artist"
        writes = self.api.writes
        self.apply()
        self.assertEqual(self.api.writes, writes)
        self.assertEqual(s.comparable("  ", "singleLineText"), None)
        self.assertEqual(s.comparable("  raw  ", "longText"), "  raw  ")

    def test_explicitly_sets_marker_when_create_omits_description(self):
        self.api.omit_create_description = True
        self.apply()
        self.assertTrue(all(t.get("description", "").endswith(self.plan["digest"])
                            for t in self.api.tables.values()))
        writes = self.api.writes
        self.apply()
        self.assertEqual(self.api.writes, writes)

    def test_resume_after_ambiguous_record_commit(self):
        self.api.interrupt_records_once = True
        with self.assertRaisesRegex(RuntimeError, "after record commit"):
            self.apply()
        self.apply()
        artists = next(t for t in self.api.tables.values() if t["name"] == "Artists")
        self.assertEqual(len(self.api.rows[artists["id"]]), 1)

    def test_resume_after_ambiguous_table_commit(self):
        self.api.interrupt_table_once = True
        with self.assertRaisesRegex(RuntimeError, "after table commit"):
            self.apply()
        self.apply()
        self.assertEqual(len(self.api.tables), len(self.plan["tables"]))

    def test_refuses_existing_base_without_checkpoint(self):
        self.api.tables["tblOld"] = {"id": "tblOld", "name": "Existing"}
        with self.assertRaisesRegex(ValueError, "empty base"):
            self.apply()
        self.assertEqual(self.api.writes, 0)

    def test_refuses_cross_origin_checkpoint(self):
        self.apply()
        self.api.origin = "https://different.example"
        writes = self.api.writes
        with self.assertRaisesRegex(ValueError, "different origin"):
            self.apply()
        self.assertEqual(self.api.writes, writes)

    def test_refuses_changed_destination_record(self):
        self.apply()
        tid = next(t["id"] for t in self.api.tables.values() if t["name"] == "Artists")
        self.api.rows[tid][0]["fields"]["Name"] = "Human edit"
        with self.assertRaisesRegex(ValueError, "refusing overwrite"):
            self.apply()
        self.assertEqual(self.api.rows[tid][0]["fields"]["Name"], "Human edit")

    def test_rejects_duplicate_keys_and_orphan_links(self):
        self.data["Tracks"].append(copy.deepcopy(self.data["Tracks"][0]))
        write_snapshot(self.path, self.data)
        with self.assertRaisesRegex(ValueError, "duplicate Record_Key"):
            s.build_plan(self.path)
        self.data["Tracks"].pop()
        self.data["Radio Plays"][0]["Track_ID"] = "unknown"
        write_snapshot(self.path, self.data)
        with self.assertRaisesRegex(ValueError, "Orphan relationship"):
            s.build_plan(self.path)

    def test_rejects_unsafe_origins_and_redirects(self):
        for origin in ["http://public.example", "https://user:pass@example.com", "https://example.com/path"]:
            with self.assertRaises(ValueError):
                s.TeableAPI(origin, "synthetic-token")
        with self.assertRaises(RuntimeError):
            s.NoRedirect().redirect_request(None, None, 302, None, None, "https://elsewhere.example")

    def test_pagination_reads_past_one_thousand(self):
        api = s.TeableAPI("http://127.0.0.1", "synthetic-token")
        paths = []
        def request(method, path):
            paths.append(path)
            return {"records": [{}] * (1000 if len(paths) == 1 else 7)}
        api.request = request
        self.assertEqual(len(api.records("tblExample")), 1007)
        self.assertIn("skip=1000", paths[1])


if __name__ == "__main__":
    unittest.main()
