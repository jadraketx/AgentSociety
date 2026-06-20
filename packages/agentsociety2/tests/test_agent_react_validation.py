"""Tests for the ReAct finish-validation, ask-mode answer extraction, and the
step-memory fallback synthesis.

These lock in the contract added to address weak-model behavior:

- step-mode ``finish`` requires a non-empty ``memories`` list;
- ask-mode ``finish`` requires a non-empty ``answer``;
- ask-mode free-text answers are matched conservatively (JSON object/scalar),
  otherwise an error is returned so the loop corrects the model via feedback;
- the step-memory fallback episode is valid and tagged
  ``source=step_result_fallback``;
- the ask-mode system prompt carries the finish-tool requirement and the
  override-rejection clause.
"""

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from agentsociety2.agent.base.agent import (
    AgentBase,
    _synthesize_step_fallback_episode,
)
from agentsociety2.agent.memory import MemoryExtractionResult
from agentsociety2.agent.person_prompt import build_preamble


class _DummyAgent(AgentBase):
    @classmethod
    def create(cls, workspace_path: Path, profile: dict, config: dict) -> None:
        raise NotImplementedError

    @classmethod
    async def from_workspace(cls, workspace_path: Path, service_proxy):
        raise NotImplementedError

    def to_workspace(self) -> dict:
        raise NotImplementedError

    async def ask(self, question: str, readonly: bool = True) -> str:
        raise NotImplementedError

    async def step(self, tick: int, t: datetime) -> str:
        raise NotImplementedError


def _agent() -> _DummyAgent:
    return _DummyAgent()


# ----------------------------- finish validation -----------------------------


def test_step_finish_rejects_empty_memories():
    agent = _agent()
    decisions, error = agent._build_react_decisions(
        [("finish", {"memories": []})], readonly=False
    )
    assert decisions == []
    assert "memories" in error.lower()


def test_step_finish_rejects_missing_memories():
    agent = _agent()
    decisions, error = agent._build_react_decisions(
        [("finish", {})], readonly=False
    )
    assert decisions == []
    assert error


def test_step_finish_accepts_nonempty_memories():
    agent = _agent()
    memories = [
        {"type": "observation", "importance": 0.5, "text": "ate lunch"}
    ]
    decisions, error = agent._build_react_decisions(
        [("finish", {"memories": memories})], readonly=False
    )
    assert error == ""
    assert len(decisions) == 1
    assert decisions[0].action == "finish"


def test_ask_finish_rejects_empty_answer():
    agent = _agent()
    decisions, error = agent._build_react_decisions(
        [("finish", {"answer": "  "})], readonly=True
    )
    assert decisions == []
    assert "answer" in error.lower()


def test_ask_finish_accepts_nonempty_answer():
    agent = _agent()
    decisions, error = agent._build_react_decisions(
        [("finish", {"answer": "left"})], readonly=True
    )
    assert error == ""
    assert decisions[0].final == "left"


# ------------------------ free-text answer extraction ------------------------


def test_extract_answer_from_json_object():
    agent = _agent()
    assert agent._extract_free_text_answer('{"answer": "left"}') == "left"


def test_extract_answer_from_json_scalar():
    agent = _agent()
    assert agent._extract_free_text_answer('"left"') == "left"
    assert agent._extract_free_text_answer("42") == "42"


def test_extract_answer_rejects_natural_language():
    """Natural-language answers must NOT be matched — corrected via feedback."""
    agent = _agent()
    assert agent._extract_free_text_answer("The answer is left.") == ""


def test_extract_answer_skips_null_value():
    """A null answer must not become the literal string 'None'."""
    agent = _agent()
    assert agent._extract_free_text_answer('{"answer": null}') == ""
    # Falls through to other keys / error feedback rather than returning "None".
    assert agent._extract_free_text_answer("null") == ""


def test_extract_answer_handles_json_code_fence():
    agent = _agent()
    assert agent._extract_free_text_answer('```json\n{"answer": "left"}\n```') == "left"


def test_parse_ask_free_text_synthesizes_finish():
    agent = _agent()
    message = SimpleNamespace(tool_calls=None, content='{"answer": "left"}')
    response = SimpleNamespace(choices=[SimpleNamespace(message=message)])
    decisions, error = agent._parse_react_responses(response, readonly=True)
    assert error == ""
    assert decisions[0].action == "finish"
    assert decisions[0].final == "left"
    # Free text is stashed for the end-of-loop fallback.
    assert agent._last_raw_answer_text == '{"answer": "left"}'


def test_parse_ask_free_text_natural_language_returns_error():
    agent = _agent()
    message = SimpleNamespace(tool_calls=None, content="The answer is left.")
    response = SimpleNamespace(choices=[SimpleNamespace(message=message)])
    decisions, error = agent._parse_react_responses(response, readonly=True)
    assert decisions == []
    assert "finish" in error.lower()


# --------------------------- fallback episode --------------------------------


def test_fallback_episode_is_valid_and_tagged():
    episode = _synthesize_step_fallback_episode(
        step_count=3,
        t=datetime(2026, 6, 20, 9, 0),
        observations=[
            {"action": "observe", "observation": "at home"},
            {"action": "ask_env", "observation": "moved to cafe"},
        ],
    )
    # Must round-trip through the memory validator used by after_step.
    validated = MemoryExtractionResult.model_validate({"memories": [episode]})
    assert len(validated.memories) == 1
    assert validated.memories[0].source == "step_result_fallback"
    assert "Step 3" in episode["text"]
    assert "at home" in episode["text"]


def test_synthesize_step_fallback_memory_uses_step_count():
    agent = _agent()
    agent._step_count = 7
    memories = agent._synthesize_step_fallback_memory(
        tick=1, t=datetime(2026, 6, 20, 9, 0), observations=[]
    )
    assert len(memories) == 1
    assert "Step 7" in memories[0]["text"]


def test_synthesize_ask_fallback_uses_stashed_text():
    agent = _agent()
    agent._last_raw_answer_text = "left"
    assert agent._synthesize_ask_fallback() == "left"


def test_synthesize_ask_fallback_default_when_no_text():
    agent = _agent()
    assert agent._synthesize_ask_fallback() == "done"


# ----------------------------- ask-mode prompt -------------------------------


def test_ask_mode_rules_only_when_ask_mode():
    step_prompt = build_preamble(name="Alice", ask_mode=False)
    ask_prompt = build_preamble(name="Alice", ask_mode=True)
    assert "ask_mode_rules" not in step_prompt
    assert "<ask_mode_rules>" in ask_prompt
    # The finish-tool requirement must be present in ask mode.
    assert "finish(answer=...)" in ask_prompt
    # The override-rejection clause must be present.
    assert "OVERRIDE REJECTION" in ask_prompt


# ------------------------ memory validation fallback -------------------------

def _memory_runtime():
    from agentsociety2.agent.memory_runtime import (
        MemoryRuntimeConfig,
        PersonMemoryRuntime,
    )

    return PersonMemoryRuntime(
        agent_id=1,
        agent_name="Alice",
        config=MemoryRuntimeConfig(),
        get_model_name=lambda: "m",
        dispatch_llm=lambda **k: None,
        get_profile=lambda: {},
        logger=__import__("logging").getLogger("test"),
    )


def test_validate_finish_memories_lenient_coerces_bad_items():
    """One malformed item must not drop the valid ones."""
    rt = _memory_runtime()
    raw = [
        {"type": "observation", "importance": 0.5, "text": "valid item"},
        {"type": "not-a-real-type", "importance": 0.9, "text": "bad type"},
        {"garbage": "no text at all"},
    ]
    coerced = rt._validate_finish_memories_lenient(raw)
    # Valid item kept; bad-enum item coerced; textless garbage dropped.
    assert len(coerced) == 2
    assert coerced[0]["text"] == "valid item"
    # The genuinely-invalid (bad enum) item is downgraded to a tagged episode.
    assert coerced[1]["source"] == "finish_memory_coerced"
    assert coerced[1]["type"] == "observation"
    assert coerced[1]["text"] == "bad type"
    # All coerced items are valid episodes.
    from agentsociety2.agent.memory import MemoryExtractionResult

    MemoryExtractionResult.model_validate({"memories": coerced})


def test_validate_finish_memories_strict_still_raises_on_bad_input():
    rt = _memory_runtime()
    import pytest

    with pytest.raises(Exception):
        rt._validate_finish_memories([{"type": "not-a-real-type", "text": "x"}])
