"""The trust gate (design §6; the vault's Knowledge OS Plugin Plan 2026-10, D7).

A model grades only after it has agreed on every case of tests/grader-cases.json, and plays Teach's student and
reviewer only after it has found every gap tests/teach-cases.json plants. A pass is kept per provider and model in
`.local/trust.json` (git-ignored), with a hash of the prompts it was earned on: change the grader's prompt, or Teach's,
and the pass no longer counts until the test is run again. Results written before this file existed (the Claude
plan's `tests/grader-results-*.json` and `teach-results-*.json`, model "sonnet") still count for that model.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
TRUST = SITE / ".local" / "trust.json"
KINDS = ("grader", "teach")


def model_key(model) -> str:
    return f"{model.preset.id}/{model.info.id}" if model.preset and model.info else ""


def prompt_hash(kind: str) -> str:
    if kind == "grader":
        from . import grade
        text = grade.SYSTEM + grade.PROMPT
    else:
        from . import teach
        text = "".join(str(getattr(teach, n, "")) for n in ("STUDENT_SYSTEM", "REVIEW_SYSTEM"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def load(path: Path = TRUST) -> dict:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def record(model, kind: str, rep: dict, path: Path = TRUST) -> dict:
    """Keep a test's outcome for `model`. Returns the entry written."""
    if kind not in KINDS:
        raise ValueError(kind)
    data = load(path)
    entry = {"passed": bool(rep.get("ok")), "agreed": rep.get("agreed", rep.get("passed")), "total": rep.get("total"),
             "date": rep.get("date") or date.today().isoformat(), "cost_usd": rep.get("cost_usd"),
             "prompt": prompt_hash(kind)}
    data.setdefault(model_key(model), {})[kind] = entry
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(p)
    return entry


def _legacy(model, kind: str, site: Path = SITE) -> dict | None:
    """The newest result file from before trust.json, for the Claude plan's model it was run on."""
    if not model.preset or model.preset.id != "claude-cli":
        return None
    pattern = "grader-results-????-??-??.json" if kind == "grader" else "teach-results-????-??-??.json"
    for f in sorted((site / "tests").glob(pattern), reverse=True):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if d.get("model") == model.info.id:
            return {"passed": bool(d.get("ok")), "agreed": d.get("agreed", d.get("passed")), "total": d.get("total"),
                    "date": d.get("date"), "legacy": f.name}
    return None


def status(model, kind: str, path: Path = TRUST, site: Path = SITE) -> dict:
    """What the Settings page shows: passed or not, when, and whether the pass still counts."""
    e = load(path).get(model_key(model), {}).get(kind)
    if e:
        current = e.get("prompt") == prompt_hash(kind)
        return {**e, "counts": bool(e.get("passed")) and current, "stale": bool(e.get("passed")) and not current}
    e = _legacy(model, kind, site)
    if e:
        return {**e, "counts": e["passed"], "stale": False}
    return {"passed": False, "counts": False, "stale": False, "never": True}


def trusted(model, kind: str = "grader", path: Path = TRUST, site: Path = SITE) -> bool:
    return bool(status(model, kind, path, site).get("counts"))
