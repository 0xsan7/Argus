"""The synthetic Zeek conn.log v1 input contract."""
import hashlib
import io
import ipaddress
import json
import math
from datetime import UTC, datetime, timedelta
from pathlib import Path

MAX_BYTES = 50 * 1024 * 1024
MAX_ROWS = 250_000
MAX_LINE = 64 * 1024
PARSER_VERSION = "zeek-conn-v1"
SAMPLE = Path(__file__).resolve().parents[2] / "fixtures/zeek-conn-synthetic-v1.jsonl"
SAMPLE_DIGEST = hashlib.sha256(SAMPLE.read_bytes()).hexdigest()
SAMPLE_COVERAGE = (29_926_680, 29_926_684)  # Synthetic generator was active 10:00–10:04 UTC.
SYNTHETIC_NETWORKS = tuple(map(ipaddress.ip_network, (
    "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24", "2001:db8::/32",
)))


class ImportRejected(ValueError):
    pass


def utc_text(value):
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def ip_text(value):
    if not isinstance(value, str) or "%" in value:
        raise ValueError("Expected an IP address")
    return str(ipaddress.ip_address(value))


def optional_count(row, key, maximum):
    value = row.get(key)
    return value if type(value) is int and 0 <= value <= maximum else None


def normalize(row):
    if not isinstance(row, dict):
        raise ValueError("Expected a JSON object")
    ts, uid, protocol = row["ts"], row["uid"], row["proto"]
    if type(ts) not in (int, float) or not math.isfinite(ts):
        raise ValueError("Invalid timestamp")
    if not isinstance(uid, str) or not (1 <= len(uid) <= 128) or not uid.isascii() or not uid.isalnum():
        raise ValueError("Invalid Zeek UID")
    if protocol not in ("tcp", "udp", "icmp", "unknown"):
        raise ValueError("Unsupported protocol")
    origin, responder = (ip_text(row[key]) for key in ("id.orig_h", "id.resp_h"))
    if any(not any(ipaddress.ip_address(address) in net for net in SYNTHETIC_NETWORKS)
           for address in (origin, responder)):
        raise ImportRejected("This prototype accepts only synthetic records using documentation IP ranges.")
    start = datetime.fromtimestamp(ts, UTC)
    duration = row.get("duration")
    end = None
    if type(duration) in (int, float) and math.isfinite(duration) and duration >= 0:
        try:
            end = utc_text(start + timedelta(seconds=duration))
        except OverflowError:
            pass
    return {
        "uid": uid, "start": utc_text(start), "end": end, "protocol": protocol,
        "origin": origin, "responder": responder,
        "origin_port": optional_count(row, "id.orig_p", 65535),
        "responder_port": optional_count(row, "id.resp_p", 65535),
        **{key: optional_count(row, key, 2**63 - 1)
           for key in ("orig_bytes", "resp_bytes", "orig_pkts", "resp_pkts")},
    }


def parse_rows(payload):
    count = 0
    for line_number, raw in enumerate(io.BytesIO(payload), 1):
        if not raw.strip():
            continue
        count += 1
        if count > MAX_ROWS:
            raise ImportRejected(f"File exceeds the {MAX_ROWS:,} nonblank row limit.")
        if len(raw.rstrip(b"\r\n")) > MAX_LINE:
            yield line_number, None
            continue
        try:
            record = normalize(json.loads(raw.decode("utf-8")))
        except ImportRejected:
            raise
        except (ValueError, KeyError, OverflowError, OSError, RecursionError):
            record = None
        yield line_number, record
