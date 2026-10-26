"""The page's language and the vault's bilingual pairs (CLAUDE.md §7).

A durable note has an Arabic counterpart: the note its `counterpart:` names, marked `language: ar`, and naming it back.
When the page is in Arabic, the site shows that counterpart wherever it shows a note, and says plainly when there is
none, and why: a claim, an open question and a Library card are English by design (§7: claims and questions are
English-primary, and so are the pages of proper nouns and sources); any other note has no Arabic version yet. The
road stays the English note's: its graph, verdicts and banks are keyed by the English names.

Reads only. Once Explore's index exists it is read as it stands (it holds every Atlas note and the Library shelves with
their frontmatter); before that, a note and its counterpart are read from Atlas's own folders, two files, because the
first index reads them all and takes 32 s on the Drive mount (19 Oct 2026). Nothing here builds the index: the warm-up
and the Explore tab do, and the names the page shows for links (`labels`) say they are not ready until it exists.
"""
from __future__ import annotations

import threading
from pathlib import Path

from .explore import _links, _parse

LANGS = ("en", "ar")
BY_DESIGN = ("claim", "question", "english-primary")
ATLAS = ("Atlas/Concepts", "Atlas/Topics", "Atlas/Debates", "Atlas/Questions", "Atlas/Timelines")
_DIRECT: dict[str, tuple] = {}
_LOCK = threading.RLock()


def page_lang(q: dict, key: str = "lang") -> str:
    v = (q.get(key) or [""])[0]
    return v if v in LANGS else "en"


class Bilingual:
    def __init__(self, explore):
        self.explore = explore
        self.root = Path(explore.root)
        self._labels: tuple | None = None

    def get(self, name: str) -> dict | None:
        """A note as Explore parses it: from the index when it exists (as it stands, never rebuilt here), else from
        Atlas's folders, each file parsed again only when it changes."""
        key = str(name or "").strip().lower()
        if not key:
            return None
        notes = self.explore.notes
        n = notes.get(key) if notes else None
        return n if n is not None else self._direct(str(name).strip())

    def _direct(self, name: str) -> dict | None:
        if "/" in name or "\\" in name or name.startswith("."):
            return None
        for d in ATLAS:
            p = self.root / d / f"{name}.md"
            try:
                st = p.stat()
            except OSError:
                continue
            sig = (st.st_mtime_ns, st.st_size)
            with _LOCK:
                hit = _DIRECT.get(str(p))
                if hit is None or hit[0] != sig:
                    hit = (sig, _parse(p, f"{d}/{p.name}", self.explore.RG.split_frontmatter, self.explore.RG.read_raw))
                    _DIRECT[str(p)] = hit
            if hit[1] is not None:
                return hit[1]
        return None

    @staticmethod
    def lang_of(n: dict) -> str:
        return "ar" if str(n["fm"].get("language") or "").strip().lower() == "ar" else "en"

    @staticmethod
    def title_of(n: dict) -> str:
        return str(n["fm"].get("title") or n["name"]).strip() or n["name"]

    def counterpart(self, n: dict) -> dict | None:
        """The note `counterpart:` names, when it is in the other language."""
        names = _links(n["fm"].get("counterpart"))
        cp = self.get(names[0]) if names else None
        return cp if cp is not None and self.lang_of(cp) != self.lang_of(n) else None

    def why_english(self, n: dict) -> str:
        """Why an English note has no Arabic one: by design (a claim, a question, a Library card or another page the
        vault marks english-primary that is not a concept, map or debate), or `none`: not written yet."""
        if n["type"] == "question":
            return "question"
        if n["type"] == "concept":
            parent = self.get(n["up"]) if n["up"] else None
            if parent is not None and parent["type"] == "concept":
                return "claim"
        if n["rel"].startswith("Library/"):
            return "english-primary"
        if str(n["fm"].get("translation_status") or "").strip() == "english-primary" and \
                n["type"] not in ("concept", "moc", "debate"):
            return "english-primary"         # on a concept, map or debate it means a counterpart pending (§7)
        return "none"

    def side(self, name: str, lang: str) -> dict:
        """Which note the page shows for `name` in `lang`: `name` (shown), `title`, `lang` (its own), `base` (the English
        side, which the road and Explore's relations are keyed by), `other` (the counterpart not shown) and `missing`
        (None, or why the note is not in `lang`)."""
        n = self.get(name)
        if n is None:
            return {"name": name, "title": name, "lang": None, "base": name, "other": None, "missing": None}
        cp = self.counterpart(n)
        own = self.lang_of(n)
        base = cp if own == "ar" and cp is not None else n
        if own == lang:
            shown, missing = n, None
        elif cp is not None:
            shown, missing = cp, None
        else:
            shown, missing = n, self.why_english(n) if own == "en" else "none"
        other = cp if shown is n else n
        return {"name": shown["name"], "title": self.title_of(shown), "lang": self.lang_of(shown), "base": base["name"],
                "other": other["name"] if other is not None else None, "missing": missing}

    def first(self, name: str, lang: str) -> tuple[str, str] | None:
        """A note's one-line summary in `lang` when its counterpart in `lang` has one: (line, lang)."""
        n = self.get(name)
        if n is None or self.lang_of(n) == lang:
            return None
        cp = self.counterpart(n)
        return (cp["first"], lang) if cp is not None and cp["first"] else None

    def labels(self, lang: str) -> dict[str, str] | None:
        """The name the page shows for a linked note, for every note with a counterpart in `lang`: lower-case name ->
        the counterpart's name. Empty in English, where the links already say what they open; None until Explore's
        index exists."""
        if lang != "ar":
            return {}
        notes = self.explore.notes
        if not notes:
            return None
        if self._labels and self._labels[0] is notes:
            return self._labels[1]
        out = {}
        for k, n in notes.items():
            if self.lang_of(n) == "en":
                cp = self.counterpart(n)
                if cp is not None:
                    out[k] = cp["name"]
        self._labels = (notes, out)
        return out
