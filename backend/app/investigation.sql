CREATE TABLE IF NOT EXISTS investigation_workspaces (
    id TEXT PRIMARY KEY
);
INSERT INTO investigation_workspaces VALUES ('alpha'), ('beta') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS investigation_imports (
    id TEXT PRIMARY KEY,
    workspace TEXT NOT NULL REFERENCES investigation_workspaces(id),
    sensor TEXT NOT NULL,
    filename TEXT NOT NULL,
    digest TEXT NOT NULL,
    parser TEXT NOT NULL,
    received_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    payload BYTEA,
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    lease_until TEXT,
    lease_token TEXT,
    accepted INTEGER NOT NULL DEFAULT 0,
    rejected INTEGER NOT NULL DEFAULT 0,
    duplicates INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    UNIQUE (workspace, id)
);
CREATE INDEX IF NOT EXISTS investigation_jobs ON investigation_imports (status, received_at);
CREATE INDEX IF NOT EXISTS investigation_workspace_imports ON investigation_imports (workspace, received_at);

CREATE TABLE IF NOT EXISTS investigation_observations (
    id TEXT PRIMARY KEY,
    workspace TEXT NOT NULL REFERENCES investigation_workspaces(id),
    sensor TEXT NOT NULL,
    uid TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    started TEXT NOT NULL,
    minute BIGINT NOT NULL,
    origin TEXT NOT NULL,
    responder TEXT NOT NULL,
    record TEXT NOT NULL,
    UNIQUE (workspace, sensor, uid),
    UNIQUE (workspace, id)
);
CREATE INDEX IF NOT EXISTS investigation_range ON investigation_observations (workspace, sensor, started, id);

CREATE TABLE IF NOT EXISTS investigation_sources (
    workspace TEXT NOT NULL,
    import_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    line INTEGER NOT NULL,
    PRIMARY KEY (workspace, import_id, evidence_id),
    FOREIGN KEY (workspace, import_id) REFERENCES investigation_imports(workspace, id),
    FOREIGN KEY (workspace, evidence_id) REFERENCES investigation_observations(workspace, id)
);
CREATE INDEX IF NOT EXISTS investigation_evidence_sources ON investigation_sources (workspace, evidence_id);

CREATE TABLE IF NOT EXISTS investigation_cases (
    id TEXT PRIMARY KEY,
    workspace TEXT NOT NULL REFERENCES investigation_workspaces(id),
    title TEXT NOT NULL,
    disposition TEXT NOT NULL,
    reason TEXT NOT NULL,
    author TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    evidence TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS investigation_workspace_cases ON investigation_cases (workspace, saved_at);
