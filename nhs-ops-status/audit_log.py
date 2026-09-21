"""SQLite-backed, append-only audit log for NHS central-data ingestion runs.

This is real, on-disk persistence — distinct from the in-memory
`_INGESTION_LEDGER` in server.py, which is deliberately process-lifetime
only (see docs/TRANSPORT_DECISION.md). This module owns the connection
pool, the schema, and the two operations server.py needs: writing one row
per completed ingestion run, and reading rows back by idempotency_key.

No row here is ever UPDATEd or DELETEd — append-only by construction is
this project's practical stand-in for "immutable audit log"; it is not a
cryptographic guarantee (no hash chaining, no tamper detection).
"""

import os
import queue
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import TypedDict

# SQLite has no username/password to read from the environment. The closest
# equivalent sensitive value here is the database file's location, so THAT
# is what comes from the environment rather than being a literal in source.
# The default below is a local-dev convenience, not a credential: a real
# deployment fronting an actually-authenticated database would have no
# default here and would fail closed if the env var were unset.
_DB_PATH_ENV_VAR = "NHS_OPS_AUDIT_DB_PATH"
_DEFAULT_DB_PATH = str(Path(__file__).parent / "audit_log.db")


class AuditLogEntry(TypedDict):
    transaction_id: str
    correlation_id: str
    status: str
    records_ingested: int
    logged_at: str


class SqliteConnectionPool:
    """A small, honest connection pool for the audit-log database.

    Sized at 1 by default, deliberately: this server is single-caller-per-
    process under stdio (docs/TRANSPORT_DECISION.md), so there is no real
    contention to pool against today. But callers acquire()/release()
    through the same protocol a larger pool would use, and SQLite itself
    only ever supports one writer at a time regardless — so this stays
    correct even if that single-caller assumption ever turns out to be
    wrong, not just convenient while it holds.
    """

    def __init__(self, db_path: str, pool_size: int = 1) -> None:
        self._db_path = db_path
        self._pool: queue.Queue[sqlite3.Connection] = queue.Queue(maxsize=pool_size)
        for _ in range(pool_size):
            conn = sqlite3.connect(db_path, check_same_thread=False)
            conn.execute("PRAGMA journal_mode=WAL")
            self._pool.put(conn)

    def acquire(self) -> sqlite3.Connection:
        return self._pool.get()

    def release(self, conn: sqlite3.Connection) -> None:
        self._pool.put(conn)


def _db_path() -> str:
    return os.environ.get(_DB_PATH_ENV_VAR, _DEFAULT_DB_PATH)


def _init_schema(pool: SqliteConnectionPool) -> None:
    conn = pool.acquire()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ingestion_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id TEXT NOT NULL UNIQUE,
                idempotency_key TEXT NOT NULL,
                correlation_id TEXT NOT NULL,
                status TEXT NOT NULL,
                records_ingested INTEGER NOT NULL,
                logged_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_idempotency_key "
            "ON ingestion_audit_log(idempotency_key)"
        )
        conn.commit()
    finally:
        pool.release(conn)


def open_pool() -> SqliteConnectionPool:
    """Open (creating if needed) the audit database and its schema.

    Called once at server startup, the same way CENTRAL_DATA is loaded
    once at import time in server.py — fail fast if the database can't be
    opened, rather than discovering that mid-request.
    """
    pool = SqliteConnectionPool(_db_path())
    _init_schema(pool)
    return pool


def record_ingestion_sync(
    pool: SqliteConnectionPool,
    *,
    idempotency_key: str,
    correlation_id: str,
    status: str,
    records_ingested: int,
) -> str:
    """Append one audit row for a completed ingestion run.

    Synchronous — sqlite3 connections are synchronous — so server.py runs
    this via asyncio.to_thread rather than calling it directly from an
    async tool function. Returns the transaction_id the row was written
    under (STORY-011's "logged with a unique transaction ID").
    """
    transaction_id = str(uuid.uuid4())
    conn = pool.acquire()
    try:
        conn.execute(
            "INSERT INTO ingestion_audit_log "
            "(transaction_id, idempotency_key, correlation_id, status, records_ingested, logged_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                transaction_id,
                idempotency_key,
                correlation_id,
                status,
                records_ingested,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        conn.commit()
    finally:
        pool.release(conn)
    return transaction_id


def query_by_idempotency_key_sync(pool: SqliteConnectionPool, idempotency_key: str) -> list[AuditLogEntry]:
    """Real query against the real database, with idempotency_key passed as
    a bound parameter — it never touches the SQL text itself, so nothing a
    caller (or a model acting on a caller's behalf) supplies can be
    interpreted as SQL, no matter what it contains.

    Synchronous, like record_ingestion_sync above — run via asyncio.to_thread.
    """
    conn = pool.acquire()
    try:
        cursor = conn.execute(
            "SELECT transaction_id, correlation_id, status, records_ingested, logged_at "
            "FROM ingestion_audit_log WHERE idempotency_key = ? ORDER BY logged_at ASC",
            (idempotency_key,),
        )
        columns = [d[0] for d in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]  # type: ignore[return-value]
    finally:
        pool.release(conn)
