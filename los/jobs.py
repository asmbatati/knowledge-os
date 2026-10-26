"""Is a vault job running?

Every scheduled job takes the named mutex `Global\\ObsidianVaultJobs` (x/scripts/agent_jobs/VaultJobLock.ps1) and
holds it until its process exits. The object exists only while some job holds a handle to it, so opening it by name
answers the question without taking the lock: the site never makes a job wait.

Why it matters: an LLM job diffs `git status` before and after its run and moves any new file outside its expected
outputs into quarantine (Invoke-VaultLLM.ps1). Verdicts and ledgers live under x/reports/, which every job expects;
a bank under x/Checks/ does not, so the site writes no bank while a job runs.
"""
from __future__ import annotations

import sys

NAME = "Global\\ObsidianVaultJobs"
SUPPORTED = sys.platform == "win32"
_SYNCHRONIZE = 0x00100000
_ERROR_ACCESS_DENIED = 5

if SUPPORTED:
    import ctypes
    from ctypes import wintypes

    _k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _k32.OpenMutexW.restype = wintypes.HANDLE
    _k32.OpenMutexW.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR]
    _k32.CreateMutexW.restype = wintypes.HANDLE
    _k32.CreateMutexW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR]
    _k32.CloseHandle.argtypes = [wintypes.HANDLE]


def vault_job_running(name: str = NAME) -> bool:
    if not SUPPORTED:
        return False
    h = _k32.OpenMutexW(_SYNCHRONIZE, False, name)
    if h:
        _k32.CloseHandle(h)
        return True
    return ctypes.get_last_error() == _ERROR_ACCESS_DENIED     # it exists, owned by an account we cannot open


def _create_mutex(name: str):
    """For the selftest: hold a mutex of our own, as a job would."""
    return _k32.CreateMutexW(None, False, name) if SUPPORTED else None


def _close(h) -> None:
    if SUPPORTED and h:
        _k32.CloseHandle(h)
