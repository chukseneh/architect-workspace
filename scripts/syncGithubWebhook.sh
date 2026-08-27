#!/usr/bin/env bash
# Creates or updates the GitHub webhook that notifies enterprise.colaberry.ai on push.
# Requires: gh CLI authenticated with repo admin access, and COLABERRY_WEBHOOK_SECRET set.
set -euo pipefail

REPO="chukseneh/architect-workspace"
WEBHOOK_URL="https://enterprise.colaberry.ai/api/webhook/github"

if [ -z "${COLABERRY_WEBHOOK_SECRET:-}" ]; then
  echo "COLABERRY_WEBHOOK_SECRET is not set. Export it before running this script." >&2
  exit 1
fi

HOOK_ID=$(gh api "repos/${REPO}/hooks" --jq ".[] | select(.config.url==\"${WEBHOOK_URL}\") | .id" | head -1)

if [ -n "$HOOK_ID" ]; then
  gh api "repos/${REPO}/hooks/${HOOK_ID}" --method PATCH \
    -f "config[url]=${WEBHOOK_URL}" \
    -f 'config[content_type]=json' \
    -f "config[secret]=${COLABERRY_WEBHOOK_SECRET}" \
    -F active=true
  echo "Updated webhook ${HOOK_ID} on ${REPO}."
else
  gh api "repos/${REPO}/hooks" --method POST \
    -f name=web \
    -F active=true \
    -f 'events[]=push' \
    -f "config[url]=${WEBHOOK_URL}" \
    -f 'config[content_type]=json' \
    -f "config[secret]=${COLABERRY_WEBHOOK_SECRET}"
  echo "Created new webhook on ${REPO}."
fi
