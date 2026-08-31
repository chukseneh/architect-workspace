import json
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal, TypedDict

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ResourceNotFoundError
from pydantic import Field

mcp = MCPServer("nhs-ops-status")


class TrustStatus(TypedDict):
    trust_name: str
    region: str
    ed_wait_minutes: int
    bed_occupancy_pct: int
    ambulance_handover_delay_minutes: int
    last_updated: str


# Hardcoded in-memory sample data — stands in for a live NHS operational feed.
TRUST_STATUS: list[TrustStatus] = [
    {"trust_name": "Manchester Royal Infirmary", "region": "North West", "ed_wait_minutes": 187, "bed_occupancy_pct": 96, "ambulance_handover_delay_minutes": 42, "last_updated": "2026-08-25T06:00:00Z"},
    {"trust_name": "Leeds General Infirmary", "region": "Yorkshire", "ed_wait_minutes": 142, "bed_occupancy_pct": 91, "ambulance_handover_delay_minutes": 18, "last_updated": "2026-08-25T06:00:00Z"},
    {"trust_name": "St Thomas' Hospital", "region": "London", "ed_wait_minutes": 205, "bed_occupancy_pct": 98, "ambulance_handover_delay_minutes": 55, "last_updated": "2026-08-25T06:00:00Z"},
    {"trust_name": "Queen Elizabeth Hospital Birmingham", "region": "West Midlands", "ed_wait_minutes": 163, "bed_occupancy_pct": 93, "ambulance_handover_delay_minutes": 30, "last_updated": "2026-08-25T06:00:00Z"},
    {"trust_name": "Bristol Royal Infirmary", "region": "South West", "ed_wait_minutes": 98, "bed_occupancy_pct": 84, "ambulance_handover_delay_minutes": 9, "last_updated": "2026-08-25T06:00:00Z"},
    {"trust_name": "Newcastle upon Tyne Hospitals", "region": "North East", "ed_wait_minutes": 121, "bed_occupancy_pct": 88, "ambulance_handover_delay_minutes": 14, "last_updated": "2026-08-25T06:00:00Z"},
    {"trust_name": "Royal Liverpool University Hospital", "region": "North West", "ed_wait_minutes": 176, "bed_occupancy_pct": 95, "ambulance_handover_delay_minutes": 38, "last_updated": "2026-08-25T06:00:00Z"},
    {"trust_name": "Nottingham University Hospitals", "region": "East Midlands", "ed_wait_minutes": 110, "bed_occupancy_pct": 87, "ambulance_handover_delay_minutes": 12, "last_updated": "2026-08-25T06:00:00Z"},
]


class CentralDataRecord(TypedDict):
    icb_name: str
    region: str
    opel_level: int
    ambulance_handover_over_60min_pct: float
    discharge_delay_beddays: int
    critical_care_occupancy_pct: int
    last_updated: str


class IngestResult(TypedDict):
    status: Literal["ingested", "replayed_idempotent", "no_new_records"]
    idempotency_key: str
    records_ingested: int
    records: list[CentralDataRecord]
    message: str


# NHS central data systems (REQ-002) has no real integration yet — STORY-002 is
# unbuilt. This reads a static sample file standing in for a live regional/ICB
# feed, the same stand-in role TRUST_STATUS above plays for per-trust data.
_CENTRAL_DATA_PATH = Path(__file__).parent / "central_data_sample.json"
CENTRAL_DATA: list[CentralDataRecord] = json.loads(_CENTRAL_DATA_PATH.read_text())

# In-memory idempotency ledger keyed on the caller-supplied idempotency_key.
# Process-lifetime only — a real deployment would persist this (STORY-011,
# trust spine) so idempotency survives a restart; flagged, not solved, here.
_INGESTION_LEDGER: dict[str, IngestResult] = {}


def _log_ingestion_event(correlation_id: str, idempotency_key: str, outcome: str, start_time: float) -> None:
    print(
        json.dumps(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "level": "info",
                "service": "nhs-ops-status",
                "event": "ingest_nhs_central_data",
                "correlation_id": correlation_id,
                "duration_ms": round((time.monotonic() - start_time) * 1000, 1),
                "outcome": outcome,
                "context": {"idempotency_key": idempotency_key},
            }
        ),
        file=sys.stderr,
    )


@mcp.tool()
def search_trust_status(
    query: Annotated[
        str,
        Field(min_length=1, max_length=200, description="Trust name or region keyword to search for, e.g. 'Leeds' or 'North West'."),
    ],
    limit: Annotated[
        int,
        Field(ge=1, le=20, description="Maximum number of matching trusts to return."),
    ] = 5,
) -> list[TrustStatus]:
    """Call this whenever the user asks about current NHS hospital or trust operational
    conditions — A&E wait times, bed occupancy, or ambulance handover delays. This data
    changes constantly and is not something you know from training; always look it up
    here rather than estimating or guessing a figure. Search is a case-insensitive
    substring match against trust name and region."""
    q = query.strip().lower()
    matches = [
        row for row in TRUST_STATUS
        if q in row["trust_name"].lower() or q in row["region"].lower()
    ]
    return matches[:limit]


@mcp.tool()
def ingest_nhs_central_data(
    since: Annotated[
        str,
        Field(
            min_length=20,
            max_length=25,
            pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$",
            description="ISO-8601 UTC timestamp, e.g. '2026-08-27T05:00:00Z'. Only records captured at or after this time are ingested.",
        ),
    ],
    idempotency_key: Annotated[
        str,
        Field(
            min_length=8,
            max_length=128,
            pattern=r"^[A-Za-z0-9_-]+$",
            description="A unique key identifying this ingestion run, e.g. 'daily-2026-08-27'. Re-calling with the same key returns the original result instead of re-ingesting.",
        ),
    ],
    limit: Annotated[
        int,
        Field(ge=1, le=20, description="Maximum number of ingested records to return in the response."),
    ] = 10,
) -> IngestResult:
    """Call this when the user asks you to pull in, refresh, or check for new
    NHS central data systems records — the regional/ICB-level winter-pressure
    feed covering OPEL escalation level, ambulance handovers delayed over 60
    minutes, discharge-delay bed-days, and critical care occupancy. This is a
    system-level view, one level up from a single trust — if the user is
    asking about one specific hospital, use search_trust_status instead, not
    this. This tool changes state: it records an ingestion run and logs the
    outcome, so only call it when the user actually wants fresh data pulled
    in, not just to answer a question you could already answer from data
    already in front of you. If you are retrying after a failure, pass the
    same idempotency_key you used the first time so the same batch is never
    ingested twice.
    """
    start = time.monotonic()
    correlation_id = str(uuid.uuid4())

    if idempotency_key in _INGESTION_LEDGER:
        result = _INGESTION_LEDGER[idempotency_key]
        _log_ingestion_event(correlation_id, idempotency_key, "replayed_idempotent", start)
        return result

    matches = [r for r in CENTRAL_DATA if r["last_updated"] >= since][:limit]

    if not matches:
        result: IngestResult = {
            "status": "no_new_records",
            "idempotency_key": idempotency_key,
            "records_ingested": 0,
            "records": [],
            "message": f"No NHS central data records found at or after {since}.",
        }
    else:
        result = {
            "status": "ingested",
            "idempotency_key": idempotency_key,
            "records_ingested": len(matches),
            "records": matches,
            "message": f"Ingested {len(matches)} NHS central data record(s) at or after {since}.",
        }

    _INGESTION_LEDGER[idempotency_key] = result
    _log_ingestion_event(correlation_id, idempotency_key, result["status"], start)
    return result


@mcp.resource(
    "nhs-central-data://latest-snapshot",
    name="nhs_central_data_latest_snapshot",
    title="NHS central data — latest snapshot",
    description="The full set of NHS central data systems (ICB/regional) records currently held by this server.",
    mime_type="application/json",
)
def get_central_data_snapshot() -> str:
    """Read-only: returns every currently-held CentralDataRecord as JSON. No ingestion, no state change."""
    return json.dumps(CENTRAL_DATA, indent=2)


@mcp.resource(
    "nhs-central-data://icb/{icb_name}",
    name="nhs_central_data_by_icb",
    title="NHS central data — single ICB record",
    description="A single ICB's NHS central data record, addressed by exact ICB name, e.g. 'NHS Greater Manchester ICB'.",
    mime_type="application/json",
)
def get_central_data_for_icb(icb_name: str) -> str:
    """Read-only: returns one CentralDataRecord by exact icb_name match, or raises ResourceNotFoundError."""
    for record in CENTRAL_DATA:
        if record["icb_name"] == icb_name:
            return json.dumps(record, indent=2)
    raise ResourceNotFoundError(f"No NHS central data record for ICB {icb_name!r}.")


@mcp.prompt(
    name="triage_nhs_central_ingestion",
    title="Triage NHS central data ingestion",
    description=(
        "Ingest NHS central data since a given time, read the full current snapshot, "
        "and produce a human-facing uncertainty triage for review — never an autonomous decision."
    ),
)
def triage_nhs_central_ingestion(
    since: Annotated[
        str,
        Field(
            min_length=20,
            max_length=25,
            pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$",
            description="ISO-8601 UTC timestamp, e.g. '2026-08-27T05:00:00Z'. Ingest and triage central data at or after this time.",
        ),
    ],
    min_opel_level: Annotated[
        int,
        Field(
            ge=1,
            le=4,
            description="Only surface ICBs at or above this OPEL escalation level in the triage summary. 1 shows everything; 4 shows only the most severe.",
        ),
    ] = 1,
) -> str:
    # A multi-turn workflow could return a list of typed Message objects instead
    # (mcp.server.mcpserver.prompts.base.UserMessage / AssistantMessage) to seed
    # more than one conversation turn. A single expanded string is enough here.
    return f"""You are triaging the NHS central data systems feed (regional/ICB-level \
winter-pressure reporting) for human review. Follow this workflow exactly.

## Step 1 — Ingest
Call the `ingest_nhs_central_data` tool with:
- since = "{since}"
- idempotency_key = "triage-{since}" (deterministic, so re-running this exact triage never double-ingests)
- limit = 20

## Step 2 — Read the full picture
Read the resource `nhs-central-data://latest-snapshot` to see every ICB record currently \
held, not just what was newly ingested in Step 1 — the tool tells you what's new, the \
resource tells you the complete current state.

## Step 3 — Flag uncertainty per record
For each ICB record where opel_level >= {min_opel_level}, decide whether it can be trusted \
as-is or should be flagged as uncertain, one category at a time:

1. `malformed_input` — opel_level is outside 1-4, or ambulance_handover_over_60min_pct or \
   critical_care_occupancy_pct is outside 0-100, or discharge_delay_beddays is negative. \
   There is no way to reason about a value that cannot be real.
2. `stale_data` — the values look plausible, but `last_updated` is far older than you'd \
   expect for a feed that should refresh at least every few hours. Missing information is \
   itself evidence — a record with no usable timestamp is `malformed_input`, not silently skipped.
3. `none` — none of the above apply. This is a normal, expected outcome — say so plainly, \
   do not withhold healthy records just because nothing is wrong with them.

Note honestly: this feed carries no second-source field today, so `conflicting_sources` (a \
category from the tested single-record uncertainty prompt this triage is adapted from, \
prompts/flag-data-uncertainty/v1.1.0.md) cannot be evaluated here — do not invent a second \
source or guess at one.

For each flagged record, give a confidence_score between 0 and 1 the same way the tested \
version of this check does: more severe or further out-of-range findings get a lower score, \
borderline calls get a middling score, and `none` findings sit at 0.90-1.00.

## Step 4 — Produce the output
Write a short triage summary for a human operator: a list of flagged ICBs (name, category, \
confidence_score, one-line reason) and a separate short list of healthy ICBs. Do not \
recommend or decide any clinical or operational action — this triage's only job is to flag \
data for a person to review, per this project's guardrail that the system must never make \
autonomous clinical decisions.

## Step 5 — Nothing to report
If Step 1 returns status "no_new_records", or if no record after Step 2 meets \
opel_level >= {min_opel_level}, say so plainly: state there is nothing to triage at this \
threshold, and do not fabricate a flagged record to fill the summary."""


if __name__ == "__main__":
    mcp.run(transport="stdio")
