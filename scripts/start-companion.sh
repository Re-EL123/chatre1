#!/usr/bin/env bash
# Auto-start Chatre desktop companion with API bridge when env is set.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TOKEN="${CHATRE_COMPANION_TOKEN:-local-dev-only}"
export CHATRE_COMPANION_TOKEN="$TOKEN"

if [[ -n "${CHATRE_API_BASE:-}" && -n "${CHATRE_API_TOKEN:-}" ]]; then
  echo "Starting companion with bridge → $CHATRE_API_BASE"
else
  echo "Starting companion (local-only). Set CHATRE_API_BASE + CHATRE_API_TOKEN to bridge."
fi

exec node desktop-companion/server.js
