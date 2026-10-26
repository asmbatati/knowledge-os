"""One way to reach a model, whichever the learner chose (the vault's Knowledge OS Plugin Plan 2026-10, D5).

`make_model(cfg)` returns a `Model` for the provider and model in the settings: the Claude or ChatGPT subscription
through its CLI, an API key (Anthropic, OpenAI, Gemini, OpenRouter, a custom server) or a local Ollama. The grader, the
bank writer, the tutor, the coach and Teach all call `Model.complete(system, prompt, timeout)` and keep their own
prompts and checks; `Model.available()` says whether a call may be made now and, when not, why:

  no_provider  the settings chose none          no_cli   the subscription's CLI is not installed
  no_key       the provider's key is missing    quiet    the night jobs' hours, for the Claude plan only (D8)
  budget       today's spend on paid models has reached `daily_budget_usd` (D9)

Each call leaves one row in the `usage` ledger: provider, model, call site, tokens and cost. Never any text.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, time

from .registry import ModelInfo, Preset, presets, price


@dataclass
class Reply:
    text: str
    cost_usd: float | None = None
    input_tokens: int = 0
    output_tokens: int = 0


class Unavailable(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


WHY = {
    "no_provider": "no model is chosen in the settings",
    "no_cli": "the subscription's CLI was not found",
    "no_key": "the provider's API key is not set",
    "quiet": "the night jobs' quiet hours: the Claude plan is left to them",
    "budget": "today's budget for paid models is spent",
}


def _hm(s: str) -> time:
    h, m = str(s).split(":")
    return time(int(h), int(m))


def in_quiet_hours(t: time, quiet) -> bool:
    if not quiet:
        return False
    a, b = _hm(quiet[0]), _hm(quiet[1])
    return (a <= t < b) if a <= b else (t >= a or t < b)


class Model:
    def __init__(self, preset: Preset | None, info: ModelInfo | None, transport, *, quiet=("23:55", "04:30"),
                 clock=datetime.now, budget_usd: float | None = 1.0, ledger=None, missing: str = ""):
        self.preset, self.info, self.transport = preset, info, transport
        self.quiet, self.clock, self.budget, self.ledger = quiet, clock, budget_usd, ledger
        self.missing = missing

    @property
    def name(self) -> str:
        """The name the ledgers keep (`grader` in a verdict row): "claude" for Claude Code, as before."""
        return self.preset.name if self.preset else "none"

    @property
    def label(self) -> str:
        if not self.preset:
            return "no model"
        return f"{self.preset.label} · {self.info.label if self.info else ''}".rstrip(" ·")

    def describe(self) -> dict:
        p, m = self.preset, self.info
        return {"provider": p.id if p else "", "model": m.id if m else "", "name": self.name, "label": self.label,
                "tier": p.tier if p else "", "metered": bool(p and p.metered)}

    def spent_today(self) -> float:
        if not self.ledger:
            return 0.0
        today = self.clock().date().isoformat()
        return round(sum(float(r.get("cost_usd") or 0) for r in self.ledger.rows("usage")
                         if r.get("date") == today and r.get("metered")), 6)

    def available(self) -> tuple[bool, str]:
        if self.missing:
            return False, self.missing
        if self.preset.shares_night_plan and in_quiet_hours(self.clock().time(), self.quiet):
            return False, "quiet"
        if self.preset.metered and self.budget is not None and self.spent_today() >= self.budget:
            return False, "budget"
        return True, ""

    def complete(self, system: str, prompt: str, timeout: int, site: str = "") -> Reply:
        ok, code = self.available()
        if not ok:
            raise Unavailable(code, WHY.get(code, code))
        r = self.transport.complete(system, prompt, timeout)
        if self.preset.metered:
            r.cost_usd = price(self.info, r.input_tokens, r.output_tokens)
        if self.ledger is not None:
            self.ledger.append("usage", {"provider": self.preset.id, "model": self.info.id, "site": site,
                                         "input_tokens": r.input_tokens, "output_tokens": r.output_tokens,
                                         "cost_usd": r.cost_usd, "metered": self.preset.metered}, self.clock())
        return r


def make_model(cfg, ledger=None, environ=None, clock=datetime.now, runner=None, proc=None, post=None) -> Model:
    """The model the settings name. `runner`, `proc` and `post` replace the CLI and HTTP transports in the tests."""
    from . import cli, http

    env = os.environ if environ is None else environ
    table = presets(cfg)
    pid = getattr(cfg, "provider", "claude-cli")
    kw = dict(quiet=cfg.quiet_hours, clock=clock, budget_usd=getattr(cfg, "daily_budget_usd", 1.0), ledger=ledger)
    if not pid or pid not in table:
        return Model(None, None, None, missing="no_provider", **kw)
    p = table[pid]
    info = p.model(cfg.model or p.models[0].id)
    effort = getattr(cfg, "effort", "") or ""
    if p.kind == "claude-cli":
        prefix = cli.resolve_cli("claude", getattr(cfg, "claude_cli", ""))
        if not prefix:
            return Model(p, info, None, missing="no_cli", **kw)
        t = cli.ClaudeCode(prefix, info.id, effort, **({"runner": runner, "detect": False} if runner else {}))
        return Model(p, info, t, **kw)
    if p.kind == "codex-cli":
        prefix = cli.resolve_cli("codex", getattr(cfg, "codex_cli", ""))
        if not prefix:
            return Model(p, info, None, missing="no_cli", **kw)
        return Model(p, info, cli.Codex(prefix, info.id, effort, **({"proc": proc} if proc else {})), **kw)
    key = env.get(p.key_env, "") if p.key_env else ""
    if p.key_required and not key:
        return Model(p, info, None, missing="no_key", **kw)
    extra = {"post": post} if post else {}
    if p.kind == "anthropic":
        return Model(p, info, http.AnthropicAPI(key, info.id, p.base_url, **extra), **kw)
    return Model(p, info, http.OpenAICompat(key, info.id, p.base_url, **extra), **kw)


__all__ = ["Model", "Reply", "Unavailable", "WHY", "in_quiet_hours", "make_model", "presets"]
