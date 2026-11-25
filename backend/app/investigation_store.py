"""PostgreSQL storage and the bounded import worker for the local prototype."""
import argparse
import hashlib
import json
import os
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from .zeek import ImportRejected, parse_rows, utc_text

MAX_ATTEMPTS = 3
LEASE_SECONDS = 120
WORKER_LOCK = 1973771541
MIGRATION = Path(__file__).with_name("investigation.sql")
JOB_COLUMNS = "id, sensor, filename, digest, parser, received_at, status, attempts, accepted, rejected, duplicates, error"


class StorageUnavailable(RuntimeError):
    pass


def connect():
    dsn = os.getenv("ARGUS_INVESTIGATION_DSN")
    if not dsn:
        raise StorageUnavailable("Set ARGUS_INVESTIGATION_DSN to a local PostgreSQL database.")
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:
        raise StorageUnavailable("Install the PostgreSQL driver from backend/requirements.investigation.txt.") from exc
    try:
        return psycopg.connect(dsn, row_factory=dict_row, connect_timeout=5,
                               options="-c statement_timeout=60000 -c idle_in_transaction_session_timeout=120000")
    except psycopg.OperationalError as exc:
        raise StorageUnavailable("PostgreSQL is unavailable. Check the local server and database settings.") from exc


def initialize():
    with connect() as conn:
        # Execute each statement individually with the same migration transaction.
        for statement in MIGRATION.read_text().split(";"):
            if statement.strip():
                conn.execute(statement)


def enqueue(workspace, sensor, filename, payload, parser):
    job_id = uuid4().hex
    now = datetime.now(UTC)
    with connect() as conn:
        return conn.execute(f"""
            INSERT INTO investigation_imports
              (id, workspace, sensor, filename, digest, parser, received_at, expires_at, payload, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'queued')
            RETURNING {JOB_COLUMNS}
        """, (job_id, workspace, sensor, filename, hashlib.sha256(payload).hexdigest(), parser,
              utc_text(now), utc_text(now + timedelta(hours=24)), payload)).fetchone()


def claim(conn, now):
    timestamp = utc_text(now)
    conn.execute("""
        UPDATE investigation_imports
        SET payload = NULL, status = 'failed', error = 'Staged file expired. Import the file again.',
            lease_token = NULL, lease_until = NULL
        WHERE payload IS NOT NULL AND expires_at <= %s
    """, (timestamp,))
    conn.execute("""
        UPDATE investigation_imports
        SET status = 'failed', error = 'Worker interrupted too many times. Retry the import.',
            lease_token = NULL, lease_until = NULL
        WHERE status = 'processing' AND lease_until <= %s AND attempts >= %s
    """, (timestamp, MAX_ATTEMPTS))
    return conn.execute("""
        UPDATE investigation_imports
        SET status = 'processing', attempts = attempts + 1, lease_token = %s, lease_until = %s, error = NULL
        WHERE id = (
            SELECT id FROM investigation_imports
            WHERE status = 'queued' OR (status = 'processing' AND lease_until <= %s)
            ORDER BY received_at, id LIMIT 1
        ) AND (status = 'queued' OR (status = 'processing' AND lease_until <= %s))
        RETURNING id, workspace, sensor, payload, lease_token, attempts
    """, (uuid4().hex, utc_text(now + timedelta(seconds=LEASE_SECONDS)), timestamp, timestamp)).fetchone()


def finish(job):
    from .zeek import PARSER_VERSION

    with connect() as conn:
        owns_job = conn.execute("""
            UPDATE investigation_imports SET lease_until = lease_until
            WHERE id = %s AND workspace = %s AND status = 'processing' AND lease_token = %s
            RETURNING parser
        """, (job["id"], job["workspace"], job["lease_token"])).fetchone()
        if not owns_job:
            return
        if owns_job["parser"] != PARSER_VERSION:
            raise ImportRejected("This parser version is unavailable. Import the file again.")

        conn.execute("""
            CREATE TEMPORARY TABLE investigation_batch (
                line INTEGER, uid TEXT, fingerprint TEXT, started TEXT, minute BIGINT,
                origin TEXT, responder TEXT, record TEXT, id TEXT
            )
        """)
        rejected = total = 0
        with conn.cursor() as cursor:
            batch = []
            for line, record in parse_rows(job["payload"]):
                total += 1
                if record is None:
                    rejected += 1
                    continue
                canonical = json.dumps(record, sort_keys=True, separators=(",", ":"))
                minute = int(datetime.fromisoformat(record["start"]).timestamp() // 60)
                batch.append((line, record["uid"], hashlib.sha256(canonical.encode()).hexdigest(),
                              record["start"], minute, record["origin"], record["responder"], canonical, uuid4().hex))
                if len(batch) == 1000:
                    stage(cursor, batch)
                    batch.clear()
            if batch:
                stage(cursor, batch)

        accepted = conn.execute("""
            INSERT INTO investigation_observations
              (id, workspace, sensor, uid, fingerprint, started, minute, origin, responder, record)
            SELECT id, %s, %s, uid, fingerprint, started, minute, origin, responder, record
            FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY uid ORDER BY line) AS occurrence
                FROM investigation_batch
            ) ranked
            WHERE occurrence = 1
            ON CONFLICT (workspace, sensor, uid) DO NOTHING
        """, (job["workspace"], job["sensor"])).rowcount
        rejected += conn.execute("""
            SELECT COUNT(*) AS conflicts FROM investigation_batch b
            JOIN investigation_observations o ON o.workspace = %s AND o.sensor = %s AND o.uid = b.uid
            WHERE o.fingerprint <> b.fingerprint
        """, (job["workspace"], job["sensor"])).fetchone()["conflicts"]
        conn.execute("""
            INSERT INTO investigation_sources (workspace, import_id, evidence_id, line)
            SELECT o.workspace, %s, o.id, MIN(b.line)
            FROM investigation_batch b
            JOIN investigation_observations o
              ON o.workspace = %s AND o.sensor = %s AND o.uid = b.uid AND o.fingerprint = b.fingerprint
            GROUP BY o.workspace, o.id
        """, (job["id"], job["workspace"], job["sensor"]))

        error = "No valid Zeek connection rows. Check the supported fields and UTF-8 format." if total == rejected else None
        conn.execute("""
            UPDATE investigation_imports
            SET status = %s, accepted = %s, rejected = %s, duplicates = %s, error = %s,
                lease_until = NULL, lease_token = NULL, payload = NULL
            WHERE id = %s AND workspace = %s AND lease_token = %s
        """, ("failed" if error else "completed", accepted, rejected, total - rejected - accepted,
              error, job["id"], job["workspace"], job["lease_token"]))


def stage(cursor, rows):
    cursor.executemany("INSERT INTO investigation_batch VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)", rows)


def run_once(now=None):
    with connect() as conn:
        job = claim(conn, now or datetime.now(UTC))
    if job is None:
        return False
    try:
        finish(job)
    except Exception as exc:
        permanent = isinstance(exc, ImportRejected)
        if not permanent:
            # Keep uploaded fields and connection details out of worker logs.
            print(f"Investigation job {job['id']} attempt {job['attempts']} failed ({type(exc).__name__}).", flush=True)
        with connect() as conn:
            conn.execute("""
                UPDATE investigation_imports
                SET status = %s, error = %s, lease_until = NULL, lease_token = NULL,
                    payload = CASE WHEN %s THEN NULL ELSE payload END
                WHERE id = %s AND workspace = %s AND lease_token = %s
            """, ("failed" if permanent or job["attempts"] >= MAX_ATTEMPTS else "queued",
                  str(exc) if permanent else "Worker could not process the file. Check the local worker before retrying.",
                  permanent, job["id"], job["workspace"], job["lease_token"]))
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("init", "worker"))
    args = parser.parse_args()
    try:
        if args.command == "init":
            initialize()
            return
        # ponytail: one worker per database. A multi-worker pilot needs per-workspace claim limits.
        with connect() as leader:
            if not leader.execute("SELECT pg_try_advisory_lock(%s) AS locked", (WORKER_LOCK,)).fetchone()["locked"]:
                raise SystemExit("An investigation worker is already running for this database.")
            leader.commit()
            while True:
                leader.execute("SELECT 1")  # Stop if the connection holding the singleton lock was lost.
                leader.commit()
                if not run_once():
                    time.sleep(0.75)
    except StorageUnavailable as exc:
        raise SystemExit(str(exc)) from exc
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
