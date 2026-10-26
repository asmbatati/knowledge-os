"""The two subscription providers, run through the vendors' own CLIs: Claude Code (`claude -p`) and Codex (`codex exec`).

Each call runs in a fresh empty folder, with the text on stdin and never in argv, no tools, no MCP servers and no
user settings, so no plugin or hook runs and a note's text cannot steer an agent into acting. API keys are taken out of
the child's environment: a CLI that finds ANTHROPIC_API_KEY or OPENAI_API_KEY bills that key instead of the plan, and
the Obsidian plugin hands the server the learner's keys in its environment.

Finding Claude Code (P0 of the vault's Knowledge OS Plugin Plan 2026-10): it used to be `node <cli.js>`; since 2.1 it is
a native `claude.exe`, and npm's shim runs that directly. `resolve_cli` returns whichever argv prefix runs it, so no
shell (cmd.exe and its 8,191-character limit) ever sits between the site and the CLI.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

NO_TOOLS = ("Bash Edit Write Read Glob Grep WebFetch WebSearch NotebookEdit Task TodoWrite SlashCommand "
            "BashOutput KillShell ExitPlanMode MultiEdit LS Skill AskUserQuestion")
KEY_VARS = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY",
            "OPENROUTER_API_KEY", "CUSTOM_OPENAI_API_KEY")
# what an npm .cmd shim runs: a JS entry point (with node) or a native .exe; global shims say `%dp0%\node_modules\...`,
# local node_modules/.bin shims `%dp0%\..\...`
_SHIM_TARGET_RE = re.compile(r'"%dp0%\\([^"%]+?\.(?:c?js|mjs|exe))"', re.I)
_features: dict[tuple, set] = {}


def resolve_cli(name: str, override: str = "") -> list[str] | None:
    """The argv prefix that runs CLI `name`, or None. `override` (a settings path) wins over PATH; a path to a .js
    entry point is run with node, as the site's settings used to name Claude Code's cli.js."""
    path = str(override or "").strip().strip('"')
    found = path if path and Path(path).exists() else (None if path else shutil.which(name))
    if not found:
        return None
    low = found.lower()
    if sys.platform == "win32" and low.endswith((".cmd", ".bat")):
        return _resolve_npm_shim(Path(found)) or [found]
    if low.endswith((".js", ".cjs", ".mjs")):
        node = shutil.which("node")
        return [node, found] if node else None
    return [found]


def _resolve_npm_shim(shim: Path) -> list[str] | None:
    try:
        text = shim.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    targets = [t for t in _SHIM_TARGET_RE.findall(text) if t.lower() != "node.exe"]
    if not targets:
        return None
    target = shim.parent.joinpath(*targets[-1].split("\\")).resolve()
    if not target.is_file():
        return None
    if target.suffix.lower() == ".exe":
        return [str(target)]
    local_node = shim.parent / "node.exe"
    node = str(local_node) if local_node.is_file() else shutil.which("node")
    return [node, str(target)] if node else None


def legacy_prefix(cli: str, node: str | None = None) -> list[str]:
    """The prefix for the site's old `claude_cli` setting: a cli.js run with node, anything else run as it is."""
    if cli.lower().endswith((".js", ".cjs", ".mjs")):
        return [node or shutil.which("node") or "node", cli]
    return [cli]


def child_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in KEY_VARS}
    env["NO_COLOR"] = "1"
    return env


def run_cli(argv: list[str], stdin_text: str, timeout: int, cwd: str | None = None) -> str:
    """Run the CLI in a fresh empty folder (or `cwd`), the prompt on stdin, the keys out of its environment; return its
    stdout. A non-zero exit raises, with the output, unless stdout is a JSON result the caller can read."""
    rc, out, err = run_proc(argv, stdin_text, timeout, cwd)
    if rc != 0 and not out.lstrip().startswith("{"):
        raise RuntimeError(f"the CLI exited {rc}: {(err or out)[:300]}")
    return out


def run_proc(argv: list[str], stdin_text: str, timeout: int, cwd: str | None = None) -> tuple[int, str, str]:
    kwargs: dict = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "CREATE_NO_WINDOW", 0)
    else:
        kwargs["start_new_session"] = True
    with tempfile.TemporaryDirectory(prefix="los-model-") as tmp:
        p = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             cwd=cwd or tmp, env=child_env(), **kwargs)
        try:
            out, err = p.communicate(stdin_text.encode("utf-8"), timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill_tree(p.pid)
            p.communicate()
            raise TimeoutError(f"no answer within {timeout} s")
    return p.returncode, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")


def _kill_tree(pid: int) -> None:
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)], capture_output=True, timeout=15, check=False)
        else:
            os.killpg(pid, signal.SIGKILL)
    except (OSError, subprocess.SubprocessError):
        pass


def features(prefix: list[str]) -> set:
    """Which optional flags this CLI's --help names, asked once per binary; nothing when it cannot be asked."""
    key = tuple(prefix)
    if key not in _features:
        found: set = set()
        if prefix and Path(prefix[-1]).exists():
            try:
                rc, out, err = run_proc([*prefix, "--help"], "", 60)
                text = out + err
                found = {f for f in ("--effort", "--no-session-persistence", "--tools") if f in text}
            except (OSError, TimeoutError):
                pass
        _features[key] = found
    return _features[key]


def explain(text: str, cli: str) -> str | None:
    """A plain sentence for the CLI errors a learner can act on."""
    low = text.lower()
    if any(k in low for k in ("/login", "not logged in", "invalid api key", "sign in again", "log out and sign in",
                              "unauthorized", "401", "login required")):
        return (f"{cli} is not signed in: run `claude` and /login." if cli == "Claude Code"
                else f"{cli} is not signed in: run `codex login`.")
    if "usage limit" in low or "rate limit" in low or "limit reached" in low:
        return f"Your plan's usage limit for {cli} was reached; it resets on the plan's schedule."
    return None


class ClaudeCode:
    """Claude Code headless. `runner(argv, stdin, timeout) -> stdout` is replaceable for the tests."""

    def __init__(self, prefix: list[str], model: str, effort: str = "", runner=run_cli, detect: bool = True):
        self.prefix, self.model, self.effort, self.runner = list(prefix), model, effort, runner
        self.detect = detect

    def argv(self, system: str) -> list[str]:
        argv = [*self.prefix, "-p", "--output-format", "json", "--model", self.model,
                "--setting-sources", "project", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
                "--disallowedTools", NO_TOOLS, "--system-prompt", system]
        found = features(self.prefix) if self.detect else set()
        if "--effort" in found and self.effort:
            argv += ["--effort", self.effort]
        if "--no-session-persistence" in found:
            argv.append("--no-session-persistence")
        return argv

    def complete(self, system: str, prompt: str, timeout: int):
        from . import Reply
        raw = self.runner(self.argv(system), prompt, timeout)
        try:
            out = json.loads(raw)
        except json.JSONDecodeError as e:
            raise RuntimeError(explain(raw, "Claude Code") or f"Claude Code did not reply with JSON: {raw[:200]}") from e
        if out.get("is_error") or out.get("subtype") != "success":
            msg = str(out.get("result") or out.get("subtype") or "")
            raise RuntimeError(explain(msg, "Claude Code") or f"claude reported {out.get('subtype')}: {msg[:200]}")
        u = out.get("usage") or {}
        return Reply(text=str(out.get("result") or ""), cost_usd=out.get("total_cost_usd"),
                     input_tokens=int(u.get("input_tokens") or 0) + int(u.get("cache_read_input_tokens") or 0)
                     + int(u.get("cache_creation_input_tokens") or 0),
                     output_tokens=int(u.get("output_tokens") or 0))


class Codex:
    """Codex headless (`codex exec`), in its read-only sandbox, with the user's Codex config ignored.
    `proc(argv, stdin, timeout, cwd) -> (rc, stdout, stderr)` is replaceable for the tests."""

    def __init__(self, prefix: list[str], model: str, effort: str = "", proc=run_proc):
        self.prefix, self.model, self.effort, self.proc = list(prefix), model, effort, proc

    def complete(self, system: str, prompt: str, timeout: int):
        from . import Reply
        with tempfile.TemporaryDirectory(prefix="los-codex-") as tmp:
            last = Path(tmp) / "last-message.txt"
            argv = [*self.prefix, "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config",
                    "--ignore-rules", "--sandbox", "read-only", "--color", "never", "--json", "-C", tmp,
                    "-o", str(last)]
            if self.model and self.model != "default":
                argv += ["-m", self.model]
            if self.effort:
                argv += ["-c", f'model_reasoning_effort="{self.effort}"']
            argv.append("-")
            stdin = ("You are used as a text generator. Do not run commands, read files or edit anything: answer "
                     "from the text below only.\n\n# Instructions\n\n" + system + "\n\n" + prompt)
            rc, out, err = self.proc(argv, stdin, timeout, tmp)
            text = last.read_text(encoding="utf-8", errors="replace") if last.is_file() else ""
        events = []
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("{"):
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        if not text.strip():
            fail = next((e for e in reversed(events) if e.get("type") in ("turn.failed", "error")), {})
            detail = str((fail.get("error") or {}).get("message") or fail.get("message") or err or out)
            raise RuntimeError(explain(detail + "\n" + err, "Codex") or f"Codex gave no answer (exit {rc}): {detail[:200]}")
        i = o = 0
        for e in events:
            if e.get("type") == "turn.completed" and isinstance(e.get("usage"), dict):
                i += int(e["usage"].get("input_tokens") or 0)
                o += int(e["usage"].get("output_tokens") or 0)
        return Reply(text=text, cost_usd=None, input_tokens=i, output_tokens=o)
