"""The site's own ledgers: x/reports/learning/los/<kind>-YYYY-MM.jsonl, append-only.

    attempts  every answer: the question, the answer, the confidence, the grade, the time taken; and a row per
              verdict recorded, so one item is never recorded twice
    sessions  focus sessions (start, stop, minutes, energy, open loops) and "I have read it" marks
    banks     banks written from the site: which concept, whether the validator took it, what it cost
    lab       the Lab's exercises: which one, how many of its tests passed; never a verdict
    tutor     the course tutor: a lecture marked prepared, attended or reviewed; a free recall and what it
              caught; a question asked; a practice exam's answers; never a verdict
    teach     the Teach tab: a session's subject, level, length and the reviewer's findings; never a verdict
    coach     the coach: a session's start and end, the chunks taught, practice answers, stuck steps, the
              reflection, the owner's teach-backs, open loops and cards brought home; never a verdict

Nothing here reads or writes a note. The verdicts themselves go through the road's writer (`_road.cmd_verdict`).
"""
from __future__ import annotations

import json
import os
import secrets
import threading
from datetime import date, datetime, timedelta
from pathlib import Path

KINDS = ("attempts", "sessions", "banks", "lab", "tutor", "teach", "coach", "usage")


class Ledger:
    def __init__(self, learn_dir: Path):
        self.dir = Path(learn_dir) / "los"
        self.lock = threading.Lock()

    def path(self, kind: str, when: datetime) -> Path:
        return self.dir / f"{kind}-{when:%Y-%m}.jsonl"

    def append(self, kind: str, row: dict, when: datetime | None = None) -> dict:
        if kind not in KINDS:
            raise ValueError(kind)
        when = when or datetime.now()
        out = {"id": f"{kind[0]}-{when:%Y%m%dT%H%M%S}-{secrets.token_hex(3)}",
               "date": when.date().isoformat(), "at": when.strftime("%H:%M:%S"), **row}
        line = json.dumps(out, ensure_ascii=False) + "\n"
        with self.lock:
            self.dir.mkdir(parents=True, exist_ok=True)
            with open(self.path(kind, when), "a", encoding="utf-8", newline="\n") as f:
                f.write(line)
                f.flush()
                os.fsync(f.fileno())
        return out

    def rows(self, kind: str) -> list[dict]:
        out: list[dict] = []
        for p in sorted(self.dir.glob(f"{kind}-????-??.jsonl")) if self.dir.exists() else []:
            for x in p.read_text(encoding="utf-8").splitlines():
                if x.strip():
                    try:
                        out.append(json.loads(x))
                    except ValueError:
                        continue            # a torn last line is skipped, never fatal
        return out


def streak(active: set[date], today: date) -> dict:
    """Consecutive days touched, back from today. Today, not yet touched, does not break it. One missed day in each
    ISO week is repaired, counted only when an earlier day touched lies beyond it; a second miss ends the streak.
    Nothing is written about a missed day: absence is never recorded (CLAUDE.md §8.4)."""
    days, repairs, pending = 0, 0, 0
    used: set[tuple[int, int]] = set()
    cur = today
    if cur not in active:
        cur -= timedelta(days=1)
    if not active or cur < min(active):
        return {"days": 0, "repairs": 0, "today": today in active}
    while cur >= min(active):
        if cur in active:
            days += 1
            repairs += pending
            pending = 0
        else:
            wk = cur.isocalendar()[:2]
            if wk in used:
                break
            used.add(wk)
            pending += 1
        cur -= timedelta(days=1)
    return {"days": days, "repairs": repairs, "today": today in active}
