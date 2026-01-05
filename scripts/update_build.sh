#!/bin/sh
set -e
stamp="$(date '+%Y-%m-%d %H:%M')"
sha="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
printf '%s  %s\n' "$stamp" "$sha" > build.txt

python3 - "$sha" <<'PY'
import sys
from pathlib import Path

build_id = sys.argv[1]
index = Path("index.html")
text = index.read_text(encoding="utf-8")

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
text = replace_version(text, "./app.js")

index.write_text(text, encoding="utf-8")
PY
