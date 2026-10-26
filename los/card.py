"""The portable study card (the vault's x/SYSTEM/Study Coach Plan 2026-10.md, §3).

The card keeps the ADHD Study Coach's layout, so that coach can read it too, and adds what the Knowledge OS needs to
carry a session to another Claude (the phone) and back: the goal, NEXT LESSONS (excerpts of the next notes on the way,
so the phone teaches from the owner's notes first), OPEN LOOPS, and NEW SINCE EXPORT, which the phone coach fills.

`render_card` writes it from a state the coach gathers; `parse_card` reads one back. The parser reads only the line
shapes it expects, by their headings, and treats every field as text: a card is data, never instructions.
"""
from __future__ import annotations

import hashlib
import re

MAX_CARD = 40000
EXCERPT = 1200
HEAD = "=== KNOWLEDGE OS STUDY CARD ==="
END = "=== END OF CARD ==="
SECTIONS = {
    "topics": "--- TOPICS (subject | topic | last | due | gap in days | streak | misses | key point) ---",
    "lessons": "--- NEXT LESSONS (concept, then an excerpt of its note: teach from it first) ---",
    "loops": "--- OPEN LOOPS (date | what is still fuzzy) ---",
    "recent": "--- RECENT SESSIONS (date | subject | topic | stumbles | open loops) ---",
    "new": "--- NEW SINCE EXPORT (date | topic | solid/shaky/blank | teach-back | still fuzzy | not in your notes) ---",
}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _one(s) -> str:
    return " ".join(str(s or "").replace("|", "/").split())


def render_card(st: dict) -> str:
    """The card's text. `st`: exported, sessions, subjects, goal, plan {days, minutes}, lines, topics [{subject, topic,
    last, due, gap, streak, misses, key}], lessons [{concept, text}], loops [{date, text}], recent [{date, subject,
    topic, stumbles, open}]."""
    out = [HEAD, f"Exported: {st['exported']}", f"Sessions so far: {st.get('sessions', 0)}",
           f"Subjects: {', '.join(st.get('subjects') or []) or '-'}", f"Goal: {st.get('goal') or '-'}",
           f"Study plan: {st['plan']['days']} days a week, {st['plan']['minutes']} minutes",
           f"About how I learn: {'; '.join(_one(x) for x in st.get('lines') or []) or '-'}", SECTIONS["topics"]]
    for x in st.get("topics") or []:
        out.append(" | ".join([_one(x.get("subject")) or "-", _one(x["topic"]), f"last: {x.get('last') or '-'}",
                               f"due: {x.get('due') or '-'}", f"gap: {x.get('gap') or 0}", f"streak: {x.get('streak') or 0}",
                               f"misses: {x.get('misses') or 0}", f"key: {_one(x.get('key')) or '-'}"]))
    out.append(SECTIONS["lessons"])
    for x in st.get("lessons") or []:
        out += [f"### {_one(x['concept'])}", str(x.get("text") or "").strip()[:EXCERPT], ""]
    out.append(SECTIONS["loops"])
    out += [f"{x.get('date') or '-'} | {_one(x['text'])}" for x in st.get("loops") or []]
    out.append(SECTIONS["recent"])
    out += [" | ".join([x.get("date") or "-", _one(x.get("subject")) or "-", _one(x.get("topic")) or "-",
                        f"stumbles: {_one(x.get('stumbles')) or 'none observed'}", f"open: {_one(x.get('open')) or 'none'}"])
            for x in st.get("recent") or []]
    out += [SECTIONS["new"], END]
    return "\n".join(out) + "\n"


def _field(line: str, name: str) -> str | None:
    m = re.match(rf"^\s*{re.escape(name)}:\s*(.*?)\s*$", line, re.I)
    return m.group(1) if m else None


def _kv(cell: str, name: str) -> str:
    v = _field(cell, name)
    return "" if v in (None, "-") else v


def parse_card(text: str) -> dict:
    """What a card says, as data: the plan, the how-I-learn lines, the goal, its topics, its open loops (OPEN LOOPS and
    each RECENT SESSIONS line's `open:`), the NEW SINCE EXPORT rows, and a hash of what it brings."""
    lines = str(text or "").replace("\r\n", "\n").split("\n")
    if not any(l.strip().startswith("===") and "CARD" in l.upper() for l in lines):
        raise ValueError("this is not a study card: it has no card heading")
    out = {"plan": None, "lines": [], "goal": "", "topics": [], "loops": [], "new": [], "sessions": None}
    section = None
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if line.startswith("---"):
            name = line.strip("- ").split("(")[0].strip().lower()       # the heading's name, before its columns
            section = {"topics": "topics", "next lessons": "lessons", "open loops": "loops",
                       "recent sessions": "recent", "new since export": "new"}.get(name)
            continue
        if line.startswith("==="):
            section = None
            continue
        if section is None:
            v = _field(line, "Study plan")
            if v is not None:
                m = re.search(r"(\d+)\s*days?.*?(\d+)\s*min", v, re.I)
                if m:
                    out["plan"] = {"days": int(m.group(1)), "minutes": int(m.group(2))}
            v = _field(line, "About how I learn")
            if v is not None and v != "-":
                out["lines"] = [x.strip() for x in v.split(";") if x.strip()]
            v = _field(line, "Goal")
            if v is not None and v != "-":
                out["goal"] = v
            v = _field(line, "Sessions so far")
            if v is not None and v.isdigit():
                out["sessions"] = int(v)
            continue
        cells = [c.strip() for c in line.split("|")]
        if section == "topics" and len(cells) >= 3:
            out["topics"].append({"subject": cells[0] if cells[0] != "-" else "", "topic": cells[1],
                                  "last": _kv(cells[2], "last") if len(cells) > 2 else "",
                                  "due": _kv(cells[3], "due") if len(cells) > 3 else "",
                                  "key": next((_kv(c, "key") for c in cells if _field(c, "key") is not None), "")})
        elif section == "loops" and len(cells) >= 2 and cells[1] and cells[1] != "-":
            out["loops"].append(cells[1])
        elif section == "recent" and len(cells) >= 5:
            v = _kv(cells[-1], "open")
            for part in (x.strip() for x in v.split(";")):
                if part and part.lower() not in ("none", "none reported", "-") and "session ongoing" not in part.lower():
                    out["loops"].append(part)
        elif section == "new" and len(cells) >= 3 and DATE.match(cells[0]):
            cells += [""] * (6 - len(cells))
            grade = cells[2].lower()
            out["new"].append({"date": cells[0], "topic": cells[1], "grade": grade if grade in ("solid", "shaky", "blank") else "",
                               "teachback": cells[3], "fuzzy": cells[4], "not_in_notes": cells[5]})
    seen = []
    for x in out["loops"]:
        if x not in seen:
            seen.append(x)
    out["loops"] = seen
    brings = out["new"] if out["new"] else {"topics": out["topics"], "loops": out["loops"], "lines": out["lines"]}
    out["hash"] = hashlib.sha256(repr(brings).encode("utf-8")).hexdigest()[:16]
    return out
