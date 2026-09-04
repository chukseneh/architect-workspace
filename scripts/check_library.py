"""
check_library.py

Plain-English purpose
----------------------
This script is the quality gate for the prompt library in prompts/. It
walks every prompt folder, checks each one against the five rules in
prompts/CONTRIBUTING.md ("What makes a prompt library-ready"), and prints
a table showing where every prompt stands.

The five rules it checks:
  1. The current prompt file is named with a version number (v1.0.0.md,
     v1.1.0.md, ...).
  2. Its header has nothing left blank (name, version, purpose, model,
     inputs, output, last_eval, status).
  3. Its eval.jsonl has at least three test cases.
  4. Its last_eval field records a score of at least 0.85.
  5. Its header names which model produced that score.

A prompt's status field is a human's claim, not something this script
sets. This script only ever checks that claim:
  - status: draft   -> always listed as a draft and skipped. Never fails.
  - status: ready   -> checked against all five rules. If any rule isn't
                        actually met, this is reported as FAIL, and the
                        whole script exits with an error so the mismatch
                        between "claims ready" and "isn't" gets noticed.

How to run it
--------------
    python scripts/check_library.py
"""

import json
import re
import sys
from pathlib import Path

MINIMUM_SCORE = 0.85
MINIMUM_CASES = 3

VERSION_FILENAME_PATTERN = re.compile(r"^v(\d+)\.(\d+)\.(\d+)\.md$")
REQUIRED_HEADER_FIELDS = ["name", "version", "purpose", "model", "inputs", "output", "last_eval", "status"]


def find_latest_version_file(prompt_dir: Path):
    """Return the path to the highest-numbered vX.Y.Z.md file in this
    folder, or None if there isn't one. Older version files are left
    alone -- we only ever evaluate the newest one."""
    candidates = []
    for path in prompt_dir.iterdir():
        match = VERSION_FILENAME_PATTERN.match(path.name)
        if match:
            version_tuple = tuple(int(part) for part in match.groups())
            candidates.append((version_tuple, path))
    if not candidates:
        return None
    candidates.sort(key=lambda pair: pair[0])
    return candidates[-1][1]


def parse_header(text: str) -> dict:
    """Read the --- ... --- header block at the top of a prompt file into
    a dict of field name -> its full text (inline value plus any indented
    lines under it, like the inputs/output lists). This is a small
    line-based reader, not a full YAML parser -- it's enough for this
    project's flat header style and keeps this script dependency-free."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not match:
        return {}
    fields = {}
    current_key = None
    for line in match.group(1).split("\n"):
        top_level = re.match(r"^([A-Za-z_][A-Za-z0-9_]*):(.*)$", line)
        if top_level:
            current_key = top_level.group(1)
            fields[current_key] = top_level.group(2).strip()
        elif current_key is not None and line.strip():
            fields[current_key] += " " + line.strip()
    return fields


def header_is_complete(fields: dict) -> bool:
    """True only if every required field is present and has real content,
    not just an empty 'field:' line."""
    return all(fields.get(name, "").strip() for name in REQUIRED_HEADER_FIELDS)


def count_eval_cases(eval_path: Path) -> int:
    """Count usable test cases (lines with both 'input' and 'expected')
    in eval.jsonl. Returns 0 if the file is missing."""
    if not eval_path.exists():
        return 0
    count = 0
    for raw_line in eval_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            case = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "input" in case and "expected" in case:
            count += 1
    return count


def extract_score(last_eval_text: str):
    """Pull the score number (like 1.00 or 0.80) out of a last_eval note
    such as '2026-09-05 -- 1.00 (5/5 cases matched, ...)'. Returns None
    if no score-shaped number is found."""
    match = re.search(r"\b(\d\.\d+)\b", last_eval_text)
    return float(match.group(1)) if match else None


def evaluate_prompt(prompt_dir: Path):
    """Check one prompt folder against the five library-ready rules.
    Returns a dict describing what was found, or None if this folder
    doesn't contain a versioned prompt file at all (not a prompt)."""
    latest_file = find_latest_version_file(prompt_dir)
    if latest_file is None:
        return None

    fields = parse_header(latest_file.read_text(encoding="utf-8"))
    cases = count_eval_cases(prompt_dir / "eval.jsonl")
    score = extract_score(fields.get("last_eval", ""))
    complete_header = header_is_complete(fields)

    criteria_met = (
        complete_header
        and cases >= MINIMUM_CASES
        and score is not None
        and score >= MINIMUM_SCORE
    )

    status = fields.get("status", "").strip().lower()
    if status == "ready":
        verdict = "PASS" if criteria_met else "FAIL"
    else:
        verdict = "DRAFT"

    return {
        "name": fields.get("name", prompt_dir.name).strip() or prompt_dir.name,
        "version": fields.get("version", "?").strip() or "?",
        "model": fields.get("model", "?").strip() or "?",
        "score": f"{score:.2f}" if score is not None else "--",
        "status": fields.get("status", "?").strip() or "?",
        "verdict": verdict,
    }


def print_table(rows: list) -> None:
    columns = ["name", "version", "model", "score", "status", "verdict"]
    headers = ["Name", "Version", "Model", "Score", "Status", "Pass/Fail"]
    widths = [
        max(len(headers[i]), max((len(row[col]) for row in rows), default=0))
        for i, col in enumerate(columns)
    ]

    def format_row(values):
        return "  ".join(value.ljust(widths[i]) for i, value in enumerate(values))

    print(format_row(headers))
    print(format_row(["-" * w for w in widths]))
    for row in rows:
        print(format_row([row[col] for col in columns]))


def main() -> None:
    project_root = Path(__file__).resolve().parent.parent
    prompts_dir = project_root / "prompts"

    rows = []
    for entry in sorted(prompts_dir.iterdir()):
        if not entry.is_dir() or entry.name.startswith("_"):
            continue
        result = evaluate_prompt(entry)
        if result is not None:
            rows.append(result)

    if not rows:
        print("No prompt folders with a versioned prompt file were found under prompts/.")
        sys.exit(0)

    print_table(rows)

    failures = [row for row in rows if row["verdict"] == "FAIL"]
    print()
    if failures:
        print(f"{len(failures)} prompt(s) claim status: ready but do not actually meet all five rules:")
        for row in failures:
            print(f"  - {row['name']} (v{row['version']})")
        print("Fix these before they can truly be called library-ready.")
        sys.exit(1)

    print("No prompt claiming to be library-ready is failing its checks.")
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        print(f"Something unexpected went wrong: {e}")
        sys.exit(1)
