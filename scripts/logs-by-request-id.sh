#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
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

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found" >&2
  exit 1
fi

if ! command -v grep >/dev/null 2>&1; then
  echo "grep command not found" >&2
  exit 1
fi

echo "Filtering docker compose logs for requestId=${REQUEST_ID} service=${SERVICE} ..."
docker compose logs --tail "${TAIL_LINES}" -f "${SERVICE}" | grep --line-buffered -F "${REQUEST_ID}"
