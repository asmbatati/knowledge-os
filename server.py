#!/usr/bin/env python3
"""Knowledge OS — the local site for the vault's learning road.

    python server.py                         # serve the vault in knowledge-os.json on 127.0.0.1:4190, or, when
                                             # it names none, the vault this folder sits in (x/apps/knowledge-os)
    python server.py --vault "<a vault's folder>" --port 4190
    python server.py --demo --port 4191      # a temporary demo vault, nothing of yours touched
    python server.py --grader self           # grade by comparing with the key yourself
    python server.py --wait-for-vault 1800   # at logon: wait up to 30 min for the vault's drive (autostart.ps1)
    python server.py --selftest [group ...]  # render grade ledger bridge jobs api gradertest config lab js tutor
    python server.py --grader-test           # the grader against tests/grader-cases.json (calls the chosen model)
    python server.py --teach-test            # the Teach reviewer against tests/teach-cases.json (calls the model)
    python server.py --grader-test --provider openai --model gpt-6-luna   # any provider/model for one run

Design: x/SYSTEM/Learning OS Design 2026-09.md in the vault. The site imports the road's scripts from the vault,
writes verdicts only through `_road.cmd_verdict`, and its own ledgers under x/reports/learning/los/. It writes no
note and no frontmatter.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent
sys.path.insert(0, str(SITE))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Knowledge OS")
    default_cfg = SITE / "knowledge-os.json"
    if not default_cfg.exists() and (SITE / "learning-os.json").exists():
        default_cfg = SITE / "learning-os.json"          # a copy made before the site was renamed (8 Oct 2026)
    ap.add_argument("--config", default=str(default_cfg))
    ap.add_argument("--vault")
    ap.add_argument("--port", type=int)
    ap.add_argument("--grader", choices=("claude", "self"))
    ap.add_argument("--demo", action="store_true", help="serve a temporary demo vault")
    ap.add_argument("--wait-for-vault", type=float, default=0, metavar="SECONDS",
                    help="when the vault is not there yet (a drive not mounted at logon), wait for it this long")
    ap.add_argument("--provider", help="the model provider for this run (los/providers/registry.py)")
    ap.add_argument("--model", help="the provider's model id for this run")
    ap.add_argument("--selftest", nargs="*", metavar="GROUP")
    ap.add_argument("--grader-test", action="store_true", help="grade the test set with the chosen model")
    ap.add_argument("--teach-test", action="store_true", help="review the Teach test set with the chosen model")
    a = ap.parse_args(argv)

    from los.config import load_config
    cfg = load_config(a.config, site=SITE, vault=a.vault, port=a.port, grader=a.grader, provider=a.provider,
                      model=a.model)
    if a.selftest is not None:
        from los import selftest
        return selftest.run(a.selftest, Path(cfg.vault))

    if a.grader_test:
        from los import gradertest
        from los.vault import Vault
        return gradertest.run(cfg, Vault(cfg.vault))

    if a.teach_test:
        from los import teachtest
        from los.vault import Vault
        return teachtest.run(cfg, Vault(cfg.vault))

    from los.serve import serve
    # a demo touches nothing of the learner's: its model choice lasts until it stops, never written to the settings file
    return serve(cfg, demo_mode=a.demo, wait_s=a.wait_for_vault, settings_path=None if a.demo else Path(a.config))


if __name__ == "__main__":
    sys.exit(main())
