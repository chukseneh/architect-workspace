"""
score_prompt.py

Plain-English purpose
----------------------
This script tests a prompt against a set of example cases (an "eval" file).

For every example case it will:
  1. Take the case's "input" values and drop them into the prompt text.
  2. Send the filled-in prompt to Claude.
  3. Compare Claude's reply against the case's "expected" answer.

At the end it prints one overall score (the fraction of cases that matched)
plus a line for each case that failed, so you can see exactly what went
wrong.

How to run it
--------------
    python scripts/score_prompt.py <path-to-prompt-file> <path-to-eval.jsonl>

Example:
    python scripts/score_prompt.py prompts/flag-data-uncertainty/prompt.txt prompts/flag-data-uncertainty/eval.jsonl

Prompt file format
-------------------
The prompt file is plain text. Anywhere you write {{field_name}}, this
script replaces it with that field's value from the current test case's
"input" object. There's also a special {{input_json}} placeholder that
inserts the whole input object as formatted JSON, in case the prompt wants
the full record instead of individual fields.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

try:
    import anthropic
except ImportError:
    print("The 'anthropic' Python package isn't installed.")
    print("Fix: run this in your terminal, then try again:")
    print("  pip install anthropic")
    sys.exit(1)


# --- Settings you might want to change -------------------------------------

# Which Claude model to test the prompt against.
MODEL_NAME = "claude-sonnet-5"

# How close two numbers need to be to still count as "matching". Expected
# answers in this project are mostly 0-1 scores, so 0.05 is a reasonable
# amount of wiggle room.
NUMBER_TOLERANCE = 0.05

# How many tokens Claude is allowed to use for its reply. The prompts in
# this project return short structured answers, but some are allowed to
# write a sentence of reasoning before or after the JSON, so this leaves
# enough room for that plus a full JSON object without getting cut off.
MAX_REPLY_TOKENS = 600


# --- Reading the .env file --------------------------------------------------

def load_env_file(env_path: Path) -> None:
    """Read KEY=VALUE lines from a .env file into the environment.

    We do this by hand (instead of adding the python-dotenv package) to
    keep this script's dependencies to just the 'anthropic' package.
    Lines that are blank, start with #, or don't contain '=' are skipped.
    """
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # setdefault: don't overwrite a value that's already set in the
        # real environment, so a manually-exported variable always wins.
        os.environ.setdefault(key, value)


def get_api_key(project_root: Path) -> str:
    """Load the .env file and return ANTHROPIC_API_KEY, or exit with a
    plain-English explanation if it's missing."""
    load_env_file(project_root / ".env")
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        print("No ANTHROPIC_API_KEY found.")
        print(f"Fix: create a file called .env in {project_root} with a line like:")
        print("  ANTHROPIC_API_KEY=sk-ant-...")
        print("Get a key from https://console.anthropic.com/settings/keys if you don't have one.")
        sys.exit(1)
    return api_key


# --- Reading the eval.jsonl file --------------------------------------------

def load_eval_cases(eval_path: Path) -> list:
    """Read one JSON object per line. Each object needs an 'input' and an
    'expected' field. Bad lines are skipped with a warning, not a crash."""
    cases = []
    with eval_path.open(encoding="utf-8") as f:
        for line_number, raw_line in enumerate(f, start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                case = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"Skipping eval.jsonl line {line_number}: not valid JSON ({e})")
                continue
            if "input" not in case or "expected" not in case:
                print(f"Skipping eval.jsonl line {line_number}: missing 'input' or 'expected'")
                continue
            cases.append(case)
    return cases


# --- Filling the prompt template --------------------------------------------

PLACEHOLDER_PATTERN = re.compile(r"\{\{(\w+)\}\}")


def fill_template(template: str, input_values: dict) -> str:
    """Replace {{field_name}} placeholders in the prompt with this case's
    input values. Unknown placeholders are left alone rather than causing
    an error, so a typo shows up as visibly wrong text instead of a crash."""

    def replace(match: re.Match) -> str:
        key = match.group(1)
        if key == "input_json":
            return json.dumps(input_values, indent=2)
        if key in input_values:
            value = input_values[key]
            return "" if value is None else str(value)
        return match.group(0)

    return PLACEHOLDER_PATTERN.sub(replace, template)


# --- Talking to Claude -------------------------------------------------------

def call_claude(client: "anthropic.Anthropic", model: str, prompt_text: str) -> str:
    """Send the filled-in prompt to Claude and return its reply as text.

    Retries once if the failure looks like a temporary connection problem.
    Does not retry an authentication failure, since retrying can't fix a
    bad API key.
    """
    last_error = None
    for attempt in range(2):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=MAX_REPLY_TOKENS,
                messages=[{"role": "user", "content": prompt_text}],
            )
            # Some models return a ThinkingBlock before the actual answer,
            # so we can't assume the first content block is always text --
            # find the first block that actually has one.
            for block in response.content:
                if getattr(block, "type", None) == "text":
                    return block.text
            raise ValueError("Claude's reply had no text content to read.")
        except anthropic.AuthenticationError:
            raise
        except (anthropic.APIConnectionError, anthropic.APITimeoutError) as e:
            last_error = e
            continue
    raise last_error


# --- Comparing Claude's reply to the expected answer ------------------------

def extract_json_object(text: str):
    """Find the first {...} block in Claude's reply and parse it as JSON.

    Claude might wrap its answer in a sentence or a markdown code fence;
    this pulls out just the JSON object and ignores everything around it,
    per the "ignore extra commentary" rule.
    """
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                candidate = text[start:i + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    return None
    return None


def values_match(expected, actual) -> bool:
    """Compare one field. Text is compared case-insensitively and ignoring
    surrounding whitespace. Numbers are allowed a small tolerance. Booleans
    must match exactly."""
    if isinstance(expected, bool) or isinstance(actual, bool):
        return expected == actual
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        # The tiny 1e-9 pad guards against floating-point rounding (e.g.
        # 0.4 - 0.35 isn't exactly 0.05 in binary), so a genuine
        # boundary-case match isn't rejected by a razor-thin margin.
        return abs(expected - actual) <= NUMBER_TOLERANCE + 1e-9
    if isinstance(expected, str) and isinstance(actual, str):
        return expected.strip().lower() == actual.strip().lower()
    return expected == actual


def is_freetext(value) -> bool:
    """True for open-ended explanation fields, like 'contributing_factors'
    (a list of sentences) or 'reason' (one sentence). These can't reasonably
    be held to an exact match, since Claude will phrase the same correct
    idea differently each time. They're still shown to you for review, just
    not used to decide pass/fail.

    A plain string only counts as free text if it's more than a few words
    long -- short category labels like "Green" or "4-24h" are still exact
    values worth scoring, not explanations."""
    if isinstance(value, list):
        return all(isinstance(item, str) for item in value)
    if isinstance(value, str):
        return len(value.split()) > 4
    return False


def case_passes(expected: dict, actual) -> bool:
    """A case only passes if every scored field named in 'expected' matches.
    Free-text fields (see is_freetext) are skipped here and reported
    separately instead. Extra fields in Claude's reply are ignored."""
    if not isinstance(actual, dict):
        return False
    for key, expected_value in expected.items():
        if is_freetext(expected_value):
            continue
        if key not in actual:
            return False
        if not values_match(expected_value, actual[key]):
            return False
    return True


# --- Main program -------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Test a prompt against a set of example cases (eval.jsonl) and "
            "print a score for how well it matches the expected answers."
        )
    )
    parser.add_argument("prompt_path", help="Path to the prompt file, e.g. prompts/flag-data-uncertainty/prompt.txt")
    parser.add_argument("eval_path", help="Path to the eval.jsonl file with test cases")
    args = parser.parse_args()

    prompt_path = Path(args.prompt_path)
    eval_path = Path(args.eval_path)
    project_root = Path(__file__).resolve().parent.parent

    if not prompt_path.exists():
        print(f"Prompt file not found: {prompt_path}")
        print("There's nothing to test yet -- write the prompt file at this path and run this again.")
        sys.exit(1)

    if not eval_path.exists():
        print(f"Eval file not found: {eval_path}")
        sys.exit(1)

    prompt_template = prompt_path.read_text(encoding="utf-8")
    cases = load_eval_cases(eval_path)
    if not cases:
        print("No usable test cases found in the eval file.")
        sys.exit(1)

    api_key = get_api_key(project_root)
    # Explicit timeout so a stuck network call can't hang forever.
    client = anthropic.Anthropic(api_key=api_key, timeout=30.0)

    passed = 0
    failures = []  # list of (case_number, expected, actual)
    freetext_notes = []  # list of (case_number, {field_name: actual_value}), for review only

    for i, case in enumerate(cases, start=1):
        filled_prompt = fill_template(prompt_template, case["input"])

        try:
            reply_text = call_claude(client, MODEL_NAME, filled_prompt)
        except anthropic.AuthenticationError:
            print("Your ANTHROPIC_API_KEY is missing or invalid.")
            print(f"Fix: open the .env file at {project_root} and check this line:")
            print("  ANTHROPIC_API_KEY=sk-ant-...")
            print("Get a key from https://console.anthropic.com/settings/keys if needed.")
            sys.exit(1)
        except Exception as e:
            print(f"Case {i}: could not reach Claude ({e}). Counting this case as failed.")
            failures.append((i, case["expected"], f"[no response: {e}]"))
            continue

        actual = extract_json_object(reply_text)
        if case_passes(case["expected"], actual):
            passed += 1
        else:
            failures.append((i, case["expected"], actual if actual is not None else reply_text))

        if isinstance(actual, dict):
            freetext_fields = {
                key: actual.get(key)
                for key, expected_value in case["expected"].items()
                if is_freetext(expected_value)
            }
            if freetext_fields:
                freetext_notes.append((i, freetext_fields))

    total = len(cases)
    score = passed / total if total else 0.0

    print()
    print(f"Score: {score:.2f}  ({passed}/{total} cases matched)")
    print(f"Model: {MODEL_NAME}")
    print(f"Cases run: {total}")

    if failures:
        print()
        print("Failed cases:")
        for i, expected, actual in failures:
            print(f"  Case {i}: expected {expected} -- got {actual}")

    if freetext_notes:
        print()
        print("Free-text fields (shown for you to review, not used to decide pass/fail):")
        for i, fields in freetext_notes:
            for key, value in fields.items():
                print(f"  Case {i} {key}: {value}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except KeyboardInterrupt:
        sys.exit(1)
    except Exception as e:
        # Catch-all so a non-programmer sees one clear line instead of a
        # multi-page Python stack trace.
        print(f"Something unexpected went wrong: {e}")
        sys.exit(1)
