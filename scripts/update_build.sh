#!/bin/sh
set -e
stamp="$(date '+%Y-%m-%d %H:%M')"
sha="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
printf '%s  %s\n' "$stamp" "$sha" > build.txt
