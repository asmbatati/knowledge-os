"""The API: routes to the road, the grader and the ledgers.

Every request passes the Host check (127.0.0.1 or localhost on the site's port: no DNS rebinding). Every POST also
passes the Origin check and carries the session token the page received in its HTML. The key and the note's evidence
never leave the server before an answer is given, and a verdict is rebuilt from the attempts the server recorded,
never from what the browser sends.
"""
from __future__ import annotations

import hmac
import importlib.util
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from . import VERSION
from .grade import in_quiet_hours
from .jobs import vault_job_running
from .ledger import Ledger, streak
from .banks import write_bank
from .render import render_note
from .tutor import Tutor, TutorError
from .coach import Coach, CoachError
from .explore import Explore
from .lang import Bilingual, page_lang
from .teach import HABITS, LEVELS, Teach, TeachError

MAX_BODY = 64 * 1024
MAX_ANSWER = 4000
ITEM_HOURS = 12
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
       "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; "
       "form-action 'none'")
# The page itself may be framed by Obsidian alone (the vault's Knowledge OS Plugin Plan 2026-10, D2): the Knowledge OS
# plugin shows the site in a tab. Every other framer is still refused, and nothing but the page is ever framable.
OBSIDIAN_ORIGIN = "app://obsidian.md"
PAGE_CSP = CSP.replace("frame-ancestors 'none'", f"frame-ancestors 'self' {OBSIDIAN_ORIGIN}")
# The Lab's code runs in a worker with a policy of its own: it may evaluate code, and it may reach nothing at all.
WORKER_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'; worker-src 'none'"
WORKERS = {"app/lab/worker.js"}
# A figure (figures/<id>/<page>.html, built with the Anatomy skill's kit) carries its script inline. It gets a policy of
# its own, and a sandbox: an opaque origin, so its script runs but reaches nothing of the site's, and only the site
# itself may frame it.
FIGURE_CSP = ("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; "
              "base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts")
FIGURE = re.compile(r"^/figures/([a-z0-9][a-z0-9-]{0,47})/([a-z0-9][a-z0-9-]{0,47})\.html$")
# An image a note embeds (render.py): no script, no fetch, sandboxed if opened on its own.
ASSET_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox"
IMAGE_TYPES = {".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".gif": "image/gif", ".webp": "image/webp"}
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
         ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon"}
EXERCISE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
LAB_OUT, LAB_ERR = 100_000, 20_000
MARK = "\x1eLOSFIGS\x1e"           # the runner's line before the figures (labrun.py)
MAX_FIGURES, MAX_FIGURE = 6, 3_000_000
FACETS = ("define", "work", "why")


class HttpError(Exception):
    def __init__(self, status: int, message: str, **extra):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra


class App:
    def __init__(self, cfg, *, vault, grader, bank_writer=None, job_running=vault_job_running, web_dir,
                 clock=datetime.now, tutor=None, llm=None, teach_llm=None, model=None, settings_path=None,
                 plugin_token=""):
        self.cfg, self.vault, self.grader, self.bank_writer = cfg, vault, grader, bank_writer
        self.model = model                  # the los/providers Model behind them, for the Settings page; None in tests
        self.settings_path = settings_path  # knowledge-os.json, where the Settings page saves the model choice
        # The Obsidian plugin's secret (LOS_PLUGIN_TOKEN, set when the plugin starts the site): its writes carry it
        # instead of the page's Origin and token. Empty when the site was started any other way.
        self.plugin_token = plugin_token
        self.trust_job: dict = {}
        self.job_running, self.clock = job_running, clock
        self.web_dir = Path(web_dir).resolve()
        self.figures_dir = (self.web_dir.parent / "figures").resolve()
        self.port = cfg.port
        self.token = secrets.token_hex(24)
        self.ledger = Ledger(vault.learn)
        self.tutor = tutor if tutor is not None else Tutor(vault, vault.learn, clock=clock, llm=llm, grader=grader,
                                                           ledger=self.ledger)
        self.items: dict[str, dict] = {}
        self.pending_self: dict[str, dict] = {}
        self.lock = threading.RLock()
        self.lab_lock = threading.Lock()
        self._modules: dict | None = None
        self.warm_done = False
        self.explore = Explore(vault)
        self.bilingual = Bilingual(self.explore)
        self.coach = Coach(vault, self.explore, vault.learn, clock=clock, llm=llm, ledger=self.ledger,
                           bank_writer=bank_writer, job_running=job_running)
        self.teach = Teach(vault, self.explore, vault.learn, clock=clock, llm=teach_llm if teach_llm is not None else llm,
                           ledger=self.ledger)
        self._known: tuple | None = None

    # ------------------------------------------------------------- plumbing
    def warm(self) -> None:
        """Read the graph and the sources once at start, so the first page does not wait ten seconds."""
        try:
            self.vault.next_item()
            self.vault.plan()
            self.explore.tree()
        finally:
            self.warm_done = True

    def host_ok(self, headers: dict) -> bool:
        return headers.get("host", "") in (f"127.0.0.1:{self.port}", f"localhost:{self.port}")

    def _headers(self, ctype: str, cache: str = "no-store", csp: str = CSP) -> dict:
        return {"Content-Type": ctype, "Cache-Control": cache, "Content-Security-Policy": csp,
                "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY"}

    def _json(self, status: int, obj) -> tuple[int, dict, bytes]:
        return status, self._headers("application/json; charset=utf-8"), \
            json.dumps(obj, ensure_ascii=False).encode("utf-8")

    def handle(self, method: str, path: str, headers: dict, body: bytes) -> tuple[int, dict, bytes]:
        try:
            if not self.host_ok(headers):
                raise HttpError(403, "this site answers only on 127.0.0.1 and localhost")
            parts = urlsplit(path)
            route, query = parts.path, parse_qs(parts.query)
            if method == "GET":
                return self._get(route, query)
            if method == "POST":
                plugin = headers.get("x-los-plugin", "")
                from_plugin = bool(self.plugin_token) and bool(plugin) and hmac.compare_digest(plugin, self.plugin_token)
                origin = headers.get("origin", "")
                if not from_plugin and origin not in (f"http://127.0.0.1:{self.port}", f"http://localhost:{self.port}"):
                    raise HttpError(403, "a write must come from this site's own page")
                if not from_plugin and not hmac.compare_digest(headers.get("x-los-token", ""), self.token):
                    raise HttpError(403, "the session token is missing or stale: reload the page")
                if len(body) > MAX_BODY:
                    raise HttpError(413, "the request is too large")
                try:
                    data = json.loads(body or b"{}")
                except ValueError:
                    raise HttpError(400, "the body is not JSON")
                if not isinstance(data, dict):
                    raise HttpError(400, "the body is not a JSON object")
                return self._post(route, data)
            raise HttpError(405, "method not allowed")
        except HttpError as e:
            return self._json(e.status, {"error": e.message, **e.extra})
        except Exception as e:          # an unexpected failure still answers, and says what it was
            traceback.print_exc()
            return self._json(500, {"error": f"the server failed: {type(e).__name__}: {e}"})

    # ---------------------------------------------------------------- pages
    def _get(self, route: str, q: dict):
        if route in ("/", "/index.html"):
            html = (self.web_dir / "index.html").read_text(encoding="utf-8")
            html = html.replace("{{TOKEN}}", self.token).replace("{{LANG}}", self.cfg.lang).replace(
                "{{VERSION}}", VERSION)
            headers = self._headers("text/html; charset=utf-8", csp=PAGE_CSP)
            del headers["X-Frame-Options"]      # it cannot name one origin; the CSP's frame-ancestors decides
            return 200, headers, html.encode("utf-8")
        if route.startswith(("/app/", "/vendor/", "/fonts/")):
            return self._static(route)
        if route.startswith("/figures/"):
            return self._figure(route)
        if route.startswith("/asset/"):
            return self._asset(route)
        if route == "/favicon.ico":
            return 204, self._headers("image/x-icon"), b""
        api = {"/api/health": self.api_health, "/api/today": self.api_today, "/api/next": self.api_next,
               "/api/concept": self.api_concept, "/api/graph": self.api_graph, "/api/progress": self.api_progress,
               "/api/lab": self.api_lab, "/api/courses": self.api_courses, "/api/course": self.api_course,
               "/api/course/draft": self.api_course_draft, "/api/tutor/session": self.api_tutor_session,
               "/api/tutor/exam": self.api_tutor_exam, "/api/place": self.api_place,
               "/api/explore": self.api_explore, "/api/field": self.api_field, "/api/river": self.api_river,
               "/api/frontier": self.api_frontier, "/api/xnote": self.api_xnote, "/api/xsearch": self.api_xsearch,
               "/api/teach": self.api_teach, "/api/teach/past": self.api_teach_past, "/api/labels": self.api_labels,
               "/api/coach": self.api_coach, "/api/coach/card": self.api_coach_card,
               "/api/models": self.api_models, "/api/models/check": self.api_models_check,
               "/api/models/test": self.api_models_test_state}
        if route in api:
            return self._json(200, api[route](q))
        raise HttpError(404, "no such page")

    def _static(self, route: str):
        rel = unquote(route).lstrip("/")
        p = (self.web_dir / rel).resolve()
        if not p.is_relative_to(self.web_dir) or not p.is_file() or p.suffix.lower() not in TYPES:
            raise HttpError(404, "no such file")
        cache = "max-age=86400" if rel.startswith(("vendor/", "fonts/")) else "no-cache"
        csp = WORKER_CSP if rel in WORKERS else CSP
        return 200, self._headers(TYPES[p.suffix.lower()], cache, csp), p.read_bytes()

    def _figure(self, route: str):
        m = FIGURE.match(unquote(route))
        p = (self.figures_dir / m.group(1) / f"{m.group(2)}.html").resolve() if m else None
        if p is None or not p.is_relative_to(self.figures_dir) or not p.is_file():
            raise HttpError(404, "no such figure")
        headers = self._headers("text/html; charset=utf-8", "no-cache", FIGURE_CSP)
        headers["X-Frame-Options"] = "SAMEORIGIN"
        return 200, headers, p.read_bytes()

    def _asset(self, route: str):
        """An image a concept note embeds, by its file name, from beside the notes (`Vault.asset_path`). The page shows
        it in an <img>, where an SVG's script never runs, and its own policy sandboxes it when opened directly."""
        p = self.vault.asset_path(unquote(route[len("/asset/"):]))
        if p is None:
            raise HttpError(404, "no such image")
        return 200, self._headers(IMAGE_TYPES[p.suffix.lower()], "no-cache", ASSET_CSP), p.read_bytes()

    def _post(self, route: str, data: dict):
        api = {"/api/attempt": self.api_attempt, "/api/attempt/self": self.api_attempt_self,
               "/api/dispute": self.api_dispute, "/api/verdict": self.api_verdict, "/api/focus": self.api_focus,
               "/api/read": self.api_read, "/api/bank": self.api_bank, "/api/lab/python": self.api_lab_python,
               "/api/lab/attempt": self.api_lab_attempt, "/api/course/save": self.api_course_save,
               "/api/course/match": self.api_course_match, "/api/course/archive": self.api_course_archive,
               "/api/tutor/mark": self.api_tutor_mark, "/api/tutor/recall": self.api_tutor_recall,
               "/api/tutor/recall/self": self.api_tutor_recall_self, "/api/tutor/ask": self.api_tutor_ask,
               "/api/tutor/practice": self.api_tutor_practice,
               "/api/tutor/practice/answer": self.api_tutor_practice_answer,
               "/api/tutor/practice/self": self.api_tutor_practice_self,
               "/api/place/answer": self.api_place_answer, "/api/place/self": self.api_place_self,
               "/api/place/skip": self.api_place_skip,
               "/api/words": self.api_words, "/api/teach/start": self.api_teach_start,
               "/api/teach/say": self.api_teach_say, "/api/teach/end": self.api_teach_end,
               "/api/coach/profile": self.api_coach_profile, "/api/coach/start": self.api_coach_start,
               "/api/coach/step": self.api_coach_step, "/api/coach/answer": self.api_coach_answer,
               "/api/coach/loop": self.api_coach_loop, "/api/coach/reflect": self.api_coach_reflect,
               "/api/coach/end": self.api_coach_end, "/api/coach/import": self.api_coach_import,
               "/api/coach/more": self.api_coach_more, "/api/coach/skip": self.api_coach_skip,
               "/api/coach/explain": self.api_coach_explain,
               "/api/models/save": self.api_models_save, "/api/models/test": self.api_models_test}
        if route not in api:
            raise HttpError(404, "no such action")
        return self._json(200, api[route](data))

    # ------------------------------------------------------------ helpers
    def today(self) -> date:
        return self.clock().date()

    def _canon(self, name) -> str:
        canon = self.vault.known().get(str(name or "").strip().lower())
        if not canon:
            raise HttpError(404, "no concept note by that name")
        return canon

    def _activity(self) -> set[date]:
        days: set[date] = set()
        for r in self.ledger.rows("attempts"):
            days.add(date.fromisoformat(r["date"]))
        for r in self.ledger.rows("sessions"):
            if r.get("type") == "read" or (r.get("type") == "focus" and (r.get("minutes") or 0) > 0):
                days.add(date.fromisoformat(r["date"]))
        for r in self.vault.verdict_rows():
            try:
                days.add(date.fromisoformat(r["date"]))
            except (KeyError, ValueError):
                continue
        return days

    def _focus_minutes(self, on: date) -> int:
        return sum(int(r.get("minutes") or 0) for r in self.ledger.rows("sessions")
                   if r.get("type") == "focus" and r.get("event") == "stop" and r.get("date") == on.isoformat())

    def _questions(self, nx: dict) -> list[dict]:
        """A check asks the bank's three main questions; one taken again after a failure asks their variants, since the
        main keys were shown. A review asks again, in new words, what the concept's last verdict missed (`ask`, from
        _road.cmd_next), else one facet in turn (Learning System Improvement Plan 2026-10, decision 2)."""
        bank = self.vault.bank(nx["concept"]) or {}
        by_facet = {q.get("facet"): q for q in bank.get("questions") or []}
        nvar = lambda f: len(by_facet.get(f, {}).get("variants") or [])          # noqa: E731
        tc = int(nx.get("test_count") or 0)
        if nx["kind"] == "check":
            chosen = [(f, 1 + tc % nvar(f) if nx.get("recheck") and nvar(f) else 0) for f in FACETS]
        elif nx.get("ask"):
            chosen = [(f, 1 + tc % nvar(f) if nvar(f) else 0) for f in nx["ask"] if f in FACETS][:2]
        else:
            f = FACETS[tc % 3]
            chosen = [(f, (tc // 3) % (nvar(f) + 1))]
        out = []
        for facet, v in chosen:
            base = by_facet.get(facet)
            if not base:
                continue
            src = base if v == 0 else base["variants"][v - 1]
            out.append({"qid": f"{facet}-{v}", "facet": facet, "variant": v, "q": src["q"], "key": src["key"],
                        "evidence": src["evidence"]})
        return out

    # -------------------------------------------------------------- the API
    def api_health(self, q):
        return {"ok": True, "version": VERSION, "warm": self.warm_done, "grader": self.grader.name,
                "job_running": self.job_running(), "quiet": in_quiet_hours(self.clock().time(), self.cfg.quiet_hours),
                "timer": {"focus": self.cfg.focus_minutes, "break": self.cfg.break_minutes},
                "model": self._model_brief()}

    # ------------------------------------------------------------- the model (the vault's Knowledge OS Plugin Plan)
    def _model_brief(self) -> dict | None:
        if self.model is None:
            return None
        ok, code = self.model.available()
        return {**self.model.describe(), "available": ok, "why_code": code}

    def _rewire(self) -> None:
        """Build the model again from the settings and hand it to everything that uses it."""
        from .wiring import wire
        w = wire(self.cfg, self.vault)
        with self.lock:
            self.model, self.grader, self.bank_writer = w.model, w.grader, w.bank_writer
            self.tutor.llm, self.tutor.grader = w.tutor, w.grader
            self.coach.llm, self.coach.bank_writer = w.tutor, w.bank_writer
            self.teach.llm = w.teach_llm

    def api_models(self, q):
        """Every provider, whether it is set up here, the chosen one, its trust and today's spend."""
        import dataclasses
        from . import trust
        from .providers import make_model, presets
        out = []
        for p in presets(self.cfg).values():
            probe = make_model(dataclasses.replace(self.cfg, provider=p.id, model=p.models[0].id))
            out.append({"id": p.id, "label": p.label, "kind": p.kind, "tier": p.tier, "metered": p.metered,
                        "ready": not probe.missing, "why_code": probe.missing, "setup_hint": p.setup_hint,
                        "notes": p.notes, "docs_url": p.docs_url, "key_env": p.key_env,
                        "quiet": p.shares_night_plan,
                        "models": [{"id": m.id, "label": m.label, "notes": m.notes, "input_price": m.input_price,
                                    "output_price": m.output_price} for m in p.models]})
        m = self.model
        cur = self._model_brief()
        return {"providers": out, "current": cur, "grader": self.cfg.grader, "effort": self.cfg.effort,
                "budget": {"daily_usd": self.cfg.daily_budget_usd, "spent_usd": m.spent_today() if m else 0.0},
                "trust": {k: trust.status(m, k) for k in trust.KINDS} if m and m.preset else {},
                "saved_to_file": bool(self.settings_path), "plugin": bool(self.plugin_token),
                "test": self.api_models_test_state(q)}

    def api_models_check(self, q):
        """Is the provider's CLI installed (and Codex signed in), or its key set? Spends nothing."""
        import dataclasses
        from .providers import cli, make_model, presets
        pid = self._q1(q, "provider")
        table = presets(self.cfg)
        if pid not in table:
            raise HttpError(404, "no such provider")
        p = table[pid]
        if p.tier == "local":
            # a model on this machine: ask the server for its models, which costs nothing and leaves nothing
            import urllib.request
            try:
                with urllib.request.urlopen(p.base_url.rstrip("/") + "/models", timeout=2) as r:
                    names = [m.get("id") for m in json.loads(r.read().decode("utf-8")).get("data", [])]
                return {"installed": True, "version": f"{len(names)} models", "signed_in": None, "ready": True,
                        "message": "ready", "models": names[:50]}
            except Exception:           # not running, or not this kind of server
                return {"installed": False, "version": None, "signed_in": None, "ready": False,
                        "message": "not_running"}
        if p.kind not in ("claude-cli", "codex-cli"):
            probe = make_model(dataclasses.replace(self.cfg, provider=pid, model=p.models[0].id))
            return {"installed": None, "version": None, "signed_in": None, "ready": not probe.missing,
                    "message": "ready" if not probe.missing else probe.missing}
        name = "claude" if p.kind == "claude-cli" else "codex"
        prefix = cli.resolve_cli(name, getattr(self.cfg, f"{name}_cli", ""))
        if not prefix:
            return {"installed": False, "version": None, "signed_in": None, "ready": False, "message": "no_cli"}
        try:
            rc, out, err = cli.run_proc([*prefix, "--version"], "", 60)
            version = (out or err).strip().splitlines()[0] if (out or err).strip() else None
            signed = None
            if name == "codex":
                rc, out, err = cli.run_proc([*prefix, "login", "status"], "", 60)
                text = (out + err).lower()
                signed = rc == 0 and "logged in" in text and "not logged in" not in text
        except (OSError, TimeoutError) as e:
            return {"installed": True, "version": None, "signed_in": None, "ready": False, "message": str(e)[:200]}
        return {"installed": True, "version": version, "signed_in": signed, "ready": signed is not False,
                "message": "ready" if signed is not False else "not_signed_in"}

    def api_models_save(self, d):
        """Choose the provider, model, effort, daily budget or self-grading; kept in knowledge-os.json."""
        import dataclasses
        from .config import save_settings
        from .providers import presets
        changes = {}
        if "provider" in d:
            pid = str(d["provider"] or "")
            if pid and pid not in presets(self.cfg):
                raise HttpError(400, "no such provider")
            changes["provider"] = pid
        if "model" in d:
            mid = str(d["model"] or "")
            if mid and not re.fullmatch(r"[A-Za-z0-9._:/@-]{1,120}", mid):
                raise HttpError(400, "not a model id")
            changes["model"] = mid
        if "effort" in d:
            if d["effort"] not in ("", "low", "medium", "high"):
                raise HttpError(400, "effort is low, medium or high")
            changes["effort"] = d["effort"]
        if "daily_budget_usd" in d:
            try:
                b = round(float(d["daily_budget_usd"]), 2)
            except (TypeError, ValueError):
                raise HttpError(400, "the budget is a number of dollars")
            if not 0 <= b <= 1000:
                raise HttpError(400, "the budget is between 0 and 1000 dollars a day")
            changes["daily_budget_usd"] = b
        if "grader" in d:
            if d["grader"] not in ("claude", "self"):
                raise HttpError(400, "grading is by a model or by yourself")
            changes["grader"] = d["grader"]
        if not changes:
            raise HttpError(400, "nothing to change")
        if self.settings_path:
            save_settings(self.settings_path, **changes)
        self.cfg = dataclasses.replace(self.cfg, **changes)
        self._rewire()
        return self.api_models({})

    def api_models_test(self, d):
        """Run the grader test or the Teach test on the chosen model, in the background; its trust is kept."""
        kind = d.get("kind")
        if kind not in ("grader", "teach"):
            raise HttpError(400, "the test is the grader's or Teach's")
        if self.trust_job.get("running"):
            raise HttpError(409, "a test is already running")
        if self.model is None or self.model.missing:
            raise HttpError(409, "choose a model that is set up first")
        ok, code = self.model.available()
        if not ok:
            raise HttpError(409, "the model cannot be asked now", why_code=code)
        job = {"running": True, "kind": kind, "model": self.model.label, "done": 0, "total": 0, "lines": [],
               "result": None, "started": self.clock().isoformat(timespec="seconds")}
        self.trust_job = job
        model = self.model

        def say(line):
            job["lines"] = (job["lines"] + [str(line)])[-40:]

        def progress(i, n, r):
            job["done"], job["total"] = i, n

        def run():
            try:
                if kind == "grader":
                    from . import gradertest
                    rc = gradertest.run(self.cfg, self.vault, model=model, say=say, on_progress=progress)
                else:
                    from . import teachtest
                    rc = teachtest.run(self.cfg, self.vault, model=model, say=say)
                job["result"] = "passed" if rc == 0 else "failed" if rc == 1 else "not_run"
            except Exception as e:          # the job reports, never takes the site down
                job["result"] = "error"
                say(f"the test stopped: {type(e).__name__}: {e}")
            finally:
                job["running"] = False
                self._rewire()

        threading.Thread(target=run, daemon=True, name="trust-test").start()
        return self.api_models_test_state({})

    def api_models_test_state(self, q):
        return dict(self.trust_job) if self.trust_job else {"running": False}

    # ------------------------------------------------------------- Explore (the vault's Knowledge OS Design §3-§4)
    def _field(self, q) -> dict:
        n = self.explore.get(self._q1(q, "name"))
        if n is None:
            raise HttpError(404, "no such field")
        return n

    # ------------------------------------------------------------- the page's language (CLAUDE.md §7)
    @staticmethod
    def _view_lang(q) -> str:
        """The language a note is shown in: the page's, or `show`, when the page asks for the other note."""
        return page_lang(q, "show") if q.get("show") else page_lang(q)

    @staticmethod
    def _view(v: dict) -> dict:
        return {"name": v["name"], "title": v["title"], "lang": v["lang"] or "en", "other": v["other"],
                "missing": v["missing"]}

    def _first_in(self, item: dict, lang: str) -> dict:
        """An item with its one-line summary in `lang` when its counterpart has one; a copy, never the cached item."""
        got = self.bilingual.first(item["name"], lang) if lang != "en" else None
        return {**item, "first": got[0], "first_lang": got[1]} if got else {**item, "first_lang": "en"}

    def api_labels(self, q):
        """The Arabic names of linked notes; `ready: false` while Explore's first index is still being built (the page
        asks again), so no page waits for it."""
        lang = page_lang(q)
        labels = self.bilingual.labels(lang)
        return {"lang": lang, "ready": labels is not None, "labels": labels or {}}

    def api_explore(self, q):
        tree, lang = self.explore.tree(), page_lang(q)
        if lang == "en":
            return tree
        return {**tree, "branches": [self._first_in(b, lang) for b in tree["branches"]]}

    def api_field(self, q):
        rec, lang = self.explore.record(self._field(q)), page_lang(q)
        if lang == "en":
            return rec
        rec = self._first_in(rec, lang)
        for key in ("maps", "concepts"):
            rec[key] = [self._first_in(x, lang) for x in rec.get(key, [])]
        return rec

    def api_river(self, q):
        return self.explore.river(self._field(q)["name"])

    def api_frontier(self, q):
        return self.explore.frontier(self._field(q)["name"])

    def api_xnote(self, q):
        self.explore.index()                            # Explore's own page: its index, built or refreshed here
        view = self.bilingual.side(self._q1(q, "name"), self._view_lang(q))
        out = self.explore.note(view["base"])           # its place, dates and relations: the English note's
        if out is None:
            raise HttpError(404, "no such note")
        notes = self.explore.index()
        if self._known is None or self._known[0] is not notes:
            self._known = (notes, {k: n["name"] for k, n in notes.items()})
        text = out.pop("text")
        if view["name"].lower() != out["name"].lower():
            shown = self.explore.get(view["name"])
            text = shown["text"] if shown is not None else text
        out["html"] = render_note(text, self._known[1]).replace('href="#/concept/', 'href="#/note/')
        out["view"] = self._view(view)
        return out

    def api_xsearch(self, q):
        return {"hits": self.explore.search(self._q1(q, "q"))}

    def api_today(self, q):
        on = self.today()
        plan = self.vault.plan(on)
        plan.pop("daily", None)
        done = [{"concept": r.get("concept"), "kind": r.get("kind"), "passed": r.get("passed"), "at": r.get("at")}
                for r in self.vault.verdict_rows() if r.get("date") == on.isoformat()]
        return {"date": on.isoformat(), "plan": plan, "done": done, "streak": streak(self._activity(), on),
                "focus_minutes": self._focus_minutes(on), "grader": self.grader.name,
                # quiet hours rest the Claude plan only (D8); with another model the day goes on
                "quiet": (self.model.available()[1] == "quiet") if self.model is not None
                else in_quiet_hours(self.clock().time(), self.cfg.quiet_hours),
                "model": self._model_brief(),
                "timer": {"focus": self.cfg.focus_minutes, "break": self.cfg.break_minutes}}

    def _named_item(self, name: str) -> dict:
        """A check the learner asks for: a concept failed and since read (the /road skill asks the same at a session's
        start), or one ready now. Never a locked concept, a mastered one (its review comes when it is due) or one on no
        active road: the graph decides what is ready."""
        canon = self._canon(name)
        g, roads = self.vault.graph()
        RG, R = self.vault.RG, self.vault.R
        k = canon.lower()
        if k not in g.nodes:
            raise HttpError(400, f"{canon} is not on the road")
        if k not in R.scope_of(g, R.chosen_roads(roads)):
            raise HttpError(409, f"{canon} is on no active road")
        st, stat, lay = RG.standing(g), RG.statuses(g), RG.layers(g)
        if stat[k] not in ("ready", "to-read"):
            raise HttpError(409, f"{canon} is {stat[k]}: the road offers it when its time comes", road_status=stat[k])
        last = R.last_verdicts(g, self.vault.learn).get(k)
        again = R.recheck_on(last)
        if stat[k] == "to-read" and again and self.today() < again:
            # a failed check is checked again from the next day, in new words (Improvement Plan, decision 2)
            raise HttpError(409, f"{canon} is checked again from {again.isoformat()}, in new words",
                            road_status="to-read", recheck_on=again.isoformat())
        n = g.nodes[k]
        bank = self.vault.bank(n.name)
        bank_state = "missing" if bank is None else (
            "invalid" if self.vault.RB.validate_bank(bank, self.vault.note_text(n.name) or "") else "ok")
        # a concept placement missed twice was asked its main question there: its first check asks the variants
        missed = last is None and k in R.placement_missed(self.vault.learn)
        return {"kind": "check", "concept": n.name, "rel": n.rel, "layer": lay.get(k, 0),
                "unlocks": RG.unlocks(g, k, st), "test_count": n.test_count, "bank": bank_state,
                "sources": RG.sources_index(self.vault.root).get(k, []), "stuck": None, "asked": True,
                "recheck": stat[k] == "to-read" or missed, "ask": []}

    def api_next(self, q):
        road, concept = (q.get("road") or [None])[0], (q.get("concept") or [None])[0]
        nx = self._named_item(concept) if concept else self.vault.next_item(road, self.today())
        nx.pop("bank_problems", None)
        if nx.get("kind") in ("check", "review") and nx.get("bank") == "ok":
            qs = self._questions(nx)
            item = secrets.token_hex(8)
            with self.lock:
                cutoff = self.clock() - timedelta(hours=ITEM_HOURS)
                for k in [k for k, v in self.items.items() if v["created"] < cutoff]:
                    self.items.pop(k, None)
                self.items[item] = {"concept": nx["concept"], "kind": nx["kind"], "layer": nx.get("layer"),
                                    "questions": {x["qid"]: x for x in qs}, "created": self.clock()}
            nx["item"] = item
            nx["questions"] = [{"qid": x["qid"], "facet": x["facet"], "q": x["q"]} for x in qs]
        return nx

    def api_concept(self, q):
        asked = self._canon((q.get("name") or [""])[0])
        view = self.bilingual.side(asked, self._view_lang(q))
        canon = self.vault.known().get(view["base"].lower(), asked)     # the road's side: the English note
        text = self.vault.note_text(canon) or ""
        g, _roads = self.vault.graph()
        RG = self.vault.RG
        k = canon.lower()
        n = g.nodes.get(k)
        s = self.vault.L.fm_scalars(text)
        out = {"name": canon, "title": s.get("title") or canon, "domain": s.get("domain"),
               "maturity": s.get("status"), "in_graph": n is not None, "status": None, "layer": None,
               "requires": [], "unlocks": [], "due": None, "sources": [], "bank": None, "history": []}
        if n is not None:
            st, stat, lay = RG.standing(g), RG.statuses(g), RG.layers(g)
            out.update({
                "status": stat.get(k), "layer": lay.get(k), "axiom": n.axiom,
                "requires": [{"name": g.nodes[p].name, "status": stat.get(p)} for p in g.prereq_keys(k)],
                "unlocks": sorted(g.nodes[d].name for d in g.rdeps.get(k, [])),
                "due": n.next_review.isoformat() if (st.get(k) and n.next_review) else None,
                "sources": RG.sources_index(self.vault.root).get(k, []),
                "bank": "ok" if self.vault.bank(canon) else "missing",
                "history": [{"date": r.get("date"), "at": r.get("at"), "kind": r.get("kind"),
                             "passed": r.get("passed")} for r in self.vault.verdict_rows()
                            if str(r.get("concept", "")).lower() == k]})
        reads = [r["date"] for r in self.ledger.rows("sessions")
                 if r.get("type") == "read" and str(r.get("concept", "")).lower() == k]
        out["read_on_site"] = reads[-1] if reads else None
        shown = text if view["name"].lower() == canon.lower() else self.vault.note_text(view["name"])
        if shown is None:                       # a counterpart outside Atlas/Concepts: the English note, said so
            shown, view = text, dict(view, name=canon, title=out["title"], lang="en", other=None, missing="none")
        out["html"] = render_note(shown, self.vault.known(), self.vault.assets())
        out["view"] = self._view(view)
        return out

    def api_graph(self, q):
        g, roads = self.vault.graph()
        RG = self.vault.RG
        want = (q.get("road") or [""])[0].strip().lower()
        road = next((r for r in roads if r.name.lower() == want), None) or \
            next((r for r in roads if r.active), None) or (roads[0] if roads else None)
        listing = [{"name": r.name, "active": r.active, "priority": r.priority} for r in roads]
        if road is None:
            return {"road": None, "roads": listing, "nodes": [], "edges": []}
        keys = RG.road_scope(g, road)
        st, stat, lay = RG.standing(g), RG.statuses(g), RG.layers(g)
        due = set(RG.due(g, self.today(), st))
        goals = {str(x).lower() for x in road.goals}
        nodes = [{"name": g.nodes[k].name, "layer": lay.get(k, 0), "status": stat.get(k), "due": k in due,
                  "goal": k in goals} for k in sorted(keys, key=lambda k: (lay.get(k, 0), k))]
        edges = [[g.nodes[p].name, g.nodes[k].name] for k in keys for p in g.prereq_keys(k) if p in keys]
        return {"road": road.name, "roads": listing, "pending_goals": RG.pending_goals(g, road),
                "nodes": nodes, "edges": edges}

    def api_progress(self, q):
        on = self.today()
        state = self.vault.road_state(on)
        roads = {name: {k: v for k, v in r.items() if k != "layers"} for name, r in state["roads"].items()}
        per: dict[str, dict] = defaultdict(lambda: {"checks": 0, "checks_passed": 0, "reviews": 0,
                                                    "reviews_passed": 0})
        for r in self.vault.verdict_rows():
            d, kind = r.get("date"), r.get("kind")
            if not d or kind not in ("check", "review"):
                continue
            per[d][kind + "s"] += 1
            per[d][kind + "s_passed"] += bool(r.get("passed"))
        history = [{"date": d, **per[d]} for d in sorted(per)]
        focus: dict[str, int] = defaultdict(int)
        for r in self.ledger.rows("sessions"):
            if r.get("type") == "focus" and r.get("event") == "stop":
                focus[r["date"]] += int(r.get("minutes") or 0)
        since = (on - timedelta(days=29)).isoformat()
        cal = {str(c): {"n": 0, "correct": 0} for c in range(1, 5)}
        superseded = {r.get("supersedes") for r in self.ledger.rows("attempts") if r.get("supersedes")}
        for r in self.ledger.rows("attempts"):
            if r.get("type") == "attempt" and r.get("id") not in superseded and str(r.get("confidence")) in cal:
                c = cal[str(r["confidence"])]
                c["n"] += 1
                c["correct"] += bool(r.get("correct"))
        return {"date": on.isoformat(), "roads": roads, "history": history,
                "focus": [{"date": d, "minutes": m} for d, m in sorted(focus.items()) if d >= since],
                "calibration": cal, "streak": streak(self._activity(), on)}

    # ------------------------------------------------------------ placement (decision 3)
    def _new_item(self, entry: dict) -> str:
        item = secrets.token_hex(8)
        with self.lock:
            cutoff = self.clock() - timedelta(hours=ITEM_HOURS)
            for k in [k for k, v in self.items.items() if v["created"] < cutoff]:
                self.items.pop(k, None)
            self.items[item] = {**entry, "created": self.clock()}
        return item

    def api_place(self, q):
        """The next placement question toward a goal: one `use it` question, its key kept here; or `done`, with each
        missed concept's questions, the learner's answers and the keys, which placement holds back until the end."""
        goal = self._canon((q.get("goal") or [""])[0])
        try:
            nx = self.vault.place(goal, self.today())
        except SystemExit as e:
            raise HttpError(409, str(e))
        nx.pop("bank_problems", None)
        if nx.get("kind") == "done":
            nx["review"] = self._place_review(nx)
            return nx
        if nx.get("bank") != "ok":
            return nx
        work = next((x for x in (self.vault.bank(nx["concept"]) or {}).get("questions") or []
                     if x.get("facet") == "work"), None)
        v = int(nx.get("variant") or 0)
        src = work if v == 0 else (work.get("variants") or [])[v - 1]
        qd = {"qid": f"work-{v}", "facet": "work", "variant": v, "q": src["q"], "key": src["key"],
              "evidence": src["evidence"]}
        nx["item"] = self._new_item({"concept": nx["concept"], "kind": "place", "goal": nx["goal"], "variant": v,
                                     "layer": nx.get("layer"), "questions": {qd["qid"]: qd}})
        nx["questions"] = [{"qid": qd["qid"], "facet": "work", "q": qd["q"]}]
        return nx

    def _place_review(self, nx: dict) -> list[dict]:
        rows = [r for r in self.vault.placement_rows()
                if r.get("kind") == "place" and str(r.get("goal", "")).lower() == nx["goal"].lower()]
        out = []
        for m in nx.get("missed") or []:
            work = next((x for x in (self.vault.bank(m["concept"]) or {}).get("questions") or []
                         if x.get("facet") == "work"), None)
            items = []
            for r in rows:
                if r.get("concept") != m["concept"] or work is None:
                    continue
                v, vs = int(r.get("variant") or 0), work.get("variants") or []
                src = vs[v - 1] if 0 < v <= len(vs) else work
                items.append({"q": src["q"], "key": src["key"], "evidence": src["evidence"],
                              "answer": r.get("answer", ""), "dont_know": bool(r.get("dont_know"))})
            out.append({"concept": m["concept"], "items": items})
        return out

    def api_place_answer(self, d):
        it = self._item(d.get("item"))
        if it.get("kind") != "place":
            raise HttpError(400, "this item is not a placement question")
        qd = it["questions"].get(str(d.get("qid") or ""))
        if not qd:
            raise HttpError(400, "no such question in this item")
        dont_know = d.get("dont_know") is True
        answer = "" if dont_know else str(d.get("answer") or "").strip()
        if not dont_know and (not answer or len(answer) > MAX_ANSWER):
            raise HttpError(400, f"an answer is 1 to {MAX_ANSWER} characters")
        seconds = d.get("seconds") if isinstance(d.get("seconds"), (int, float)) else None
        row = {"type": "place", "item": d["item"], "goal": it["goal"], "concept": it["concept"], "qid": qd["qid"],
               "facet": "work", "variant": qd["variant"], "question": qd["q"], "answer": answer, "seconds": seconds}
        if dont_know:           # nothing to grade: it settles at once (the owner, 24 Oct 2026)
            row.update({"correct": False, "credited": "", "missing": "(I don't know)", "gap": "none",
                        "grader": "self", "dont_know": True})
            return self._place_record(row)
        g = self.grader.grade(qd, answer)
        if g.get("needs_self"):
            handle = secrets.token_hex(8)
            with self.lock:
                self.pending_self[handle] = row
            return {"attempt": handle, "needs_self": True, "why": g.get("why", ""), "why_code": g.get("why_code", ""),
                    "key": qd["key"], "evidence": qd["evidence"]}
        row.update({k: g.get(k) for k in ("correct", "credited", "missing", "gap", "grader")})
        return self._place_record(row)

    def api_place_self(self, d):
        with self.lock:
            row = self.pending_self.get(str(d.get("attempt") or ""))
            if row is not None and row.get("type") == "place":
                self.pending_self.pop(str(d.get("attempt")), None)
            else:
                row = None
        if row is None:
            raise HttpError(410, "this answer has expired: answer it again")
        if not isinstance(d.get("correct"), bool):
            raise HttpError(400, "say whether your answer said what the key says")
        row.update({"correct": d["correct"], "credited": "", "missing": "" if d["correct"] else "(self-graded)",
                    "gap": "none", "grader": "self"})
        return self._place_record(row)

    def _place_record(self, row: dict) -> dict:
        """The road records the answer and what it settles; the site keeps the answer in its attempts ledger. The
        reply says only that it was recorded, and whether the concept comes back in other words: no key, no grade."""
        try:
            v = self.vault.place_verdict(row["goal"], row["concept"], row["variant"], bool(row["correct"]),
                                         self.today(), answer=row["answer"] or None,
                                         dont_know=bool(row.get("dont_know")))
        except SystemExit as e:
            raise HttpError(409, str(e))
        self.ledger.append("attempts", {**row, "place": v["id"], "settles": v["settles"]}, self.clock())
        with self.lock:
            self.items.pop(row["item"], None)
        return {"recorded": True, "concept": row["concept"], "again": v["again"]}

    def api_place_skip(self, d):
        """Step past the concept placement asks when its bank cannot be written yet: it settles nothing, and
        placement asks it again once it has a bank (the night's write-up takes such notes first)."""
        goal, concept = self._canon(d.get("goal")), self._canon(d.get("concept"))
        try:
            v = self.vault.place_skip(goal, concept, self.today(), why=str(d.get("why") or "")[:300])
        except SystemExit as e:
            raise HttpError(409, str(e))
        self.ledger.append("attempts", {"type": "place-skip", "goal": goal, "concept": concept, "place": v["id"]},
                           self.clock())
        return {"skipped": v["skipped"]}

    # ------------------------------------------------------------ the coach (coach.py; the vault's Study Coach Plan)
    def _coach(self, fn, *args):
        try:
            return fn(*args)
        except CoachError as e:
            raise HttpError(e.status, e.message)

    def api_coach(self, q):
        """The front door's facts: the profile, the open loops, what comes next toward the goal, how many sessions,
        and whether Claude can teach now."""
        p = self.coach.profile()
        ok, code = self.coach.llm.available() if self.coach.llm else (False, "no_cli")
        ends = [r for r in self.ledger.rows("coach") if r.get("type") == "session" and r.get("event") == "end"]
        return {"profile": p, "loops": self.coach.open_loops(), "elsewhere": self.coach.studied_elsewhere(),
                "next": self.coach.next_toward(p["goal"]) if p["goal"] else None, "sessions": len(ends),
                "last": ends[-1] if ends else None, "available": ok, "why_code": code}

    def api_coach_profile(self, d):
        return self._coach(self.coach.set_profile, d if isinstance(d, dict) else {})

    def api_coach_start(self, d):
        return self._coach(self.coach.start, str(d.get("mode") or ""), str(d.get("topic") or ""),
                           str(d.get("lang") or "en"))

    def api_coach_step(self, d):
        return self._coach(self.coach.step, str(d.get("session") or ""), d.get("reflect") is True)

    def api_coach_answer(self, d):
        return self._coach(self.coach.answer, str(d.get("session") or ""), str(d.get("lesson") or ""),
                           d.get("chunk"), str(d.get("choice") or ""))

    def api_coach_loop(self, d):
        return self._coach(self.coach.loop, str(d.get("session") or ""), str(d.get("loop") or ""),
                           d.get("clear") is True)

    def api_coach_reflect(self, d):
        return self._coach(self.coach.reflect, str(d.get("session") or ""), d.get("sentence"), d.get("teachback"),
                           d.get("fuzzy"), str(d.get("concept") or ""))

    def api_coach_explain(self, d):
        return self._coach(self.coach.explain, str(d.get("session") or ""), str(d.get("lesson") or ""), d.get("chunk"),
                           str(d.get("ask") or ""))

    def api_coach_end(self, d):
        return self._coach(self.coach.end, str(d.get("session") or ""))

    def api_coach_more(self, d):
        return self._coach(self.coach.more, str(d.get("session") or ""))

    def api_coach_skip(self, d):
        return self._coach(self.coach.skip, str(d.get("session") or ""), str(d.get("concept") or ""))

    def api_coach_card(self, q):
        return {"text": self._coach(self.coach.card, page_lang(q))}

    def api_coach_import(self, d):
        return self._coach(self.coach.import_card, str(d.get("text") or ""))

    # ------------------------------------------------------------ the course tutor (tutor.py)
    def _tutor(self, fn, *args):
        try:
            return fn(*args)
        except TutorError as e:
            raise HttpError(e.status, e.message)

    @staticmethod
    def _q1(q: dict, key: str) -> str:
        return (q.get(key) or [""])[0]

    def api_courses(self, q):
        return {"catalog": self._tutor(self.tutor.catalog), "courses": self._tutor(self.tutor.courses),
                "today": self.today().isoformat()}

    def api_course(self, q):
        return self._tutor(self.tutor.view, self._q1(q, "id"))

    def api_course_draft(self, q):
        return self._tutor(self.tutor.draft, self._q1(q, "card"))

    def api_tutor_session(self, q):
        out, lang = self._tutor(self.tutor.session, self._q1(q, "id"), self._q1(q, "n")), page_lang(q)
        for c in out["before"]["concepts"] if lang != "en" else []:
            view = self.bilingual.side(c["name"], lang)        # the preview from the note in the page's language
            c.update(label=view["name"], missing=view["missing"], abstract_lang="en")
            if view["missing"] is None and view["name"].lower() != c["name"].lower():
                got = self.vault.concept_meta(view["name"])["abstract"]
                if got:
                    c.update(abstract=got, abstract_lang=lang)
        return out

    def api_tutor_exam(self, q):
        return self._tutor(self.tutor.exam, self._q1(q, "id"), self._q1(q, "exam"))

    def api_course_save(self, d):
        return self._tutor(self.tutor.save, d.get("course") if isinstance(d.get("course"), dict) else d)

    def api_course_match(self, d):
        return {"topics": self._tutor(self.tutor.match, str(d.get("topics") or "")[:20000])}

    def api_course_archive(self, d):
        return self._tutor(self.tutor.archive, str(d.get("id") or ""))

    def api_tutor_mark(self, d):
        return self._tutor(self.tutor.mark, str(d.get("id") or ""), d.get("n"), str(d.get("what") or ""))

    def api_tutor_recall(self, d):
        return self._tutor(self.tutor.recall, str(d.get("id") or ""), d.get("n"), d.get("text"))

    def api_tutor_recall_self(self, d):
        return self._tutor(self.tutor.recall_self, str(d.get("id") or ""), d.get("n"), d.get("recalled"))

    def api_tutor_ask(self, d):
        return self._tutor(self.tutor.ask, str(d.get("id") or ""), d.get("n"), d.get("question"))

    def api_tutor_practice(self, d):
        return self._tutor(self.tutor.practice, str(d.get("id") or ""), str(d.get("exam") or ""))

    def api_tutor_practice_answer(self, d):
        return self._tutor(self.tutor.practice_answer, d.get("item"), d.get("qid"), d.get("answer"))

    def api_tutor_practice_self(self, d):
        return self._tutor(self.tutor.practice_self, d.get("handle"), d.get("correct"))

    # ------------------------------------------------------------ Teach (teach.py; design §6)
    def _teach(self, fn, *args):
        try:
            return fn(*args)
        except TeachError as e:
            raise HttpError(e.status, e.message)

    def api_teach(self, q):
        ok, code = self.teach.available()
        out = {"levels": list(LEVELS), "habits": list(HABITS), "available": ok, "why_code": code,
               "measures": self.teach.measures()}
        name = self._q1(q, "name")
        if name:
            sub = self._teach(self.teach.subject, name)
            view = self.bilingual.side(sub["name"], page_lang(q))
            abstract, alang = sub["abstract"], view["lang"] or "en"
            if view["name"].lower() != sub["name"].lower():       # the summary from the note in the page's language
                other = self._teach(self.teach.subject, view["name"])
                abstract, alang = (other["abstract"], view["lang"]) if other["abstract"] else (abstract, "en")
            out["subject"] = {"name": sub["name"], "rel": sub["rel"], "abstract": abstract, "abstract_lang": alang,
                              "label": view["name"], "missing": view["missing"]}
        return out

    def api_teach_past(self, q):
        return self._teach(self.teach.past, self._q1(q, "id"))

    def api_teach_start(self, d):
        return self._teach(self.teach.start, str(d.get("name") or ""), str(d.get("level") or ""),
                           str(d.get("lang") or "en"))

    def api_teach_say(self, d):
        return self._teach(self.teach.say, str(d.get("session") or ""), d.get("text"))

    def api_teach_end(self, d):
        return self._teach(self.teach.end, str(d.get("session") or ""))

    # ---------------------------------------------------------- answering
    def _item(self, item_id) -> dict:
        it = self.items.get(str(item_id or ""))
        if not it:
            raise HttpError(410, "this question has expired: open the next item again")
        return it

    def api_attempt(self, d):
        it = self._item(d.get("item"))
        qd = it["questions"].get(str(d.get("qid") or ""))
        if not qd:
            raise HttpError(400, "no such question in this item")
        seconds = d.get("seconds") if isinstance(d.get("seconds"), (int, float)) else None
        reveal = {"key": qd["key"], "evidence": qd["evidence"], "facet": qd["facet"]}
        if d.get("dont_know") is True:
            # "I don't know": a miss with nothing to grade and no confidence to calibrate (the owner, 24 Oct 2026)
            row = {"type": "attempt", "item": d["item"], "concept": it["concept"], "kind": it["kind"],
                   "qid": qd["qid"], "facet": qd["facet"], "variant": qd["variant"], "question": qd["q"],
                   "answer": "", "confidence": None, "seconds": seconds, "dont_know": True, "correct": False,
                   "credited": "", "missing": "(I don't know)", "gap": "none", "grader": "self"}
            saved = self.ledger.append("attempts", row, self.clock())
            return {"attempt": saved["id"], "correct": False, "credited": "", "missing": "", "gap": "none",
                    "grader": "self", "dont_know": True, "disagreed": False, **reveal}
        answer = str(d.get("answer") or "").strip()
        if not answer or len(answer) > MAX_ANSWER:
            raise HttpError(400, f"an answer is 1 to {MAX_ANSWER} characters")
        try:
            conf = int(d.get("confidence"))
        except (TypeError, ValueError):
            conf = 0
        if conf not in (1, 2, 3, 4):
            raise HttpError(400, "confidence is 1 to 4, asked before the key")
        row = {"type": "attempt", "item": d["item"], "concept": it["concept"], "kind": it["kind"],
               "qid": qd["qid"], "facet": qd["facet"], "variant": qd["variant"], "question": qd["q"],
               "answer": answer, "confidence": conf, "seconds": seconds}
        g = self.grader.grade(qd, answer)
        if g.get("needs_self"):
            handle = secrets.token_hex(8)
            with self.lock:
                self.pending_self[handle] = row
            return {"attempt": handle, "needs_self": True, "why": g.get("why", ""), "why_code": g.get("why_code", ""),
                    **reveal}
        row.update({k: g.get(k) for k in ("correct", "credited", "missing", "gap", "grader")})
        if g.get("disagreed"):
            row["disagreed"] = True
        saved = self.ledger.append("attempts", row, self.clock())
        return {"attempt": saved["id"], "correct": row["correct"], "credited": row["credited"],
                "missing": row["missing"], "gap": row["gap"], "grader": row["grader"],
                "disagreed": bool(g.get("disagreed")), **reveal}

    def api_attempt_self(self, d):
        with self.lock:
            row = self.pending_self.pop(str(d.get("attempt") or ""), None)
        if row is None:
            raise HttpError(410, "this answer has expired: answer it again")
        if not isinstance(d.get("correct"), bool):
            raise HttpError(400, "say whether your answer said what the key says")
        row.update({"correct": d["correct"], "credited": "", "missing": "" if d["correct"] else "(self-graded)",
                    "gap": "none", "grader": "self"})
        saved = self.ledger.append("attempts", row, self.clock())
        return {"attempt": saved["id"], "correct": row["correct"], "grader": "self"}

    def _item_rows(self, item_id: str) -> tuple[list[dict], bool]:
        rows = self.ledger.rows("attempts")
        recorded = any(r.get("type") == "verdict" and r.get("item") == item_id for r in rows)
        latest: dict[str, dict] = {}
        for r in rows:
            if r.get("type") == "attempt" and r.get("item") == item_id:
                latest[r["qid"]] = r             # a later row (a regrade) replaces an earlier one
        return list(latest.values()), recorded

    def api_dispute(self, d):
        aid = str(d.get("attempt") or "")
        reason = str(d.get("reason") or "").strip()[:1000]
        row = next((r for r in self.ledger.rows("attempts") if r.get("id") == aid and r.get("type") == "attempt"),
                   None)
        if row is None:
            raise HttpError(404, "no such answer")
        _rows, recorded = self._item_rows(row["item"])
        if recorded:
            raise HttpError(409, "the verdict is already recorded")
        if row.get("grader") in (None, "", "self", "fake"):
            raise HttpError(400, "only a model's grades are disputed; a self-grade is yours to give")
        it = self._item(row["item"])
        qd = it["questions"][row["qid"]]
        g = self.grader.grade(qd, row["answer"], objection=reason or "I believe the answer says what the key says.")
        if g.get("needs_self"):
            raise HttpError(503, g.get("why", "Claude could not grade"))
        new = {k: row[k] for k in ("item", "concept", "kind", "qid", "facet", "variant", "question", "answer",
                                   "confidence", "seconds") if k in row}
        new.update({"type": "attempt", "supersedes": aid, "dispute": reason,
                    **{k: g.get(k) for k in ("correct", "credited", "missing", "gap", "grader")}})
        saved = self.ledger.append("attempts", new, self.clock())
        return {"attempt": saved["id"], "correct": new["correct"], "credited": new["credited"],
                "missing": new["missing"], "gap": new["gap"], "grader": new["grader"]}

    def api_verdict(self, d):
        item_id = str(d.get("item") or "")
        rows, recorded = self._item_rows(item_id)
        if recorded:
            raise HttpError(409, "this item's verdict is already recorded")
        if not rows:
            raise HttpError(400, "no answers for this item")
        concept, kind = rows[0]["concept"], rows[0]["kind"]
        answers = [{"facet": r["facet"], "correct": bool(r.get("correct")), "note": r.get("missing") or "",
                    "confidence": r.get("confidence"), "grader": r.get("grader"), "attempt": r["id"]}
                   for r in rows]
        try:
            v = self.vault.verdict(concept, kind, answers, self.today())
        except SystemExit as e:
            raise HttpError(409, str(e))
        self.ledger.append("attempts", {"type": "verdict", "item": item_id, "concept": concept, "kind": kind,
                                        "passed": v["passed"], "verdict": v["id"]}, self.clock())
        with self.lock:
            self.items.pop(item_id, None)
        return {"passed": v["passed"], "unlocked": v["unlocked"], "id": v["id"], "concept": concept, "kind": kind,
                "missed": v.get("missed", []), "status": v.get("status")}

    # ------------------------------------------------------ the learner's own
    def api_words(self, d):
        """In my words (decision 6): one sentence after a passed check, as the learner wrote it. The road keeps it in
        its ledger, and `_learning_apply.py --road` writes it into the note; the site writes no note."""
        canon = self._canon(d.get("concept"))
        text = " ".join(str(d.get("text") or "").split())
        if not text or len(text) > 400:
            raise HttpError(400, "In my words is one sentence, 1 to 400 characters")
        try:
            w = self.vault.words(canon, text, self.today())
        except SystemExit as e:
            raise HttpError(409, str(e))
        return {"ok": True, "concept": canon, "id": w["id"]}

    def api_focus(self, d):
        event = d.get("event")
        if event not in ("start", "stop"):
            raise HttpError(400, "event is start or stop")
        try:
            minutes = max(0, min(240, int(d.get("minutes") or 0)))
        except (TypeError, ValueError):
            minutes = 0
        energy = d.get("energy") if d.get("energy") in ("low", "medium", "high") else ""
        row = {"type": "focus", "event": event, "minutes": minutes if event == "stop" else 0, "energy": energy,
               "item": str(d.get("item") or "")[:80], "loops": str(d.get("loops") or "").strip()[:1000]}
        self.ledger.append("sessions", row, self.clock())
        return {"ok": True, "focus_minutes": self._focus_minutes(self.today())}

    def api_read(self, d):
        canon = self._canon(d.get("concept"))
        self.ledger.append("sessions", {"type": "read", "concept": canon}, self.clock())
        return {"ok": True, "concept": canon}

    def api_bank(self, d):
        canon = self._canon(d.get("concept"))
        g, _ = self.vault.graph()
        if canon.lower() not in g.nodes:
            raise HttpError(400, "only a concept on the road has a check bank")
        if self.vault.bank(canon) is not None:
            raise HttpError(409, "this concept already has a bank")
        if self.job_running():
            raise HttpError(423, "a vault job is running: a bank is written when it has finished")
        if self.bank_writer is None:
            raise HttpError(501, "no bank writer is set up")
        try:
            problems = write_bank(self.vault, self.bank_writer, self.ledger, canon, self.clock())
        except Exception as e:
            raise HttpError(502, f"the bank could not be written: {e}")
        if problems:
            raise HttpError(422, "the note cannot carry a bank yet", problems=problems)
        return {"ok": True, "concept": canon, "questions": 3}


    # ---------------------------------------------------------------- the lab
    def _lab_timeout(self) -> int:
        try:
            return max(1, min(60, int(self.cfg.lab_timeout_s)))
        except (TypeError, ValueError):
            return 10

    def _lab_modules(self) -> dict:
        if self._modules is None:
            self._modules = {m: importlib.util.find_spec(m) is not None for m in ("numpy", "matplotlib", "scipy")}
        return self._modules

    def api_lab(self, q):
        """What the Lab can do here, and each exercise's best run so far (the site's own ledger, never a verdict)."""
        best: dict[str, dict] = {}
        for r in self.ledger.rows("lab"):
            ex = r.get("exercise")
            if not isinstance(ex, str):
                continue
            b = best.setdefault(ex, {"best": 0, "total": int(r.get("total") or 0), "runs": 0, "last": None})
            b["runs"] += 1
            b["last"] = r.get("date")
            if int(r.get("passed") or 0) >= b["best"]:
                b["best"], b["total"] = int(r.get("passed") or 0), int(r.get("total") or 0)
        return {"python": bool(self.cfg.lab_python), "timeout_s": self._lab_timeout(), "modules": self._lab_modules(),
                "results": best}

    def api_lab_python(self, d):
        if not self.cfg.lab_python:
            raise HttpError(403, "Python is turned off in knowledge-os.json (lab_python)")
        code = d.get("code")
        if not isinstance(code, str) or not code.strip():
            raise HttpError(400, "there is no code to run")
        if not self.lab_lock.acquire(blocking=False):
            raise HttpError(429, "the last run has not finished")
        try:
            return run_python(code, self._lab_timeout())
        finally:
            self.lab_lock.release()

    def api_lab_attempt(self, d):
        ex = str(d.get("exercise") or "")
        if not EXERCISE_ID.match(ex):
            raise HttpError(400, "no such exercise")
        try:
            passed, total = int(d.get("passed")), int(d.get("total"))
        except (TypeError, ValueError):
            raise HttpError(400, "passed and total are numbers")
        if not (1 <= total <= 100 and 0 <= passed <= total):
            raise HttpError(400, "passed is between 0 and total")
        lang = d.get("lang") if d.get("lang") in ("js", "python") else "js"
        row = self.ledger.append("lab", {"exercise": ex, "passed": passed, "total": total, "lang": lang}, self.clock())
        return {"ok": True, "id": row["id"]}


def _text(v) -> str:
    if v is None:
        return ""
    return v.decode("utf-8", "replace") if isinstance(v, bytes) else str(v)


def run_python(code: str, timeout_s: float) -> dict:
    """The Lab's Python: a fresh interpreter in an empty temporary folder, the code on stdin, stopped at the time
    limit; its output cut to a size a page can show, and the figures it drew split off."""
    runner = Path(__file__).with_name("labrun.py")
    env = {**os.environ, "MPLBACKEND": "Agg", "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    t0 = time.monotonic()
    timed_out = False
    with tempfile.TemporaryDirectory(prefix="los-lab-") as cwd:
        try:
            p = subprocess.run([sys.executable, "-X", "utf8", str(runner)], input=code, capture_output=True,
                               text=True, encoding="utf-8", errors="replace", timeout=timeout_s, cwd=cwd, env=env,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            out, err, status = p.stdout, p.stderr, p.returncode
        except subprocess.TimeoutExpired as e:
            timed_out, out, err, status = True, _text(e.stdout), _text(e.stderr), None
    figures: list[str] = []
    if MARK in out:
        head, _, tail = out.rpartition(MARK)
        out = head[:-1] if head.endswith("\n") else head
        try:
            got = json.loads(tail)
            figures = [f for f in got if isinstance(f, str) and len(f) <= MAX_FIGURE][:MAX_FIGURES]
        except ValueError:
            pass
    truncated = len(out) > LAB_OUT or len(err) > LAB_ERR
    return {"stdout": out[:LAB_OUT], "stderr": err[:LAB_ERR], "exit": status, "timed_out": timed_out,
            "truncated": truncated, "figures": figures, "ms": int((time.monotonic() - t0) * 1000)}
