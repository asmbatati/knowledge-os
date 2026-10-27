"""The coach (the vault's x/SYSTEM/Study Coach Plan 2026-10.md): a study session the way the ADHD Study Coach runs one.

A session starts from the owner's goal (the next concept on the way up to it, after a short round of placement while
placement toward it is not done) or from a topic named that day. It warms up on the oldest open loop and the road's
reviews that are due, teaches a concept in chunks of at most five lines with one A–D question each, drops one step down
the prerequisite graph when the owner is stuck, closes a taught concept with its road check, and ends with a
reflection: one sentence, a teach-back compared with the note, what is still fuzzy.

What it writes: its own state (`x/reports/learning/los/coach/profile.json`), the `coach` ledger, and a `gaps.jsonl` row
for each line it taught that the note does not hold. Practice is never a verdict: the road's own pages record the
reviews, checks and placement, through the road's writers. Claude runs as the tutor runs (tutorllm.py); without it the
lesson is the note's own sections, and the page says so.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import threading
from datetime import datetime, timedelta
from pathlib import Path

from .banks import write_bank
from .card import EXCERPT, HEAD, MAX_CARD, parse_card, render_card
from .coachllm import (LESSON_SYSTEM, LETTERS, REFLECT_SYSTEM, body_of, explain_prompt, explanation_of, lesson_of,
                       lesson_prompt, note_lesson, reflect_prompt, reflection_of)
from .render import render_note

PLAN_DEFAULT = {"days": 4, "minutes": 30}
MAX_LINES, MAX_LINE = 8, 200
PLACE_ROUND = 8          # placement answers a session, within the road's own limit of 30 (PLACE_MAX)
MAX_REVIEWS = 3          # the road's due reviews a warm-up takes
MAX_DUE = 10             # ... and a road session's: all the day's plan holds (the road's own MAX_DUE)
MAX_TOPIC = 200
FACET_WORDS = {"define": "what it is", "work": "how to use it on a case", "why": "why it holds"}
SESSION_HOURS = 6
MAX_EXPLAIN = 3          # "explain more" on one step (26 Oct 2026: the owner had only the question to go forward)
MAX_ASK = 400


def agenda(minutes: int, due: int, loop: bool, placing: bool) -> dict:
    """A session's minutes: about a quarter to warm up when there is something to warm up on, a sixth (at least three)
    to reflect, the rest new: 30 minutes is about 8, 17 and 5, as the coach planned it."""
    reflect = max(3, round(minutes / 6))
    warmup = round(minutes * 0.27) if (due or loop or placing) else 0
    return {"warmup": warmup, "new": minutes - warmup - reflect, "reflect": reflect}


class CoachError(Exception):
    def __init__(self, status: int, message: str, **extra):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra


class Coach:
    def __init__(self, vault, explore, learn_dir, clock=datetime.now, llm=None, ledger=None, bank_writer=None,
                 job_running=lambda: False, place_round=PLACE_ROUND, spawn=None):
        self.vault, self.explore, self.clock, self.llm, self.ledger = vault, explore, clock, llm, ledger
        self.bank_writer, self.job_running, self.place_round = bank_writer, job_running, place_round
        self.learn = Path(learn_dir)
        self.dir = self.learn / "los" / "coach"
        self.lock = threading.RLock()
        self.sessions: dict[str, dict] = {}
        self.spawn = spawn or (lambda f: threading.Thread(target=f, daemon=True).start())
        self._banking: set[str] = set()

    # ------------------------------------------------------------------ the profile
    def profile(self) -> dict:
        p = self.dir / "profile.json"
        data = {}
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        plan = data.get("plan") if isinstance(data.get("plan"), dict) else {}
        return {"goal": str(data.get("goal") or ""),
                "plan": {"days": int(plan.get("days") or PLAN_DEFAULT["days"]),
                         "minutes": int(plan.get("minutes") or PLAN_DEFAULT["minutes"])},
                "lines": [str(x) for x in data.get("lines") or [] if str(x).strip()][:MAX_LINES],
                "created": str(data.get("created") or "")}

    def _save_profile(self, p: dict) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        path = self.dir / "profile.json"
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(p, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
        os.replace(tmp, path)

    def _concept(self, name: str) -> str:
        """A concept of the graph, by the name of its note; 400 when there is none."""
        g, _roads = self.vault.graph()
        n = g.get(str(name or "").strip())
        if n is None:
            raise CoachError(400, f"{name!r} is not a concept of the road's graph")
        return n.name

    def set_profile(self, d: dict) -> dict:
        with self.lock:
            p = self.profile()
            if "goal" in d:
                p["goal"] = self._concept(d["goal"]) if str(d.get("goal") or "").strip() else ""
            if "plan" in d:
                plan = d.get("plan") if isinstance(d.get("plan"), dict) else {}
                try:
                    days, minutes = int(plan.get("days")), int(plan.get("minutes"))
                except (TypeError, ValueError):
                    raise CoachError(400, "a plan is a number of days a week and of minutes a sitting")
                if not (1 <= days <= 7 and 10 <= minutes <= 120):
                    raise CoachError(400, "a plan is one to seven days a week, ten to 120 minutes a sitting")
                p["plan"] = {"days": days, "minutes": minutes}
            if "lines" in d:
                lines = d.get("lines") if isinstance(d.get("lines"), list) else []
                p["lines"] = [self._line(x) for x in lines if str(x).strip()][-MAX_LINES:]
            if d.get("add_line"):
                line = self._line(d["add_line"])
                p["lines"] = ([x for x in p["lines"] if x != line] + [line])[-MAX_LINES:]
            if d.get("remove_line"):
                p["lines"] = [x for x in p["lines"] if x != str(d["remove_line"]).strip()]
            p["created"] = p["created"] or self.clock().date().isoformat()
            self._save_profile(p)
            return p

    @staticmethod
    def _line(x) -> str:
        line = " ".join(str(x or "").split())
        if not line or len(line) > MAX_LINE:
            raise CoachError(400, f"a how-I-learn line is 1 to {MAX_LINE} characters")
        return line

    # ------------------------------------------------------------------ the road beneath a goal
    def next_toward(self, goal: str) -> str | None:
        """The concept a goal's session teaches next: among the goal and what it rests on, those not yet standing,
        ready ones first, then those failed and to read, then the rest, the lowest layer first. None when the goal
        stands."""
        g, _roads = self.vault.graph()
        RG = self.vault.RG
        gk = str(goal or "").lower()
        if gk not in g.nodes:
            return None
        st, stat, lay = RG.standing(g), RG.statuses(g), RG.layers(g)
        cands = [k for k in RG.closure(g, [gk]) if not st.get(k)]
        if not cands:
            return None
        rank = {"ready": 0, "to-read": 1}
        cands.sort(key=lambda k: (rank.get(stat.get(k), 2), lay.get(k, 0), k))
        return g.nodes[cands[0]].name

    def _resolve(self, topic: str) -> str | None:
        """A named topic as a concept note: by its name, else by an alias Explore's index holds."""
        hit = self.vault.known().get(topic.lower())
        if hit:
            return hit
        for n in (self.explore.notes or {}).values():
            if n["type"] == "concept" and n["rel"].startswith("Atlas/Concepts/"):
                aliases = n["fm"].get("aliases") or []
                aliases = aliases if isinstance(aliases, list) else [aliases]
                if any(str(a).strip().lower() == topic.lower() for a in aliases):
                    return n["name"]
        return None

    # ------------------------------------------------------------------ a session
    def _session(self, sid: str) -> dict:
        with self.lock:
            now = self.clock()
            for k in [k for k, s in self.sessions.items() if now - s["started"] > timedelta(hours=SESSION_HOURS)]:
                self.sessions.pop(k, None)
            s = self.sessions.get(str(sid or ""))
        if s is None:
            raise CoachError(404, "no such session: it ended, or it is older than the server")
        return s

    def _row(self, kind: str, row: dict) -> dict:
        return self.ledger.append("coach", {"type": kind, **row}, self.clock())

    def start(self, mode: str, topic: str = "", lang: str = "en") -> dict:
        """A session from the goal, from a topic named today, or through today's road (`road`, 24 Oct 2026: each of
        the day's checks taught before it is asked, after the due reviews, recalled cold; `topic` names the check to
        start from)."""
        if mode not in ("goal", "named", "road"):
            raise CoachError(400, "a session starts from the goal, from a topic named today, or from today's road")
        p = self.profile()
        topic = " ".join(str(topic or "").split())[:MAX_TOPIC]
        if mode == "goal" and not p["goal"]:
            raise CoachError(409, "set a goal first")
        if mode == "named" and not topic:
            raise CoachError(400, "name what you want to learn today")
        today = self.clock().date()
        concept = self._resolve(topic) if (mode == "named" or topic) else None
        due = [x["name"] for x in (self.vault.plan(today).get("due") or [])]
        if mode == "road":
            if topic and concept is None:
                raise CoachError(400, f"{topic!r} is not a concept note")
            if not due and not concept and not self.vault.road_today(today)["ready"]:
                raise CoachError(409, "the road has nothing to review or check today")
        loops = self.open_loops() if mode != "road" else []        # a road session is the day's road, nothing else
        placing = False
        if mode == "goal":
            try:
                placing = self.vault.place(p["goal"], today).get("kind") == "place"
            except SystemExit:
                placing = False
        ag = agenda(p["plan"]["minutes"], len(due), bool(loops), placing)
        sid = f"c-{self.clock():%Y%m%dT%H%M%S}-{secrets.token_hex(4)}"
        s = {"id": sid, "mode": mode, "goal": p["goal"] if mode == "goal" else "", "topic": topic, "concept": concept,
             "lang": lang if lang in ("en", "ar") else "en", "started": self.clock(), "agenda": ag,
             "v0": len(self.vault.verdict_rows()), "p0": len(self.vault.placement_rows()),
             "loop": loops[0] if loops else None, "loop_asked": False, "target": None, "lessons": {}, "detour": [],
             "taught": [], "teach_concept": None, "reflected": False, "cost": 0.0, "building": {},
             "prefetch": None, "first": concept if mode == "road" else None, "skipped": set(), "beyond": False,
             "review_taught": set()}
        with self.lock:
            self.sessions[sid] = s
        self._prefetch(s, len(due), placing)
        self._row("session", {"session": sid, "event": "start", "mode": mode, "goal": s["goal"], "topic": topic,
                              "concept": concept, "agenda": ag, "lang": s["lang"]})
        return {"session": sid, "agenda": ag, "mode": mode, "goal": s["goal"], "topic": topic, "concept": concept,
                "due": len(due), "loop": s["loop"], "placing": placing}

    def _prefetch(self, s: dict, due: int, placing: bool) -> None:
        """Write, in the background, the lesson the session will want first: the open loop's, else the topic named
        today, else the goal's next concept; never while a placement round may change what comes next. A lesson takes
        Claude about half a minute (measured 20 Oct 2026); this way the warm-up hides it."""
        if s["loop"]:
            args = (s["loop"].get("concept") or None, s["loop"].get("text") or "")
        elif s["mode"] == "named":
            args = (s["concept"], s["topic"])
        elif s["mode"] == "road":
            first = self._road_next(s, self.clock().date())
            if not isinstance(first, str):
                return
            args = (first, "")
        elif not placing:
            args = (self.next_toward(s["goal"]), "")
        else:
            return
        if not args[0] and not args[1]:
            return
        s["prefetch"] = (args[0] or f"topic:{args[1]}").lower()
        self.spawn(lambda: self._lesson(s, *args))

    def _since(self, s: dict) -> tuple[list[dict], list[dict]]:
        """The road's verdict and placement rows written since the session started (both ledgers are append-only)."""
        return self.vault.verdict_rows()[s["v0"]:], self.vault.placement_rows()[s["p0"]:]

    def _target(self, s: dict) -> tuple:
        """What the session teaches after its warm-up: the goal's next concept, or the topic named today, as (concept
        or None, focus). Fixed the first time it is asked, after the reviews, the placement round and the open loop."""
        if s["target"] is None:
            s["target"] = (self.next_toward(s["goal"]), "") if s["mode"] == "goal" else (s["concept"], s["topic"])
        return s["target"]

    def step(self, sid: str, to_reflect: bool = False) -> dict:
        """The session's next step: a review, a placement question, a lesson, the open loop's question, the taught
        concept's road check, the reflection, or done. A road step is done when the road's own ledger shows it."""
        s = self._session(sid)
        if True:                                          # no lock here: a lesson is written outside it (_lesson)
            if s["reflected"]:
                return {"kind": "done"}
            if to_reflect or s.get("stopping"):           # "stop and reflect": whatever is left becomes an open loop
                s["stopping"] = True
                return {"kind": "reflect", "concepts": self._learned(s), "early": True}
            today = self.clock().date()
            verdicts, places = self._since(s)
            reviewed = {str(r.get("concept", "")).lower() for r in verdicts if r.get("kind") == "review"}
            road = s["mode"] == "road"
            # a road session takes every review the day's plan holds, recalled cold before anything is taught; a
            # lesson written ahead in the background does not end its warm-up, only one shown does
            if (not s["taught"] if road else not s["lessons"]) and len(reviewed) < (MAX_DUE if road else MAX_REVIEWS):
                due = [x["name"] for x in (self.vault.plan(today).get("due") or []) if x["name"].lower() not in reviewed]
                if due:
                    return {"kind": "review", "concept": due[0], "left": len(due)}
            if road:
                return self._road_step(s, verdicts, today)
            if s["mode"] == "goal" and not s["lessons"]:
                placed = sum(1 for r in places if r.get("kind") == "place"
                             and str(r.get("goal", "")).lower() == s["goal"].lower())
                if placed < self.place_round:
                    try:
                        nx = self.vault.place(s["goal"], today)
                    except SystemExit:
                        nx = {"kind": "done"}
                    if nx.get("kind") == "place":
                        return {"kind": "place", "goal": s["goal"], "concept": nx["concept"], "bank": nx.get("bank"),
                                "asked": nx.get("asked"), "round": self.place_round, "placed": placed}
            while s["detour"]:
                below, above = s["detour"][-1]
                les = self._lesson(s, below, "", stuck_on=above)
                if not les["complete"]:
                    return self._shown(s, les)
                s["detour"].pop()
            if s["loop"] and not s["loop_asked"]:      # the oldest open loop, taught first, then asked about
                loop = s["loop"]
                les = self._lesson(s, loop.get("concept") or None, loop.get("text") or "")
                if not les["complete"]:
                    s["teach_concept"] = les["concept"] or s["teach_concept"]
                    return self._shown(s, les)
                return {"kind": "loop", "loop": loop}
            concept, focus = self._target(s)
            les = self._lesson(s, concept, focus)
            if not les["complete"]:
                s["teach_concept"] = concept or s["teach_concept"]
                return self._shown(s, les)
            if not les["chunks"] and not les.get("shown"):
                les["shown"] = True             # nothing to teach (no note, no Claude): the page says so, once
                return {**self._shown(s, les), "empty": "no_note" if not concept else "empty_note"}
            if concept:
                g, _roads = self.vault.graph()
                stat = self.vault.RG.statuses(g)
                k = concept.lower()
                checked = any(str(r.get("concept", "")).lower() == k and r.get("kind") == "check" for r in verdicts)
                if k in g.nodes and stat.get(k) in ("ready", "to-read") and not checked:
                    return {"kind": "check", "concept": concept, "status": stat.get(k)}
            return {"kind": "reflect", "concepts": self._learned(s)}

    # ------------------------------------------------------------------ a session through today's road
    def _road_next(self, s: dict, today, verdicts=None):
        """The check a road session teaches next: the one it was opened on, then a failed check whose day to be checked
        again has come (the plan's readings: the lesson is the reading), then the road's ready checks in its order;
        none checked or skipped in this session. When the day's quota of new checks is met, a `more` step asks first
        whether to go on; None when nothing is left."""
        verdicts = self._since(s)[0] if verdicts is None else verdicts
        checked = {str(r.get("concept", "")).lower() for r in verdicts if r.get("kind") == "check"}
        t = self.vault.road_today(today)
        offered = {x.lower() for x in t["ready"] + t["rechecks"]}

        def open_(name):
            return bool(name) and name.lower() in offered and name.lower() not in checked | s["skipped"]
        if open_(s["first"]):
            return s["first"]
        again = next((n for n in t["rechecks"] if open_(n)), None)
        if again:
            return again
        nxt = next((n for n in t["ready"] if open_(n)), None)
        if nxt and t["checked_today"] >= t["quota"] and not s["beyond"]:
            return {"kind": "more", "checked": t["checked_today"], "quota": t["quota"], "next": nxt}
        return nxt

    def _road_step(self, s: dict, verdicts: list[dict], today) -> dict:
        """A road session after its warm-up: a short lesson on what each review missed, then the day's checks, each
        taught and then asked through the road's own check page, until the learner stops."""
        for r in verdicts:
            missed = self.vault.R.missed_facets(r) if r.get("kind") == "review" else []
            k = str(r.get("concept", "")).lower()
            if missed and k not in s["review_taught"]:
                focus = "what I missed when I recalled it: " + ", ".join(FACET_WORDS.get(f, f) for f in missed)
                les = self._lesson(s, r["concept"], focus)
                if not les["complete"]:
                    s["teach_concept"] = les["concept"] or s["teach_concept"]
                    return self._shown(s, les)
                s["review_taught"].add(k)
        while s["detour"]:
            below, above = s["detour"][-1]
            les = self._lesson(s, below, "", stuck_on=above)
            if not les["complete"]:
                return self._shown(s, les)
            s["detour"].pop()
        nxt = self._road_next(s, today, verdicts)
        if isinstance(nxt, dict):
            return nxt
        if nxt is None:
            return {"kind": "reflect", "concepts": self._learned(s)}
        les = self._lesson(s, nxt, "")
        if not les["complete"]:
            s["teach_concept"] = nxt
            return self._shown(s, les)
        if not les["chunks"] and not les.get("shown"):
            les["shown"] = True
            return {**self._shown(s, les), "empty": "empty_note"}
        self._prefetch_after(s, today, nxt)
        g, _roads = self.vault.graph()
        return {"kind": "check", "concept": nxt, "status": self.vault.RG.statuses(g).get(nxt.lower())}

    def _prefetch_after(self, s: dict, today, current: str) -> None:
        """While the learner takes one check, the next check's lesson is written in the background."""
        nxt = self._road_next(dict(s, skipped=s["skipped"] | {current.lower()}), today)
        if isinstance(nxt, str) and nxt.lower() not in s["lessons"] and nxt.lower() not in s["building"]:
            self.spawn(lambda: self._lesson(s, nxt, ""))

    def more(self, sid: str) -> dict:
        """"Go on" once the day's quota of new checks is met: the session teaches the road's next checks too."""
        s = self._session(sid)
        if s["mode"] != "road":
            raise CoachError(400, "only a session through the road goes on to its next checks")
        s["beyond"] = True
        self._row("road", {"session": s["id"], "event": "more"})
        return {"ok": True}

    def skip(self, sid: str, concept: str) -> dict:
        """Step past a check the session cannot take now (its bank cannot be written yet): it stays on the road."""
        s = self._session(sid)
        name = self._concept(concept)
        s["skipped"].add(name.lower())
        self._row("road", {"session": s["id"], "event": "skip", "concept": name})
        return {"skipped": name}

    def _requires(self, concept) -> list[str]:
        """What a concept rests on, one line each: its prerequisites' one-sentence summaries."""
        if not concept:
            return []
        g, _roads = self.vault.graph()
        k = concept.lower()
        if k not in g.nodes:
            return []
        out = []
        for pk in g.prereq_keys(k):
            name = g.nodes[pk].name
            out.append(f"{name}: {self.vault.concept_meta(name)['abstract'] or '(no summary in its note)'}")
        return out

    def _lesson(self, s: dict, concept, focus: str, stuck_on: str = "") -> dict:
        """A concept's or a topic's lesson, written once a session: by Claude from the note when Claude can be asked,
        else the note's own sections. Its chunks go to the ledger, each line the note does not hold to gaps.jsonl."""
        key = (concept or f"topic:{focus}").lower()
        with self.lock:
            les = s["lessons"].get(key)
            if les is not None:
                return les
            ev = s["building"].get(key)
            mine = ev is None
            if mine:
                ev = s["building"][key] = threading.Event()
        if not mine:                                      # written already, in the background: wait for it
            ev.wait(timeout=600)
            with self.lock:
                les = s["lessons"].get(key)
            if les is not None:
                return les
        try:
            return self._build_lesson(s, key, concept, focus, stuck_on)
        finally:
            with self.lock:
                s["building"].pop(key, None)
            ev.set()

    def _build_lesson(self, s: dict, key: str, concept, focus: str, stuck_on: str) -> dict:
        note = self.vault.note_text(concept) if concept else None
        built, claude, cost = None, False, 0.0
        ok, code = self.llm.available() if self.llm else (False, "no_cli")
        if ok:
            ask = focus if focus and focus.lower() != str(concept or "").lower() else ""
            before = self.before_lines(self.history(concept, exclude=s["id"])) if concept and not stuck_on else []
            try:
                v = self.llm.call(LESSON_SYSTEM, lesson_prompt(concept or focus, note or "", self.profile()["lines"],
                                                               self._requires(concept), ask, s["lang"], stuck_on,
                                                               before))
                cost = float(v.get("_cost_usd") or 0)
                built, claude, code = lesson_of(v, note or ""), True, ""
            except Exception:
                code = "unreachable"
        if built is None:
            built = note_lesson(note) if note else {"title": focus, "chunks": []}
        les = {"key": key, "concept": concept, "focus": focus, "title": built["title"] or concept or focus,
               "chunks": built["chunks"], "answered": {}, "claude": claude, "why_code": code, "blanks": 0,
               "for": stuck_on}
        les["complete"] = not les["chunks"]
        known = self.vault.known()
        assets = self.vault.assets() if hasattr(self.vault, "assets") else None
        for c in les["chunks"]:                           # rendered before anyone can see the lesson
            c["html"] = render_note(c["text"], known, assets)
        with self.lock:
            if key in s["lessons"]:                       # someone else's, finished first
                return s["lessons"][key]
            s["lessons"][key] = les
            s["cost"] += cost
        rel = f"{self.vault.RG.CONCEPT_DIR}/{concept}.md" if concept else ""
        gaps = []
        for c in les["chunks"]:
            self._row("chunk", {"session": s["id"], "concept": concept, "n": c["n"], "text": c["text"],
                                "source": c["source"], "quote": c.get("quote", ""), "memorize": c.get("memorize", ""),
                                "focus": focus, "cost_usd": cost if c["n"] == 1 else 0})
            if c["source"] == "claude":
                gaps.append({"date": self.clock().date().isoformat(), "rel": rel, "name": concept or focus,
                             "gap": " ".join(c["text"].split())[:300], "source": "coach", "session": s["id"]})
        if gaps:
            path = self.learn / "gaps.jsonl"
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "a", encoding="utf-8", newline="\n") as f:
                for g in gaps:
                    f.write(json.dumps(g, ensure_ascii=False) + "\n")
        if concept:
            self._bank_soon(concept)
        return les

    def _bank_soon(self, concept: str) -> None:
        """The bank a concept's road check will need, written while it is taught: only when Claude may be asked (not
        in the night jobs' hours, not with Claude off in the settings), never while a vault job runs, never twice at
        once. A failure is in the banks ledger, and the check page's own button stays."""
        g, _roads = self.vault.graph()
        if (self.bank_writer is None or concept.lower() not in g.nodes or self.vault.bank(concept) is not None
                or concept in self._banking or self.job_running()):
            return
        if not (self.llm and self.llm.available()[0]):
            return
        self._banking.add(concept)

        def run():
            try:
                write_bank(self.vault, self.bank_writer, self.ledger, concept, self.clock())
            except Exception:
                pass
            finally:
                self._banking.discard(concept)
        self.spawn(run)

    @staticmethod
    def _learned(s: dict) -> list[str]:
        """The concepts the learner actually took, in the order they were taught: a lesson with at least one step
        answered or read. A lesson shown and left before its first step (stopped as it appeared) is not among them, so
        the teach-back is never asked about it (26 Oct 2026: stopping as Relations opened judged a teach-back of Power
        sets against Relations)."""
        done = {str(les["concept"]).lower() for les in s["lessons"].values() if les["concept"] and les["answered"]}
        return [c for c in s["taught"] if c.lower() in done]

    def _shown(self, s: dict, les: dict) -> dict:
        """A lesson about to reach the page: its concept is now among what the session taught."""
        if les["concept"] and les["concept"] not in s["taught"]:
            s["taught"].append(les["concept"])
        return self._public(les)

    @staticmethod
    def _public(les: dict) -> dict:
        """A lesson as the page sees it: never a key, an explanation or a worked answer before the answer."""
        chunks = []
        for c in les["chunks"]:
            q = c.get("question")
            chunks.append({"n": c["n"], "html": c["html"], "source": c["source"], "memorize": c.get("memorize", ""),
                           "question": {"stem": q["stem"], "choices": q["choices"]} if q else None})
        return {"kind": "lesson", "lesson": les["key"], "for": les.get("for", ""),
                "concept": les["concept"], "focus": les["focus"], "title": les["title"],
                "claude": les["claude"], "why_code": les.get("why_code", ""), "chunks": chunks,
                "answered": les["answered"]}

    # ------------------------------------------------------------------ answers, and the step down when stuck
    def _prereq_for(self, concept: str) -> str | None:
        """Where to go when stuck on a concept: what it rests on that does not stand yet, the lowest layer first; else
        the lowest-layer of what it rests on. None for an axiom."""
        g, _roads = self.vault.graph()
        RG = self.vault.RG
        k = concept.lower()
        if k not in g.nodes:
            return None
        pre = g.prereq_keys(k)
        if not pre:
            return None
        st, lay = RG.standing(g), RG.layers(g)
        pre.sort(key=lambda p: (bool(st.get(p)), lay.get(p, 0), p))
        return g.nodes[pre[0]].name

    def answer(self, sid: str, lesson: str, n, choice: str) -> dict:
        """One answer to a chunk's question: a letter, or `blank` ("I'm blanking, show me"), or `seen` for a chunk with
        no question. Two blanks in one lesson take the session one step down the graph. Practice, never a verdict."""
        s = self._session(sid)
        with self.lock:
            les = s["lessons"].get(str(lesson or "").lower())
            if les is None:
                raise CoachError(404, "no such lesson in this session")
            try:
                c = next(c for c in les["chunks"] if c["n"] == int(n))
            except (StopIteration, TypeError, ValueError):
                raise CoachError(404, "no such chunk in this lesson")
            if str(c["n"]) in les["answered"]:
                raise CoachError(409, "this chunk is answered")
            choice = str(choice or "").strip()
            q = c.get("question")
            if q is None:
                if choice != "seen":
                    raise CoachError(400, "this chunk has no question: it is only read")
                res = {"seen": True, "stuck": None}
                # a read step is kept, so the lecture note knows the lesson was taken (the vault's _coach_apply.py)
                self._row("read", {"session": s["id"], "concept": les["concept"], "n": c["n"]})
            else:
                letters = LETTERS[:len(q["choices"])]
                if choice != "blank" and choice.upper() not in letters:
                    raise CoachError(400, f"answer with one of {', '.join(letters)}, or blank")
                blank = choice == "blank"
                chosen = "blank" if blank else choice.upper()
                correct = not blank and chosen == q["key"]
                res = {"correct": correct, "blank": blank, "key": q["key"],
                       "why": "" if blank else q["why"].get(chosen, ""),
                       "why_key": q["why"].get(q["key"], ""),
                       "worked": q["worked"] if not correct else "", "stuck": None}
                if blank:
                    les["blanks"] += 1
                self._row("practice", {"session": s["id"], "concept": les["concept"], "n": c["n"], "stem": q["stem"],
                                       "choices": q["choices"], "key": q["key"], "chosen": chosen, "correct": correct,
                                       "source": c["source"]})
            les["answered"][str(c["n"])] = res
            les["complete"] = len(les["answered"]) == len(les["chunks"])
            if les["blanks"] >= 2 and not les.get("detoured") and les["concept"]:
                to = self._prereq_for(les["concept"])
                if to and all(to != d[0] for d in s["detour"]):
                    les["detoured"] = True
                    s["detour"].append((to, les["concept"]))
                    res["stuck"] = {"to": to}
                    self._row("stuck", {"session": s["id"], "from": les["concept"], "to": to, "why": "blank"})
            return res

    def explain(self, sid: str, lesson: str, n, ask: str = "") -> dict:
        """"Explain more" on one step (26 Oct 2026: a step's question was the only way forward): the same idea again,
        another way, from the note first, with a new example and an answer to what the learner asked; never the answer
        to the step's question. At most three a step; a try that gave nothing does not count. Practice, never a verdict;
        what the note does not hold goes to gaps.jsonl, as a lesson's lines do."""
        s = self._session(sid)
        ask = " ".join(str(ask or "").split())[:MAX_ASK]
        with self.lock:
            les = s["lessons"].get(str(lesson or "").lower())
            if les is None:
                raise CoachError(404, "no such lesson in this session")
            try:
                c = next(c for c in les["chunks"] if c["n"] == int(n))
            except (StopIteration, TypeError, ValueError):
                raise CoachError(404, "no such chunk in this lesson")
            n = str(c["n"])
            used = les.setdefault("explained", {}).get(n, 0)
            if used >= MAX_EXPLAIN:
                raise CoachError(429, f"{MAX_EXPLAIN} explanations is the most one step gets: answer it, or keep what is "
                                      "still unclear for the reflection")
            les["explained"][n] = used + 1
            q, answered = c.get("question"), n in les["answered"]

        def nothing(code: str) -> dict:
            with self.lock:
                les["explained"][n] = used
            return {"html": "", "source": "", "why_code": code, "left": MAX_EXPLAIN - used}

        ok, code = self.llm.available() if self.llm else (False, "no_cli")
        if not ok:
            return nothing(code)
        concept = les["concept"]
        note = self.vault.note_text(concept) if concept else None
        hidden = q if q and not answered else None          # an answered question can be talked about freely
        key_choice = q["choices"][LETTERS.index(q["key"])] if hidden else ""
        try:
            v = self.llm.call(LESSON_SYSTEM, explain_prompt(concept or les["focus"] or les["title"], c["text"], hidden,
                                                            ask, note or "", self.profile()["lines"], s["lang"]))
            ex = explanation_of(v, note or "", key_choice)
        except Exception:
            return nothing("unreachable")
        cost = float(v.get("_cost_usd") or 0)
        html = render_note(ex["text"], self.vault.known(), self.vault.assets() if hasattr(self.vault, "assets") else None)
        with self.lock:
            s["cost"] += cost
        self._row("explain", {"session": s["id"], "concept": concept, "n": c["n"], "ask": ask, "text": ex["text"],
                              "source": ex["source"], "quote": ex["quote"], "cost_usd": cost})
        if ex["source"] == "claude":
            path = self.learn / "gaps.jsonl"
            path.parent.mkdir(parents=True, exist_ok=True)
            rel = f"{self.vault.RG.CONCEPT_DIR}/{concept}.md" if concept else ""
            with open(path, "a", encoding="utf-8", newline="\n") as f:
                f.write(json.dumps({"date": self.clock().date().isoformat(), "rel": rel, "name": concept or les["focus"],
                                    "gap": " ".join(ex["text"].split())[:300], "source": "coach-explain",
                                    "session": s["id"]}, ensure_ascii=False) + "\n")
        return {"html": html, "source": ex["source"], "why_code": "", "left": MAX_EXPLAIN - used - 1}

    # ------------------------------------------------------------------ the open loop, the reflection, the end
    def loop(self, sid: str, loop_id: str, clear: bool) -> dict:
        """The answer to "is it clear now?" after the open loop's lesson: clear closes it; not yet keeps it open."""
        s = self._session(sid)
        with self.lock:
            if not s["loop"] or s["loop"]["id"] != loop_id:
                raise CoachError(404, "this session did not open with that loop")
            s["loop_asked"] = True
            if clear:
                self._row("loop", {"session": s["id"], "event": "close", "loop": loop_id, "text": s["loop"]["text"],
                                   "concept": s["loop"].get("concept")})
            return {"closed": bool(clear)}

    def reflect(self, sid: str, sentence: str, teachback: str, fuzzy: str, concept: str = "") -> dict:
        """The closing three: today in one sentence, a teach-back (compared with the note by Claude, never a verdict),
        what is still fuzzy (an open loop). The texts are kept as typed. The teach-back is about the concept the learner
        picked among those the session actually taught, else the last of them; never a lesson they did not take."""
        s = self._session(sid)
        clip = lambda t, n: str(t or "").strip()[:n]
        sentence, teachback, fuzzy = clip(sentence, 600), clip(teachback, 4000), clip(fuzzy, 600)
        with self.lock:
            learned = self._learned(s)
            want = str(concept or "").strip().lower()
            main = s["teach_concept"] if s["teach_concept"] in learned else None    # not a step-down lesson below it
            concept = (next((c for c in learned if c.lower() == want), None) or main
                       or (learned[-1] if learned else None))
            note = self.vault.note_text(concept) if concept else None
            res = {"grade": "", "refinement": "", "missing": [], "propose": "", "compare": "", "why_code": ""}
            ok, code = self.llm.available() if self.llm else (False, "no_cli")
            if ok and teachback:
                answers = [a for les in s["lessons"].values() for a in les["answered"].values() if "correct" in a]
                stats = (f"{sum(1 for a in answers if a['correct'])} right, "
                         f"{sum(1 for a in answers if a.get('blank'))} blank, "
                         f"{sum(1 for a in answers if not a['correct'] and not a.get('blank'))} wrong, "
                         f"of {len(answers)}")
                try:
                    v = self.llm.call(REFLECT_SYSTEM, reflect_prompt(concept or s["topic"], note or "", sentence,
                                                                     teachback, stats, self.profile()["lines"],
                                                                     s["lang"]))
                    s["cost"] += float(v.get("_cost_usd") or 0)
                    res.update(reflection_of(v))
                except Exception:
                    code = "unreachable"
            if not res["grade"]:
                res["why_code"] = code
                res["compare"] = self.vault.concept_meta(concept)["abstract"] if concept else ""
            self._row("reflect", {"session": s["id"], "concept": concept, "sentence": sentence, "teachback": teachback,
                                  "fuzzy": fuzzy, "grade": res["grade"], "refinement": res["refinement"],
                                  "missing": res["missing"]})
            if teachback:
                self._row("teachback", {"session": s["id"], "concept": concept, "text": teachback})
            if fuzzy:
                self._row("loop", {"session": s["id"], "event": "open", "text": fuzzy, "concept": concept})
            s["reflected"] = True
            res["concept"] = concept or ""
            return res

    def end(self, sid: str) -> dict:
        """The session's end, kept with what was taught, how long it took and what Claude cost; and the next day the
        plan studies."""
        s = self._session(sid)
        with self.lock:
            now = self.clock()
            minutes = max(1, round((now - s["started"]).total_seconds() / 60))
            learned = self._learned(s)
            first = next((les for les in s["lessons"].values() if les["answered"]), None)
            title = ((first["title"] if first else "") or (learned[0] if learned else "") or s["topic"] or s["goal"]
                     or "Study session")
            days = self.profile()["plan"]["days"]
            next_day = (now.date() + timedelta(days=max(1, 7 // max(1, days)))).isoformat()
            cost = round(s["cost"], 4)
            self._row("session", {"session": s["id"], "event": "end", "minutes": minutes, "title": title,
                                  "concepts": learned, "cost_usd": cost, "source": "site"})
            self.sessions.pop(s["id"], None)
            return {"minutes": minutes, "title": title, "concepts": learned, "next_day": next_day, "cost_usd": cost}

    # ------------------------------------------------------------------ the portable card (card.py)
    def _domain(self, name) -> str:
        text = self.vault.note_text(name) if name else None
        return str(self.vault.L.fm_scalars(text).get("domain") or "") if text else ""

    def _toward(self, goal: str, n: int = 3) -> list[str]:
        """The first `n` concepts a goal's sessions will teach, in next_toward's order."""
        g, _roads = self.vault.graph()
        RG = self.vault.RG
        gk = str(goal or "").lower()
        if gk not in g.nodes:
            return []
        st, stat, lay = RG.standing(g), RG.statuses(g), RG.layers(g)
        rank = {"ready": 0, "to-read": 1}
        cands = sorted((k for k in RG.closure(g, [gk]) if not st.get(k)),
                       key=lambda k: (rank.get(stat.get(k), 2), lay.get(k, 0), k))
        return [g.nodes[k].name for k in cands[:n]]

    def _excerpt(self, name: str) -> str:
        """A note's one sentence, its definition and its worked example, as the phone's lesson starts from them."""
        note = body_of(self.vault.note_text(name) or "")
        parts = []
        meta = self.vault.concept_meta(name)
        if meta["abstract"]:
            parts.append(meta["abstract"])
        for head in ("Definition", "Worked example", "Intuition"):
            m = re.search(rf"^## +{head}\s*\n(.*?)(?=^## |\Z)", note, re.M | re.S | re.I)
            if m and m.group(1).strip():
                parts.append(f"{head}: " + m.group(1).strip())
        return "\n\n".join(parts)[:EXCERPT]

    def card(self, lang: str = "en") -> str:
        """The portable card: the profile, the topics taught and imported, the next lessons toward the goal with their
        notes' excerpts, the open loops, the recent sessions, and an empty NEW SINCE EXPORT for the phone to fill."""
        p = self.profile()
        g, _roads = self.vault.graph()
        rows = self.ledger.rows("coach")
        ends = [r for r in rows if r.get("type") == "session" and r.get("event") == "end"]
        topics: dict[str, dict] = {}
        for r in rows:
            if r.get("type") == "topic":
                topics[str(r.get("topic", "")).lower()] = {k: r.get(k) for k in ("subject", "topic", "last", "due",
                                                                                    "gap", "streak", "misses", "key")}
        for r in ends:
            for name in r.get("concepts") or []:
                n = g.nodes.get(str(name).lower())
                misses = sum(1 for x in rows if x.get("type") == "practice" and x.get("concept") == name
                             and not x.get("correct"))
                topics[str(name).lower()] = {
                    "subject": self._domain(name), "topic": name, "last": r.get("date"),
                    "due": n.next_review.isoformat() if n is not None and n.next_review else "",
                    "gap": n.interval_days if n is not None else 0, "streak": n.recalls if n is not None else 0,
                    "misses": misses, "key": self.vault.concept_meta(name)["abstract"]}
        recent = []
        for r in ends[-10:]:
            mine = [x for x in rows if x.get("session") == r.get("session")]
            prac = [x for x in mine if x.get("type") == "practice"]
            right = sum(1 for x in prac if x.get("correct"))
            stumbles = ", ".join(sorted({str(x.get("concept") or x.get("topic") or "") for x in prac
                                         if not x.get("correct")} - {""}))
            opened = "; ".join(x.get("text", "") for x in mine if x.get("type") == "loop" and x.get("event") == "open")
            first = (r.get("concepts") or [""])[0]
            recent.append({"date": r.get("date"), "subject": self._domain(first), "topic": r.get("title"),
                           "stumbles": (f"{stumbles}; " if stumbles else "") + f"{right} solid", "open": opened})
        subjects = sorted({t["subject"] for t in topics.values() if t.get("subject")} | (
            {self._domain(p["goal"])} - {""} if p["goal"] else set()))
        state = {"exported": self.clock().strftime("%Y-%m-%d %H:%M"), "sessions": len(ends), "subjects": subjects,
                 "goal": p["goal"], "plan": p["plan"], "lines": p["lines"], "topics": list(topics.values())[-12:],
                 "lessons": [{"concept": c, "text": self._excerpt(c)} for c in self._toward(p["goal"])] if p["goal"] else [],
                 "loops": [{"date": x["date"], "text": x["text"]} for x in self.open_loops()], "recent": recent}
        return render_card(state)

    def import_card(self, text: str) -> dict:
        """A card pasted on Today, as data. The card's own NEW SINCE EXPORT rows come home as practice, teach-backs,
        open loops and gaps marked `source: card`, under a session titled *On the phone*; a foreign card (the coach's
        own, from ChatGPT) brings its topics and open loops, and proposes its plan and lines. Never a verdict."""
        text = str(text or "")
        if len(text) > MAX_CARD:
            raise CoachError(413, f"a card is at most {MAX_CARD} characters")
        try:
            c = parse_card(text)
        except ValueError as e:
            raise CoachError(400, str(e))
        with self.lock:
            if c["hash"] in {r.get("hash") for r in self.ledger.rows("coach") if r.get("type") == "card"}:
                raise CoachError(409, "this card was brought home already")
            ours = HEAD in text
            concepts, added = [], []
            open_now = {x["text"] for x in self.open_loops()}
            by_day: dict[str, list] = {}
            for x in c["new"]:
                by_day.setdefault(x["date"], []).append(x)
            for day, items in sorted(by_day.items()):
                sid = f"card-{c['hash']}-{day}"
                names = []
                self._row("session", {"session": sid, "event": "start", "mode": "card", "date_of": day, "source": "card"})
                for x in items:
                    concept = self._resolve(x["topic"]) if x["topic"] else None
                    names.append(concept or x["topic"])
                    if concept and concept not in concepts:
                        concepts.append(concept)
                    self._row("practice", {"session": sid, "concept": concept, "topic": x["topic"], "grade": x["grade"],
                                           "correct": x["grade"] == "solid", "chosen": x["grade"], "source": "card"})
                    if x["teachback"]:
                        self._row("teachback", {"session": sid, "concept": concept, "topic": x["topic"],
                                                "text": x["teachback"], "source": "card"})
                    if x["fuzzy"]:
                        loop = x["fuzzy"] if concept else f"{x['topic']}: {x['fuzzy']}"
                        if loop not in open_now:
                            self._row("loop", {"session": sid, "event": "open", "text": loop, "concept": concept,
                                               "source": "card"})
                            open_now.add(loop)
                            added.append(loop)
                    if x["not_in_notes"]:
                        self._gap(concept, x["topic"], x["not_in_notes"], sid, "card")
                self._row("session", {"session": sid, "event": "end", "minutes": None, "source": "card",
                                      "title": "On the phone: " + ", ".join(dict.fromkeys(names)), "date_of": day,
                                      "concepts": [n for n in dict.fromkeys(names) if n in concepts]})
            if not ours:
                for t in c["topics"]:
                    concept = self._resolve(t["topic"])
                    if concept and concept not in concepts:
                        concepts.append(concept)
                    self._row("topic", {"topic": t["topic"], "concept": concept, "subject": t["subject"],
                                        "key": t["key"], "last": t["last"], "due": t["due"], "source": "card"})
                for loop in c["loops"]:
                    if loop not in open_now:
                        self._row("loop", {"session": "", "event": "open", "text": loop, "concept": None, "source": "card"})
                        open_now.add(loop)
                        added.append(loop)
            self._row("card", {"event": "import", "hash": c["hash"], "rows": len(c["new"]), "ours": ours})
            p = self.profile()
            have = {x.strip().lower() for line in p["lines"] for x in line.split(";")}
            propose = {"plan": c["plan"] if c["plan"] and c["plan"] != p["plan"] else None,
                       "lines": [x for x in c["lines"] if x.strip().lower() not in have][:MAX_LINES],
                       "goal": None}
            if c["goal"] and not ours:
                try:
                    goal = self._concept(c["goal"])
                    propose["goal"] = goal if goal != p["goal"] else None
                except CoachError:
                    pass
            return {"rows": len(c["new"]), "concepts": concepts, "loops": added, "propose": propose}

    def studied_elsewhere(self) -> list[str]:
        """Concepts a card brought home whose road check is open now and has not been taken since."""
        rows = [r for r in self.ledger.rows("coach") if r.get("source") == "card" and r.get("concept")
                and r.get("type") in ("practice", "topic")]
        if not rows:
            return []
        g, _roads = self.vault.graph()
        stat = self.vault.RG.statuses(g)
        checked = {(str(r.get("concept", "")).lower(), r.get("date", "")) for r in self.vault.verdict_rows()
                   if r.get("kind") == "check"}
        out = []
        for r in rows:
            k = str(r["concept"]).lower()
            if k in g.nodes and stat.get(k) in ("ready", "to-read") and r["concept"] not in out \
                    and not any(c == k and d >= r.get("date", "") for c, d in checked):
                out.append(r["concept"])
        return out

    def _gap(self, concept, topic: str, text: str, sid: str, source: str) -> None:
        path = self.learn / "gaps.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        row = {"date": self.clock().date().isoformat(),
               "rel": f"{self.vault.RG.CONCEPT_DIR}/{concept}.md" if concept else "", "name": concept or topic,
               "gap": " ".join(str(text).split())[:300], "source": source, "session": sid}
        with open(path, "a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    # ------------------------------------------------------------------ what the coach has done on a concept
    def history(self, concept: str, exclude: str = "") -> dict | None:
        """The coached sessions on a concept, from the coach's ledger (26 Oct 2026): how many, the last day, the
        questions answered and right, and the last teach-back's grade, refinement and missing points; with the
        questions missed and what was left fuzzy, for the next lesson to build on. None when never coached."""
        k = str(concept or "").strip().lower()
        if not k or not self.ledger:
            return None
        sessions, asked, right, missed, last = {}, 0, 0, [], None
        for r in self.ledger.rows("coach"):
            sid = str(r.get("session") or "")
            if not sid or sid == exclude or str(r.get("concept") or "").lower() != k:
                continue
            kind = r.get("type")
            if kind not in ("practice", "reflect", "read"):     # a step taken; a lesson written ahead is not
                continue
            sessions[sid] = r.get("date") or sessions.get(sid)
            if kind == "practice":
                asked += 1
                if r.get("correct"):
                    right += 1
                elif r.get("stem"):
                    missed.append(" ".join(str(r["stem"]).split())[:200])
            elif kind == "reflect" and (r.get("teachback") or r.get("sentence") or r.get("fuzzy")):
                last = r
        if not sessions:
            return None
        out = {"sessions": len(sessions), "last": max(d for d in sessions.values() if d) if any(sessions.values())
               else None, "asked": asked, "right": right, "missed": missed[-3:], "grade": "", "refinement": "",
               "missing": [], "fuzzy": ""}
        if last:
            out.update({"grade": last.get("grade") or "", "refinement": last.get("refinement") or "",
                        "missing": list(last.get("missing") or [])[:3], "fuzzy": last.get("fuzzy") or ""})
        return out

    @staticmethod
    def before_lines(h: dict | None) -> list[str]:
        """A concept's coaching history as the lines the next lesson builds on."""
        if not h:
            return []
        out = [f"coached {h['sessions']} time(s) before; {h['right']} of {h['asked']} questions right"]
        out += [f"missed the question: {m}" for m in h["missed"]]
        if h["grade"]:
            out.append(f"their teach-back was {h['grade']}")
        if h["refinement"]:
            out.append(f"the refinement they were given: {h['refinement']}")
        out += [f"their teach-back missed: {m}" for m in h["missing"]]
        if h["fuzzy"]:
            out.append(f"they said this stayed fuzzy: {h['fuzzy']}")
        return out

    # ------------------------------------------------------------------ open loops
    def open_loops(self) -> list[dict]:
        """What the owner said was still fuzzy and no session has closed, oldest first."""
        rows = [r for r in self.ledger.rows("coach") if r.get("type") == "loop"] if self.ledger else []
        closed = {r.get("loop") for r in rows if r.get("event") == "close"}
        return [{"id": r["id"], "text": r.get("text", ""), "concept": r.get("concept"), "date": r.get("date")}
                for r in rows if r.get("event") == "open" and r["id"] not in closed]
