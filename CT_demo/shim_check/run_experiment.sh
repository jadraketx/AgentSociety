#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/Users/jadrake/Local_dev/AgentSociety"
cd "$ROOT_DIR"

ENV_FILE="/Users/jadrake/Local_dev/AgentSociety/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

PY_BIN="${PYTHON_BIN:-$ROOT_DIR/.venv/bin/python}"
"$PY_BIN" "$ROOT_DIR/scripts/run_ct_demo.py" \
  --config "/Users/jadrake/Local_dev/AgentSociety/CT_demo/shim_check/config.yaml" \
  --steps "/Users/jadrake/Local_dev/AgentSociety/CT_demo/shim_check/steps.yaml" \
  --run-dir "/Users/jadrake/Local_dev/AgentSociety/CT_demo/shim_check/results" \
  --log-level INFO
