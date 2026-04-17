#!/bin/sh
set -eu

if [ "$#" -lt 1 ]; then
  cat <<'EOF'
Usage:
  ./scripts/logs-by-request-id.sh <requestId> [service]

Examples:
  ./scripts/logs-by-request-id.sh 846af9c6-52b5-4076-84e1-f1c0ed11dedb
  ./scripts/logs-by-request-id.sh 846af9c6-52b5-4076-84e1-f1c0ed11dedb asspp

Environment:
  TAIL_LINES   Number of historical lines to include before follow mode (default: 1000)
EOF
  exit 1
fi

REQUEST_ID="$1"
SERVICE="${2:-asspp}"
TAIL_LINES="${TAIL_LINES:-1000}"

if ! command -v grep >/dev/null 2>&1; then
  echo "grep command not found" >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1; then
  echo "Filtering docker compose logs for requestId=${REQUEST_ID} service=${SERVICE} ..."
  docker compose logs --tail "${TAIL_LINES}" -f "${SERVICE}" | grep --line-buffered -F "${REQUEST_ID}"
  exit 0
fi

if [ -r "/proc/1/fd/1" ] && command -v tail >/dev/null 2>&1; then
  echo "docker command not found; fallback to container stdout stream via /proc/1/fd/1 ..."
  echo "Only new log lines can be filtered in this mode."
  tail -f /proc/1/fd/1 | grep --line-buffered -F "${REQUEST_ID}"
  exit 0
fi

echo "docker command not found and /proc/1/fd/1 is not readable; cannot stream logs." >&2
exit 1
