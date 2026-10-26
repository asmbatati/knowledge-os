"""The site's settings: knowledge-os.json beside server.py, then the command line. Nothing personal goes in it.

API keys are never settings: a pay-per-use provider reads its key from the environment the server was started with
(the Obsidian plugin hands it over from Obsidian's keychain), so no key reaches a file, the vault or an export."""
from __future__ import annotations

import json
import os
import shutil
from dataclasses import dataclass, fields
from pathlib import Path


def _default_cli() -> str:
    """Claude Code's npm install, as a last resort when `claude` is not on PATH (a logon start may have a short PATH):
    the native claude.exe of 2.1 and later, else the cli.js of earlier versions (los/providers/cli.py runs either)."""
    appdata = os.environ.get("APPDATA", "")
    for rel in (("bin", "claude.exe"), ("cli.js",)):
        p = Path(appdata, "npm", "node_modules", "@anthropic-ai", "claude-code", *rel)
        if appdata and p.exists():
            return str(p)
    return ""


def resolve_vault(value: str, site) -> str:
    """The vault to serve: the one the settings name, else the vault the site sits in (the first folder above it that
    holds the road's scripts, as in a vault copy that carries the site in x/apps/), else none ("")."""
    if value:
        return str(value)
    for d in Path(site).resolve().parents:
        if (d / "x" / "scripts" / "_road.py").exists():
            return str(d)
    return ""


@dataclass
class Config:
    vault: str = ""                        # empty: the vault the site sits in (resolve_vault)
    port: int = 4190
    grader: str = "claude"                 # claude (a model grades, whichever provider) | self
    model: str = "sonnet"                  # the provider's model id; "" takes the provider's first
    timeout_s: int = 90
    quiet_hours: tuple = ("23:55", "04:30")  # the night jobs' window (the vault's in_job_window(), 20 Oct 2026): the Claude plan grades nothing then
    focus_minutes: int = 24
    break_minutes: int = 6
    lang: str = "en"                       # en | ar — the page's first language; the header switches it
    lab_python: bool = True                # the Lab may run Python on this machine (False turns it off)
    lab_timeout_s: int = 10                # a Lab run, Python or JavaScript, is stopped after this long
    # the model (the vault's Knowledge OS Plugin Plan 2026-10): one of los/providers/registry.py's ids; "" means none
    # chosen yet, as an edition ships, so the first run asks
    provider: str = "claude-cli"
    effort: str = ""                       # low | medium | high, for the providers that take it; "" leaves it to them
    daily_budget_usd: float = 1.0          # pay-per-use providers stop for the day once this much is spent (D9)
    ollama_base_url: str = "http://localhost:11434/v1"
    custom_base_url: str = ""              # any OpenAI-compatible server; with it, the provider "custom" exists
    custom_model: str = ""
    claude_cli: str = ""                   # only when `claude` is not on PATH: claude.exe, an npm shim or cli.js
    codex_cli: str = ""                    # only when `codex` is not on PATH


def load_config(path, site=None, **overrides) -> Config:
    """The settings from `path`, then the command line's `overrides`; given the site's folder, an empty vault
    resolves to the vault the site sits in."""
    data = {}
    p = Path(path) if path else None
    if p and p.exists():
        data = json.loads(p.read_text(encoding="utf-8"))
    names = {f.name for f in fields(Config)}
    kw = {k: v for k, v in data.items() if k in names}
    kw.update({k: v for k, v in overrides.items() if v is not None and k in names})
    if "quiet_hours" in kw:
        kw["quiet_hours"] = tuple(kw["quiet_hours"])
    cfg = Config(**kw)
    if not cfg.claude_cli and not shutil.which("claude"):
        cfg.claude_cli = _default_cli()
    if site is not None:
        cfg.vault = resolve_vault(cfg.vault, site)
    return cfg


SETTABLE = ("provider", "model", "effort", "daily_budget_usd", "grader")


def save_settings(path, **changes) -> dict:
    """Write the model settings the Settings page changes into knowledge-os.json, keeping everything else in it as it
    was. Only `SETTABLE` keys; never a key or a path."""
    p = Path(path)
    data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    for k, v in changes.items():
        if k not in SETTABLE:
            raise ValueError(f"not a model setting: {k}")
        data[k] = v
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(p)
    return data
