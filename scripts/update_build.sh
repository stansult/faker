#!/bin/sh
set -e
stamp="$(date '+%Y-%m-%d %H:%M')"
sha="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
printf '%s  %s\n' "$stamp" "$sha" > build.txt
if ! git diff --quiet -- build.txt; then
  git add build.txt
fi

python3 - "$sha" <<'PY'
import sys
import subprocess
from pathlib import Path

build_id = sys.argv[1]
index = Path("index.html")
text = index.read_text(encoding="utf-8")

try:
    changed = subprocess.check_output(
        ["git", "diff", "--cached", "--name-only"],
        text=True
    ).splitlines()
except subprocess.CalledProcessError:
    changed = []

if not any(path in ("styles.css", "app.js") for path in changed):
    sys.exit(0)

def replace_version(text, asset):
    marker = f"{asset}?v="
    if marker in text:
        parts = text.split(marker)
        out = [parts[0]]
        for chunk in parts[1:]:
            prefix, rest = chunk.split("\"", 1)
            out.append(f"{asset}?v={build_id}\"{rest}")
        return "".join(out)
    return text

text = replace_version(text, "./styles.css")
text = replace_version(text, "./validationConstants.js")
text = replace_version(text, "./uiErrors.js")
text = replace_version(text, "./app.js")

index.write_text(text, encoding="utf-8")
PY

if ! git diff --quiet -- index.html; then
  git add index.html
fi
