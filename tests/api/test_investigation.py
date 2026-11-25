import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SAMPLE = Path("fixtures/zeek-conn-synthetic-v1.jsonl")
PREFIX = "/api/investigation/v1"
HEADERS = {"X-Argus-Identity": "alpha-analyst"}
IMPORT_HEADERS = {
    **HEADERS, "X-Argus-Synthetic": "yes", "X-Argus-Filename": SAMPLE.name,
    "Content-Type": "text/plain",
}
OTHER = {"X-Argus-Identity": "beta-analyst"}
VIEWER = {"X-Argus-Identity": "alpha-viewer"}


def test_local_identity_gate_precedes_storage():
    from backend.app.local import app

    with TestClient(app, base_url="http://localhost") as client:
        assert client.get(PREFIX + "/imports").status_code == 401
        assert client.post(PREFIX + "/imports?sensor=edge", headers=HEADERS).status_code == 415
        assert client.post(
            PREFIX + "/imports?sensor=edge", headers={**IMPORT_HEADERS, "X-Argus-Synthetic": "no"},
            content=SAMPLE.read_bytes(),
        ).status_code == 400
        assert client.post(
            PREFIX + "/imports?sensor=edge", headers=VIEWER, content=SAMPLE.read_bytes(),
        ).status_code == 403
        assert client.get(PREFIX + "/imports", headers={**HEADERS, "Origin": "http://other.local"}).status_code == 403


def test_parser_limits_and_times(monkeypatch):
    from backend.app import zeek

    rows = list(zeek.parse_rows(SAMPLE.read_bytes()))
    assert len(rows) == 5
    assert rows[2] == (3, None)
    assert rows[1][1]["start"] == "2026-11-25T10:00:05.500000Z"
    assert rows[1][1]["end"] == "2026-11-25T10:00:06.750000Z"
    assert rows[4][1]["origin_port"] is None
    assert rows[1][1] == rows[3][1]
    assert list(zeek.parse_rows(b"\xff\n" + b"x" * 65537)) == [(1, None), (2, None)]
    monkeypatch.setattr(zeek, "MAX_ROWS", 2)
    with pytest.raises(zeek.ImportRejected, match="nonblank"):
        list(zeek.parse_rows(SAMPLE.read_bytes()))


@pytest.fixture(params=["sqlite-contract", "postgresql"])
def workspace(request, monkeypatch, tmp_path):
    from uuid import uuid4

    from backend.app import investigation_store as store
    from backend.app.local import app
    from tests.api.investigation_harness import connect_to

    if request.param == "sqlite-contract":
        monkeypatch.setattr(store, "connect", connect_to(tmp_path / "synthetic.sqlite"))
        store.initialize()
        yield TestClient(app, base_url="http://localhost")
        return

    dsn = os.getenv("ARGUS_INVESTIGATION_TEST_DSN")
    if not dsn:
        pytest.skip("ARGUS_INVESTIGATION_TEST_DSN requires a local PostgreSQL server and driver")
    from contextlib import contextmanager

    monkeypatch.setenv("ARGUS_INVESTIGATION_DSN", dsn)
    original = store.connect
    schema = f"argus_synthetic_{uuid4().hex}"
    with original() as conn:
        conn.execute(f"CREATE SCHEMA {schema}")

    @contextmanager
    def isolated():
        with original() as conn:
            conn.execute(f"SET search_path TO {schema}")
            yield conn

    try:
        monkeypatch.setattr(store, "connect", isolated)
        store.initialize()
        yield TestClient(app, base_url="http://localhost")
    finally:
        with original() as conn:
            conn.execute(f"DROP SCHEMA {schema} CASCADE")


def submit(client, payload=None, sensor="edge"):
    response = client.post(PREFIX + f"/imports?sensor={sensor}", headers=IMPORT_HEADERS,
                           content=SAMPLE.read_bytes() if payload is None else payload)
    assert response.status_code == 202, response.text
    assert response.json()["status"] == "queued"
    return response.json()["id"]


def read(client, resource, headers=HEADERS):
    response = client.get(PREFIX + resource, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_import_timeline_case_round_trip(workspace, monkeypatch):
    from backend.app import investigation_store as store
    from backend.app.local import app

    job = submit(workspace)
    assert store.run_once()
    result = read(workspace, f"/imports/{job}")
    assert (result["status"], result["accepted"], result["rejected"], result["duplicates"]) == ("completed", 3, 1, 1)
    assert result["start"] == "2026-11-25T10:00:05.500000Z"
    timeline = read(workspace, f"/imports/{job}/timeline")
    assert [bucket["state"] for bucket in timeline["buckets"]] == [
        "observed", "verified-quiet", "observed", "verified-quiet", "unknown", "observed",
    ]
    assert timeline["buckets"][1]["count"] == 0 and timeline["buckets"][4]["count"] is None
    assert "Baseline unavailable" in timeline["baseline"]
    records = timeline["records"]
    assert [record["uid"] for record in records] == ["CSample1", "CSample2", "CSample3"]

    from backend.app import local
    monkeypatch.setattr(local, "PAGE_SIZE", 1)
    timeline = read(workspace, f"/imports/{job}/timeline?asset=192.0.2.10")
    assert len(timeline["records"]) == 1
    page_two = read(workspace, f"/imports/{job}/timeline?asset=192.0.2.10&after={timeline['next']}")
    assert page_two["records"][0]["uid"] == "CSample2" and page_two["next"] is None

    first = records[0]["id"]
    sample = read(workspace, f"/evidence/{first}")
    assert sample["sources"][0]["line"] == 2
    for path in (f"/imports/{job}", f"/imports/{job}/timeline", f"/evidence/{first}"):
        assert workspace.get(PREFIX + path, headers=OTHER).status_code == 404
    assert workspace.post(PREFIX + f"/imports/{job}/retry", headers=OTHER).status_code == 404

    case = {"title": "Synthetic DNS follow-up", "disposition": "needs-investigation",
            "reason": "Review the connection with the network team", "evidence": [first]}
    assert workspace.post(PREFIX + "/cases", headers=OTHER, json=case).status_code == 404
    assert workspace.post(PREFIX + "/cases", headers=VIEWER, json=case).status_code == 403
    result = workspace.post(PREFIX + "/cases", headers=HEADERS, json=case)
    assert result.status_code == 201, result.text
    case_path = f"/cases/{result.json()['id']}"
    brief_path = PREFIX + case_path + "/brief"
    assert workspace.get(brief_path, headers=VIEWER).status_code == 403
    assert workspace.get(brief_path, headers=OTHER).status_code == 404
    assert workspace.get(PREFIX + case_path, headers=OTHER).status_code == 404
    with TestClient(app, base_url="http://localhost") as reloaded:
        assert read(reloaded, case_path, VIEWER)["reason"] == case["reason"]
        brief = reloaded.get(brief_path, headers=HEADERS)
        assert brief.status_code == 200
        for expected in ("Evidence time range (UTC)", "CSample1", "line 2", "Needs investigation",
                         "Coverage caveats", first, "10:00:05.500000Z"):
            assert expected in brief.text

    duplicate = submit(workspace)
    assert store.run_once()
    result = read(workspace, f"/imports/{duplicate}")
    assert (result["accepted"], result["rejected"], result["duplicates"]) == (0, 1, 4)
    assert read(workspace, f"/imports/{duplicate}/timeline")["records"][0]["id"] == first
    assert len(read(workspace, f"/evidence/{first}")["sources"]) == 2
    assert workspace.get(brief_path, headers=HEADERS).content == brief.content

    overlap = SAMPLE.read_bytes().splitlines()[1]
    variant = submit(workspace, overlap + b"\n" + overlap.replace(b"2370", b"2371"))
    assert store.run_once()
    result = read(workspace, f"/imports/{variant}")
    assert (result["accepted"], result["rejected"], result["duplicates"]) == (0, 1, 1)
    assert read(workspace, f"/imports/{variant}/timeline")["coverage"] is None


def test_worker_interruption_and_retry(workspace, monkeypatch):
    from datetime import UTC, datetime, timedelta
    from backend.app import investigation_store as store

    job = submit(workspace, sensor="lab")
    original_stage = store.stage

    def interrupt(cursor, rows):
        original_stage(cursor, rows)
        raise KeyboardInterrupt

    with monkeypatch.context() as patch:
        patch.setattr(store, "stage", interrupt)
        with pytest.raises(KeyboardInterrupt):
            store.run_once()
    path = f"/imports/{job}"
    assert read(workspace, path)["status"] == "processing"
    assert read(workspace, path + "/timeline")["records"] == []
    assert not store.run_once()
    assert store.run_once(datetime.now(UTC) + timedelta(seconds=store.LEASE_SECONDS + 1))
    recovered = read(workspace, path)
    assert (recovered["status"], recovered["attempts"], recovered["accepted"]) == ("completed", 2, 3)

    transient = submit(workspace, sensor="lab")

    def fail(_):
        raise RuntimeError("synthetic worker failure")

    path = f"/imports/{transient}"
    with monkeypatch.context() as patch:
        patch.setattr(store, "finish", fail)
        for _ in range(store.MAX_ATTEMPTS):
            assert store.run_once()
    assert read(workspace, path)["status"] == "failed"
    assert workspace.post(PREFIX + path + "/retry", headers=HEADERS).status_code == 202
    assert store.run_once()
    retried = read(workspace, path)
    assert (retried["status"], retried["accepted"], retried["duplicates"]) == ("completed", 0, 4)


def test_invalid_imports(workspace, monkeypatch):
    from backend.app import investigation_store as store, zeek

    assert workspace.post(PREFIX + "/imports?sensor=edge", headers=IMPORT_HEADERS,
                          content=b"\x1f\x8bdata").status_code == 415
    with monkeypatch.context() as patch:
        patch.setattr(zeek, "MAX_BYTES", 32)
        assert workspace.post(PREFIX + "/imports?sensor=edge", headers=IMPORT_HEADERS,
                              content=SAMPLE.read_bytes()).status_code == 413
    broken = submit(workspace, b"{broken}\n\n")
    assert store.run_once()
    result = read(workspace, f"/imports/{broken}")
    assert (result["status"], result["rejected"]) == ("failed", 1)
    with monkeypatch.context() as patch:
        patch.setattr(zeek, "MAX_ROWS", 2)
        oversized = submit(workspace)
        assert store.run_once()
        assert "nonblank row limit" in read(workspace, f"/imports/{oversized}")["error"]
    out_of_scope = submit(workspace, SAMPLE.read_bytes().replace(b"192.0.2.12", b"10.0.0.12"))
    assert store.run_once()
    result = read(workspace, f"/imports/{out_of_scope}")
    assert result["status"] == "failed" and "documentation IP" in result["error"]


def test_abrupt_worker_exit_survives_process_restart(tmp_path, monkeypatch):
    import subprocess
    import sys
    from backend.app import investigation_store as store
    from backend.app.local import app
    from tests.api.investigation_harness import connect_to

    path = tmp_path / "interrupted.sqlite"
    monkeypatch.setattr(store, "connect", connect_to(path))
    store.initialize()
    worker = """
import os
import sys
from datetime import UTC, datetime, timedelta
from backend.app import investigation_store as store
from tests.api.investigation_harness import connect_to
store.connect = connect_to(sys.argv[1])
if sys.argv[2] == "interrupt":
    stage = store.stage
    def stop(cursor, rows):
        stage(cursor, rows)
        os._exit(23)
    store.stage = stop
    store.run_once()
else:
    store.run_once(datetime.now(UTC) + timedelta(seconds=store.LEASE_SECONDS + 1))
"""
    with TestClient(app, base_url="http://localhost") as client:
        job = submit(client)
        command = [sys.executable, "-B", "-c", worker, str(path)]
        assert subprocess.run([*command, "interrupt"], timeout=10).returncode == 23
        assert read(client, f"/imports/{job}")["status"] == "processing"
        subprocess.run([*command, "recover"], check=True, timeout=10)
        result = read(client, f"/imports/{job}")
        assert (result["status"], result["attempts"], result["accepted"], result["duplicates"]) == ("completed", 2, 3, 1)
