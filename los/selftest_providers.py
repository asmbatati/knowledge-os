"""Selftest groups for the model providers and the trust gate (the vault's Knowledge OS Plugin Plan 2026-10):

  llm    finding the CLIs (claude.exe, npm shims, cli.js), Claude Code's and Codex's calls, the HTTP providers against a
         fake Anthropic and OpenAI server on 127.0.0.1, availability (quiet hours for the Claude plan only, the daily
         budget, a missing CLI or key) and the usage ledger (counts, never text)
  trust  passes kept per provider and model, voided by a prompt change; the Claude plan's old result files; an
         untrusted model grades nothing and plays no Teach
  parent the site the Obsidian plugin starts: it stops once the plugin's process is gone, and once the pipes the plugin
         read its output from are closed (a window reload); any other site keeps going on its log file

No call leaves the machine and no real model is asked.
"""
from __future__ import annotations

import json
import re
import os
import sys
import tempfile
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

from .selftest import check


def _cfg(**kw):
    from .config import Config
    return Config(**{"quiet_hours": ("23:55", "04:30"), **kw})


class FakeLedger:
    def __init__(self):
        self.items = []

    def append(self, kind, row, when=None):
        when = when or datetime.now()
        out = {"date": when.date().isoformat(), **row}
        self.items.append((kind, out))
        return out

    def rows(self, kind):
        return [r for k, r in self.items if k == kind]


class FakeAPI(BaseHTTPRequestHandler):
    """Anthropic's /v1/messages and the OpenAI-compatible /chat/completions, scripted by `FakeAPI.mode`."""
    mode = "ok"
    seen: list = []

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        FakeAPI.seen.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body})
        if FakeAPI.mode == "401":
            return self._send(401, {"error": {"message": "invalid x-api-key"}})
        if FakeAPI.mode == "429-then-ok":
            FakeAPI.mode = "ok"
            return self._send(429, {"error": {"message": "slow down"}}, {"retry-after": "0"})
        if FakeAPI.mode == "no-json-mode" and "response_format" in body:
            return self._send(400, {"error": {"message": "response_format is not supported by this model"}})
        if self.path.endswith("/v1/messages"):
            return self._send(200, {"content": [{"type": "text", "text": '{"correct": true}'}], "stop_reason": "end_turn",
                                    "usage": {"input_tokens": 1000, "output_tokens": 200}})
        return self._send(200, {"choices": [{"message": {"content": '{"correct": true}'}, "finish_reason": "stop"}],
                                "usage": {"prompt_tokens": 1000, "completion_tokens": 200}})

    def _send(self, status, obj, headers=None):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)


FAKE_CLI = r'''
import json, os, sys
args = sys.argv[1:]
if "--help" in args:
    print("Usage\n  --effort <level>\n  --no-session-persistence\n  --tools <tools...>"); sys.exit(0)
stdin = sys.stdin.read()
rec = {"args": args, "stdin": stdin, "cwd": os.getcwd(), "files": sorted(os.listdir(os.getcwd())),
       "keys": [k for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY") if k in os.environ]}
open(os.environ["FAKE_CLI_RECORD"], "w", encoding="utf-8").write(json.dumps(rec))
if "exec" in args:
    out = args[args.index("-o") + 1]
    open(out, "w", encoding="utf-8").write('{"correct": false}')
    print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 900, "output_tokens": 40}}))
else:
    print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": '{"correct": true}',
                      "total_cost_usd": 0.004, "usage": {"input_tokens": 10, "output_tokens": 5}}))
'''


def group_llm(ctx) -> None:
    from . import providers as P
    from .providers import cli as C
    from .providers import http as H

    # ---- finding the CLIs
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        exe = root / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe"
        exe.parent.mkdir(parents=True)
        exe.write_text("")
        local = root / "node_modules" / ".bin" / "claude.cmd"
        local.parent.mkdir(parents=True)
        local.write_text('@ECHO off\r\n"%dp0%\\..\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n')
        check("a local npm shim that runs claude.exe resolves to the exe", C._resolve_npm_shim(local) == [str(exe.resolve())])
        js = root / "node_modules" / "@openai" / "codex" / "bin" / "codex.js"
        js.parent.mkdir(parents=True)
        js.write_text("//")
        (root / "node.exe").write_text("")
        glob = root / "codex.cmd"
        glob.write_text('@ECHO off\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\n'
                        '"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n')
        check("a global npm shim that runs a script resolves to node and the script",
              C._resolve_npm_shim(glob) == [str(root / "node.exe"), str(js.resolve())])
        check("a cli.js named in the settings is run with node", C.resolve_cli("claude", str(js))[-1] == str(js))
        check("a path that does not exist finds nothing", C.resolve_cli("claude", str(root / "nope.exe")) is None)
        check("the old setting's prefix: cli.js with node, an exe alone",
              C.legacy_prefix("x/cli.js", "node") == ["node", "x/cli.js"] and C.legacy_prefix("claude.exe") == ["claude.exe"])

        # ---- the CLIs as real child processes: text on stdin, an empty folder, no keys
        script = root / "fakecli.py"
        script.write_text(FAKE_CLI, encoding="utf-8")
        record = root / "record.json"
        os.environ["FAKE_CLI_RECORD"] = str(record)
        os.environ["ANTHROPIC_API_KEY"] = "sk-must-not-reach-the-cli"
        try:
            cc = C.ClaudeCode([sys.executable, str(script)], "haiku", effort="low")
            r = cc.complete("SYSTEM", "SECRET-ANSWER", 60)
            rec = json.loads(record.read_text(encoding="utf-8"))
            check("Claude Code: the reply and its notional cost are read", r.text == '{"correct": true}' and r.cost_usd == 0.004)
            check("Claude Code: the text goes on stdin, never in argv",
                  rec["stdin"] == "SECRET-ANSWER" and not any("SECRET" in a for a in rec["args"]))
            check("Claude Code: no tools, no MCP servers, no user settings",
                  "--disallowedTools" in rec["args"] and "--strict-mcp-config" in rec["args"]
                  and rec["args"][rec["args"].index("--setting-sources") + 1] == "project")
            check("Claude Code: --effort and --no-session-persistence when the CLI offers them",
                  rec["args"][rec["args"].index("--effort") + 1] == "low" and "--no-session-persistence" in rec["args"])
            check("a CLI runs in an empty folder, with no API key in its environment",
                  rec["files"] == [] and rec["keys"] == [])
            cx = C.Codex([sys.executable, str(script)], "gpt-6-luna", effort="low")
            r = cx.complete("SYSTEM", "SECRET-ANSWER", 60)
            rec = json.loads(record.read_text(encoding="utf-8"))
            a = rec["args"]
            check("Codex: read-only sandbox, ephemeral, the user's config ignored, the model and effort passed",
                  a[0] == "exec" and a[a.index("--sandbox") + 1] == "read-only" and "--ephemeral" in a
                  and "--ignore-user-config" in a and a[a.index("-m") + 1] == "gpt-6-luna"
                  and 'model_reasoning_effort="low"' in a)
            check("Codex: the last message is the reply, its tokens counted",
                  r.text == '{"correct": false}' and r.input_tokens == 900 and r.output_tokens == 40)
            check("Codex: the instructions and the text go on stdin", "SYSTEM" in rec["stdin"] and "SECRET-ANSWER" in rec["stdin"])
        finally:
            os.environ.pop("ANTHROPIC_API_KEY", None)
            os.environ.pop("FAKE_CLI_RECORD", None)

    def fails(fn, needle):
        try:
            fn()
        except Exception as e:      # noqa: BLE001
            return needle in str(e)
        return False

    check("Claude Code: a sign-in error is said plainly", fails(lambda: C.ClaudeCode(["c"], "m", runner=lambda *a: json.dumps(
        {"type": "result", "subtype": "success", "is_error": True, "result": "Invalid API key · Please run /login"}),
        detect=False).complete("s", "p", 5), "not signed in"))
    check("Claude Code: a plan limit is said plainly", fails(lambda: C.ClaudeCode(["c"], "m", runner=lambda *a: json.dumps(
        {"type": "result", "subtype": "success", "is_error": True, "result": "Claude AI usage limit reached|1793000000"}),
        detect=False).complete("s", "p", 5), "usage limit"))
    check("Codex: an expired sign-in is said plainly", fails(lambda: C.Codex(["c"], "m", proc=lambda *a: (
        1, '{"type":"turn.failed","error":{"message":"unauthorized (401)"}}', "Please log out and sign in again")
    ).complete("s", "p", 5), "codex login"))

    # ---- the HTTP providers against a fake server on 127.0.0.1
    srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeAPI)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        FakeAPI.mode, FakeAPI.seen = "ok", []
        r = H.AnthropicAPI("sk-ant-test", "claude-haiku-5-5", base).complete("SYS", "PROMPT", 10)
        req = FakeAPI.seen[-1]
        check("Anthropic: the key in x-api-key, the version header, system and prompt in the body",
              req["path"] == "/v1/messages" and req["headers"]["x-api-key"] == "sk-ant-test"
              and req["headers"]["anthropic-version"] == H.ANTHROPIC_VERSION and req["body"]["system"] == "SYS"
              and req["body"]["messages"][0]["content"] == "PROMPT")
        check("Anthropic: the reply and its tokens", r.text == '{"correct": true}' and r.input_tokens == 1000)
        r = H.OpenAICompat("sk-test", "gpt-6-luna", base + "/v1").complete("Reply in JSON.", "PROMPT", 10)
        req = FakeAPI.seen[-1]
        check("OpenAI-compatible: a bearer key, system and user messages, JSON mode when JSON is asked for",
              req["path"] == "/v1/chat/completions" and req["headers"]["authorization"] == "Bearer sk-test"
              and req["body"]["messages"][0] == {"role": "system", "content": "Reply in JSON."}
              and req["body"]["response_format"] == {"type": "json_object"})
        FakeAPI.mode = "no-json-mode"
        oc = H.OpenAICompat("", "qwen3.6:27b", base + "/v1")
        r = oc.complete("JSON please", "x", 10)
        check("a server that refuses JSON mode is asked again without it, and no key is sent when there is none",
              r.text == '{"correct": true}' and oc.json_mode is False and "authorization" not in FakeAPI.seen[-1]["headers"])
        FakeAPI.mode = "429-then-ok"
        r = H.OpenAICompat("k", "m", base).complete("s", "p", 10)
        check("a 429 with a short wait is retried", r.text == '{"correct": true}')
        FakeAPI.mode = "401"
        check("a refused key is said plainly",
              fails(lambda: H.AnthropicAPI("bad", "m", base).complete("s", "p", 10), "refused the API key"))
        check("an unreachable provider is said plainly", fails(lambda: H.post_json(
            "http://127.0.0.1:9/x", {}, {}, 2, retries=0), "could not reach"))
    finally:
        srv.shutdown()

    # ---- availability and the usage ledger
    noon, night = datetime(2026, 10, 26, 12, 0), datetime(2026, 10, 26, 2, 0)
    reply = SimpleNamespace(complete=lambda s, p, t: P.Reply('{"correct": true}', None, 1_000_000, 100_000))
    table = P.presets(_cfg())
    led = FakeLedger()
    m = P.Model(table["claude-cli"], table["claude-cli"].model("sonnet"), reply, clock=lambda: night, ledger=led)
    check("the Claude plan rests in the night jobs' hours", m.available() == (False, "quiet"))
    m = P.Model(table["codex-cli"], table["codex-cli"].model("gpt-6-luna"), reply, clock=lambda: night, ledger=led)
    check("the ChatGPT plan does not share the night jobs: it may answer then", m.available() == (True, ""))
    m = P.Model(table["anthropic"], table["anthropic"].model("claude-haiku-5-5"), reply, clock=lambda: noon,
                ledger=led, budget_usd=0.2)
    r = m.complete("s", "SECRET", 10, site="grade")
    row = led.rows("usage")[-1]
    check("a paid call is priced from its tokens", r.cost_usd == round((1_000_000 * 0.10 + 100_000 * 0.50) / 1e6, 6))
    check("the usage row holds counts and the cost, never the text",
          row["provider"] == "anthropic" and row["site"] == "grade" and row["metered"] is True
          and "SECRET" not in json.dumps(row))
    m.complete("s", "p", 10)
    check("past the daily budget a paid provider rests", m.available() == (False, "budget"))
    try:
        m.complete("s", "p", 10)
        rested = False
    except P.Unavailable as e:
        rested = e.code == "budget"
    check("a call past the budget is refused, not sent", rested)
    m = P.Model(table["ollama"], table["ollama"].model("qwen3.6:27b"), reply, clock=lambda: noon, ledger=led, budget_usd=0)
    check("a local model is never counted against the budget", m.available() == (True, ""))
    check("an API provider with no key is unavailable",
          P.make_model(_cfg(provider="openai", model="gpt-6-luna"), environ={}).available() == (False, "no_key"))
    check("with a key it is ready", P.make_model(_cfg(provider="openai"), environ={"OPENAI_API_KEY": "sk"}).available()[0])
    check("no provider chosen is said as such", P.make_model(_cfg(provider="")).available() == (False, "no_provider"))
    check("an unknown model id is kept, with no price",
          P.make_model(_cfg(provider="openai", model="gpt-x"), environ={"OPENAI_API_KEY": "k"}).info.input_price is None)
    check("Claude Code keeps the grader name the ledgers know", table["claude-cli"].name == "claude")
    check("Ollama needs no key", P.make_model(_cfg(provider="ollama"), environ={}).available()[0])
    check("a custom server appears only when its address is set",
          "custom" not in P.presets(_cfg()) and "custom" in P.presets(_cfg(custom_base_url="http://127.0.0.1:1234/v1")))


def group_trust(ctx) -> None:
    from . import providers as P
    from . import trust as T
    from .grade import make_grader
    from .tutorllm import GatedTutor
    table = P.presets(_cfg())
    with tempfile.TemporaryDirectory() as td:
        path, site = Path(td) / "trust.json", Path(td)
        (site / "tests").mkdir()
        luna = P.Model(table["openai"], table["openai"].model("gpt-6-luna"), None)
        check("a model never tested is not trusted", not T.trusted(luna, "grader", path, site))
        T.record(luna, "grader", {"ok": True, "agreed": 60, "total": 60, "date": "2026-10-26"}, path)
        check("a pass is kept per provider and model", T.trusted(luna, "grader", path, site)
              and not T.trusted(luna, "teach", path, site))
        data = json.loads(path.read_text(encoding="utf-8"))
        data["openai/gpt-6-luna"]["grader"]["prompt"] = "an-older-prompt"
        path.write_text(json.dumps(data), encoding="utf-8")
        st = T.status(luna, "grader", path, site)
        check("a pass earned on another prompt no longer counts", not st["counts"] and st["stale"])
        T.record(luna, "grader", {"ok": False, "agreed": 58, "total": 60}, path)
        check("a failed test is kept and trusts nothing", not T.trusted(luna, "grader", path, site))
        sonnet = P.Model(table["claude-cli"], table["claude-cli"].model("sonnet"), None)
        (site / "tests" / "grader-results-2026-10-05.json").write_text(
            json.dumps({"ok": True, "agreed": 60, "total": 60, "date": "2026-10-05", "model": "sonnet"}), encoding="utf-8")
        check("the Claude plan's result file from before trust.json counts for its model",
              T.trusted(sonnet, "grader", path, site))
        haiku = P.Model(table["claude-cli"], table["claude-cli"].model("haiku"), None)
        check("and for no other model", not T.trusted(haiku, "grader", path, site))
        cfg = _cfg(provider="openai", model="gpt-6-luna")
        g = make_grader(cfg, luna, trusted=lambda m: False)
        r = g.grade({"q": "?", "key": "k"}, "an answer")
        check("an untrusted model grades nothing: the learner does, told why",
              g.name == "self" and r["needs_self"] and r["why_code"] == "untrusted")
        g = make_grader(cfg, luna, trusted=lambda m: True)
        check("a trusted model grades", g.name == "openai")
        check("Teach held back from an untrusted model says why", GatedTutor(object()).available() == (False, "untrusted"))


def group_models(ctx) -> None:
    """The Settings page's API on the demo vault: the providers, saving a choice (with the page's token or the
    plugin's secret, never without), and the trust test as a background job."""
    import time
    from . import demo, gradertest
    from .selftest import Client
    from .serve import build_app
    from .vault import Vault
    from .web import make_server
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "vault"
        root.mkdir()
        demo.make_demo(root)
        settings = Path(td) / "knowledge-os.json"
        settings.write_text(json.dumps({"vault": str(root), "port": 4190}), encoding="utf-8")
        cfg = _cfg(vault=str(root), port=0, provider="ollama", model="qwen3.6:27b", ollama_base_url="http://127.0.0.1:9/v1")
        app = build_app(cfg, Vault(ctx["code_root"], root), settings_path=settings,
                        environ={"LOS_PLUGIN_TOKEN": "plugin-secret-123"})
        srv = make_server(app, "127.0.0.1", 0)
        app.port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        cl = Client(app.port)
        try:
            st, _, _, js = cl.req("GET", "/api/models")
            ids = [p["id"] for p in js["providers"]]
            check("the providers are listed, subscriptions first",
                  st == 200 and ids[:2] == ["claude-cli", "codex-cli"] and {"anthropic", "openai", "ollama"} <= set(ids))
            check("the chosen model is reported, with its tier and no trust yet",
                  js["current"]["provider"] == "ollama" and js["current"]["tier"] == "local"
                  and js["trust"]["grader"].get("never"))
            check("Ollama needs no setup beyond running", next(p for p in js["providers"] if p["id"] == "ollama")["ready"])
            st, *_ = cl.req("POST", "/api/models/save", {"provider": "openai"})
            check("a save without the page's token is refused", st == 403)
            st, _, _, js = cl.req("POST", "/api/models/save", {"provider": "openai", "model": "gpt-6-luna",
                                                                "daily_budget_usd": 0.5},
                                  headers={"Origin": "", "X-LOS-Plugin": "plugin-secret-123"})
            saved = json.loads(settings.read_text(encoding="utf-8"))
            check("the plugin's secret is enough for a write",
                  st == 200 and js["current"]["provider"] == "openai" and js["budget"]["daily_usd"] == 0.5)
            check("the choice is kept in knowledge-os.json, the rest of the file as it was, no key in it",
                  saved == {"vault": str(root), "port": 4190, "provider": "openai", "model": "gpt-6-luna",
                            "daily_budget_usd": 0.5})
            check("the grader follows the new model at once", app.grader.model.preset.id == "openai")
            st, *_ = cl.req("POST", "/api/models/save", {"provider": "x"}, headers={"Origin": "", "X-LOS-Plugin": "wrong"})
            check("a wrong secret is refused", st == 403)
            cl.token = re.search(rb'name="los-token" content="([0-9a-f]+)"', cl.req("GET", "/")[2]).group(1).decode()
            st, *_ = cl.req("POST", "/api/models/save", {"provider": "nonesuch"})
            check("an unknown provider is refused", st == 400)
            st, *_ = cl.req("POST", "/api/models/save", {"daily_budget_usd": 5000})
            check("a budget out of range is refused", st == 400)
            st, *_ = cl.req("POST", "/api/models/save", {"model": "bad model; rm -rf"})
            check("a model id that is not one is refused", st == 400)
            st, _, _, js = cl.req("POST", "/api/models/save", {"provider": "ollama", "model": "qwen3.6:27b"})
            check("the page's own token saves too", st == 200 and js["current"]["provider"] == "ollama")

            real_run = gradertest.run

            def fake_run(cfg, vault, model=None, say=print, on_progress=None):
                for i in range(1, 4):
                    on_progress(i, 3, {})
                say("3 of 3 agreed")
                return 0
            gradertest.run = fake_run
            try:
                st, _, _, js = cl.req("POST", "/api/models/test", {"kind": "grader"})
                check("the trust test starts as a job", st == 200)
                for _ in range(50):
                    st, _, _, js = cl.req("GET", "/api/models/test")
                    if not js["running"]:
                        break
                    time.sleep(0.1)
                check("the job reports its progress and its result",
                      js["result"] == "passed" and js["done"] == 3 and js["total"] == 3 and "3 of 3 agreed" in js["lines"])
            finally:
                gradertest.run = real_run
            st, *_ = cl.req("POST", "/api/models/test", {"kind": "nonsense"})
            check("an unknown test is refused", st == 400)
            st, _, _, js = cl.req("GET", "/api/models/check?provider=ollama")
            check("checking Ollama asks the local server and says when it is not running",
                  st == 200 and js["ready"] is False and js["message"] == "not_running")
            st, _, _, js = cl.req("GET", "/api/models/check?provider=openai")
            check("checking an API provider spends nothing and says the key is missing",
                  st == 200 and js["ready"] is False and js["message"] == "no_key")
        finally:
            srv.shutdown()


def group_frame(ctx) -> None:
    """Who may frame what (P3): the page by Obsidian alone, nothing else by anyone."""
    from . import demo
    from .app import App
    from .grade import FakeGrader
    from .vault import Vault
    from .selftest import SITE
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        demo.make_demo(root)
        app = App(_cfg(vault=str(root), port=4190), vault=Vault(ctx["code_root"], root), grader=FakeGrader(),
                  web_dir=SITE / "web")
        host = {"host": "127.0.0.1:4190"}
        st, hd, body = app.handle("GET", "/", host, b"")
        csp = hd.get("Content-Security-Policy", "")
        check("the page may be framed by Obsidian", st == 200 and "frame-ancestors 'self' app://obsidian.md" in csp)
        check("by Obsidian alone: no wildcard, no other origin, no X-Frame-Options that would forbid it",
              "*" not in csp.split("frame-ancestors")[1].split(";")[0] and "X-Frame-Options" not in hd)
        check("the page keeps its script policy", "script-src 'self'" in csp and "'unsafe-inline'" not in csp.split("script-src")[1].split(";")[0])
        st, hd, _ = app.handle("GET", "/api/health", host, b"")
        check("an API answer is never framable", hd.get("X-Frame-Options") == "DENY"
              and "frame-ancestors 'none'" in hd.get("Content-Security-Policy", ""))
        st, hd, _ = app.handle("GET", "/app/main.js", host, b"")
        check("a script file is never framable either", hd.get("X-Frame-Options") == "DENY")
        st, hd, _ = app.handle("GET", "/", {"host": "evil.example:4190"}, b"")
        check("a foreign Host still gets nothing", st == 403)


class _BrokenPipe:
    def write(self, text):
        raise OSError(22, "Invalid argument")

    def flush(self):
        raise BrokenPipeError(32, "Broken pipe")


def group_parent(ctx=None) -> None:
    import subprocess
    from . import watchdog
    check("this process is alive", watchdog.pid_alive(os.getpid()))
    check("pid 0 is no process", not watchdog.pid_alive(0))
    done = subprocess.run([sys.executable, "-c", "pass"])
    p = subprocess.Popen([sys.executable, "-c", "pass"])
    p.wait()
    check("a process that has ended is gone", done.returncode == 0 and not watchdog.pid_alive(p.pid))

    gone = threading.Event()
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(0.3)"])
    watchdog.watch_parent(child.pid, interval_s=0.05, on_gone=gone.set, say=lambda *a, **k: None)
    check("the watchdog notices its parent end", gone.wait(5))
    child.wait()
    check("no LOS_PARENT_PID, no watchdog", watchdog.from_env({}) is None
          and watchdog.from_env({"LOS_PARENT_PID": "x"}) is None and watchdog.from_env({"LOS_PARENT_PID": "0"}) is None)

    saved = sys.stdout, sys.stderr
    exits = []
    with tempfile.TemporaryDirectory() as d:
        log = Path(d) / ".local" / "server.log"
        try:
            sys.stdout, sys.stderr = _BrokenPipe(), _BrokenPipe()
            plugin = watchdog.guard_streams(log, {"LOS_PARENT_PID": "1234"}, exit=exits.append)
            sys.stderr.write("GET /api/health 200\n")
            sys.stdout.flush()
        finally:
            sys.stdout, sys.stderr = saved
        check("a plugin's site stops when its pipe breaks", plugin and exits[:1] == [0] and not log.exists())
        stops = len(exits)

        try:
            sys.stdout, sys.stderr = _BrokenPipe(), _BrokenPipe()
            plugin = watchdog.guard_streams(log, {}, exit=exits.append)
            sys.stderr.write("GET /api/today 200\n")
            print("still serving", flush=True)
            again = watchdog.guard_streams(log, {}, exit=exits.append)
        finally:
            sys.stdout, sys.stderr = saved
        text = log.read_text(encoding="utf-8") if log.exists() else ""
        check("any other site keeps serving, on its log file", not plugin and not again and len(exits) == stops
              and "GET /api/today 200" in text and "still serving" in text)


def register(groups: dict) -> None:
    groups["parent"] = group_parent
    groups["llm"] = group_llm
    groups["trust"] = group_trust
    groups["models"] = group_models
    groups["frame"] = group_frame
