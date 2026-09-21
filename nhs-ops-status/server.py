import asyncio
import json
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, Literal, TypedDict
from urllib.parse import unquote, urlparse
from urllib.request import url2pathname

from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ResourceNotFoundError, ToolError
from mcp_types import CreateMessageResult, EmptyResult, LoggingLevel, SamplingMessage, SetLevelRequestParams, TextContent
from pydantic import Field

import audit_log

mcp = MCPServer("nhs-ops-status")


async def _handle_set_logging_level(_ctx: Any, _params: SetLevelRequestParams) -> EmptyResult:
    """No-op — its only job is to make `logging/setLevel` a registered method,
    which is what makes MCPServer declare the `logging` capability at
    handshake (MCPServer has no public toggle for this deprecated-but-still-
    functional protocol feature; see the module-level note below).

    WHY: without the declaration the client drops every log notification on
    the floor. Nothing errors. You will think your code is broken and it is not.
    """
    return EmptyResult()


mcp._lowlevel_server.add_request_handler("logging/setLevel", SetLevelRequestParams, _handle_set_logging_level)


async def resolve_within_roots(ctx: Context, correlation_id: str, requested_path: str) -> Path | None:
    """Ask the client for its declared filesystem roots (`roots/list` —
    deprecated as of SEP-2577 but still functional; see the module note
    below), then decide whether `requested_path` may be read.

    THE ORDER IS THE WHOLE CONTROL. Resolve first, compare second:

    1. Resolve `requested_path` to its real, canonical form with
       `Path.resolve()` — this collapses `..` segments AND follows symlinks
       to whatever they actually point at.
    2. Only then check whether that resolved path sits inside one of the
       resolved roots, with `Path.is_relative_to`.

    A plain string-prefix check on the RAW path is not safe and must not be
    used here: `"/allowed/../../etc/passwd".startswith("/allowed")` is True
    even though the path it names is nowhere near `/allowed`, and a symlink
    literally sitting inside the allowed root (e.g. `/allowed/link`) can
    point anywhere on disk while its own path string still looks contained
    — the string never lies about where it starts, only `resolve()` reveals
    where it actually ends up. Comparing strings checks what the path is
    spelled like; comparing resolved paths checks where it actually is.

    Returns the resolved `Path` if it is inside an allowed root, `None` if
    it is denied (no declared roots, no `file://` roots, or outside all of
    them).
    """
    roots_start = time.monotonic()
    await _log_event(
        ctx, correlation_id, "info", "roots_list_started", "started",
        context={"boundary": "external_call"},
    )
    try:
        roots_result = await ctx.session.list_roots()
    except Exception as exc:
        # No back-channel, client refused, or the call errored some other
        # way — deny by default, not allow by default, but never swallow
        # the reason silently: a denial that can't be traced back to why
        # is not auditable.
        await _log_event(
            ctx, correlation_id, "warning", "roots_list_completed", "failure",
            duration_ms=(time.monotonic() - roots_start) * 1000,
            error_class=type(exc).__name__,
            context={"boundary": "external_call"},
        )
        return None
    await _log_event(
        ctx, correlation_id, "info", "roots_list_completed", "success",
        duration_ms=(time.monotonic() - roots_start) * 1000,
        context={"boundary": "external_call", "root_count": len(roots_result.roots)},
    )

    allowed_roots = []
    for root in roots_result.roots:
        if root.uri.scheme != "file":
            continue
        raw = url2pathname(unquote(urlparse(str(root.uri)).path))
        allowed_roots.append(Path(raw).resolve())

    if not allowed_roots:
        # The client answered, but declared zero roots (or none with a
        # file:// scheme we can use) — deny by default rather than treat
        # "nothing declared" as "everything allowed". Logged as its own
        # event, distinct from a failed roots/list call above and from an
        # outside-the-root denial below, so the reason is never ambiguous.
        await _log_event(
            ctx, correlation_id, "warning", "roots_declared_empty", "deny_by_default",
            context={"boundary": "external_call", "reason": "client_declared_no_accessible_roots"},
        )
        return None

    resolved = Path(requested_path).resolve()

    for root in allowed_roots:
        try:
            if resolved.is_relative_to(root):
                return resolved
        except ValueError:
            continue
    return None


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
# Safe as a plain, unlocked dict only because of this server's stdio,
# single-caller-per-process transport (docs/TRANSPORT_DECISION.md) — there
# is no concurrent writer to race. A multi-caller transport would need a
# real store (or at least a lock) here, not this dict as-is.
_INGESTION_LEDGER: dict[str, IngestResult] = {}

# Real, on-disk persistence layer (see audit_log.py) — separate from the
# in-memory ledger above. Opened once at import time, same as CENTRAL_DATA,
# so a broken database fails the server at startup rather than mid-request.
_AUDIT_POOL = audit_log.open_pool()


async def _log_event(
    ctx: Context,
    correlation_id: str,
    level: LoggingLevel,
    event: str,
    outcome: str,
    *,
    duration_ms: float | None = None,
    error_class: str | None = None,
    context: dict[str, Any] | None = None,
) -> None:
    """One structured log line, dual-delivered: stderr (stdout is reserved for
    the JSON-RPC wire protocol on stdio transport) and an MCP
    `notifications/message` to the client, gated by the capability declared
    above. Payload is a structured object with stable field names — never a
    formatted sentence — so it stays greppable across every invocation.

    Never pass an API key, connection string, credential, or raw customer
    record in `context`: identifiers, counts, and durations only.
    """
    payload: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "service": "nhs-ops-status",
        "event": event,
        "correlation_id": correlation_id,
        "outcome": outcome,
    }
    if duration_ms is not None:
        payload["duration_ms"] = round(duration_ms, 1)
    if error_class is not None:
        payload["error_class"] = error_class
    if context:
        payload["context"] = context

    print(json.dumps(payload), file=sys.stderr)
    try:
        # MCP's own opt-in gating (the capability above, plus each client's
        # requested level) decides whether this actually reaches anyone —
        # ctx.log is a safe no-op when nobody asked for it.
        await ctx.log(level, payload)
    except Exception as exc:
        print(
            json.dumps(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "level": "warning",
                    "service": "nhs-ops-status",
                    "event": "log_notification_delivery_failed",
                    "correlation_id": correlation_id,
                    "outcome": "failure",
                    "error_class": type(exc).__name__,
                }
            ),
            file=sys.stderr,
        )


def _progress_token(ctx: Context) -> str | int | None:
    """The client's progress token for the current request, or None if it
    never asked for progress updates on this call."""
    return (ctx.request_context.meta or {}).get("progress_token")


async def _report_progress(
    ctx: Context,
    progress_token: str | int | None,
    progress: float,
    total: float | None = None,
    message: str | None = None,
) -> None:
    """Send one MCP progress notification for a long-running tool step — the
    one shared place every tool routes through, so none of them duplicate
    this gating logic.

    Emits nothing, and changes nothing else about the tool's behavior, when
    `progress_token` is None: the client never asked for updates on this
    request, so it gets exactly the pre-progress behavior.

    `total` must be a real, known denominator (a record count, a byte
    count, etc.) or omitted entirely — never fabricate one. If the total
    amount of work is genuinely unknown, pass total=None and say so in
    `message` instead of guessing a percentage.
    """
    if progress_token is None:
        return
    await ctx.report_progress(progress, total, message)


@mcp.tool()
async def search_trust_status(
    query: Annotated[
        str,
        Field(min_length=1, max_length=200, description="Trust name or region keyword to search for, e.g. 'Leeds' or 'North West'."),
    ],
    ctx: Context,
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
    start = time.monotonic()
    correlation_id = str(uuid.uuid4())  # one id, reused on every log line for this invocation
    await _log_event(
        ctx, correlation_id, "info", "tool_invocation_started", "started",
        context={"tool": "search_trust_status", "query_length": len(query), "limit": limit},
    )

    try:
        q = query.strip().lower()
        matches = [
            row for row in TRUST_STATUS
            if q in row["trust_name"].lower() or q in row["region"].lower()
        ]
        result = matches[:limit]
    except Exception as exc:
        await _log_event(
            ctx, correlation_id, "error", "tool_invocation_failed", "failure",
            duration_ms=(time.monotonic() - start) * 1000,
            error_class=type(exc).__name__,
            context={"tool": "search_trust_status"},
        )
        raise

    await _log_event(
        ctx, correlation_id, "info", "tool_invocation_completed", "success",
        duration_ms=(time.monotonic() - start) * 1000,
        context={"tool": "search_trust_status", "result_count": len(result), "limit": limit},
    )
    return result


_SAMPLING_TIMEOUT_SECONDS = 30.0
_SAMPLING_PROGRESS_INTERVAL_SECONDS = 1.0
_SAMPLING_MAX_TOKENS = 300
_SAMPLING_SYSTEM_PROMPT = (
    "You are assisting NHS operational staff in reasoning about a single trust's "
    "escalation risk from its current operational metrics. Use only the metrics "
    "given in the user message — never invent or assume a figure. This is advisory "
    "only: a human operator always makes the final call, so never issue a clinical "
    "or operational directive. In 2-4 concise sentences: state a risk level (low, "
    "medium, or high), name which of the three metrics is the primary driver, and "
    "suggest one thing a human operator should check next."
)


def _rule_based_escalation_fallback(status: TrustStatus) -> str:
    """Deterministic, no-model substitute for the reasoning step in
    assess_trust_escalation_risk. Used only when sampling is unavailable or
    refused — coarser than a real assessment (fixed thresholds, no weighing
    the three metrics against each other), but it is a real, useful risk
    read rather than an empty answer.
    """
    if (
        status["ed_wait_minutes"] >= 180
        or status["bed_occupancy_pct"] >= 95
        or status["ambulance_handover_delay_minutes"] >= 45
    ):
        level = "high"
    elif (
        status["ed_wait_minutes"] >= 140
        or status["bed_occupancy_pct"] >= 90
        or status["ambulance_handover_delay_minutes"] >= 25
    ):
        level = "medium"
    else:
        level = "low"
    return (
        f"[Degraded — rule-based, not model-reasoned] Risk level: {level}. "
        f"ED wait {status['ed_wait_minutes']}min, bed occupancy {status['bed_occupancy_pct']}%, "
        f"ambulance handover delay {status['ambulance_handover_delay_minutes']}min, checked against "
        "fixed thresholds rather than weighed together. A human operator should review the full "
        "metrics directly — this is not a model-reasoned assessment."
    )


class EscalationRiskAssessment(TypedDict):
    trust_name: str
    region: str
    metrics: TrustStatus
    assessment: str
    source: Literal["model_reasoning", "degraded_no_sampling"]


@mcp.tool()
async def assess_trust_escalation_risk(
    query: Annotated[
        str,
        Field(
            min_length=1,
            max_length=200,
            description="Trust name or region keyword identifying the trust to assess, e.g. 'Leeds' or 'St Thomas'.",
        ),
    ],
    ctx: Context,
) -> EscalationRiskAssessment:
    """Call this when the user asks you to judge whether a specific NHS trust looks like
    it is heading toward a critical incident — not just what its current numbers are (use
    search_trust_status for that instead). This reasons over ED wait time, bed occupancy,
    and ambulance handover delay together to produce a short risk narrative; it is advisory
    only and never issues a clinical or operational directive. If the connected client
    can't or won't run a model completion for this, you still get a real (but coarser,
    rule-based) answer — never an empty one — and `source` in the response tells you which
    kind you got."""
    start = time.monotonic()
    correlation_id = str(uuid.uuid4())  # one id, reused on every log line for this invocation
    progress_token = _progress_token(ctx)
    await _log_event(
        ctx, correlation_id, "info", "tool_invocation_started", "started",
        context={"tool": "assess_trust_escalation_risk", "query_length": len(query)},
    )

    try:
        # Step 1 — fetch the real data ourselves. No model call for this part.
        q = query.strip().lower()
        match = next(
            (row for row in TRUST_STATUS if q in row["trust_name"].lower() or q in row["region"].lower()),
            None,
        )
        if match is None:
            raise ToolError(f"No trust found matching {query!r}.")

        # Step 2 — reason over that data. Only attempt sampling if the client
        # told us at handshake it can serve one; otherwise skip straight to
        # the deterministic fallback rather than round-tripping a request
        # that can only fail.
        if ctx.client_capabilities is None or ctx.client_capabilities.sampling is None:
            await _log_event(
                ctx, correlation_id, "warning", "sampling_unavailable", "degraded",
                context={"tool": "assess_trust_escalation_risk", "reason": "client_declared_no_sampling_capability"},
            )
            assessment = _rule_based_escalation_fallback(match)
            source: Literal["model_reasoning", "degraded_no_sampling"] = "degraded_no_sampling"
        else:
            sampling_start = time.monotonic()
            await _log_event(
                ctx, correlation_id, "info", "sampling_request_started", "started",
                context={"tool": "assess_trust_escalation_risk", "trust_name": match["trust_name"]},
            )
            try:
                # >>> The completion request leaves this server for the client here. <<<
                sampling_task = asyncio.ensure_future(
                    ctx.session.create_message(
                        messages=[
                            SamplingMessage(
                                role="user",
                                content=TextContent(
                                    type="text",
                                    text=(
                                        "Assess escalation risk for this NHS trust from its current "
                                        f"metrics:\n{json.dumps(match)}"
                                    ),
                                ),
                            )
                        ],
                        max_tokens=_SAMPLING_MAX_TOKENS,
                        system_prompt=_SAMPLING_SYSTEM_PROMPT,
                    )
                )
                # How long this takes is genuinely unknown up front — it depends on
                # the client's model, and often on a human approving the request —
                # so there is no real total to report. Tick a heartbeat of real
                # elapsed time instead of inventing a percentage against a fake
                # denominator; asyncio.shield keeps each 1s poll from cancelling
                # the underlying request while we wait.
                elapsed_seconds = 0.0
                while True:
                    try:
                        result: CreateMessageResult = await asyncio.wait_for(
                            asyncio.shield(sampling_task), timeout=_SAMPLING_PROGRESS_INTERVAL_SECONDS
                        )
                        break
                    except TimeoutError:
                        elapsed_seconds += _SAMPLING_PROGRESS_INTERVAL_SECONDS
                        if elapsed_seconds >= _SAMPLING_TIMEOUT_SECONDS:
                            sampling_task.cancel()
                            raise TimeoutError(
                                f"No sampling response from client within {_SAMPLING_TIMEOUT_SECONDS:.0f}s."
                            ) from None
                        await _report_progress(
                            ctx, progress_token, elapsed_seconds, None,
                            f"Waiting on client model completion — {elapsed_seconds:.0f}s elapsed, total unknown.",
                        )
            except Exception as exc:
                # Client has no sampling back-channel, declined the request,
                # timed out, or errored some other way — none of that may
                # crash this tool or produce a silent empty answer.
                await _log_event(
                    ctx, correlation_id, "warning", "sampling_request_completed", "failure",
                    duration_ms=(time.monotonic() - sampling_start) * 1000,
                    error_class=type(exc).__name__,
                    context={"tool": "assess_trust_escalation_risk", "trust_name": match["trust_name"]},
                )
                assessment = _rule_based_escalation_fallback(match)
                source = "degraded_no_sampling"
            else:
                await _log_event(
                    ctx, correlation_id, "info", "sampling_request_completed", "success",
                    duration_ms=(time.monotonic() - sampling_start) * 1000,
                    # client_reported_model is whatever the client says it used — this
                    # server never selects, requests, or hardcodes a model name itself.
                    context={
                        "tool": "assess_trust_escalation_risk",
                        "trust_name": match["trust_name"],
                        "client_reported_model": result.model,
                    },
                )
                if isinstance(result.content, TextContent):
                    assessment = result.content.text
                    source = "model_reasoning"
                else:
                    await _log_event(
                        ctx, correlation_id, "warning", "sampling_result_not_text", "degraded",
                        context={"tool": "assess_trust_escalation_risk", "content_type": type(result.content).__name__},
                    )
                    assessment = _rule_based_escalation_fallback(match)
                    source = "degraded_no_sampling"

        response: EscalationRiskAssessment = {
            "trust_name": match["trust_name"],
            "region": match["region"],
            "metrics": match,
            "assessment": assessment,
            "source": source,
        }
    except ToolError:
        await _log_event(
            ctx, correlation_id, "warning", "tool_invocation_failed", "not_found",
            duration_ms=(time.monotonic() - start) * 1000,
            error_class="NotFoundError",
            context={"tool": "assess_trust_escalation_risk", "query": query},
        )
        raise
    except Exception as exc:
        await _log_event(
            ctx, correlation_id, "error", "tool_invocation_failed", "failure",
            duration_ms=(time.monotonic() - start) * 1000,
            error_class=type(exc).__name__,
            context={"tool": "assess_trust_escalation_risk"},
        )
        raise

    await _log_event(
        ctx, correlation_id, "info", "tool_invocation_completed", "success",
        duration_ms=(time.monotonic() - start) * 1000,
        context={"tool": "assess_trust_escalation_risk", "source": source},
    )
    return response


# Bare filenames passed to read_trust_incident_report resolve against this
# directory. It only matters for convenience (so a caller can pass just
# "leeds-sitrep-2026-08-27.txt"); it grants no access by itself — every
# candidate path, bare filename or not, still has to pass resolve_within_roots.
_REPORTS_DIR = Path(__file__).parent / "reports"


@mcp.tool()
async def read_trust_incident_report(
    path: Annotated[
        str,
        Field(
            min_length=1,
            max_length=500,
            description="Path to an NHS trust incident/situation report file, e.g. 'leeds-sitrep-2026-08-27.txt'. May be a bare filename, a relative path, or an absolute path.",
        ),
    ],
    ctx: Context,
) -> str:
    """Call this when the user asks you to read the contents of a specific
    NHS trust incident or situation report file by name or path. Only files
    inside a root the connected client has declared as accessible can be
    read — this refuses anything outside those roots regardless of how the
    path is written (relative, absolute, '..', or a symlink/junction). If it
    refuses, tell the user the file is outside the accessible area rather
    than guessing at its contents."""
    start = time.monotonic()
    correlation_id = str(uuid.uuid4())  # one id, reused on every log line for this invocation
    await _log_event(
        ctx, correlation_id, "info", "tool_invocation_started", "started",
        context={"tool": "read_trust_incident_report", "requested_path": path},
    )

    candidate = path if Path(path).is_absolute() else str(_REPORTS_DIR / path)
    resolved = await resolve_within_roots(ctx, correlation_id, candidate)
    if resolved is None:
        # Denial is expected, not exceptional: log it so a blocked attempt is
        # visible (never silent), and return a result the model can read and
        # explain, rather than an opaque crash.
        await _log_event(
            ctx, correlation_id, "warning", "filesystem_access_denied", "denied",
            duration_ms=(time.monotonic() - start) * 1000,
            error_class="AccessDenied",
            context={"tool": "read_trust_incident_report", "requested_path": path},
        )
        # raise ToolError, not some other exception: the MCPServer dispatcher
        # (server.py _handle_call_tool) catches exactly this and converts it
        # to CallToolResult(is_error=True) — a normal tool result the caller
        # reads and reports, not a JSON-RPC-level protocol failure. That is
        # what "return an error result rather than throw" means at the wire.
        raise ToolError(f"Access denied: {path!r} is not inside an accessible root.")

    try:
        content = resolved.read_text(encoding="utf-8")
    except Exception as exc:
        await _log_event(
            ctx, correlation_id, "error", "tool_invocation_failed", "failure",
            duration_ms=(time.monotonic() - start) * 1000,
            error_class=type(exc).__name__,
            context={"tool": "read_trust_incident_report", "requested_path": path},
        )
        raise ToolError(f"Could not read {path!r}: {exc}") from exc

    await _log_event(
        ctx, correlation_id, "info", "tool_invocation_completed", "success",
        duration_ms=(time.monotonic() - start) * 1000,
        context={"tool": "read_trust_incident_report", "byte_count": len(content)},
    )
    return content


@mcp.tool()
async def ingest_nhs_central_data(
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
    ctx: Context,
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
    correlation_id = str(uuid.uuid4())  # one id, reused on every log line for this invocation
    progress_token = _progress_token(ctx)

    await _log_event(
        ctx, correlation_id, "info", "tool_invocation_started", "started",
        context={"tool": "ingest_nhs_central_data", "idempotency_key": idempotency_key, "limit": limit},
    )

    try:
        if idempotency_key in _INGESTION_LEDGER:
            result = _INGESTION_LEDGER[idempotency_key]
            await _log_event(
                ctx, correlation_id, "info", "tool_invocation_completed", "replayed_idempotent",
                duration_ms=(time.monotonic() - start) * 1000,
                context={"tool": "ingest_nhs_central_data", "idempotency_key": idempotency_key, "status": result["status"]},
            )
            return result

        matches: list[CentralDataRecord] = []
        total = len(CENTRAL_DATA)
        for i, record in enumerate(CENTRAL_DATA, start=1):
            # Real, known total (the record count) — a genuine running count,
            # not a guessed percentage.
            await _report_progress(ctx, progress_token, i, total, f"Checking {record['icb_name']}")
            if record["last_updated"] >= since:
                matches.append(record)
        matches = matches[:limit]

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

        # Best-effort: a real, on-disk audit row for this run. This is
        # observability infra riding alongside the primary operation, not
        # part of its contract — mirrors how _log_event treats ctx.log as a
        # safe no-op on failure. A broken audit write must not make an
        # otherwise-successful ingestion fail; it is logged, not swallowed.
        try:
            await asyncio.to_thread(
                audit_log.record_ingestion_sync,
                _AUDIT_POOL,
                idempotency_key=idempotency_key,
                correlation_id=correlation_id,
                status=result["status"],
                records_ingested=result["records_ingested"],
            )
        except Exception as exc:
            await _log_event(
                ctx, correlation_id, "warning", "audit_log_write_failed", "failure",
                error_class=type(exc).__name__,
                context={"tool": "ingest_nhs_central_data", "boundary": "external_call"},
            )
    except Exception as exc:
        await _log_event(
            ctx, correlation_id, "error", "tool_invocation_failed", "failure",
            duration_ms=(time.monotonic() - start) * 1000,
            error_class=type(exc).__name__,
            context={"tool": "ingest_nhs_central_data", "idempotency_key": idempotency_key},
        )
        raise

    await _log_event(
        ctx, correlation_id, "info", "tool_invocation_completed", result["status"],
        duration_ms=(time.monotonic() - start) * 1000,
        context={"tool": "ingest_nhs_central_data", "idempotency_key": idempotency_key, "records_ingested": result["records_ingested"]},
    )
    return result


_AUDIT_QUERY_TIMEOUT_SECONDS = 5.0


@mcp.tool()
async def query_ingestion_audit_log(
    idempotency_key: Annotated[
        str,
        Field(
            min_length=8,
            max_length=128,
            pattern=r"^[A-Za-z0-9_-]+$",
            description="The idempotency_key an earlier ingest_nhs_central_data call used, e.g. 'daily-2026-08-27'.",
        ),
    ],
    ctx: Context,
) -> list[audit_log.AuditLogEntry]:
    """Call this when the user asks whether — or how many times, and when —
    an NHS central data ingestion run for a given idempotency_key has
    actually been recorded. This reads the real, on-disk ingestion audit
    log (a separate SQLite database from the in-memory idempotency ledger
    ingest_nhs_central_data itself uses), so it answers "what actually got
    logged" even across a server restart, which the in-memory ledger
    cannot. Returns one entry per completed ingestion run for that key, in
    the order they happened — usually zero or one entry, since
    ingest_nhs_central_data is idempotent and only writes a fresh row on a
    run that was not itself a replay."""
    start = time.monotonic()
    correlation_id = str(uuid.uuid4())  # one id, reused on every log line for this invocation
    await _log_event(
        ctx, correlation_id, "info", "tool_invocation_started", "started",
        context={"tool": "query_ingestion_audit_log", "idempotency_key": idempotency_key},
    )

    try:
        db_start = time.monotonic()
        await _log_event(
            ctx, correlation_id, "info", "audit_db_query_started", "started",
            context={"tool": "query_ingestion_audit_log", "boundary": "external_call"},
        )
        # A local, indexed, single-key SQLite lookup does not realistically
        # approach two seconds, so per this requirement's own condition
        # ("if the call can take more than about two seconds") no progress
        # heartbeat is added here — unlike assess_trust_escalation_risk's
        # sampling wait, there is no genuine multi-second signal to tick
        # against. The boundary is still fully logged (start/finish, with
        # duration) below, satisfying the logging half regardless of timing.
        try:
            # idempotency_key is passed straight through as a bound SQL
            # parameter inside query_by_idempotency_key_sync — never
            # interpolated into the query text. See audit_log.py.
            rows = await asyncio.wait_for(
                asyncio.to_thread(audit_log.query_by_idempotency_key_sync, _AUDIT_POOL, idempotency_key),
                timeout=_AUDIT_QUERY_TIMEOUT_SECONDS,
            )
        except TimeoutError:
            await _log_event(
                ctx, correlation_id, "error", "audit_db_query_completed", "failure",
                duration_ms=(time.monotonic() - db_start) * 1000,
                error_class="TimeoutError",
                context={"tool": "query_ingestion_audit_log", "boundary": "external_call"},
            )
            raise ToolError(
                f"Audit log query timed out after {_AUDIT_QUERY_TIMEOUT_SECONDS:.0f}s."
            ) from None
        except Exception as exc:
            await _log_event(
                ctx, correlation_id, "error", "audit_db_query_completed", "failure",
                duration_ms=(time.monotonic() - db_start) * 1000,
                error_class=type(exc).__name__,
                context={"tool": "query_ingestion_audit_log", "boundary": "external_call"},
            )
            # Never pass str(exc) to the caller: a sqlite3 error message can
            # embed the database file path — this server's equivalent of a
            # connection string — which must never leave the process in a
            # log, let alone in a result the caller reads directly.
            raise ToolError("Audit log query failed. See server logs for details.") from None
        else:
            await _log_event(
                ctx, correlation_id, "info", "audit_db_query_completed", "success",
                duration_ms=(time.monotonic() - db_start) * 1000,
                context={"tool": "query_ingestion_audit_log", "boundary": "external_call", "result_count": len(rows)},
            )
    except ToolError:
        await _log_event(
            ctx, correlation_id, "warning", "tool_invocation_failed", "failure",
            duration_ms=(time.monotonic() - start) * 1000,
            context={"tool": "query_ingestion_audit_log", "idempotency_key": idempotency_key},
        )
        raise
    except Exception as exc:
        await _log_event(
            ctx, correlation_id, "error", "tool_invocation_failed", "failure",
            duration_ms=(time.monotonic() - start) * 1000,
            error_class=type(exc).__name__,
            context={"tool": "query_ingestion_audit_log"},
        )
        raise

    await _log_event(
        ctx, correlation_id, "info", "tool_invocation_completed", "success",
        duration_ms=(time.monotonic() - start) * 1000,
        context={"tool": "query_ingestion_audit_log", "result_count": len(rows)},
    )
    return rows


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
    # Transport and state model are a deliberate choice, recorded in
    # docs/TRANSPORT_DECISION.md — read that first if either looks wrong.
    #
    # stdio, single caller, single process, in-memory process-lifetime state
    # (see _INGESTION_LEDGER above). This assumption is load-bearing: the
    # client launches this file as its own child process and talks to it
    # over that one process's stdin/stdout, so there is exactly one caller
    # per running instance and no concurrent access to _INGESTION_LEDGER to
    # guard against. Do NOT scale this by putting it behind a shared HTTP
    # gateway, running multiple instances against one shared ledger, or
    # otherwise serving more than one caller from a single process — none of
    # that is safe under this state model. If a second concurrent caller
    # shows up, that is the revisit trigger the decision record names:
    # switch to a stateless HTTP transport with no in-memory session map
    # (see the comment on that option in TRANSPORT_DECISION.md) rather than
    # bolting concurrency onto this dict.
    print(
        json.dumps(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "level": "info",
                "service": "nhs-ops-status",
                "event": "server_startup",
                "outcome": "success",
                "context": {
                    "transport": "stdio",
                    "state_model": "in_memory_process_lifetime",
                    "single_caller_assumption": True,
                },
            }
        ),
        file=sys.stderr,
    )
    mcp.run(transport="stdio")
