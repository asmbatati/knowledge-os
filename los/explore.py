"""Explore: the disciplines as the vault holds them (the vault's Knowledge OS Design 2026-10, §3-§4).

A field is a map under DISCIPLINES. Its record gathers what the vault already holds about it (its scope, concepts and
claims, history, dated concepts, people, tools, literature, debates, questions, gaps, and the owner's road) and scores
each section present, thin or missing: the completeness profile. The river lays the field's dated events out in time;
the frontier lists what is open at its right edge.

Reads only. The dates and their rules are the vault's own (`x/scripts/_knowledge.py`, CLAUDE.md §8.6), imported, never
copied. Each note's parse is kept keyed by its modification time and size, so a note is read again only when it changes.
"""
from __future__ import annotations

import importlib
import os
import time
import re
import threading
from collections import defaultdict
from pathlib import Path

import yaml

SCAN = (("Atlas/Concepts", False), ("Atlas/Topics", False), ("Atlas/Debates", False), ("Atlas/Questions", False),
        ("Atlas/Timelines", False), ("Library/People", True), ("Library/Groups", True), ("Library/Things", True),
        ("Library/Papers", True), ("Library/Books", True), ("Library/Courses", True), ("Library/Sources", True))
ROOT_HUB = "DISCIPLINES"
ROOT_HUB_AR = "فروع المعرفة"
REFRESH_S = 90          # the Drive mount is slow to list: a change shows within this many seconds
THRESH = {"scope_bytes": 800, "history_events": 10, "dated_share": 0.70}   # the owner's thresholds, 8 Oct 2026
LANES = ("people", "ideas", "tools", "papers", "experiments", "debates", "institutions")
KIND_LANE = {"person": "people", "idea": "ideas", "paper": "papers", "tool": "tools", "release": "tools",
             "dataset": "tools", "experiment": "experiments", "debate": "debates", "institution": "institutions"}
LIT_TYPES = {"source-summary", "paper", "book", "course", "lecture", "lecture-part", "source"}
LINK_RE = re.compile(r"\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]")
FENCE_RE = re.compile(r"^```.*?^```[ \t]*$", re.S | re.M)
ABSTRACT_RE = re.compile(r"^>\s*\[!abstract\][^\n]*\n((?:>[^\n]*(?:\n|$))+)", re.M)

_CACHE: dict[str, tuple] = {}
_LOCK = threading.RLock()


def _scan(d: Path, recursive: bool):
    out, stack = [], [str(d)]
    while stack:
        cur = stack.pop()
        try:
            it = os.scandir(cur)
        except OSError:
            continue
        with it:
            for e in it:
                try:
                    if e.is_dir(follow_symlinks=False):
                        if recursive:
                            stack.append(e.path)
                    elif e.name.lower().endswith(".md"):
                        st = e.stat(follow_symlinks=False)
                        out.append((Path(e.path), (st.st_mtime_ns, st.st_size)))
                except OSError:
                    continue
    return out


def _prose_bytes(body: str) -> int:
    """The body without code fences, headings, link bullets and table rows: what reads as prose (the §8.4 rule)."""
    body = FENCE_RE.sub("", body)
    keep = []
    for line in body.splitlines():
        s = line.strip()
        if not s or s.startswith(("#", "|", "~", "🏡")):
            continue
        if re.fullmatch(r"[-*]\s*(\[\[[^\]]+\]\][\s·|,]*)+", s):
            continue
        keep.append(s)
    return len("\n".join(keep).encode("utf-8"))


def _first_line(body: str) -> str:
    m = ABSTRACT_RE.search(body)
    if m:
        text = " ".join(x.lstrip(">").strip() for x in m.group(1).splitlines()).strip()
        if text and not text.startswith("%%"):
            return _plain(text)[:300]
    for line in body.splitlines():
        s = line.strip()
        if s and not s.startswith(("#", "```", ">", "|", "~", "🏡", "[[", "-", "%%")):
            return _plain(s)[:300]
    return ""


def _plain(s) -> str:
    """A table cell as text: links by their shown words, no emphasis marks."""
    s = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", str(s or ""))
    s = re.sub(r"\[\[([^\]]+)\]\]", r"\1", s)
    return re.sub(r"[*`]|(?<!\w)_|_(?!\w)", "", s).strip()      # emphasis marks only: rmw_zenoh keeps its underscore


def _links(v) -> list[str]:
    vals = v if isinstance(v, list) else [v] if v not in (None, "") else []
    out = []
    for x in vals:
        for m in LINK_RE.finditer(str(x)):
            out.append(m.group(1).strip())
    return out


def _parse(p: Path, rel: str, split_frontmatter, read_raw) -> dict | None:
    try:
        text = read_raw(p)
    except OSError:
        return None
    fm = split_frontmatter(text)
    data, body = {}, text
    if fm is not None:
        body = fm.body
        try:
            data = yaml.safe_load("\n".join(fm.lines)) or {}
        except yaml.YAMLError:
            data = {}
        if not isinstance(data, dict):
            data = {}
    return {"name": p.stem, "rel": rel, "fm": data, "type": str(data.get("type") or "").strip(),
            "up": (_links(data.get("up")) or [""])[0], "links": frozenset(m.group(1).strip().lower() for m in LINK_RE.finditer(text)),
            "prose": _prose_bytes(body), "has_map": "## The map" in body or "## الخريطة" in body,
            "first": _first_line(body), "text": text}


class Explore:
    """The index of what Explore reads, rebuilt only from the notes that changed since the last call."""

    def __init__(self, vault):
        self.vault = vault
        self.root = Path(vault.root)
        self.RG = vault.RG
        self.KN = importlib.import_module("_knowledge")
        self.notes: dict[str, dict] = {}       # lower-case name -> parsed note (the first one found wins, as in Obsidian)
        self._sig = None
        self._kids: dict[str, list[str]] = {}
        self._types: dict[str, list[dict]] = {}
        self._inbound: dict[str, set[str]] = {}
        self._sub: dict[str, list[dict]] = {}
        self._scanned = 0.0
        self._tree = None
        self._index_lock = threading.Lock()

    # ------------------------------------------------------------- the index
    def index(self, fresh: bool = False) -> dict[str, dict]:
        if self.notes and not fresh and time.monotonic() - self._scanned < REFRESH_S:
            return self.notes
        with self._index_lock:              # the warm-up and the first page wait for one scan, not two
            if self.notes and not fresh and time.monotonic() - self._scanned < REFRESH_S:
                return self.notes
            return self._rebuild()

    def _rebuild(self) -> dict[str, dict]:
        files = []
        for d, rec in SCAN:
            base = self.root / d
            if base.exists():
                files += _scan(base, rec)
        sig = tuple(sorted((str(p), s) for p, s in files))
        self._scanned = time.monotonic()
        if sig == self._sig:
            return self.notes
        notes = {}
        for p, s in sorted(files, key=lambda t: str(t[0])):
            key = str(p)
            with _LOCK:
                hit = _CACHE.get(key)
                if hit is None or hit[0] != s:
                    rel = p.relative_to(self.root).as_posix()
                    hit = (s, _parse(p, rel, self.RG.split_frontmatter, self.RG.read_raw))
                    _CACHE[key] = hit
            if hit[1] is not None:
                notes.setdefault(p.stem.lower(), hit[1])
        kids = defaultdict(list)
        for k, n in notes.items():
            if n["up"]:
                kids[n["up"].lower()].append(k)
        types, inbound = defaultdict(list), defaultdict(set)
        for k, n in notes.items():
            types[n["type"]].append(n)
            for t in n["links"]:
                inbound[t].add(k)
        self.notes, self._sig, self._kids, self._types, self._inbound, self._sub = notes, sig, kids, types, inbound, {}
        self._tree = None
        return notes

    def get(self, name: str) -> dict | None:
        return self.index().get(str(name or "").strip().lower())

    def children(self) -> dict[str, list[str]]:
        self.index()
        return self._kids

    def subtree(self, name: str) -> list[dict]:
        kids = self.children()
        if name.lower() in self._sub:
            return self._sub[name.lower()]
        out, seen, stack = [], set(), [name.lower()]
        while stack:
            cur = stack.pop()
            for k in kids.get(cur, []):
                if k not in seen:
                    seen.add(k)
                    out.append(self.notes[k])
                    stack.append(k)
        self._sub[name.lower()] = out
        return out

    def span(self, n: dict, key: str):
        v = n["fm"].get(key)
        return self.KN.parse_when(v) if v not in (None, "") else None

    def road(self) -> tuple[dict, set]:
        """Each road concept's state, and the names on some road: the overlay."""
        try:
            g, roads = self.vault.graph()
            stat = self.RG.statuses(g)
            scope = set()
            for r in roads:
                scope |= set(self.RG.road_scope(g, r))
            return {k: stat.get(k) for k in g.nodes}, scope
        except Exception:
            return {}, set()

    # ------------------------------------------------------------- the disciplines
    def tree(self) -> dict:
        notes, kids = self.index(), self.children()
        status, scope = self.road()
        key = (self._sig, hash(frozenset(status.items())))
        if self._tree and self._tree[0] == key:
            return self._tree[1]
        branches = []
        for b in sorted(kids.get(ROOT_HUB.lower(), [])):
            bn = notes[b]
            if bn["type"] != "moc":
                continue
            fields = []
            for f in sorted(kids.get(b, [])):
                fn = notes[f]
                if fn["type"] != "moc":
                    continue
                fields.append(self.summary(fn, status, scope))
            branches.append({"name": bn["name"], "first": bn["first"], "fields": fields,
                             "counterpart": (_links(bn["fm"].get("counterpart")) or [""])[0]})
        out = {"root": ROOT_HUB, "branches": branches}
        self._tree = (key, out)
        return out

    def _concepts(self, field: dict) -> tuple[list[dict], list[dict]]:
        """A field's concept-level notes (hanging from a map) and its claims (hanging from a concept)."""
        level, claims = [], []
        for n in self.subtree(field["name"]):
            if n["type"] != "concept":
                continue
            parent = self.notes.get(n["up"].lower())
            (claims if parent is not None and parent["type"] == "concept" else level).append(n)
        return level, claims

    def summary(self, field: dict, status=None, scope=None) -> dict:
        if status is None:
            status, scope = self.road()
        level, claims = self._concepts(field)
        on = [n for n in level + claims if n["name"].lower() in scope]
        rec = self.record(field, status, scope, light=True)
        return {"name": field["name"], "concepts": len(level), "claims": len(claims), "on_road": len(on),
                "off_road": len(level) + len(claims) - len(on), "mastered": sum(1 for n in on if status.get(n["name"].lower()) == "mastered"),
                "dated": sum(1 for n in level if self.span(n, "introduced")), "completeness": rec["completeness"]}

    # ------------------------------------------------------------- a field's record
    def _related_to(self, n: dict, names: set) -> bool:
        if n["up"].lower() in names:
            return True
        return any(x.lower() in names for x in _links(n["fm"].get("related"))) or \
            any(x.lower() in names for x in _links(n["fm"].get("timeline_of")))

    def record(self, field: dict, status=None, scope=None, light=False) -> dict:
        notes = self.index()
        if status is None:
            status, scope = self.road()
        sub = self.subtree(field["name"])
        names = {field["name"].lower()} | {n["name"].lower() for n in sub}
        level, claims = self._concepts(field)
        maps = [n for n in sub if n["type"] == "moc"]
        timelines = [n for n in self._types.get("timeline", []) if self._related_to(n, names)]
        debates = [n for n in self._types.get("debate", []) if self._related_to(n, names)]
        questions = [n for n in self._types.get("question", []) if self._related_to(n, names)]
        out_links = set().union(*(m["links"] for m in [field] + sub)) if sub else set(field["links"])
        in_keys = set().union(*(self._inbound.get(x, set()) for x in names))
        things = [n for n in self._types.get("entity", []) if n["rel"].startswith("Library/Things/")
                  and (self._related_to(n, names) or n["name"].lower() in out_links)]
        lit_out = set().union(*(m["links"] for m in [field] + level)) if level else set(field["links"])
        literature = [notes[k] for k in (in_keys | (lit_out & notes.keys()))
                      if k in notes and notes[k]["type"] in LIT_TYPES and notes[k]["rel"].startswith("Library/")]
        events = sum(len(self._timeline_events(t)) for t in timelines)
        dated = [n for n in level if self.span(n, "introduced")]
        with_people = [n for n in dated if _links(n["fm"].get("introduced_by"))]
        seeds = [n for n in level if str(n["fm"].get("status") or "") == "seed"]
        missing_people = sorted({p for n in level for p in _links(n["fm"].get("introduced_by")) if p.lower() not in notes})
        typed = [d for d in debates if d["fm"].get("debate_type") and d["fm"].get("debate_status")]

        def score(present, thin):
            return "present" if present else "thin" if thin else "missing"
        sections = [
            {"key": "scope", "score": score(field["prose"] >= THRESH["scope_bytes"], field["prose"] > 0), "n": field["prose"]},
            {"key": "map", "score": score(field["has_map"], False), "n": int(field["has_map"])},
            {"key": "concepts", "score": score(bool(level) and not seeds, bool(level)), "n": len(level), "claims": len(claims), "seeds": len(seeds)},
            {"key": "history", "score": score(events >= THRESH["history_events"], events > 0), "n": events, "timelines": len(timelines)},
            {"key": "dated", "score": score(bool(level) and len(dated) >= THRESH["dated_share"] * len(level), bool(dated)), "n": len(dated), "of": len(level)},
            {"key": "people", "score": score(bool(dated) and len(with_people) == len(dated), bool(with_people)), "n": len(with_people), "of": len(dated)},
            {"key": "tools", "score": score(any(self.span(t, "released") for t in things), bool(things)), "n": len(things)},
            {"key": "literature", "score": score(bool(literature), False), "n": len(literature)},
            {"key": "debates", "score": score(bool(debates) and len(typed) == len(debates), bool(debates)), "n": len(debates), "typed": len(typed)},
            {"key": "questions", "score": score(bool(questions), False), "n": len(questions)},
        ]
        got = sum({"present": 2, "thin": 1}.get(s["score"], 0) for s in sections)
        completeness = round(100 * got / (2 * len(sections)))
        out = {"name": field["name"], "completeness": completeness, "sections": sections}
        if light:
            return out
        on = {n["name"].lower() for n in level + claims} & scope

        def item(n):
            k = n["name"].lower()
            sp = self.span(n, "introduced")
            return {"name": n["name"], "type": n["type"], "status": n["fm"].get("status"), "first": n["first"],
                    "road": status.get(k) if k in on else None, "when": self.KN.year_label(*sp) if sp else None,
                    "up": n["up"]}
        out.update({
            "first": field["first"], "counterpart": (_links(field["fm"].get("counterpart")) or [""])[0],
            "up": field["up"], "maps": [item(n) for n in sorted(maps, key=lambda n: n["name"].lower())],
            "concepts": [item(n) for n in sorted(level, key=lambda n: n["name"].lower())],
            "claims": len(claims), "on_road": len(on),
            "timelines": [n["name"] for n in timelines], "debates": [self._debate(d) for d in debates],
            "questions": [n["name"] for n in questions], "tools": [n["name"] for n in things],
            "literature": [n["name"] for n in sorted(literature, key=lambda n: n["name"].lower())[:200]],
            "gaps": {"seeds": [n["name"] for n in seeds], "undated": [n["name"] for n in level if not self.span(n, "introduced")],
                     "missing_people": missing_people},
            "thresholds": THRESH,
        })
        return out

    def _debate(self, d: dict) -> dict:
        fm = d["fm"]
        per, sin = self.span(d, "period"), self.span(d, "settled_in")
        return {"name": d["name"], "type": fm.get("debate_type"), "status": fm.get("debate_status"),
                "parties": _links(fm.get("parties")), "period": self.KN.year_label(*per) if per else None,
                "settled_in": self.KN.year_label(*sin) if sin else None}

    # ------------------------------------------------------------- the river
    def _when(self, lo: int, hi: int, approx: bool = False) -> dict:
        return {"lo": lo, "hi": hi, "approx": approx, "when": ("c. " if approx else "") + self.KN.year_label(lo, hi),
                "hijri": self.KN.hijri_label(lo, hi), "hijri_ar": self.KN.hijri_label(lo, hi, lang="ar")}

    def _timeline_events(self, t: dict) -> list[dict]:
        out = []
        for r in self.KN.event_tables(t["text"]):
            sp = self.KN.parse_loose(r["when"])
            if not sp:
                continue
            lane = KIND_LANE.get(r["kind"]) if r["schema"] == "event" else None
            if lane is None:
                first = self.notes.get(r["links"][0].lower()) if r["links"] else None
                lane = "people" if first is not None and first["type"] == "person" else "ideas"
            if r["schema"] == "legacy":           # When | Who (or Shift) | What changed: the second cell names the event
                cells = r.get("cells") or []
                label = cells[1] if len(cells) > 1 else r["event"]
                detail = " · ".join(cells[2:]) if len(cells) > 2 else ""
                label = re.sub(r"\s*\([^)]*\d[^)]*\)\s*$", "", _plain(label))      # "Hume (1711–1776)" -> "Hume"
            else:
                label, detail = r["event"], r["impact"]
            out.append({**self._when(*sp), "lane": lane, "label": _plain(label)[:120], "note": r["links"][0] if r["links"] else None,
                        "links": r["links"], "source": t["name"], "detail": _plain(detail)[:300]})
        return out

    def river(self, name: str) -> dict:
        field = self.get(name)
        if field is None:
            return {"name": name, "events": [], "lanes": list(LANES)}
        status, scope = self.road()
        sub = self.subtree(field["name"])
        names = {field["name"].lower()} | {n["name"].lower() for n in sub}
        notes = self.index()
        events, people = [], set()
        level, _claims = self._concepts(field)
        for n in level:
            sp = self.span(n, "introduced")
            if sp:
                who = _links(n["fm"].get("introduced_by"))
                people |= {w.lower() for w in who}
                events.append({**self._when(*sp), "lane": "ideas", "label": n["name"], "note": n["name"],
                               "people": who, "road": status.get(n["name"].lower()) if n["name"].lower() in scope else None,
                               "rel": {k: _links(n["fm"].get(k)) for k in ("responds_to", "refutes", "generalizes")}})
        dated = {e["note"].lower() for e in events if e.get("note")}
        for t in (n for n in self._types.get("timeline", []) if self._related_to(n, names)):
            for e in self._timeline_events(t):
                if e["lane"] == "ideas" and any(x.lower() in dated for x in e.get("links") or []):
                    continue                    # the concept carries its own date: one event, not two
                events.append(e)
                if e["lane"] == "people" and e.get("note"):
                    people.add(e["note"].lower())
        for d in (n for n in self._types.get("debate", []) if self._related_to(n, names)):
            per, sin = self.span(d, "period"), self.span(d, "settled_in")
            if per or sin:
                lo = (per or sin)[0]
                hi = (sin or per)[1]
                events.append({**self._when(lo, hi), "lane": "debates", "label": d["name"], "note": d["name"],
                               "status": d["fm"].get("debate_status"), "settled_in": sin[0] if sin else None})
        covered = {(x.lower(), e["lo"]) for e in events for x in (e.get("links") or [])}
        for t in (n for n in self._types.get("entity", []) if n["rel"].startswith("Library/Things/") and self._related_to(n, names)):
            sp = self.span(t, "released")
            if sp and (t["name"].lower(), sp[0]) not in covered:    # a history's row that dates it already says more
                events.append({**self._when(*sp), "lane": "tools", "label": t["name"], "note": t["name"]})
        lives = []
        for k in sorted(people):
            p = notes.get(k)
            if p is None or p["type"] != "person":
                continue
            b, d = self.KN.parse_loose(p["fm"].get("born")), self.KN.parse_loose(p["fm"].get("died"))
            if b:
                lives.append({"name": p["name"], "lo": b[0], "hi": d[1] if d else None})
        lanes = [l for l in LANES if any(e["lane"] == l for e in events)]
        return {"name": field["name"], "events": sorted(events, key=lambda e: (e["lo"], e["label"])), "lanes": lanes,
                "lives": lives, "undated": sum(1 for n in level if not self.span(n, "introduced"))}

    # ------------------------------------------------------------- the frontier
    def frontier(self, name: str) -> dict:
        field = self.get(name)
        if field is None:
            return {"name": name}
        rec = self.record(field)
        return {"name": field["name"],
                "open_debates": [d for d in rec["debates"] if (d.get("status") or "open") in ("open", "dormant")],
                "questions": rec["questions"], "seeds": rec["gaps"]["seeds"], "undated": rec["gaps"]["undated"],
                "missing_people": rec["gaps"]["missing_people"],
                "no_history": not rec["timelines"]}

    # ------------------------------------------------------------- one note
    def note(self, name: str) -> dict | None:
        n = self.get(name)
        if n is None:
            return None
        notes = self.index()
        fm = n["fm"]
        status, scope = self.road()
        chain, cur, seen = [], n["up"], set()
        while cur and cur.lower() not in seen and len(chain) < 12:
            seen.add(cur.lower())
            chain.append(cur)
            p = notes.get(cur.lower())
            cur = p["up"] if p else ""
        k = n["name"].lower()
        reverse = {rel: sorted(m["name"] for m in notes.values() if any(x.lower() == k for x in _links(m["fm"].get(rel))))
                   for rel in ("responds_to", "refutes", "generalizes", "introduced_by", "school")}
        dates = {}
        for key in ("introduced", "released", "period", "settled_in"):
            sp = self.span(n, key) if key in fm else None
            if sp:
                dates[key] = self._when(*sp)
        for key in ("born", "died"):
            sp = self.KN.parse_loose(fm.get(key)) if fm.get(key) not in (None, "") else None
            if sp:
                dates[key] = self._when(sp[0], sp[1])
        return {"name": n["name"], "type": n["type"], "rel": n["rel"], "up": n["up"], "chain": chain,
                "children": sorted(m["name"] for m in notes.values() if m["up"].lower() == k)[:300],
                "counterpart": (_links(fm.get("counterpart")) or [""])[0], "status": fm.get("status"),
                "domain": fm.get("domain"), "dates": dates,
                "relations": {rel: _links(fm.get(rel)) for rel in ("introduced_by", "responds_to", "refutes", "generalizes",
                                                                    "school", "parties", "settled_by", "timeline_of",
                                                                    "released_by", "superseded_by") if _links(fm.get(rel))},
                "reverse": {r: v for r, v in reverse.items() if v},
                "debate": {"type": fm.get("debate_type"), "status": fm.get("debate_status")} if n["type"] == "debate" else None,
                "road": status.get(k) if k in scope else None, "text": n["text"]}

    def search(self, q: str, limit: int = 30) -> list[dict]:
        q = (q or "").strip().lower()
        if len(q) < 2:
            return []
        hits = [n for k, n in self.index().items() if q in k]
        hits.sort(key=lambda n: (not n["name"].lower().startswith(q), len(n["name"])))
        return [{"name": n["name"], "type": n["type"], "rel": n["rel"]} for n in hits[:limit]]
