"""The course tutor's selftest (`python server.py --selftest tutor`), on the demo vault, with no Claude call.

A course is read from the vault (a card and the lecture notes that name it) or typed as a syllabus; the learner's
dates are the site's own state; before a lecture, after it, and before an exam the tutor reads the road and the notes
and invents nothing; Claude's prompts carry the notes and the learner's words as data; a practice exam is graded on
the server and never becomes a verdict; and no note is ever written.
"""
from __future__ import annotations

import json
import re
import tempfile
import threading
from datetime import datetime
from pathlib import Path

from .selftest import Client, check

CARD = "Numbers - A Demo Course"
PAPER = "Counting in Practice"


class FakeLLM:
    """Records every call; answers with what the test sets."""
    name = "fake"

    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.reply: dict = {}
        self.down = ""

    def available(self):
        return (False, self.down) if self.down else (True, "")

    def call(self, system: str, prompt: str) -> dict:
        self.calls.append((system, prompt))
        return dict(self.reply)


def _notes_signature(root: Path) -> dict:
    return {str(p): (p.stat().st_mtime_ns, p.stat().st_size) for p in root.rglob("*.md")}


def _verdicts_signature(learn: Path) -> dict:
    return {str(p): p.read_bytes() for p in learn.glob("road-verdicts-*.jsonl")}


def group_tutor(ctx) -> None:
    from . import demo
    from .grade import FakeGrader
    from .ledger import Ledger
    from .vault import Vault

    try:
        from .tutor import Tutor, TutorError
        from .tutorllm import ClaudeTutor
    except ImportError as e:
        check(f"the tutor's modules exist ({e})", False)
        return

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        demo.make_demo(root)
        # A paper card and the chapter paper2chapter wrote for it (paper chapters, K6), and a chapter whose card the
        # vault does not hold
        demo._write(root, f"Library/Papers/Demo papers/{PAPER}.md",
                    ["---", f'title: "{PAPER}"', "type: source-summary", "tags:", "  - paper", "---", "", f"# {PAPER}"])
        demo._write(root, f"Library/Sources/paper-chapters/{PAPER} - Chapter.md",
                    ["---", f'title: "{PAPER} - Chapter"', "type: source-summary", "source_type: chapter",
                     f'paper: "[[{PAPER}]]"', "number: 1", f'up: "[[{PAPER}]]"', "teaches:", '  - "[[Counting]]"',
                     '  - "[[Natural number]]"', "---", "", f"# {PAPER} - Chapter"])
        demo._write(root, "Library/Sources/paper-chapters/Lost - Chapter.md",
                    ["---", 'title: "Lost - Chapter"', "type: source-summary", "source_type: chapter",
                     'paper: "[[No Such Paper]]"', "number: 1", "teaches:", '  - "[[Counting]]"', "---"])
        learn = root / "x" / "reports" / "learning"
        clock = {"now": datetime(2027, 1, 9, 10, 0)}
        llm = FakeLLM()
        vault = Vault(ctx["code_root"], root)
        ledger = Ledger(learn)
        tutor = Tutor(vault, learn, clock=lambda: clock["now"], llm=llm, grader=FakeGrader(), ledger=ledger)
        notes_before = _notes_signature(root)

        # ---------------------------------------------------------------- a course from the vault
        cat = tutor.catalog()
        card = next((c for c in cat if c["card"] == CARD), None)
        check("the catalog finds the demo course card and its three lectures",
              card is not None and card["sessions"] == 3 and card["kind"] == "course")
        draft = tutor.draft(CARD)
        check("a draft reads the lectures in the order of their number, each with what it teaches",
              [s["n"] for s in draft["sessions"]] == [1, 2, 3]
              and [s["concepts"] for s in draft["sessions"]] == [["Collection"], ["Counting"], ["Natural number"]]
              and draft["source"] == {"kind": "card", "card": CARD})
        try:
            tutor.draft("No Such Course")
            check("a card the vault does not hold is refused", False)
        except TutorError as e:
            check("a card the vault does not hold is refused", e.status == 404)
        paper = next((c for c in cat if c["card"] == PAPER), None)
        check("a paper card and its chapter are a course of kind paper, of one session",
              paper is not None and paper["kind"] == "paper" and paper["sessions"] == 1
              and paper["rel"] == f"Library/Papers/Demo papers/{PAPER}.md")
        pdraft = tutor.draft(PAPER)
        check("its draft reads what the chapter teaches",
              [s["concepts"] for s in pdraft["sessions"]] == [["Counting", "Natural number"]]
              and pdraft["source"] == {"kind": "card", "card": PAPER})
        check("a chapter naming a paper the vault does not hold is no course",
              not any(c["card"] == "No Such Paper" for c in cat))

        # ---------------------------------------------------------------- saving the learner's dates
        dates = ["2027-01-10", "2027-01-17", "2027-01-24"]
        course = dict(draft, sessions=[dict(s, date=d) for s, d in zip(draft["sessions"], dates)],
                      exams=[{"id": "final", "title": "Final", "date": "2027-02-01", "covers": [1, 2, 3]}])
        course["sessions"][0]["concepts"] = ["Natural number"]      # the page cannot change what a note teaches
        saved = tutor.save(course)
        cid = saved["id"]
        stored = learn / "los" / "courses" / f"{cid}.json"
        check("a course is saved as the site's own state, beside its ledgers", stored.exists()
              and json.loads(stored.read_text(encoding="utf-8"))["sessions"][2]["date"] == "2027-01-24")
        view = tutor.view(cid)
        check("a card course reads its concepts from the notes, not from what the page sent",
              view["sessions"][0]["concepts"] == ["Collection"])

        def refused(data, what):
            try:
                tutor.save(data)
                return False
            except TutorError as e:
                return e.status == 400 and (what.lower() in e.message.lower())

        check("an id that is not a plain slug is refused", refused(dict(course, id="../x"), "id"))
        check("a date that is not a day is refused",
              refused(dict(course, id="bad-date", sessions=[dict(course["sessions"][0], date="2027-13-01")]), "date"))
        check("an exam covering a session the course lacks is refused",
              refused(dict(course, id="bad-exam", exams=[{"id": "mid", "title": "Mid", "date": "2027-01-20",
                                                         "covers": [9]}]), "session"))
        check("a card the vault does not hold cannot be saved",
              refused(dict(course, id="bad-card", source={"kind": "card", "card": "Nowhere"}), "card"))
        syl = {"title": "My syllabus", "source": {"kind": "syllabus"},
               "sessions": [{"n": 1, "title": "Intro", "date": "2027-01-10", "concepts": ["counting"]}], "exams": []}
        s2 = tutor.save(syl)
        check("a syllabus course keeps the concepts the learner chose, by their notes' names",
              tutor.view(s2["id"])["sessions"][0]["concepts"] == ["Counting"])
        check("a syllabus naming a concept the vault lacks is refused, and says which",
              refused(dict(syl, sessions=[dict(syl["sessions"][0], concepts=["Quantum foam"])]), "Quantum foam"))
        m = tutor.match("Counting things\nnatural numbers")
        check("a syllabus's topics are matched to concept notes",
              len(m) == 2 and "Counting" in m[0]["concepts"] and "Natural number" in m[1]["concepts"])

        # ---------------------------------------------------------------- where the course stands
        v = tutor.view(cid)
        check("two days before a lecture its preparation opens", v["sessions"][0]["status"] == "prep"
              and v["sessions"][1]["status"] == "upcoming")
        check("the next step is to prepare for the first lecture, tomorrow",
              v["next"]["kind"] == "prep" and v["next"]["session"] == 1 and v["next"]["days"] == 1)
        clock["now"] = datetime(2027, 1, 10, 9, 0)
        check("on the lecture's day it is today's", tutor.view(cid)["sessions"][0]["status"] == "today")
        clock["now"] = datetime(2027, 1, 12, 9, 0)
        v = tutor.view(cid)
        check("after it, until the next lecture, it waits for its review",
              v["sessions"][0]["status"] == "review" and v["next"]["kind"] == "review" and v["next"]["session"] == 1)
        tutor.mark(cid, 1, "reviewed")
        v = tutor.view(cid)
        check("a review marked done moves the next step on to the next lecture",
              v["sessions"][0]["marks"] == ["reviewed"] and v["next"]["kind"] == "upcoming"
              and v["next"]["session"] == 2 and v["next"]["days"] == 5)
        try:
            tutor.mark(cid, 1, "graded")
            check("a mark the tutor does not know is refused", False)
        except TutorError as e:
            check("a mark the tutor does not know is refused", e.status == 400)
        clock["now"] = datetime(2027, 1, 30, 9, 0)
        for n in (2, 3):
            tutor.mark(cid, n, "reviewed")
        v = tutor.view(cid)
        check("two days before the exam, the exam is the next step",
              v["next"]["kind"] == "exam" and v["next"]["exam"] == "final" and v["next"]["days"] == 2)

        # ---------------------------------------------------------------- before and after a lecture
        clock["now"] = datetime(2027, 1, 22, 9, 0)
        sv = tutor.session(cid, 3)
        before = sv["before"]
        nat = before["concepts"][0]
        check("before a lecture: what each concept rests on, with its status",
              nat["name"] == "Natural number" and [(r["name"], r["status"]) for r in nat["requires"]] ==
              [("Counting", "ready")])
        check("what to do first is the ready concept under them, to check now",
              [(x["name"], x["action"]) for x in before["first"]] == [("Counting", "check")]
              and before["waiting"] == 0)
        col = tutor.session(cid, 1)["before"]["concepts"][0]
        check("a concept's preview is its note's own one sentence",
              col["abstract"] == "A collection is many things taken together as one.")
        listen = tutor.session(cid, 2)["before"]["listen"]
        check("what to listen for is the bank's why question", listen == [
            {"concept": "Counting", "q": "Why count instead of guessing how many?"}])
        blob = json.dumps([tutor.session(cid, n) for n in (1, 2, 3)], ensure_ascii=False)
        keys = ["Many things taken together as one.", "So a rule can speak about all of them at once.",
                "It is a procedure anyone can repeat and check."]
        check("no key of any bank reaches the page before an answer", not any(k in blob for k in keys))
        lec = tutor.session(cid, 2)["before"]["lecture"]
        check("the lecture note's one line and its parts are read from the note",
              lec and lec["one_line"] == "Counting turns a collection into a number." and lec["parts"] == [
                  "1. Pairing members with numbers", "2. The last number said"])
        after = tutor.session(cid, 1)["after"]
        check("after a lecture: its concepts on the road, the ready ones offered a check",
              [(c["name"], c["status"], c["check"]) for c in after["concepts"]] == [("Collection", "granted", False)])

        # ---------------------------------------------------------------- Claude, given the notes as data
        llm.reply = {"recalled": ["Counting", "Bogus"], "missed": [], "notes": "You have it.", "question": "Why?"}
        r = tutor.recall(cid, 2, "MY-RECALL: you pair things with numbers")
        system, prompt = llm.calls[-1]
        check("free recall goes to Claude with the learner's words between markers, as data",
              "<<<RECALL" in prompt and "MY-RECALL" in prompt.split("<<<RECALL", 1)[1] and "Counting" in prompt)
        check("Claude's verdict names only the lecture's own concepts", r["recalled"] == ["Counting"]
              and r["missed"] == [] and r["question"] == "Why?")
        llm.down = "quiet"
        r = tutor.recall(cid, 2, "anything")
        check("in the quiet hours the learner ticks the list instead", r.get("needs_self") is True
              and r.get("checklist") == ["Counting"] and r.get("why_code") == "quiet")
        llm.down = ""
        tutor.recall_self(cid, 2, ["Counting", "Bogus"])
        rows = [x for x in ledger.rows("tutor") if x.get("type") == "recall"]
        check("the learner's ticks are kept in the tutor's ledger, the lecture's concepts only",
              rows and rows[-1]["recalled"] == ["Counting"] and rows[-1]["grader"] == "self")
        llm.reply = {"answer": "Counting ends on the last number. <script>alert(1)</script>", "covered": True,
                     "sources": ["Counting", "Elsewhere"]}
        a = tutor.ask(cid, 2, "What does counting end on?")
        system, prompt = llm.calls[-1]
        check("a question goes with the lecture's notes, marked as data", "<<<QUESTION" in prompt
              and "Counting pairs the members of a collection" in prompt)
        check("the tutor's answer is sanitized, and cites only the notes it was given",
              "<script" not in a["html"] and "last number" in a["html"] and a["sources"] == ["Counting"]
              and a["covered"] is True)

        # the Claude runner: a fixed argv, the text on stdin, the quiet hours kept
        seen = {}

        def runner(argv, stdin_text, timeout):
            seen["argv"], seen["stdin"] = argv, stdin_text
            return json.dumps({"type": "result", "subtype": "success", "is_error": False,
                               "result": '{"answer": "ok", "covered": true, "sources": []}', "total_cost_usd": 0.01})

        ct = ClaudeTutor(cli="cli.js", runner=runner, clock=lambda: datetime(2027, 1, 22, 15, 0), node="node")
        out = ct.call("SYSTEM", "the prompt <<<QUESTION\nSECRET-QUESTION\nQUESTION>>>")
        check("Claude runs with a fixed argv and no tools; the text goes on stdin, never in argv",
              out.get("answer") == "ok" and "SECRET-QUESTION" in seen["stdin"]
              and "SECRET-QUESTION" not in " ".join(seen["argv"]) and "--disallowedTools" in seen["argv"])
        night = ClaudeTutor(cli="cli.js", runner=runner, clock=lambda: datetime(2027, 1, 22, 2, 30), node="node")
        check("in the night jobs' quiet hours Claude is left to them", night.available() == (False, "quiet"))
        check("with no Claude CLI the tutor says so", ClaudeTutor(cli="", runner=runner).available() ==
              (False, "no_cli"))

        # ---------------------------------------------------------------- before an exam
        clock["now"] = datetime(2027, 1, 20, 9, 0)
        ex = tutor.exam(cid, "final")
        check("an exam's scope is every concept its sessions teach, weakest first",
              [(c["name"], c["status"]) for c in ex["scope"]] ==
              [("Counting", "ready"), ("Natural number", "locked"), ("Collection", "granted")])
        study = [d for d in ex["plan"] if d["kind"] == "study"]
        check("the plan spreads them over the days left, foundations first, and keeps the last day for practice",
              ex["days_left"] == 12 and ex["plan"][-1] == {"date": "2027-01-31", "kind": "practice", "concepts": []}
              and [c for d in study for c in d["concepts"]] == ["Counting", "Natural number"]
              and study[0]["date"] == "2027-01-20")
        verdicts_before = _verdicts_signature(learn)
        p = tutor.practice(cid, "final")
        qs = p["questions"]
        check("a practice exam asks one question of each concept with a bank, and sends no key",
              [q["concept"] for q in qs] == ["Counting"]
              and not any(k in json.dumps(p, ensure_ascii=False) for k in keys))
        g = tutor.practice_answer(p["item"], qs[0]["qid"], "Pairing the members of a collection with one, two, three, in order.")
        check("an answer is graded on the server, and the key comes back after it", g["correct"] is True
              and g["key"] == "Pairing the members of a collection with one, two, three, in order.")
        prow = [x for x in ledger.rows("tutor") if x.get("type") == "practice"]
        check("practice is kept in the tutor's ledger and never becomes a verdict", prow
              and prow[-1]["concept"] == "Counting" and _verdicts_signature(learn) == verdicts_before)
        try:
            tutor.practice_answer("no-such-item", qs[0]["qid"], "x")
            check("an answer to an item the server never gave is refused", False)
        except TutorError as e:
            check("an answer to an item the server never gave is refused", e.status == 410)

        check("no note was written by anything the tutor did", _notes_signature(root) == notes_before)

        # ---------------------------------------------------------------- through the server
        _api_checks(ctx, root, tutor, cid, keys)


def _api_checks(ctx, root, tutor, cid, keys) -> None:
    from .app import App
    from .config import Config
    from .grade import FakeGrader
    from .web import make_server
    import shutil
    from .selftest import SITE

    web = root.parent / f"{root.name}-tweb" / "web"
    web.mkdir(parents=True)
    shutil.copy2(SITE / "web" / "index.html", web / "index.html")
    cfg = Config(vault=str(root), port=0)
    app = App(cfg, vault=tutor.vault, grader=FakeGrader(), job_running=lambda: False, web_dir=web, tutor=tutor)
    srv = make_server(app, "127.0.0.1", 0)
    port = srv.server_address[1]
    app.port = port
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    cl = Client(port)
    try:
        st, hd, body, _ = cl.req("GET", "/")
        m = re.search(rb'name="los-token" content="([0-9a-f]{32,})"', body)
        cl.token = m.group(1).decode() if m else ""
        st, _h, body, data = cl.req("GET", "/api/courses")
        check("the courses come through the server", st == 200 and any(c["id"] == cid for c in data["courses"])
              and any(c["card"] == CARD for c in data["catalog"]))
        st, _h, body, data = cl.req("GET", f"/api/tutor/session?id={cid}&n=2")
        check("a session comes through the server with no key in it", st == 200
              and not any(k in body.decode("utf-8") for k in keys))
        token, cl.token = cl.token, "0" * 48
        st, *_ = cl.req("POST", "/api/tutor/mark", {"id": cid, "n": 2, "what": "prepped"})
        check("a write with a stale token is refused", st == 403)
        cl.token = token
        st, _h, _b, data = cl.req("POST", "/api/tutor/mark", {"id": cid, "n": 2, "what": "prepped"})
        check("a write with the page's token is taken", st == 200 and data.get("ok") is True)
        st, _h, _b, data = cl.req("GET", "/api/course?id=..%2F..%2Fsecret")
        check("a course id that is a path is refused", st in (400, 404))
    finally:
        srv.shutdown()
