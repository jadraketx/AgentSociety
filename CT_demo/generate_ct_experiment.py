"""Generate a Commons Tragedy demo directory with config and steps files."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import yaml
from dotenv import load_dotenv
from openai import OpenAI


LOCAL_GITIGNORE = "benchmark_*/\nresults/\n"


def build_run_script(base_dir: Path, output_dir: Path) -> str:
        return f"""#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=\"{base_dir.parent}\"
cd \"$ROOT_DIR\"

set -a
source \"CT_demo/.env\"
set +a

.venv/bin/python CT_demo/run_ct_demo.py \\
    --config \"{output_dir / 'config.yaml'}\" \\
    --steps \"{output_dir / 'steps.yaml'}\" \\
    --run-dir \"{output_dir / 'results'}\" \\
    --log-level INFO
"""


def _extract_json_object(text: str) -> dict:
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            payload, _end = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    raise ValueError("Model response did not contain a JSON object")


def generate_personas(num_agents: int) -> list[dict[str, str]]:
    base_dir = Path(__file__).resolve().parent
    load_dotenv(base_dir / ".env")

    api_key = (os.getenv("AGENTSOCIETY_LLM_API_KEY") or "").strip()
    api_base = (os.getenv("AGENTSOCIETY_LLM_API_BASE") or "https://api.openai.com/v1").strip()
    model = (os.getenv("AGENTSOCIETY_LLM_MODEL") or "gpt-5.5").strip()

    if not api_key:
        raise SystemExit(
            "AGENTSOCIETY_LLM_API_KEY is required in CT_demo/.env or the environment"
        )

    client = OpenAI(api_key=api_key, base_url=api_base)
    prompt = (
        "Generate a diverse set of persona descriptions for a Tragedy of the Commons simulation. "
        f"Return exactly {num_agents} personas as JSON with the shape "
        '{"personas": [{"label": "ShortLabel", "persona": "2-3 sentences"}, ...]}. '
        "Each persona must be behaviorally distinct in how it approaches shared resource extraction. "
        "Keep each label short, title case, and suitable for inclusion in an agent name. "
        "Keep each persona to 2-3 sentences written in second person, directly instructing the agent how to behave. "
        "Do not include markdown fences or any text outside the JSON object."
    )
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=1,
    )
    content = response.choices[0].message.content or ""
    payload = _extract_json_object(content)
    personas = payload.get("personas")
    if not isinstance(personas, list) or len(personas) != num_agents:
        raise SystemExit(
            f"Persona generation returned {0 if not isinstance(personas, list) else len(personas)} personas, expected {num_agents}"
        )

    cleaned: list[dict[str, str]] = []
    for index, persona_data in enumerate(personas, start=1):
        if not isinstance(persona_data, dict):
            raise SystemExit(f"Persona {index} is not a JSON object")
        label = str(persona_data.get("label") or f"Agent {index}").strip()
        persona = str(persona_data.get("persona") or "").strip()
        if not persona:
            raise SystemExit(f"Persona {index} is missing description text")
        cleaned.append({"label": label, "persona": persona})
    return cleaned


def build_agent(
    agent_id: int,
    num_rounds: int,
    write_llm_debug_log: bool,
    *,
    persona: dict[str, str],
) -> dict:
    return {
        "agent_id": agent_id,
        "agent_type": "CommonsTragedyAgent",
        "kwargs": {
            "id": agent_id,
            "name": f"Node {agent_id:03d} ({persona['label']})",
            "persona": persona["persona"],
            "num_rounds": num_rounds,
            "write_llm_debug_log": write_llm_debug_log,
        },
    }


def build_config(
    num_agents: int,
    num_steps: int,
    initial_pool_resources: int,
    pipeline_name: str,
    *,
    personas: list[dict[str, str]],
    write_llm_debug_log: bool,
    input_cost_per_1k_tokens: float | None,
    output_cost_per_1k_tokens: float | None,
) -> dict:
    return {
        "pipeline_name": pipeline_name,
        "env_modules": [
            {
                "module_type": "CommonsTragedyEnv",
                "kwargs": {
                    "num_agents": num_agents,
                    "initial_pool_resources": initial_pool_resources,
                },
            }
        ],
        "agents": [
            build_agent(
                agent_id,
                num_steps,
                write_llm_debug_log=write_llm_debug_log,
                persona=personas[agent_id - 1],
            )
            for agent_id in range(1, num_agents + 1)
        ],
        "codegen_router": {"final_summary_enabled": False},
        "metrics": {
            "pricing": {
                "input_cost_per_1k_tokens": input_cost_per_1k_tokens,
                "output_cost_per_1k_tokens": output_cost_per_1k_tokens,
            }
        },
    }


def build_steps(num_steps: int) -> dict:
    return {
        "start_t": "2026-01-01T00:00:00",
        "steps": [{"type": "run", "num_steps": num_steps, "tick": 1}],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a CT demo directory with config.yaml and steps.yaml"
    )
    parser.add_argument("--num-agents", type=int, required=True)
    parser.add_argument("--num-steps", type=int, required=True)
    parser.add_argument(
        "--initial-pool-resources",
        type=int,
        default=100,
        help="Initial shared pool resources for CommonsTragedyEnv.",
    )
    parser.add_argument(
        "--experiment-dir",
        type=str,
        required=True,
        help="Experiment output directory path (absolute or relative to current working directory).",
    )
    parser.add_argument(
        "--write-llm-debug-log",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Whether generated agents should write per-agent LLM debug logs.",
    )
    parser.add_argument(
        "--input-cost-per-1k-tokens",
        type=float,
        default=None,
        help="Optional pricing value used for estimated input-token cost per 1K tokens.",
    )
    parser.add_argument(
        "--output-cost-per-1k-tokens",
        type=float,
        default=None,
        help="Optional pricing value used for estimated output-token cost per 1K tokens.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.num_agents <= 0:
        raise SystemExit("--num-agents must be greater than 0")
    if args.num_steps <= 0:
        raise SystemExit("--num-steps must be greater than 0")
    if args.initial_pool_resources <= 0:
        raise SystemExit("--initial-pool-resources must be greater than 0")

    base_dir = Path(__file__).resolve().parent
    output_dir = Path(args.experiment_dir).expanduser()
    if not output_dir.is_absolute():
        output_dir = Path.cwd() / output_dir
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    personas = generate_personas(args.num_agents)

    config = build_config(
        num_agents=args.num_agents,
        num_steps=args.num_steps,
        initial_pool_resources=args.initial_pool_resources,
        pipeline_name=f"commons_tragedy_{args.num_agents}_agent_test",
        personas=personas,
        write_llm_debug_log=args.write_llm_debug_log,
        input_cost_per_1k_tokens=args.input_cost_per_1k_tokens,
        output_cost_per_1k_tokens=args.output_cost_per_1k_tokens,
    )
    steps = build_steps(num_steps=args.num_steps)

    (output_dir / "config.yaml").write_text(
        yaml.safe_dump(config, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    (output_dir / "steps.yaml").write_text(
        yaml.safe_dump(steps, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    run_script_path = output_dir / "run_experiment.sh"
    run_script_path.write_text(
        build_run_script(base_dir=base_dir, output_dir=output_dir),
        encoding="utf-8",
    )
    run_script_path.chmod(0o755)
    (output_dir / ".gitignore").write_text(LOCAL_GITIGNORE, encoding="utf-8")

    print(f"Created demo config in {output_dir}")
    print(f"Run with: {run_script_path}")


if __name__ == "__main__":
    main()