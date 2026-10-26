"""The model as the course tutor, the coach's teacher and Teach's student and reviewer: one object with `available()`
and `call(system, prompt) -> dict`.

It runs as the grader runs (grade.py), through the model the settings chose (los/providers): a subscription's CLI in an
empty temporary folder with no tools, no MCP servers and no user settings, or an API provider over HTTPS. The notes and
the learner's words go in as the prompt, between markers, as data; nothing the learner types reaches a command line. In
the night jobs' quiet hours (the Claude plan), with no CLI or key, past the day's budget, or when the settings choose
self-grading, the tutor is resting and the page says so; it never guesses an answer.
"""
from __future__ import annotations

from datetime import datetime

from .grade import NO_TOOLS, extract_json, in_quiet_hours, run_cli  # noqa: F401  (kept for the modules that import them here)
from .providers import Model
from .providers.cli import ClaudeCode, legacy_prefix


class NoTutor:
    """The settings chose self-grading: no call to a model at all."""
    name = "self"

    def available(self):
        return False, "settings"

    def call(self, system: str, prompt: str) -> dict:
        raise RuntimeError("the tutor is off in the settings")


class ModelTutor:
    def __init__(self, model: Model, timeout: int = 120):
        self.model, self.timeout = model, timeout

    @property
    def name(self) -> str:
        return self.model.name

    def available(self):
        return self.model.available()

    def call(self, system: str, prompt: str, site: str = "tutor") -> dict:
        r = self.model.complete(system, prompt, self.timeout, site=site)
        v = extract_json(r.text)
        if not isinstance(v, dict):
            raise ValueError("the reply was not the JSON asked for")
        v["_cost_usd"] = r.cost_usd
        return v


class ClaudeTutor(ModelTutor):
    """Claude Code with a given CLI path and runner: the shape the selftests and the old settings use."""

    def __init__(self, cli: str, model: str = "sonnet", timeout: int = 120, quiet=("23:55", "04:30"),
                 runner=run_cli, clock=datetime.now, node: str | None = None):
        from .providers import presets
        p = presets()["claude-cli"]
        transport = ClaudeCode(legacy_prefix(cli, node), model, runner=runner, detect=runner is run_cli) if cli else None
        super().__init__(Model(p, p.model(model), transport, quiet=quiet, clock=clock, budget_usd=None,
                               missing="" if cli else "no_cli"), timeout)

    def argv(self, system: str) -> list[str]:
        return self.model.transport.argv(system)


class GatedTutor:
    """A model the trust gate holds back from one use (Teach, until it passes tests/teach-cases.json)."""

    def __init__(self, inner, code: str = "untrusted"):
        self.inner, self.code = inner, code
        self.name = getattr(inner, "name", "self")

    def available(self):
        return False, self.code

    def call(self, system: str, prompt: str) -> dict:
        raise RuntimeError("this model has not passed its test for this use")


def make_tutor(cfg, model: Model | None = None):
    if cfg.grader == "self":
        return NoTutor()
    if model is None:
        from .providers import make_model
        model = make_model(cfg)
    return ModelTutor(model, timeout=max(int(cfg.timeout_s), 120))
