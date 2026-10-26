"""Exit when the process that started the site is gone.

The Obsidian plugin starts the site as a child process and passes its own process id in LOS_PARENT_PID. If Obsidian
quits or crashes without stopping it (a window reload never runs a plugin's unload), the site would keep running in
the background, holding its port. This thread notices the parent is gone and ends the process. A site started at
logon or from HOME's servers panel has no LOS_PARENT_PID and is never watched.

A window reload keeps the renderer's process, so the parent stays alive, but the pipes it read the site's output from
are closed, and every request's log line would then fail. So the streams are guarded too (guard_streams): a site the
plugin started takes a broken pipe as the plugin gone and stops; any other site keeps going, writing to its log file.
"""
from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = kernel32.OpenProcess(0x1000, False, pid)        # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259  # STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def watch_parent(pid: int, interval_s: float = 5.0, on_gone=None, say=print) -> threading.Thread:
    """A daemon thread that calls `on_gone` (default: end the process) once `pid` has died."""
    def gone() -> None:
        say(f"the process that started the site ({pid}) is gone; stopping", flush=True)
        os._exit(0)

    def run() -> None:
        while pid_alive(pid):
            time.sleep(interval_s)
        (on_gone or gone)()

    t = threading.Thread(target=run, name="parent-watchdog", daemon=True)
    t.start()
    say(f"watching the process that started the site ({pid}); stopping when it is gone", flush=True)
    return t


def from_env(environ=None, **kw) -> threading.Thread | None:
    value = (os.environ if environ is None else environ).get("LOS_PARENT_PID", "")
    return watch_parent(int(value), **kw) if value.isdigit() and int(value) > 0 else None


class Guarded:
    """A stream whose failed write calls `broken` once instead of raising: the reader of its pipe is gone. `broken`
    returns the stream to write to from then on, or ends the process."""

    def __init__(self, stream, broken):
        self._s = stream
        self._broken = broken

    def write(self, text):
        try:
            return self._s.write(text)
        except (OSError, ValueError):
            return self._fail(text)

    def flush(self):
        try:
            self._s.flush()
        except (OSError, ValueError):
            self._fail("")

    def _fail(self, text):
        self._s = self._broken()
        try:
            self._s.write(text)
        except (OSError, ValueError):
            pass
        return len(text)

    def __getattr__(self, name):
        return getattr(self._s, name)


def guard_streams(log: Path, environ=None, exit=os._exit) -> bool:
    """Guard sys.stdout and sys.stderr (see the module's note). Returns whether a broken pipe ends the process."""
    plugin = (os.environ if environ is None else environ).get("LOS_PARENT_PID", "").isdigit()
    spare = []

    def broken():
        if plugin:
            exit(0)         # the plugin that started the site, and read what it printed, is gone
            return open(os.devnull, "w", encoding="utf-8")
        if not spare:
            Path(log).parent.mkdir(parents=True, exist_ok=True)
            spare.append(open(log, "a", encoding="utf-8", buffering=1))
        return spare[0]

    for name in ("stdout", "stderr"):
        s = getattr(sys, name)
        if s is not None and not isinstance(s, Guarded):
            setattr(sys, name, Guarded(s, broken))
    return plugin
