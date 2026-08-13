import os
import json
import resource
import sys
import time
import argparse
import asyncio
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)

sys.path.insert(0, str(ROOT / "packages" / "agentsociety2"))

from agentsociety2.logger import add_file_handler, set_logger_level
from agentsociety2.society.cli import ExperimentRunner, _validate_env_early
from agentsociety2.society.society import AgentSociety


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run CT demo with aggregated performance metrics"
    )
    parser.add_argument("--config", type=str, required=True)
    parser.add_argument("--steps", type=str, required=True)
    parser.add_argument("--run-dir", type=str, default=".")
    parser.add_argument("--experiment-id", type=str)
    parser.add_argument(
        "--log-level",
        type=str,
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        default="INFO",
    )
    parser.add_argument("--log-file", type=str)
    parser.add_argument("--replay-disable", action="store_true")
    parser.add_argument("--batch-size", type=int, default=None)
    parser.add_argument("--resume", action="store_true")
    return parser.parse_args()


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * percentile
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _peak_memory_bytes() -> int:
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        return int(peak)
    return int(peak * 1024)


def _load_metrics_config(config_path: Path) -> dict:
    try:
        payload = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    except OSError:
        return {}
    if not isinstance(payload, dict):
        return {}
    metrics = payload.get("metrics") or {}
    return metrics if isinstance(metrics, dict) else {}


def _iter_agent_metric_events(run_dir: Path) -> list[dict]:
    events: list[dict] = []
    agents_dir = run_dir / "agents"
    if not agents_dir.is_dir():
        return events
    for agent_dir in sorted(agents_dir.glob("agent_*/state/performance_metrics.jsonl")):
        try:
            for line in agent_dir.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                payload = json.loads(line)
                if isinstance(payload, dict):
                    payload.setdefault("agent_workspace", agent_dir.parent.parent.name)
                    events.append(payload)
        except (OSError, json.JSONDecodeError):
            continue
    return events


def _estimate_cost(total_input_tokens: int, total_output_tokens: int, pricing: dict) -> float | None:
    input_price = pricing.get("input_cost_per_1k_tokens")
    output_price = pricing.get("output_cost_per_1k_tokens")
    if input_price is None or output_price is None:
        return None
    return (total_input_tokens / 1000.0) * float(input_price) + (
        total_output_tokens / 1000.0
    ) * float(output_price)


def _build_run_metrics(
    *,
    run_dir: Path,
    wall_clock_seconds: float,
    step_timings_ms: list[float],
    peak_memory_bytes: int,
    metrics_config: dict,
) -> dict:
    events = _iter_agent_metric_events(run_dir)
    decision_latencies = [float(event.get("decision_latency_ms", 0.0)) for event in events]
    llm_latencies = [float(event.get("llm_call_latency_ms", 0.0)) for event in events]
    total_input_tokens = sum(int(event.get("prompt_tokens", 0) or 0) for event in events)
    total_output_tokens = sum(int(event.get("completion_tokens", 0) or 0) for event in events)
    estimated_cost = _estimate_cost(
        total_input_tokens,
        total_output_tokens,
        (metrics_config.get("pricing") or {}) if isinstance(metrics_config.get("pricing"), dict) else {},
    )

    return {
        "wall_clock_time_seconds": wall_clock_seconds,
        "simulation_step_time_ms_avg": _mean(step_timings_ms),
        "simulation_step_time_ms_p95": _percentile(step_timings_ms, 0.95),
        "per_agent_decision_latency_ms_avg": _mean(decision_latencies),
        "per_agent_decision_latency_ms_p95": _percentile(decision_latencies, 0.95),
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "llm_call_latency_ms_avg": _mean(llm_latencies),
        "llm_call_latency_ms_p95": _percentile(llm_latencies, 0.95),
        "peak_memory_bytes": peak_memory_bytes,
        "estimated_cost_per_run": estimated_cost,
        "pricing": metrics_config.get("pricing", {}),
        "event_count": len(events),
        "step_count": len(step_timings_ms),
    }


async def _run_with_metrics(args: argparse.Namespace) -> None:
    config_path = Path(args.config).resolve()
    steps_path = Path(args.steps).resolve()
    run_dir = Path(args.run_dir).resolve()
    metrics_config = _load_metrics_config(config_path)
    runner = ExperimentRunner(run_dir=run_dir)
    step_timings_ms: list[float] = []

    original_step = AgentSociety.step

    async def instrumented_step(self: AgentSociety, tick: int):
        started = time.perf_counter()
        try:
            return await original_step(self, tick)
        finally:
            step_timings_ms.append((time.perf_counter() - started) * 1000.0)

    AgentSociety.step = instrumented_step
    started = time.perf_counter()
    try:
        await runner.run(
            config_path=config_path,
            steps_path=steps_path,
            experiment_id=args.experiment_id,
            replay_disable=args.replay_disable,
            batch_size=args.batch_size,
            resume=args.resume,
        )
    finally:
        AgentSociety.step = original_step

    metrics_payload = _build_run_metrics(
        run_dir=run_dir,
        wall_clock_seconds=time.perf_counter() - started,
        step_timings_ms=step_timings_ms,
        peak_memory_bytes=_peak_memory_bytes(),
        metrics_config=metrics_config,
    )
    (run_dir / "performance_metrics.json").write_text(
        json.dumps(metrics_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

if __name__ == "__main__":
    _validate_env_early()
    args = _parse_args()
    set_logger_level(args.log_level)
    if args.log_file:
        add_file_handler(args.log_file, level=args.log_level)
    asyncio.run(_run_with_metrics(args))