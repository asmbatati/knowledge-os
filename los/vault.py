"""The bridge to the vault: the road's own code, with its file reads cached.

The site reimplements none of the road (design §2.1). It imports `_road`, `_road_graph`, `_road_bank` and `_learning`
from the vault's x/scripts and calls them with the vault it serves. One thing it adds: on the Google Drive mount,
`_road_graph.load_graph` and `sources_index` read about 1,800 notes and take 6 and 10 seconds, on every call. The
bridge swaps in versions that keep each note's parse keyed by its modification time and size, so a note is read again
only when it changes; the parsing itself stays the road's (`_node_from`, `split_frontmatter`, `fm_list`). The
selftest compares both against the road's own functions on the demo vault, so a change to the road that the cache
does not follow fails there first.
"""
from __future__ import annotations

import dataclasses
import importlib
import json
import os
import re
import sys
import threading
from collections import defaultdict
from pathlib import Path

_NODE_CACHE: dict[str, tuple] = {}
_TEACH_CACHE: dict[str, tuple] = {}
_LIB_CACHE: dict[str, tuple] = {}
_META_CACHE: dict[str, tuple] = {}
_CACHE_LOCK = threading.RLock()

LIB_DIRS = ("Library/Sources", "Library/Courses", "Library/Books")
IMAGE_EXTS = (".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp")
_ABSTRACT = re.compile(r"^>\s*\[!abstract\][^\n]*\n((?:>[^\n]*(?:\n|$))+)", re.M)
_PART = re.compile(r"^###\s+(.+?)\s*$")
_TIMESTAMP = re.compile(r"\s+[—–-]\s+\[[^\]]*\]\([^)]*\)\s*$")
_PLACEHOLDER = "What it lets you do that you could not before, in your own words."


def _abstract(body: str) -> str:
    """The first abstract callout's text, its lines joined; '' when there is none or it is the template's."""
    m = _ABSTRACT.search(body)
    if not m:
        return ""
    text = " ".join(line.lstrip(">").strip() for line in m.group(1).splitlines()).strip()
    return "" if text == _PLACEHOLDER else text


def _first_sentence(body: str, heading: str = "## Definition") -> str:
    """The first sentence of a section's first paragraph: a concept's preview when its note has no abstract."""
    lines = body.replace("\r\n", "\n").split("\n")
    try:
        i = next(k for k, line in enumerate(lines) if line.strip() == heading)
    except StopIteration:
        return ""
    para = []
    for line in lines[i + 1:]:
        if line.startswith("#"):
            break
        if line.strip():
            para.append(line.strip())
        elif para:
            break
    text = " ".join(para)
    m = re.match(r"(.+?[.!?])(\s|$)", text)
    return (m.group(1) if m else text)[:400]


def _parts(body: str) -> list[str]:
    """The part headings under ## Arc, without their timestamp links."""
    out, inside = [], False
    for line in body.replace("\r\n", "\n").split("\n"):
        if line.startswith("## "):
            inside = line.strip() == "## Arc"
            continue
        if inside:
            m = _PART.match(line)
            if m:
                out.append(_TIMESTAMP.sub("", m.group(1)).strip())
    return out


def _scan(d: Path, recursive: bool) -> list[tuple[Path, tuple[int, int]]]:
    out: list[tuple[Path, tuple[int, int]]] = []
    stack = [str(d)]
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
    return sorted(out, key=lambda t: t[0])


def _install(RG) -> None:
    """Swap the two slow readers for cached ones, once per process."""
    if getattr(RG, "_los_patched", False):
        return
    node_from = RG._node_from
    default_root = getattr(RG, "VAULT", Path(RG.__file__).resolve().parents[2])

    def load_graph(root: Path = default_root):
        d = Path(root) / RG.CONCEPT_DIR
        nodes, names = {}, set()
        for p, sig in _scan(d, recursive=False) if d.exists() else []:
            names.add(p.stem.lower())
            key = str(p)
            with _CACHE_LOCK:
                hit = _NODE_CACHE.get(key)
                if hit is None or hit[0] != sig:
                    try:
                        hit = (sig, node_from(p, f"{RG.CONCEPT_DIR}/{p.name}"))
                    except OSError:
                        continue
                    _NODE_CACHE[key] = hit
            n = hit[1]
            if n:
                nodes[n.name.lower()] = dataclasses.replace(n, requires=list(n.requires))
        return RG.Graph(nodes, names)

    def sources_index(root: Path = default_root):
        idx: dict[str, list[str]] = defaultdict(list)
        for base in RG.SOURCE_DIRS:
            d = Path(root) / base
            if not d.exists():
                continue
            for p, sig in _scan(d, recursive=True):
                key = str(p)
                with _CACHE_LOCK:
                    hit = _TEACH_CACHE.get(key)
                    if hit is None or hit[0] != sig:
                        try:
                            fm = RG.split_frontmatter(RG.read_raw(p))
                        except OSError:
                            continue
                        hit = (sig, list((RG.fm_list(fm.lines, "teaches") or []) if fm else []))
                        _TEACH_CACHE[key] = hit
                for c in hit[1]:
                    idx[c.lower()].append(p.stem)
        return idx

    RG._los_orig_load_graph, RG._los_orig_sources_index = RG.load_graph, RG.sources_index
    RG.load_graph, RG.sources_index = load_graph, sources_index
    RG._los_patched = True


class Vault:
    """The road for one vault. `code_root` holds x/scripts; `data_root` holds the notes (the same vault, except in the
    tests and the demo, which run the vault's code over a temporary vault)."""

    def __init__(self, code_root, data_root=None, learn_dir=None):
        scripts = str(Path(code_root) / "x" / "scripts")
        if scripts not in sys.path:
            sys.path.insert(0, scripts)
        self.R = importlib.import_module("_road")
        self.RG = importlib.import_module("_road_graph")
        self.RB = importlib.import_module("_road_bank")
        self.L = importlib.import_module("_learning")
        _install(self.RG)
        self.root = Path(data_root or code_root)
        self.learn = Path(learn_dir) if learn_dir else self.root / "x" / "reports" / "learning"
        self.lock = threading.RLock()

    # the road's own functions, uncached — for the selftest's comparison
    def uncached_load_graph(self, root):
        return self.RG._los_orig_load_graph(root)

    def uncached_sources(self, root):
        return self.RG._los_orig_sources_index(root)

    # ---------------------------------------------------------------- reads
    def graph(self):
        with self.lock:
            return self.R.load(self.root, self.learn)

    def known(self) -> dict[str, str]:
        """Every concept note, in the graph or not: lower-case name -> name. Only these can be opened."""
        d = self.root / self.RG.CONCEPT_DIR
        return {p.stem.lower(): p.stem for p, _ in (_scan(d, recursive=False) if d.exists() else [])}

    def note_text(self, name: str) -> str | None:
        canon = self.known().get(str(name).lower())
        if not canon:
            return None
        return self.RG.read_raw(self.root / self.RG.CONCEPT_DIR / f"{canon}.md")

    def _asset_dirs(self) -> list[Path]:
        """Where a concept note's images sit: its attachment folder (Obsidian's `./attachments`), then beside it."""
        d = self.root / self.RG.CONCEPT_DIR
        return [d / "attachments", d]

    def assets(self) -> dict[str, str]:
        """Every image beside the concept notes: lower-case file name -> file name, the attachment folder's first."""
        out: dict[str, str] = {}
        for d in reversed(self._asset_dirs()):
            try:
                names = os.listdir(d)
            except OSError:
                continue
            out.update({n.lower(): n for n in names if n.lower().endswith(IMAGE_EXTS)})
        return out

    def asset_path(self, name: str) -> Path | None:
        """An image the notes embed, by its file name alone: never a folder, a note or a path out of these folders."""
        if not name or "/" in name or "\\" in name or not name.lower().endswith(IMAGE_EXTS):
            return None
        for d in self._asset_dirs():
            p = (d / name).resolve()
            if p.is_relative_to(d.resolve()) and p.is_file():
                return p
        return None

    def library_notes(self) -> list[dict]:
        """The course tutor's reading of Library (sources, courses, books): each note's name, path, type, the card it
        belongs to (`course:` or `book:`), its `number:`, what it `teaches:`, its one line and its parts. Each note is
        parsed again only when it changes, as the graph is."""
        out = []
        for base in LIB_DIRS:
            d = self.root / base
            for p, sig in _scan(d, recursive=True) if d.exists() else []:
                key = str(p)
                with _CACHE_LOCK:
                    hit = _LIB_CACHE.get(key)
                    if hit is None or hit[0] != sig:
                        try:
                            hit = (sig, self._library_note(p))
                        except OSError:
                            continue
                        _LIB_CACHE[key] = hit
                out.append(hit[1])
        return out

    def _library_note(self, p: Path) -> dict:
        text = self.RG.read_raw(p)
        fm = self.RG.split_frontmatter(text)
        lines = fm.lines if fm else []
        s = self.L.fm_scalars(text) if fm else {}
        body = text[fm.body_offset:] if fm and hasattr(fm, "body_offset") else re.sub(
            r"\A---\r?\n.*?\r?\n---[ \t]*\r?\n", "", text, count=1, flags=re.S)
        try:
            number = int(str(s.get("number") or "").strip())
        except ValueError:
            number = None
        return {"name": p.stem, "rel": p.relative_to(self.root).as_posix(), "type": s.get("type") or "",
                "source_type": s.get("source_type") or "", "title": (s.get("title") or p.stem).strip('"'),
                "course": self.RG.link_name(s.get("course")) or "", "book": self.RG.link_name(s.get("book")) or "",
                "number": number, "teaches": list(self.RG.fm_list(lines, "teaches") or []),
                "one_line": _abstract(body), "parts": _parts(body)}

    def concept_meta(self, name: str) -> dict:
        """A concept note's preview (its abstract, else the first sentence of its Definition) and its aliases, cached
        by the note's modification time."""
        canon = self.known().get(str(name).lower())
        if not canon:
            return {"abstract": "", "aliases": []}
        p = self.root / self.RG.CONCEPT_DIR / f"{canon}.md"
        try:
            st = p.stat()
        except OSError:
            return {"abstract": "", "aliases": []}
        sig = (st.st_mtime_ns, st.st_size)
        with _CACHE_LOCK:
            hit = _META_CACHE.get(str(p))
            if hit is None or hit[0] != sig:
                text = self.RG.read_raw(p)
                fm = self.RG.split_frontmatter(text)
                body = re.sub(r"\A---\r?\n.*?\r?\n---[ \t]*\r?\n", "", text, count=1, flags=re.S)
                meta = {"abstract": _abstract(body) or _first_sentence(body),
                        "aliases": [a.strip().strip('"') for a in (self.RG.fm_list(fm.lines, "aliases") or [])]
                        if fm else []}
                hit = (sig, meta)
                _META_CACHE[str(p)] = hit
            return hit[1]

    def state(self) -> dict:
        st = dict(self.L.DEFAULT_STATE)
        p = self.learn / "state.json"
        try:
            st.update({k: v for k, v in json.loads(p.read_text(encoding="utf-8")).items() if k in st})
        except (OSError, ValueError):
            pass
        return st

    def next_item(self, road=None, on=None) -> dict:
        with self.lock:
            return self.R.cmd_next(road, on, self.root, self.learn)

    def plan(self, on=None) -> dict:
        with self.lock:
            return self.R.build_plan(on, self.root, self.learn, self.state())

    def road_today(self, on=None) -> dict:
        """What the coach's road session walks: every check the road offers now, in its order (the plan shows the
        first `quota`), the failed checks whose day to be checked again has come, the day's quota and the checks
        recorded today."""
        with self.lock:
            R = self.R
            on = on or self.L.today()
            g, roads = R.load(self.root, self.learn)
            chosen = R.chosen_roads(roads)
            _due, ready, to_read, *_ = R.queues(g, R.scope_of(g, chosen), on, R.stuck_flags(g, self.learn))
            last = R.last_verdicts(g, self.learn)
            again = [k for k in to_read if (R.recheck_on(last.get(k)) or on) <= on]
            return {"ready": [g.nodes[k].name for k in ready], "rechecks": [g.nodes[k].name for k in again],
                    "quota": sum(r.daily_new for r in chosen),
                    "checked_today": sum(1 for r in R.rows_on(on, self.learn) if r.get("kind") == "check")}

    def road_state(self, on=None) -> dict:
        with self.lock:
            return self.R.build_state(self.root, self.learn, on)

    def bank(self, name: str):
        return self.RB.load_bank(name, self.root)

    def verdict_rows(self) -> list[dict]:
        rows = []
        for p in sorted(self.learn.glob("road-verdicts-????-??-??.jsonl")) if self.learn.exists() else []:
            rows += self.RG.read_rows(p)
        return rows

    def placement_rows(self) -> list[dict]:
        return self.RG.placement_rows(self.learn)

    def place(self, goal, on=None) -> dict:
        """The next placement question toward a goal, or `done` (the road's `cmd_place`)."""
        with self.lock:
            return self.R.cmd_place(goal, on, self.root, self.learn)

    # --------------------------------------------------------------- writes
    def place_verdict(self, goal, concept, variant, correct, on=None, answer=None, dont_know=False) -> dict:
        """The road's placement writer. Raises SystemExit with the road's refusal. `dont_know` settles at once."""
        with self.lock:
            if dont_know:
                return self.R.cmd_place_verdict(goal, concept, variant, False, on, self.root, self.learn,
                                                answer=answer, dont_know=True)
            return self.R.cmd_place_verdict(goal, concept, variant, correct, on, self.root, self.learn, answer=answer)

    def place_skip(self, goal, concept, on=None, why="") -> dict:
        """Step past the concept placement asks, its bank not written yet (the road's `cmd_place_skip`)."""
        with self.lock:
            return self.R.cmd_place_skip(goal, concept, on, self.root, self.learn, why=why)

    def words(self, concept, text, on=None) -> dict:
        """The owner's In my words after a pass, through the road's writer (`_road.cmd_words`)."""
        with self.lock:
            return self.R.cmd_words(concept, text, on, self.root, self.learn, source="los")

    def verdict(self, concept, kind, answers, on=None) -> dict:
        """The road's writer. Raises SystemExit with the road's refusal."""
        with self.lock:
            return self.R.cmd_verdict(concept, kind, answers, on, self.root, self.learn)

    def save_bank(self, bank: dict) -> list[str]:
        with self.lock:
            return self.RB.save_bank(bank, self.root)
