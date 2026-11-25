"""Local verification only. Stand in for an unavailable PostgreSQL installation."""
import sqlite3
from contextlib import contextmanager


class TestCursor(sqlite3.Cursor):
    def execute(self, sql, params=()):
        return super().execute(sql.replace("%s", "?"), params)

    def executemany(self, sql, params):
        return super().executemany(sql.replace("%s", "?"), params)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class TestConnection(sqlite3.Connection):
    def cursor(self, factory=TestCursor):
        return super().cursor(factory)

    def execute(self, sql, params=()):
        return self.cursor().execute(sql, params)


def connect_to(path):
    @contextmanager
    def connect():
        conn = sqlite3.connect(path, factory=TestConnection)
        conn.row_factory = lambda cursor, row: dict(zip((column[0] for column in cursor.description), row))
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    return connect


if __name__ == "__main__":
    # Dedicated disposable file. The production service has no SQLite mode.
    import argparse
    import time
    from pathlib import Path

    import uvicorn

    from backend.app import investigation_store as store

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("api", "worker"))
    parser.add_argument("database", type=Path)
    parser.add_argument("--port", type=int, default=18081)
    args = parser.parse_args()
    store.connect = connect_to(args.database)
    if args.command == "api":
        store.initialize()
        uvicorn.run("backend.app.local:app", host="127.0.0.1", port=args.port)
    else:
        while True:
            if not store.run_once():
                time.sleep(0.5)
