"""Starting the site: the vault's road, the grader, the bank writer, a warm-up, and the server."""
from __future__ import annotations

import os
import sys
import tempfile
import threading
import time
from pathlib import Path

from . import VERSION, demo
from .app import App
from . import watchdog
from .wiring import wire
from .jobs import vault_job_running
from .vault import Vault
from .web import make_server

SITE = Path(__file__).resolve().parent.parent
LOG = SITE / ".local" / "server.log"         # git-ignored
LOG_MAX = 5_000_000


def give_streams(log: Path = LOG) -> None:
    """Started at logon by pythonw (autostart.ps1), the server has no console: sys.stdout and sys.stderr are None, and
    http.server's request line (web.py, log_message) would fail every request. Give it a log file instead, the old one
    kept as .1 once it passes 5 MB."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    log = Path(log)
    log.parent.mkdir(parents=True, exist_ok=True)
    try:
        if log.exists() and log.stat().st_size > LOG_MAX:
            log.replace(log.with_suffix(log.suffix + ".1"))
    except OSError:
        pass
    f = open(log, "a", encoding="utf-8", buffering=1)
    if sys.stdout is None:
        sys.stdout = f
    if sys.stderr is None:
        sys.stderr = f


def wait_for_vault(code_root, wait_s: float, *, poll_s: float = 10, clock=time.monotonic, sleep=time.sleep,
                   say=print) -> bool:
    """Is the vault's road there? At logon a vault on Google Drive may not be mounted yet (22 Oct 2026: the site stopped
    and stayed down all day), so with `wait_s` the server polls every `poll_s` seconds until it appears or the wait runs
    out, saying when it starts waiting and how it ended."""
    road = Path(code_root) / "x" / "scripts" / "_road.py"
    if road.exists():
        return True
    if wait_s <= 0:
        return False
    span = f"{wait_s / 60:g} min" if wait_s >= 60 and wait_s % 60 == 0 else f"{wait_s:g} s"
    start = clock()
    say(f"waiting up to {span} for the vault at {code_root} (its drive may not be mounted yet)")
    while clock() - start < wait_s:
        sleep(min(poll_s, wait_s - (clock() - start)))
        if road.exists():
            say(f"the vault was found after {clock() - start:.0f} s")
            return True
    say(f"gave up after {span}: no learning road in {code_root}")
    return False


def build_app(cfg, vault, settings_path=None, environ=None) -> App:
    """The app with one model behind the grader, the bank writer, the tutor, the coach and Teach (los/wiring.py)."""
    w = wire(cfg, vault, environ)
    return App(cfg, vault=vault, grader=w.grader, bank_writer=w.bank_writer, job_running=vault_job_running,
               web_dir=SITE / "web", llm=w.tutor, teach_llm=w.teach_llm, model=w.model, settings_path=settings_path,
               plugin_token=(os.environ if environ is None else environ).get("LOS_PLUGIN_TOKEN", ""))


def serve(cfg, demo_mode: bool = False, wait_s: float = 0, settings_path=None) -> int:
    give_streams()
    code_root = Path(cfg.vault)
    if not wait_for_vault(code_root, wait_s, say=lambda s: print(s, flush=True)):
        print(f"no learning road in {code_root}: set `vault` in knowledge-os.json or pass --vault")
        return 2
    tmp = None
    data_root = code_root
    if demo_mode:
        tmp = tempfile.TemporaryDirectory(prefix="knowledge-os-demo-")
        data_root = Path(tmp.name)
        demo.make_demo(data_root)
    vault = Vault(code_root, data_root)
    app = build_app(cfg, vault, settings_path)
    watchdog.guard_streams(LOG)
    watchdog.from_env()
    srv = make_server(app, "127.0.0.1", cfg.port)
    threading.Thread(target=app.warm, daemon=True).start()
    print(f"Knowledge OS {VERSION} on http://127.0.0.1:{cfg.port}/ · vault {data_root}"
          f"{' (demo)' if demo_mode else ''} · model {app.model.label} · grader {app.grader.name}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
        if tmp:
            tmp.cleanup()
    return 0
