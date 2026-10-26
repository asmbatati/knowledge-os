"""The grader's test set (design §6): answers whose verdict is known, graded by the grader in use.

    python server.py --grader-test          # grade tests/grader-cases.json with Claude; exit 1 on any disagreement

Every case names a bank question in the vault and carries a copy of its question, key and evidence (taken from the
owner's banks on 26 Oct 2026), so the same test runs on any install, an exported edition or a fresh vault. The grader
is trusted only when it agrees on every case; a case it cannot grade (Claude unreachable, quiet hours) counts as a
disagreement, never as a pass. The results are kept in tests/grader-results-<date>.json.
"""
from __future__ import annotations

import json
import time
from datetime import date
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent


def _question(vault, c: dict) -> dict | None:
    """The case's own question, key and evidence when it carries them (the set is then the same on every install, with
    or without the vault's banks), else the bank question it names in the vault."""
    if all(c.get(k) for k in ("q", "key", "evidence")):
        return {"facet": c["facet"], **{k: c[k] for k in ("q", "key", "evidence")}}
    bank = vault.bank(c["concept"]) or {}
    base = next((q for q in bank.get("questions") or [] if q.get("facet") == c["facet"]), None)
    if base is None:
        return None
    v = int(c.get("variant") or 0)
    src = base if v == 0 else (base.get("variants") or [None] * v)[v - 1] if v <= len(base.get("variants") or []) else None
    return {"facet": c["facet"], **{k: src[k] for k in ("q", "key", "evidence")}} if src else None


def evaluate(cases: list[dict], vault, grader, progress=None) -> dict:
    rows, agreed, errors = [], 0, 0
    for i, c in enumerate(cases):
        q = _question(vault, c)
        if q is None:
            errors += 1
            rows.append({**c, "q": None, "got": None, "agree": False, "note": "no such bank question"})
            continue
        t0 = time.time()
        g = grader.grade(q, c["answer"])
        got = None if g.get("needs_self") else bool(g.get("correct"))
        ok = got is not None and got == c["expect"]
        agreed += ok
        rows.append({**c, "q": q["q"], "got": got, "agree": ok, "seconds": round(time.time() - t0, 1),
                     "note": g.get("why") if got is None else (g.get("missing") or ""),
                     "borderline": g.get("borderline"), "disagreed": g.get("disagreed"), "cost_usd": g.get("cost_usd")})
        if progress:
            progress(i + 1, len(cases), rows[-1])
    return {"ok": agreed == len(cases) and errors == 0, "agreed": agreed, "total": len(cases), "errors": errors,
            "rows": rows}


def results_name(model, day: str, kind: str = "grader") -> str:
    """tests/<kind>-results-<date>-<provider>-<model>.json. The Claude plan's runs from before providers existed are
    tests/<kind>-results-<date>.json, which los/trust.py still reads."""
    import re
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", f"{model.preset.id}-{model.info.id}")
    return f"{kind}-results-{day}-{slug}.json"


def run(cfg, vault, model=None, say=print, on_progress=None) -> int:
    """Grade the test set with the chosen model (or `model`), keep the results and the trust they earn."""
    from . import trust
    from .grade import ModelGrader
    from .ledger import Ledger
    from .providers import make_model
    cases = json.loads((SITE / "tests" / "grader-cases.json").read_text(encoding="utf-8"))["cases"]
    model = model or make_model(cfg, ledger=Ledger(vault.learn))
    ok, code = model.available()
    if not ok:
        say(f"{model.label}: the grader test cannot run now ({code})")
        return 2
    grader = ModelGrader(model, timeout=cfg.timeout_s)

    def progress(i, n, r):
        mark = "ok  " if r["agree"] else "MISS"
        say(f"  {mark} {i:>2}/{n}  {r['facet']:6} {r['concept'][:18]:18} expect {str(r['expect']):5} "
            f"got {str(r['got']):5}  {str(r.get('note') or '')[:70]}")
        if on_progress:
            on_progress(i, n, r)

    rep = evaluate(cases, vault, grader, progress)
    rep.update({"date": date.today().isoformat(), "provider": model.preset.id, "model": model.info.id,
                "cost_usd": round(sum(r.get("cost_usd") or 0 for r in rep["rows"]), 4)})
    out = SITE / "tests" / results_name(model, rep["date"])
    out.write_text(json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8")
    trust.record(model, "grader", rep)
    say(f"{model.label}: {rep['agreed']} of {rep['total']} agreed · {rep['errors']} errors · ${rep['cost_usd']} · "
        f"{out.name} · {'trusted' if rep['ok'] else 'not trusted'}")
    return 0 if rep["ok"] else 1
