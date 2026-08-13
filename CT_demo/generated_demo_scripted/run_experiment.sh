#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/Users/jadrake/Local_dev/AgentSociety"
cd "$ROOT_DIR"

set -a
source "CT_demo/.env"
set +a

.venv/bin/python CT_demo/run_ct_demo.py \
    --config "/Users/jadrake/Local_dev/AgentSociety/CT_demo/generated_demo_scripted/config.yaml" \
    --steps "/Users/jadrake/Local_dev/AgentSociety/CT_demo/generated_demo_scripted/steps.yaml" \
    --run-dir "/Users/jadrake/Local_dev/AgentSociety/CT_demo/generated_demo_scripted/results" \
    --log-level INFO
