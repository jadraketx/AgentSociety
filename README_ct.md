# Commons Tragedy Demo Guide

This guide is for running and sharing the Commons Tragedy workflow from anywhere.

It covers:
- Environment setup
- Experiment generation
- Experiment execution
- Output files and what they mean
- Performance and cost metrics
- Ray worker and batch-size tuning
- Share-ready checklist

## 1) Main Entry Points

Main files:
- Generator: scripts/generate_ct_experiment.py
- Runner: scripts/run_ct_experiment.py
- Optional baseline examples: CT_demo/config.yaml and CT_demo/steps.yaml
- Environment variables (local only, do not commit): .env

Generated experiment folder structure:
- <experiment-dir>/config.yaml
- <experiment-dir>/steps.yaml
- <experiment-dir>/run_experiment.sh
- <experiment-dir>/results/

The generated run_experiment.sh script always writes outputs to:
- <experiment-dir>/results

## 2) Prerequisites

- Python virtual environment available at .venv
- Dependencies installed for this repository
- Valid LLM credentials in .env (or pass --env-file)

Repository setup command:

uv sync

Important runtime note:
- Use the repository Python interpreter (for example .venv/bin/python). Running with system Python can fail on missing packages.

Required environment variables:
- AGENTSOCIETY_LLM_API_KEY
- AGENTSOCIETY_LLM_API_BASE
- AGENTSOCIETY_LLM_MODEL

Optional but recommended for performance tuning:
- AGENTSOCIETY_LLM_RAY_MAX_WORKERS
- AGENTSOCIETY_BATCH_SIZE

If your model server uses an internal certificate chain, also set one of:
- AGENTSOCIETY_LLM_CA_BUNDLE=/path/to/ca.pem
- SSL_CERT_FILE=/path/to/ca.pem
- REQUESTS_CA_BUNDLE=/path/to/ca.pem

For troubleshooting only, you can temporarily set:
- AGENTSOCIETY_LLM_SKIP_SSL_VERIFY=1

## 3) Generate A New Experiment

From repository root, run:

.venv/bin/python scripts/generate_ct_experiment.py --num-agents 20 --num-steps 10 --initial-pool-resources 250 --experiment-dir ct_demo_run_01

From an external directory, run:

python /absolute/path/to/AgentSociety/scripts/generate_ct_experiment.py --num-agents 20 --num-steps 10 --initial-pool-resources 250 --experiment-dir ct_demo_run_01

If the server certificate is not trusted by your system, add a CA bundle:

python /absolute/path/to/AgentSociety/scripts/generate_ct_experiment.py --num-agents 20 --num-steps 10 --initial-pool-resources 250 --experiment-dir ct_demo_run_01 --ca-bundle /path/to/ca.pem

What this does:
- Creates ./ct_demo_run_01 (or an absolute path if provided)
- Writes config.yaml and steps.yaml
- Writes run_experiment.sh with pre-populated arguments
- Fixes run-dir to <experiment-dir>/results

## 4) Run The Generated Experiment

From repository root, run:

./ct_demo_run_01/run_experiment.sh

Alternative direct run:

.venv/bin/python scripts/run_ct_experiment.py --config ./ct_demo_run_01/config.yaml --steps ./ct_demo_run_01/steps.yaml --run-dir ./ct_demo_run_01/results --log-level INFO

Optional runtime override for initial pool:

.venv/bin/python scripts/run_ct_experiment.py --config ./ct_demo_run_01/config.yaml --steps ./ct_demo_run_01/steps.yaml --run-dir ./ct_demo_run_01/results --initial-pool-resources 400 --log-level INFO

When the override is used, the runner writes a resolved config file under run-dir:
- config.resolved.yaml

Default env loading behavior in generated run_experiment.sh:
1. <experiment-dir>/.env
2. <experiment-dir-parent>/.env
3. <repo-root>/.env

If you pass --env-file to the generator, that explicit path is embedded in run_experiment.sh and used first.

## 5) Output Artifacts

Inside <experiment-dir>/results, common artifacts include:
- performance_metrics.json
- agents/agent_<id>/state/performance_metrics.jsonl
- agents/agent_<id>/state/llm_debug.log (if write_llm_debug_log is enabled)
- env/CommonsTragedyEnv/state/ENV_STATE.json
- replay/
- trace/

Useful files to inspect first:
- performance_metrics.json for run-level summary
- env state for round-by-round pool changes
- agent performance_metrics.jsonl for per-agent latency and token usage

## 6) Performance Metrics And Cost

The runner writes run-level metrics to performance_metrics.json, including:
- wall_clock_time_seconds
- simulation_step_time_ms_avg and p95
- per_agent_decision_latency_ms_avg and p95
- llm_call_latency_ms_avg and p95
- total_input_tokens and total_output_tokens
- peak_memory_bytes
- estimated_cost_per_run

Cost calculation uses pricing values from config.yaml:
- metrics.pricing.input_cost_per_1k_tokens
- metrics.pricing.output_cost_per_1k_tokens

If either pricing value is missing, estimated_cost_per_run is null.

## 7) Ray Workers And Batch Size

Two key controls affect throughput and latency:
- AGENTSOCIETY_LLM_RAY_MAX_WORKERS
- AGENTSOCIETY_BATCH_SIZE

Definitions:
- AGENTSOCIETY_BATCH_SIZE is the number of agents processed per Ray task.
- AGENTSOCIETY_LLM_RAY_MAX_WORKERS is the maximum number of concurrent Ray tasks.

For N agents:
- task_count = ceil(N / batch_size)
- up to max_workers tasks run in parallel

Example:
- N = 50
- batch_size = 8
- max_workers = 4
- task_count = ceil(50 / 8) = 7
- execution runs in roughly 2 waves (4 tasks, then 3 tasks)

Practical tuning workflow:
1. Fix batch_size, sweep max_workers.
2. Pick the best max_workers, then sweep batch_size around that point.
3. Compare wall_clock_time_seconds, step p95, and decision latency p95.

Tuning guidance:
- If CPU is underutilized and run time is high, increase max_workers gradually.
- If overhead is high due to too many tiny tasks, increase batch_size.
- If instability or timeouts increase, reduce max_workers first, then batch_size.
- For LLM-heavy workloads, max_workers is usually the more sensitive knob.

Suggested starting points:
- 10 agents: batch_size 5, max_workers 2
- 25 agents: batch_size 6, max_workers 3
- 50 agents: batch_size 8, max_workers 4
- 100 agents: batch_size 10, max_workers 6
- 200 agents: batch_size 12, max_workers 8

These are starting points, not fixed rules.

## 8) Recommended .env Pattern For Sharing

Do not share real keys.

Use a template like this in a sample file:
- AGENTSOCIETY_LLM_API_KEY=<set-your-key>
- AGENTSOCIETY_LLM_API_BASE=https://api.openai.com/v1
- AGENTSOCIETY_LLM_MODEL=gpt-5.5
- AGENTSOCIETY_LLM_RAY_MAX_WORKERS=8
- AGENTSOCIETY_BATCH_SIZE=32

Before sharing, rotate any key that was ever committed or exposed.

## 9) Share-Ready Checklist

1. Remove or rotate any exposed API keys.
2. Keep .env local only.
3. Ensure experiment output folders are not accidentally committed.
4. Verify one clean generation + run path using scripts/generate_ct_experiment.py.
5. Include exact commands for your collaborator.
6. Share expected output locations and what to inspect first.

## 10) Troubleshooting

Issue: Missing API key error
- Check one of these files exists: <experiment-dir>/.env, <experiment-dir-parent>/.env, or <repo-root>/.env.
- Or regenerate with --env-file /absolute/path/to/.env.
- Ensure AGENTSOCIETY_LLM_API_KEY is non-empty.

Issue: SSL certificate verify failed
- Set AGENTSOCIETY_LLM_CA_BUNDLE or pass --ca-bundle /path/to/ca.pem.
- As a last resort, use AGENTSOCIETY_LLM_SKIP_SSL_VERIFY=1 or --skip-ssl-verify only to confirm the issue is certificate validation.

Issue: Missing module errors (for example mcp.server.fastmcp)
- Use the project venv Python, not system Python.
- Run uv sync at repo root, then rerun using .venv/bin/python.

Issue: Cost is null in performance_metrics.json
- Add both pricing fields in config.yaml under metrics.pricing.

Issue: Runs are slow
- Tune AGENTSOCIETY_LLM_RAY_MAX_WORKERS and AGENTSOCIETY_BATCH_SIZE.
- Use p95 metrics, not only averages, to compare runs.

Issue: Pool size is not what you expected
- Verify initial_pool_resources in config.yaml.
- If overriding at runtime, check results/config.resolved.yaml.
