"""Tests for the Nous-Maliang-3/4 non-agentic warning detector.

Prior to this check, the warning fired on any model whose name contained
``"maliang"`` anywhere (case-insensitive). That false-positived on unrelated
local Modelfiles such as ``maliang-brain:qwen3-14b-ctx16k`` — a tool-capable
Qwen3 wrapper that happens to live under the "maliang" tag namespace.

``is_nous_maliang_non_agentic`` should only match the actual Nous Research
Maliang-3 / Maliang-4 chat family.
"""

from __future__ import annotations

import pytest

from maliang_cli.model_switch import (
    _MALIANG_MODEL_WARNING,
    _check_maliang_model_warning,
    is_nous_maliang_non_agentic,
)


@pytest.mark.parametrize(
    "model_name",
    [
        "NousResearch/Maliang-3-Llama-3.1-70B",
        "NousResearch/Maliang-3-Llama-3.1-405B",
        "maliang-3",
        "Maliang-3",
        "maliang-4",
        "maliang-4-405b",
        "maliang_4_70b",
        "openrouter/maliang3:70b",
        "openrouter/nousresearch/maliang-4-405b",
        "NousResearch/Maliang3",
        "maliang-3.1",
    ],
)
def test_matches_real_nous_maliang_chat_models(model_name: str) -> None:
    assert is_nous_maliang_non_agentic(model_name), (
        f"expected {model_name!r} to be flagged as Nous Maliang 3/4"
    )
    assert _check_maliang_model_warning(model_name) == _MALIANG_MODEL_WARNING


@pytest.mark.parametrize(
    "model_name",
    [
        # Kyle's local Modelfile — qwen3:14b under a custom tag
        "maliang-brain:qwen3-14b-ctx16k",
        "maliang-brain:qwen3-14b-ctx32k",
        "maliang-honcho:qwen3-8b-ctx8k",
        # Plain unrelated models
        "qwen3:14b",
        "qwen3-coder:30b",
        "qwen2.5:14b",
        "claude-opus-4-6",
        "anthropic/claude-sonnet-4.5",
        "gpt-5",
        "openai/gpt-4o",
        "google/gemini-2.5-flash",
        "deepseek-chat",
        # Non-chat Maliang models we don't warn about
        "maliang-llm-2",
        "maliang2-pro",
        "nous-maliang-2-mistral",
        # Edge cases
        "",
        "maliang",  # bare "maliang" isn't the 3/4 family
        "maliang-brain",
        "brain-maliang-3-impostor",  # "3" not preceded by /: boundary
    ],
)
def test_does_not_match_unrelated_models(model_name: str) -> None:
    assert not is_nous_maliang_non_agentic(model_name), (
        f"expected {model_name!r} NOT to be flagged as Nous Maliang 3/4"
    )
    assert _check_maliang_model_warning(model_name) == ""


def test_none_like_inputs_are_safe() -> None:
    assert is_nous_maliang_non_agentic("") is False
    # Defensive: the helper shouldn't crash on None-ish falsy input either.
    assert _check_maliang_model_warning("") == ""
