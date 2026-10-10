#!/usr/bin/env bash
set -euo pipefail

: "${COMMIT_REF:?COMMIT_REF must be set}"
if [[ ! "$COMMIT_REF" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "COMMIT_REF must be a full commit SHA" >&2
  exit 1
fi
timestamp=$(date -u '+%Y-%m-%d %H:%M UTC')

printf '%s  %.7s\n' "$timestamp" "$COMMIT_REF" > build.txt
