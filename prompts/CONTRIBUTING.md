# Contributing to the prompt library

Welcome — if you're reading this, you're about to add or edit a prompt in this folder. This page explains how a prompt folder is put together and, most importantly, what it takes for a prompt to be called **library-ready** instead of a **draft**.

## How a prompt folder is built

1. Copy `_template/v1.0.0.md` into a new folder named after the prompt (verb-noun, lowercase-hyphenated, e.g. `predict-pressure`).
2. Write `eval.jsonl` in that same folder **before** you write the prompt itself: a handful of test cases, each with an `input` and the `expected` answer a human actually confirmed line by line. Don't guess the expected answers yourself and call it done — propose them, and have someone sign off.
3. Fill in the prompt file's header and body to match the shape those confirmed answers imply.
4. Score it with `python scripts/score_prompt.py <prompt file> <eval file>`.
5. If something fails, fix either the prompt or the eval case (whichever was actually wrong), save the fix as a **new** version file, and re-score. Never overwrite a version you already have a score for.

## What makes a prompt "library-ready"

A prompt is **library-ready** only when every one of these five things is true. Miss any one of them and it stays a **draft** — and that's fine. A draft is an expected, normal state, not a failure.

1. **A version number in the filename, with older versions kept.** The prompt file is named like `v1.0.0.md`, `v1.1.0.md`, and so on. When you fix something, you save a new version number — you don't edit or delete the old file. The folder should show its own history.
2. **A complete header, with nothing left blank.** Every field in the header block at the top of the file — `name`, `version`, `purpose`, `model`, `inputs`, `output`, `last_eval`, `status` — has real content in it. No empty fields.
3. **At least three test cases a human actually confirmed.** `eval.jsonl` has three or more lines, each a real example with an `input` and an `expected` answer someone reviewed and signed off on — not just something the AI proposed and nobody checked.
4. **A recorded score of at least 0.85.** The prompt has actually been run against its `eval.jsonl` with `scripts/score_prompt.py`, and the score it got — 85% or better of the test cases matching — is written into the `last_eval` field, not just remembered or assumed.
5. **A record of which model produced that score.** The header's `model` field names the exact model (e.g. `claude-sonnet-5`) that was used to get the recorded score. A score is meaningless if nobody can say which model earned it.

## Draft vs. library-ready

The `status` field in a prompt's header is a person's honest claim, not something a script sets automatically:

- Leave `status: draft` for anything still being worked on, still failing one of the five checks above, or that you simply haven't finished reviewing yet. **Drafts are allowed, expected, and not a problem.**
- Only change it to `status: ready` once you, a human, have personally checked that all five conditions above are actually true.

`scripts/check_library.py` exists to keep this claim honest. It walks every prompt folder, checks the five conditions for itself, and treats `status: ready` as a promise it verifies. If a prompt claims to be ready but doesn't actually meet all five conditions, the check fails the whole run. A prompt marked `draft` is never failed by this check, no matter what state it's in — it's just listed as a draft and skipped, because a draft was never promising to be finished in the first place.

## A note on scores

`score_prompt.py` only checks the fields that have one clear right answer (a category, a number within a small tolerance, and so on). Free-text fields — an explanation, a rationale, a headline — are shown to you after every run so you can read them, but they never count toward the score, because there's rarely one exact correct sentence. Read them anyway; a prompt can score 1.00 on its scored fields and still be writing something odd in its free text.
