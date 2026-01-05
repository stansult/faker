#!/usr/bin/env bash
set -euo pipefail

IP="$(ipconfig getifaddr en0 || ipconfig getifaddr en1 || echo 'unknown')"
if [ "$IP" = "unknown" ]; then
  echo "Can't test on a different device: IP is unknown"
else
  echo "LAN test: http://${IP}:8888"
fi

netlify dev --command "python3 -m http.server 3999" --target-port 3999 --functions netlify/functions --functions-port 9999 --port 8888 &
DEV_PID=$!

cleanup() {
  kill "$DEV_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

until curl -sSf http://localhost:8888 >/dev/null 2>&1; do
  sleep 0.5
done

TUNNEL_NAME="${FAKER_TUNNEL_NAME:-faker-dev}"
cloudflared tunnel run --url http://localhost:8888 "$TUNNEL_NAME"
