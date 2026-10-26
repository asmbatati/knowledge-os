"""The Teach reviewer's test set (the vault's Knowledge OS Design 2026-10, §8): sessions whose findings are known,
reviewed by the reviewer in use.

    python server.py --teach-test           # review tests/teach-cases.json with Claude; exit 1 on any miss

Every case names a note in the vault, which the reviewer reads as it would in a session, and carries a copy of the
note's text (taken from the owner's vault on 26 Oct 2026), so the same test runs on any install. The reviewer is trusted only
while it finds what every case plants: each habit named, none it must not name, whether the student's understanding
was checked, and whether an error was made. A case it cannot review (Claude unreachable, quiet hours) is a miss, never
a pass. The ledger and the gaps it would write go to a temporary folder, never to the vault. The results are kept in
tests/teach-results-<date>.json.
"""
from __future__ import annotations

import json
import tempfile
import time
from datetime import date, datetime
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent


def judge(case: dict, review: dict | None) -> list[str]:
    """What the review missed of what the case plants; [] when it found it all."""
    if not review:
        return ["no review"]
    miss = []
    got = set(review.get("habits") or [])
    miss += [f"did not name {h}" for h in case.get("habits", []) if h not in got]
    miss += [f"named {h}" for h in case.get("not_habits", []) if h in got]
    if case.get("checked") is not None and review.get("checked") is not case["checked"]:
        miss.append(f"checked should be {case['checked']}")
    if case.get("errors") is True and not review.get("errors"):
        miss.append("found no error")
    if case.get("errors") is False and review.get("errors"):
        miss.append("found an error where there is none")
    return miss


def evaluate(cases: list[dict], teach, progress=None) -> dict:
    rows, passed = [], 0
    for i, c in enumerate(cases):
        t0 = time.time()
        try:
            # a case that carries its note needs no vault: the same test runs on any install
            sub = {"name": c["subject"], "rel": f"(test) {c['subject']}.md"} if c.get("note") else teach.subject(c["subject"])
            sid = f"test-{c['id']}"
            with teach.lock:
                teach.sessions[sid] = {"id": sid, "subject": sub["name"], "rel": sub["rel"], "level": c["level"],
                                       "lang": "en", "started": teach.clock(), "turns": [
                                           {"who": who, "text": text} for who, text in c["turns"]],
                                       "confused": [], "cost": 0.0, "busy": False,
                                       **({"note_text": c["note"]} if c.get("note") else {})}
            out = teach.end(sid)
            review = out.get("review")
            note = out.get("why_code") if review is None else ""
        except Exception as e:
            review, note = None, str(e)
        miss = judge(c, review)
        passed += not miss
        rows.append({"id": c["id"], "subject": c["subject"], "ok": not miss, "miss": miss, "note": note,
                     "review": review, "seconds": round(time.time() - t0, 1)})
        if progress:
            progress(i + 1, len(cases), rows[-1])
    return {"ok": passed == len(cases), "passed": passed, "total": len(cases), "rows": rows}


def run(cfg, vault, model=None, say=print) -> int:
    """Review the Teach test set with the chosen model (or `model`), keep the results and the trust they earn."""
    from . import trust
    from .explore import Explore
    from .gradertest import results_name
    from .ledger import Ledger
    from .providers import make_model
    from .teach import Teach
    from .tutorllm import ModelTutor
    cases = json.loads((SITE / "tests" / "teach-cases.json").read_text(encoding="utf-8"))["cases"]
    model = model or make_model(cfg, ledger=Ledger(vault.learn))
    ok, code = model.available()
    if not ok:
        say(f"{model.label}: the Teach test cannot run now ({code})")
        return 2
    llm = ModelTutor(model, timeout=max(int(cfg.timeout_s), 180))
    with tempfile.TemporaryDirectory(prefix="los-teach-test-") as td:
        teach = Teach(vault, Explore(vault), Path(td), llm=llm, clock=datetime.now)

        def progress(i, n, r):
            say(f"  {'ok  ' if r['ok'] else 'MISS'} {i}/{n}  {r['id']:26} {'; '.join(r['miss'])[:90]}")

        rep = evaluate(cases, teach, progress)
    rep.update({"date": date.today().isoformat(), "provider": model.preset.id, "model": model.info.id})
    out = SITE / "tests" / results_name(model, rep["date"], "teach")
    out.write_text(json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8")
    trust.record(model, "teach", rep)
    say(f"{model.label}: {rep['passed']} of {rep['total']} found · {out.name} · "
        f"{'trusted' if rep['ok'] else 'not trusted'}")
    return 0 if rep["ok"] else 1
