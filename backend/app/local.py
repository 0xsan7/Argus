"""Opt-in, loopback-only investigation workspace alongside the benchmark API."""
import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Literal
from urllib.parse import unquote
from uuid import uuid4

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import AwareDatetime, BaseModel, Field, StringConstraints
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import investigation_store as store, zeek
from .main import create_app

PREFIX = "/api/investigation/v1"
SENSORS = ("edge", "lab")
DISPOSITIONS = {"expected": "Expected", "needs-investigation": "Needs investigation", "escalated": "Escalated"}
CAVEAT = "Intervals with no exported records have unknown coverage unless covered by the verified synthetic sample interval."
BASELINE = "Baseline unavailable in this prototype. Investigate the observations directly."
PAGE_SIZE = 50
app = FastAPI(title="Argus local prototype", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"])
router = APIRouter(prefix=PREFIX)


@dataclass(frozen=True)
class Identity:
    name: str
    workspace: str
    viewer: bool = False


IDENTITIES = {identity.name: identity for identity in (
    Identity("alpha-analyst", "alpha"), Identity("alpha-viewer", "alpha", True), Identity("beta-analyst", "beta"),
)}


def authenticate(request: Request):
    origin = request.headers.get("origin")
    if origin and origin != f"{request.url.scheme}://{request.headers.get('host')}":
        raise HTTPException(403, "Open the workspace from its local origin.")
    identity = IDENTITIES.get(request.headers.get("X-Argus-Identity"))
    if identity is None:
        raise HTTPException(401, "Select a local test identity.")
    return identity


Access = Annotated[Identity, Depends(authenticate)]


def analyst(identity: Access):
    if identity.viewer:
        raise HTTPException(403, "An analyst identity is required.")
    return identity


Analyst = Annotated[Identity, Depends(analyst)]
Identifier = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{32}$")]


@app.middleware("http")
async def private_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith(PREFIX + "/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(store.StorageUnavailable)
async def storage_error(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=503)


@app.exception_handler(Exception)
async def service_error(request, exc):
    if request.url.path.startswith(PREFIX + "/"):
        if getattr(exc, "sqlstate", None) == "42P01":
            return JSONResponse({"detail": "Initialize the investigation database before starting."}, status_code=503)
        return JSONResponse({"detail": "Investigation storage encountered an error."}, status_code=500)
    return JSONResponse({"detail": "Internal server error."}, status_code=500)


def require(row):
    if row is None:
        raise HTTPException(404, "Record not found in this workspace.")
    return row


def get_import(conn, workspace, job_id):
    return require(conn.execute(
        f"SELECT {store.JOB_COLUMNS} FROM investigation_imports WHERE workspace = %s AND id = %s",
        (workspace, job_id),
    ).fetchone())


def observations_range(conn, workspace, job_id):
    return conn.execute("""
        SELECT MIN(o.started) AS start, MAX(o.started) AS end
        FROM investigation_sources s
        JOIN investigation_observations o ON o.workspace = s.workspace AND o.id = s.evidence_id
        WHERE s.workspace = %s AND s.import_id = %s
    """, (workspace, job_id)).fetchone()


@router.get("/session")
def session(identity: Access):
    return {"workspace": identity.workspace, "viewer": identity.viewer, "sensors": SENSORS}


@router.get("/sample")
def sample(identity: Access):
    return Response(zeek.SAMPLE.read_bytes(), media_type="text/plain",
                    headers={"Content-Disposition": f'attachment; filename="{zeek.SAMPLE.name}"'})


@router.get("/imports")
def imports(identity: Access):
    with store.connect() as conn:
        return conn.execute(f"""
            SELECT {store.JOB_COLUMNS} FROM investigation_imports
            WHERE workspace = %s ORDER BY received_at DESC, id DESC LIMIT 100
        """, (identity.workspace,)).fetchall()


@router.post("/imports", status_code=202)
async def upload(request: Request, identity: Analyst, sensor: Literal["edge", "lab"]):
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "text/plain" or request.headers.get(
        "content-encoding", "identity"
    ).lower() != "identity":
        raise HTTPException(415, "Upload one uncompressed UTF-8 plain-text Zeek JSON-lines file.")
    if request.headers.get("X-Argus-Synthetic") != "yes":
        raise HTTPException(400, "Confirm that the file contains only synthetic data.")
    payload = bytearray()
    async for chunk in request.stream():
        if len(payload) + len(chunk) > zeek.MAX_BYTES:
            raise HTTPException(413, "File exceeds the 50 MiB upload limit.")
        payload.extend(chunk)
    if payload.startswith((b"\x1f\x8b", b"PK\x03\x04", b"BZh", b"\xfd7zXZ", b"\x28\xb5\x2f\xfd")) or b"\x00" in payload:
        raise HTTPException(415, "Compressed and binary exports are unsupported.")
    filename = re.split(r"[/\\]", unquote(request.headers.get("X-Argus-Filename", "conn.log")))[-1]
    filename = "".join(char for char in filename if not unicodedata.category(char).startswith("C"))[:150].strip()
    return await run_in_threadpool(store.enqueue, identity.workspace, sensor, filename or "conn.log",
                                   bytes(payload), zeek.PARSER_VERSION)


@router.get("/imports/{job_id}")
def import_detail(job_id: Identifier, identity: Access):
    with store.connect() as conn:
        job = get_import(conn, identity.workspace, job_id)
        return {**job, **observations_range(conn, identity.workspace, job_id)}


@router.post("/imports/{job_id}/retry", status_code=202)
def retry(job_id: Identifier, identity: Analyst):
    with store.connect() as conn:
        get_import(conn, identity.workspace, job_id)
        job = conn.execute(f"""
            UPDATE investigation_imports
            SET status = 'queued', attempts = 0, error = NULL
            WHERE workspace = %s AND id = %s AND status = 'failed' AND payload IS NOT NULL AND expires_at > %s
            RETURNING {store.JOB_COLUMNS}
        """, (identity.workspace, job_id, zeek.utc_text(datetime.now(UTC)))).fetchone()
        if job is None:
            raise HTTPException(409, "This import cannot be retried. Submit a corrected synthetic file if it failed validation.")
        return job


def minute_stamp(minute):
    return zeek.utc_text(datetime.fromtimestamp(minute * 60, UTC))


@router.get("/imports/{job_id}/timeline")
def timeline(job_id: Identifier, identity: Access, asset: Annotated[str, Query(max_length=64)] = "",
             start: AwareDatetime | None = None, stop: AwareDatetime | None = None, after: Identifier | None = None):
    workspace = identity.workspace
    with store.connect() as conn:
        job = get_import(conn, workspace, job_id)
        interval = observations_range(conn, workspace, job_id)
        if not interval["start"]:
            return {"buckets": [], "records": [], "next": None, "baseline": BASELINE, "coverage": None}
        try:
            asset = zeek.ip_text(asset) if asset else ""
        except ValueError:
            raise HTTPException(422, "Enter a valid IPv4 or IPv6 address.") from None
        low = zeek.utc_text(start) if start else minute_stamp(int(datetime.fromisoformat(interval["start"]).timestamp() // 60))
        upper_minute = int(datetime.fromisoformat(interval["end"]).timestamp() // 60) + 1
        high = zeek.utc_text(stop) if stop else minute_stamp(upper_minute)
        if low >= high:
            raise HTTPException(422, "The end of the UTC range must follow its start.")
        first = int(datetime.fromisoformat(low).timestamp() // 60)
        last = int(datetime.fromisoformat(high).timestamp() // 60)
        if high == minute_stamp(last):
            last -= 1
        width = max(1, (last - first + 72) // 72)
        condition = """
            FROM investigation_sources s
            JOIN investigation_observations o ON o.workspace = s.workspace AND o.id = s.evidence_id
            WHERE s.workspace = %s AND s.import_id = %s AND o.started >= %s AND o.started < %s
        """
        params = (workspace, job_id, low, high)
        if asset:
            condition += " AND (o.origin = %s OR o.responder = %s)"
            params += (asset, asset)
        counts = conn.execute("""
            SELECT CAST((o.minute - %s) / %s AS INTEGER) AS bucket, COUNT(*) AS count
        """ + condition + " GROUP BY 1", (first, width, *params)).fetchall()
        coverage = sample_coverage(job)
        by_bucket = {row["bucket"]: row["count"] for row in counts}
        buckets = []
        for i, begin in enumerate(range(first, last + 1, width)):
            end = min(begin + width, last + 1)
            count = by_bucket.get(i, 0)
            verified = coverage is not None and coverage[0] <= begin and end <= coverage[1]
            buckets.append({
                "start": max(low, minute_stamp(begin)), "end": min(high, minute_stamp(end)),
                "count": count if count or verified else None,
                "state": "observed" if count else "verified-quiet" if verified else "unknown",
                "verified": verified,
            })

        if after:
            cursor = require(conn.execute(
                "SELECT o.started, o.id " + condition + " AND o.id = %s", (*params, after),
            ).fetchone())
            condition += " AND (o.started, o.id) > (%s, %s)"
            params += (cursor["started"], cursor["id"])
        rows = conn.execute("SELECT o.id, o.record, s.line " + condition
                            + " ORDER BY o.started, o.id LIMIT %s", (*params, PAGE_SIZE + 1)).fetchall()
        return {
            "buckets": buckets, "records": [{"id": row["id"], **json.loads(row["record"])} for row in rows[:PAGE_SIZE]],
            "next": rows[PAGE_SIZE - 1]["id"] if len(rows) > PAGE_SIZE else None,
            "baseline": BASELINE, "start": low, "end": high, "observed": [interval["start"], interval["end"]],
            "coverage": [minute_stamp(bound) for bound in coverage] if coverage else None,
        }


def sample_coverage(job):
    if job["digest"] == zeek.SAMPLE_DIGEST and job["parser"] == zeek.PARSER_VERSION and job["status"] == "completed":
        return zeek.SAMPLE_COVERAGE
    return None


def get_evidence(conn, workspace, evidence_id):
    row = require(conn.execute("""
        SELECT id, sensor, record FROM investigation_observations WHERE workspace = %s AND id = %s
    """, (workspace, evidence_id)).fetchone())
    sources = conn.execute("""
        SELECT i.id AS import_id, i.filename, i.digest, i.parser, i.received_at, i.status, s.line
        FROM investigation_sources s
        JOIN investigation_imports i ON i.workspace = s.workspace AND i.id = s.import_id
        WHERE s.workspace = %s AND s.evidence_id = %s
        ORDER BY i.received_at, i.id
    """, (workspace, evidence_id)).fetchall()
    for source in sources:
        coverage = sample_coverage(source)
        source["coverage"] = [minute_stamp(bound) for bound in coverage] if coverage else None
        del source["status"]
    return {"id": row["id"], "sensor": row["sensor"], **json.loads(row["record"]), "sources": sources}


@router.get("/evidence/{evidence_id}")
def evidence(evidence_id: Identifier, identity: Access):
    with store.connect() as conn:
        return get_evidence(conn, identity.workspace, evidence_id)


class CaseInput(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    disposition: Literal["expected", "needs-investigation", "escalated"]
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    evidence: list[Identifier] = Field(min_length=1, max_length=20)


@router.get("/cases")
def cases(identity: Access):
    with store.connect() as conn:
        return conn.execute("""
            SELECT id, title, disposition, saved_at FROM investigation_cases
            WHERE workspace = %s ORDER BY saved_at DESC, id DESC LIMIT 100
        """, (identity.workspace,)).fetchall()


@router.post("/cases", status_code=201)
def save_case(body: CaseInput, identity: Analyst):
    if any("\x00" in value for value in (body.title, body.reason)):
        raise HTTPException(422, "Case text must be printable.")
    case_id = uuid4().hex
    with store.connect() as conn:
        attachments = [get_evidence(conn, identity.workspace, key) for key in sorted(set(body.evidence))]
        attachments.sort(key=lambda record: (record["start"], record["id"]))
        conn.execute("""
            INSERT INTO investigation_cases (id, workspace, title, disposition, reason, author, saved_at, evidence)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (case_id, identity.workspace, body.title, body.disposition, body.reason, identity.name,
              zeek.utc_text(datetime.now(UTC)), json.dumps(attachments, sort_keys=True)))
    return {"id": case_id}


def load_case(case_id, workspace):
    with store.connect() as conn:
        row = require(conn.execute("SELECT * FROM investigation_cases WHERE workspace = %s AND id = %s",
                                   (workspace, case_id)).fetchone())
    row["evidence"] = json.loads(row["evidence"])
    return row


@router.get("/cases/{case_id}")
def case_detail(case_id: Identifier, identity: Access):
    return load_case(case_id, identity.workspace)


def md_text(value):
    text = " ".join(value.split())
    return re.sub(r"([\\`*_{}\[\]()<>#+.!|&~-])", r"\\\1", text)


def endpoint(record, key):
    address, port = record[key], record[key + "_port"]
    if port is None:
        return address
    return f"[{address}]:{port}" if ":" in address else f"{address}:{port}"


def brief(row):
    evidence_rows = row["evidence"]
    lines = [
        f"# {md_text(row['title'])}", "", "Synthetic investigation · template v1", "",
        f"- Case ID: `{row['id']}`", f"- Workspace: {row['workspace']}",
        f"- Saved by: {row['author']} at {row['saved_at']}",
        f"- Evidence time range (UTC): {evidence_rows[0]['start']} to {evidence_rows[-1]['start']}", "",
        "## Disposition", "", f"**{DISPOSITIONS[row['disposition']]}**", "", md_text(row["reason"]), "",
        "## Observations", "",
    ]
    for item in evidence_rows:
        counters = [str(item[field]) if item[field] is not None else "unknown"
                    for field in ("orig_bytes", "resp_bytes", "orig_pkts", "resp_pkts")]
        lines.extend([
            f"### {item['uid']}", "",
            f"- Evidence: `{item['id']}` · sensor `{item['sensor']}`",
            f"- Connection start: {item['start']} · estimated end: {item['end'] or 'unknown'}",
            f"- {item['protocol'].upper()} `{endpoint(item, 'origin')}` → `{endpoint(item, 'responder')}`",
            f"- Bytes out/in: {counters[0]} / {counters[1]} · packets out/in: {counters[2]} / {counters[3]}",
        ])
        for source in item["sources"]:
            lines.append(f"- Source: {md_text(source['filename'])}, line {source['line']} "
                         f"(import `{source['import_id']}`, SHA-256 `{source['digest']}`, {source['parser']}, "
                         f"received {source['received_at']})")
            if source["coverage"]:
                lines.append(f"  - Verified synthetic collection interval: {' to '.join(source['coverage'])} (end excluded)")
        lines.append("")
    lines.extend(["## Coverage caveats", "", CAVEAT, "", BASELINE,
                  "Missing optional fields remain unknown. Source clock accuracy beyond the synthetic fixture is unverified.", ""])
    return "\n".join(lines)


@router.get("/cases/{case_id}/brief")
def export(case_id: Identifier, identity: Analyst):
    return Response(brief(load_case(case_id, identity.workspace)), media_type="text/markdown",
                    headers={"Content-Disposition": f'attachment; filename="argus-case-{case_id}.md"'})


app.include_router(router)
app.mount("/", create_app())
