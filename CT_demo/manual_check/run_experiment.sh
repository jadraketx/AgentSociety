#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/Users/jadrake/Local_dev/AgentSociety"
cd "$ROOT_DIR"

set -a
source "CT_demo/.env"
set +a

.venv/bin/python CT_demo/run_ct_demo.py \
    --config "/Users/jadrake/Local_dev/AgentSociety/CT_demo/manual_check/config.yaml" \
    --steps "/Users/jadrake/Local_dev/AgentSociety/CT_demo/manual_check/steps.yaml" \
    --run-dir "/Users/jadrake/Local_dev/AgentSociety/CT_demo/manual_check/results" \
    --log-level INFO
