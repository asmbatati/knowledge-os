"""The Knowledge OS selftest.

    python server.py --selftest              # every group
    python server.py --selftest render api   # some groups

Nothing here touches the real vault's data. A group that needs a vault builds the demo vault (los/demo.py) in a
temporary folder and imports only the road's code from the configured vault. The grader and the bank writer are
fakes, so no group calls Claude.
"""
from __future__ import annotations

import hashlib
import http.client
import json
import re
import tempfile
import threading
import traceback
from datetime import timedelta, date, datetime, time
from pathlib import Path
from urllib.parse import quote

RESULTS = {"ok": 0, "fail": 0}
SITE = Path(__file__).resolve().parent.parent


def check(name: str, cond) -> bool:
    RESULTS["ok" if cond else "fail"] += 1
    print(f"  {'ok  ' if cond else 'FAIL'}  {name}")
    return bool(cond)


# ------------------------------------------------------------------ rendering
def group_render(ctx) -> None:
    from . import render as RN
    known = {"collection": "Collection", "counting": "Counting"}
    md = "\n".join([
        "---", "title: x", "---", "```nav", "```", "",
        "# Title", "",
        "A [[Collection]] and [[Counting|how many]] and [[Unknown note]] and ![[fig.png]].", "",
        "Inline $a^2 + b^2$ and a price \\$5 and $x$.", "",
        "$$", "\\sum_{i=1}^{n} i", "$$", "",
        "> [!abstract] In one sentence",
        "> A **collection** is many things as one, see [[Collection]].", "",
        "> [!tip]", "> Untitled.", "",
        "```mermaid", "graph LR", "  A --> B", "```", "",
        "```python", "x = '$not math$'", "```", "",
        "Use `$HOME` here.", "",
        "<script>alert(1)</script>",
        '<img src=x onerror="alert(1)">', "",
        "| a | b |", "|---|---|", "| [[Collection\\|c]] | 2 |", "",
        "%%a hidden comment%%",
        "Line one", "line two ^block-1", "",
        "[out](https://example.org) and [bad](javascript:alert(1))",
    ])
    html = RN.render_note(md, known)
    check("frontmatter and the nav fence are dropped", "title: x" not in html and "language-nav" not in html)
    check("a known wikilink becomes an in-site link", 'href="#/concept/Collection"' in html)
    check("an alias is the link's text", ">how many</a>" in html)
    check("an unknown wikilink is text, not a link", "Unknown note" in html and "#/concept/Unknown" not in html)
    check("a wikilink in a table keeps its alias", ">c</a>" in html)
    check("inline math is kept for KaTeX", 'data-tex="a^2 + b^2"' in html and 'data-tex="x"' in html)
    check("an escaped dollar is a dollar, not math", "$5" in html and "\\$5" not in html)
    check("display math is a block", 'class="math display"' in html and "\\sum_{i=1}^{n} i" in html)
    check("a callout becomes a titled block, markdown inside",
          'class="callout callout-abstract"' in html and "<strong>collection</strong>" in html)
    check("an untitled callout is titled by its kind", ">Tip<" in html)
    check("a mermaid fence becomes a diagram block", '<pre class="mermaid">' in html and "A --&gt; B" in html)
    check("math inside code is left alone", "$not math$" in html and "$HOME" in html)
    check("a script tag does not survive", "<script" not in html.lower() and "alert(1)</script" not in html)
    check("an event handler does not survive", "onerror" not in html.lower())
    check("a table renders", "<table>" in html)
    check("an Obsidian comment is dropped", "hidden comment" not in html)
    check("a block id is dropped", "^block-1" not in html)
    check("a single newline is a line break, as in Obsidian", "Line one<br" in html)
    check("an external link opens outside", 'href="https://example.org"' in html and 'rel="noopener noreferrer"' in html)
    check("a javascript: link loses its href", "javascript:" not in html)
    check("an embed is named, not fetched", "fig.png" in html and "<img" not in html)
    assets = {"fig.svg": "fig.svg", "plate.png": "Plate.png"}
    html = RN.render_note("A drawing ![[fig.svg]], ![[plate.png|240]], ![[gone.svg]] and ![[Collection]].\n\n"
                          "> [!note] In a callout\n> ![[fig.svg]]\n\n```figure\nid: bench\n```", known, assets)
    check("an image beside the notes is shown, through the site's asset route",
          '<img class="embed-img" src="/asset/fig.svg" alt="fig.svg">' in html)
    check("an embed's size is the image's width", '<img class="embed-img" src="/asset/Plate.png" alt="Plate.png" width="240">' in html)
    check("an image that is not there, or a note, is still only named",
          "gone.svg" in html and "/asset/gone" not in html and html.count("<img") == 3)
    check("a figure block is left to the page, which shows its figures above the note", "bench" not in html)
    stilled = RN.render_note("Before.\n\n```figure\nid: bench\n```\n\n> [!example]- Still drawing\n> ![[bench.svg]]\n\n"
                             "After.\n\n> [!note] Kept\n> ![[fig.svg]]", known, {"bench.svg": "bench.svg", "fig.svg": "fig.svg"})
    check("a figure's still drawing goes with its block; another image in a callout stays",
          "bench" not in stilled and "Still drawing" not in stilled and "/asset/fig.svg" in stilled and "After." in stilled)
    check("an image from anywhere but the asset route, or with a handler, does not survive",
          RN.sanitize('<img src="https://x.org/a.png"><img src="/asset/a.svg" onerror="x"><img src="/asset/b.svg" width="9e9">')
          == '<img src="/asset/a.svg"><img src="/asset/b.svg">')
    legacy ="\n".join(["---", "title: y", "---", "", "[[مجموعة|AR]]|[[Collection|EN]]", "", "🏡 [[HOME]]", "",
                        "~ [[Sets|UP]]", "~ **Same Level** [[Counting]] | [[Order]]", "", "# Collection", "",
                        "Body text.", "", "~ [[Sets|UP]]"])
    html = RN.render_note(legacy, known)
    check("the note's own navigation header is left to the side panel",
          "|AR" not in html and "HOME" not in html and "Same Level" not in html and "Body text." in html
          and "<h1>Collection</h1>" in html)
    check("a closing UP line goes too", html.count("Sets") == 0)


# -------------------------------------------------------------------- grading
def group_grade(ctx) -> None:
    from . import grade as G
    check("JSON is read from a fenced reply", G.extract_json('```json\n{"correct": true}\n```') == {"correct": True})
    check("JSON is read from a plain reply", G.extract_json('Sure. {"correct": false, "gap": "method"}')["gap"] == "method")
    check("garbage gives None", G.extract_json("no json here") is None)
    check("23:30 is in the quiet hours", G.in_quiet_hours(time(23, 30), ("23:10", "00:30")))
    check("00:10 is in the quiet hours", G.in_quiet_hours(time(0, 10), ("23:10", "00:30")))
    check("noon is not", not G.in_quiet_hours(time(12, 0), ("23:10", "00:30")))

    q = {"facet": "define", "q": "What is a collection?", "key": "Many things taken together as one.",
         "evidence": "A collection is many things taken together as one."}
    fake = G.FakeGrader()
    check("the fake grader credits an answer that says the key",
          fake.grade(q, "many things taken together as one")["correct"])
    check("the fake grader refuses one that does not", not fake.grade(q, "a single thing")["correct"])

    calls = []

    def runner(argv, stdin_text, timeout):
        calls.append((argv, stdin_text))
        return json.dumps({"type": "result", "subtype": "success", "is_error": False,
                           "result": '```json\n{"correct": true, "credited": "grouped as one whole", '
                                     '"missing": "", "gap": "none", "borderline": false}\n```'})

    cg = G.ClaudeGrader(cli="cli.js", model="sonnet", runner=runner, clock=lambda: datetime(2026, 9, 29, 12, 0))
    r = cg.grade(q, "things grouped as one whole")
    check("a Claude grade is read", r["correct"] and r["grader"] == "claude" and r["credited"] == "grouped as one whole")
    argv, stdin_text = calls[0]
    check("the answer goes in on stdin, never in argv",
          "things grouped as one whole" in stdin_text and not any("grouped" in a for a in argv))
    check("the call allows no tools and no MCP servers",
          "--disallowedTools" in argv and "--strict-mcp-config" in argv and "--setting-sources" in argv)

    def lying_runner(argv, stdin_text, timeout):
        return json.dumps({"type": "result", "subtype": "success", "is_error": False,
                           "result": '{"correct": true, "credited": "words never written", "missing": "", '
                                     '"gap": "none", "borderline": false}'})
    r = G.ClaudeGrader(cli="c", model="m", runner=lying_runner, clock=lambda: datetime(2026, 9, 29, 12)).grade(q, "abc")
    check("a credited quote that is not in the answer is dropped", r["credited"] == "")

    seq = iter([True, False])

    def split_runner(argv, stdin_text, timeout):
        c = next(seq)
        return json.dumps({"type": "result", "subtype": "success", "is_error": False,
                           "result": json.dumps({"correct": c, "credited": "", "missing": "", "gap": "none",
                                                 "borderline": True})})
    r = G.ClaudeGrader(cli="c", model="m", runner=split_runner, clock=lambda: datetime(2026, 9, 29, 12)).grade(q, "x")
    check("a borderline answer the second grade disputes is not counted right", r["correct"] is False and r["disagreed"])

    def broken_runner(argv, stdin_text, timeout):
        raise TimeoutError("no answer")
    r = G.ClaudeGrader(cli="c", model="m", runner=broken_runner, clock=lambda: datetime(2026, 9, 29, 12)).grade(q, "x")
    check("an unreachable Claude hands the grade to the learner", r.get("needs_self") and "no answer" in r["why"]
          and r.get("why_code") == "unreachable")
    r = G.ClaudeGrader(cli="c", model="m", runner=runner, clock=lambda: datetime(2026, 9, 29, 23, 40),
                       quiet=("23:10", "00:30")).grade(q, "x")
    check("in the quiet hours the learner grades", r.get("needs_self") and "quiet" in r["why"]
          and r.get("why_code") == "quiet")


# -------------------------------------------------------------------- ledgers
def group_ledger(ctx) -> None:
    from . import ledger as LG
    with tempfile.TemporaryDirectory() as td:
        led = LG.Ledger(Path(td))
        a = led.append("attempts", {"type": "attempt", "concept": "Collection"}, when=datetime(2026, 9, 29, 10, 0))
        b = led.append("attempts", {"type": "attempt", "concept": "Counting"}, when=datetime(2026, 9, 29, 10, 1))
        rows = led.rows("attempts")
        check("rows come back in order with their ids", [r["id"] for r in rows] == [a["id"], b["id"]])
        check("ids are distinct", a["id"] != b["id"])
        check("a row carries its date and time", rows[0]["date"] == "2026-09-29" and rows[0]["at"] == "10:00:00")
        check("the month's file is where the design says",
              (Path(td) / "los" / "attempts-2026-09.jsonl").exists())
    active = {date(2026, 9, d) for d in (30, 29, 27, 26, 24)}
    s = LG.streak(active, date(2026, 9, 30))
    check("one missed day a week is repaired, a second ends the streak", s == {"days": 5, "repairs": 2, "today": True})
    s = LG.streak({date(2026, 9, 29)}, date(2026, 9, 30))
    check("a day not yet touched does not break the streak", s == {"days": 1, "repairs": 0, "today": False})
    check("no activity is no streak, not a failure", LG.streak(set(), date(2026, 9, 30))["days"] == 0)


# ------------------------------------------------------------- the road bridge
def group_bridge(ctx) -> None:
    from . import demo
    from .vault import Vault
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        demo.make_demo(root)
        v = Vault(ctx["code_root"], root)
        RG = v.RG
        g1, g0 = RG.load_graph(root), v.uncached_load_graph(root)
        same = sorted((k, n.requires, n.axiom, n.road_state) for k, n in g1.nodes.items()) == \
            sorted((k, n.requires, n.axiom, n.road_state) for k, n in g0.nodes.items())
        check("the cached graph equals the road's own", same and g1.concept_names == g0.concept_names)
        check("the cached sources equal the road's own", dict(RG.sources_index(root)) == dict(v.uncached_sources(root)))
        g1.nodes["collection"].road_state = "mastered"
        check("a request cannot change the cache", RG.load_graph(root).nodes["collection"].road_state is None)
        p = root / "Atlas" / "Concepts" / "Natural number.md"
        p.write_text(p.read_text(encoding="utf-8").replace('  - "[[Counting]]"', '  - "[[Collection]]"'),
                     encoding="utf-8")
        import os
        os.utime(p, (p.stat().st_atime, p.stat().st_mtime + 5))
        check("an edited note is read again", RG.load_graph(root).get("Natural number").requires == ["Collection"])
        nx = v.next_item()
        check("the road's next item comes through the bridge; the axiom is granted, never checked",
              nx["kind"] == "check" and nx["concept"] == "Natural number")


# ------------------------------------------------------------------ the API
class Client:
    def __init__(self, port: int):
        self.port, self.token = port, ""

    def req(self, method, path, body=None, headers=None, raw=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        h = {"Origin": f"http://127.0.0.1:{self.port}"} if method == "POST" else {}
        if method == "POST" and self.token:
            h["X-LOS-Token"] = self.token
        h.update(headers or {})
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        if data is not None:
            h["Content-Type"] = "application/json"
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        out = r.read()
        c.close()
        try:
            js = json.loads(out) if r.getheader("Content-Type", "").startswith("application/json") else None
        except ValueError:
            js = None
        return r.status, dict(r.getheaders()), out, js


def group_api(ctx) -> None:
    from . import demo
    from .app import App
    from .config import Config
    from .grade import FakeGrader
    from .vault import Vault
    from .web import make_server

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        info = demo.make_demo(root)
        learn = root / "x" / "reports" / "learning"
        cfg = Config(vault=str(root), port=0)
        jobs = {"running": False}

        class FakeBanks:
            def write(self, concept, note_text, layer):
                return demo.bank_from_note(concept, note_text)

        import shutil
        web = root.parent / f"{root.name}-web" / "web"         # a web root of its own, a secret just outside it
        (web / "vendor" / "katex").mkdir(parents=True)
        shutil.copy2(SITE / "web" / "index.html", web / "index.html")
        shutil.copy2(SITE / "web" / "vendor" / "katex" / "katex.min.js", web / "vendor" / "katex" / "katex.min.js")
        (web.parent / "secret.json").write_text('{"secret": true}', encoding="utf-8")
        app = App(cfg, vault=Vault(ctx["code_root"], root), grader=FakeGrader(), bank_writer=FakeBanks(),
                  job_running=lambda: jobs["running"], web_dir=web)
        srv = make_server(app, "127.0.0.1", 0)
        port = srv.server_address[1]
        app.port = port
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        cl = Client(port)
        try:
            st, hd, body, _ = cl.req("GET", "/")
            m = re.search(rb'name="los-token" content="([0-9a-f]{32,})"', body)
            check("the page is served with its token", st == 200 and m is not None)
            check("the page carries a content security policy", "script-src 'self'" in hd.get("Content-Security-Policy", ""))
            cl.token = m.group(1).decode() if m else ""

            st, *_ = cl.req("GET", "/api/today", headers={"Host": f"evil.example:{port}"})
            check("a foreign Host is refused", st == 403)
            st, *_ = cl.req("GET", "/api/today", headers={"Host": f"localhost:{port}"})
            check("localhost is accepted", st == 200)

            st, _, raw, nx = cl.req("GET", "/api/next")
            check("the axiom is granted: the first item is a check of the concept above it",
                  st == 200 and nx["kind"] == "check" and nx["concept"] == "Counting" and len(nx["questions"]) == 3)
            check("no key or evidence reaches the page before an answer",
                  b'"key"' not in raw and b'"evidence"' not in raw)
            item = nx["item"]
            bank = json.loads((root / "x" / "Checks" / "Counting.json").read_text(encoding="utf-8"))
            keys = {q["facet"]: q["key"] for q in bank["questions"]}
            vkeys = {q["facet"]: q["variants"][0]["key"] for q in bank["questions"]}
            vqs = {q["facet"]: q["variants"][0]["q"] for q in bank["questions"]}

            first = nx["questions"][0]
            answer = {"item": item, "qid": first["qid"], "answer": keys[first["facet"]], "confidence": 3}
            saved = cl.token
            cl.token = ""
            st, *_ = cl.req("POST", "/api/attempt", answer)
            check("a POST without the token is refused", st == 403)
            cl.token = saved
            st, *_ = cl.req("POST", "/api/attempt", answer, headers={"Origin": "http://evil.example"})
            check("a POST from another origin is refused", st == 403)
            st, *_ = cl.req("POST", "/api/attempt", raw=b"x" * 70000)
            check("an oversized body is refused", st == 413)

            graded = []
            for q in [x for x in nx["questions"] if x["facet"] != "work"]:
                st, _, _, g = cl.req("POST", "/api/attempt", {"item": item, "qid": q["qid"],
                                                               "answer": keys[q["facet"]], "confidence": 3})
                graded.append(st == 200 and g["correct"] and g["key"] == keys[q["facet"]] and g["evidence"])
            check("each answer is graded and its key shown after", all(graded) and len(graded) == 2)
            st, _, _, v2 = cl.req("POST", "/api/verdict", {"item": item})
            check("a check with a facet unanswered is refused by the road", st == 409 and "REFUSED" in v2["error"])
            check("the refusal wrote nothing", not sorted(learn.glob("road-verdicts-*.jsonl")))
            qw = next(x for x in nx["questions"] if x["facet"] == "work")
            cl.req("POST", "/api/attempt", {"item": item, "qid": qw["qid"], "answer": "no idea", "confidence": 3})
            st, _, _, v = cl.req("POST", "/api/verdict", {"item": item})
            check("a wrong 'use it' fails the check, and says what was missed",
                  st == 200 and v["passed"] is False and v["missed"] == ["work"])
            vf = sorted(learn.glob("road-verdicts-*.jsonl"))
            rows = [json.loads(x) for x in vf[0].read_text(encoding="utf-8").splitlines()] if vf else []
            check("one verdict row, written by the road's writer", len(rows) == 1 and rows[0]["concept"] == "Counting")
            check("each answer carries confidence, grader and attempt",
                  rows and all(a.get("confidence") == 3 and a.get("grader") == "fake" and a.get("attempt")
                               for a in rows[0]["answers"]))
            st, *_ = cl.req("POST", "/api/verdict", {"item": item})
            check("the same item cannot be recorded twice", st == 409)

            st, _, _, nx5 = cl.req("GET", "/api/next")
            check("the failed concept becomes a reading", nx5["kind"] == "reading" and nx5["concept"] == "Counting")
            st, _, _, again = cl.req("GET", "/api/next?concept=Counting")
            check("a failed concept is checked again from the next day", st == 409 and bool(again.get("recheck_on")))
            st, *_ = cl.req("GET", "/api/next?concept=Natural%20number")
            check("a locked concept cannot be asked for", st == 409)
            st, _, _, ax = cl.req("GET", "/api/next?concept=Collection")
            check("a granted axiom is never checked", st == 409 and ax.get("road_status") == "granted")

            st, _, _, c = cl.req("GET", "/api/concept?name=Collection")
            check("a concept page comes with its note rendered", st == 200 and "taken together" in c["html"])
            check("its road state is the road's", c["status"] == "granted" and c["unlocks"] == ["Counting"])
            check("no learning field is passed through", not any(k in json.dumps(c) for k in
                                                                 ('"mastery"', '"ease"', '"interval_days"')))
            st, *_ = cl.req("GET", "/api/concept?name=..%2F..%2Fx%2FChecks%2FCollection")
            check("a path is not a concept name", st == 404)
            st, _, _, c = cl.req("GET", "/api/concept?name=Stray%20idea")
            check("a concept note off the graph still opens", st == 200 and c["in_graph"] is False)

            st, _, _, gr = cl.req("GET", "/api/graph?road=" + info["road"].replace(" ", "%20"))
            status = {n["name"]: n["status"] for n in gr.get("nodes", [])}
            check("the road map has the road's concepts and states",
                  status == {"Collection": "granted", "Counting": "to-read", "Natural number": "locked"}
                  and len(gr["edges"]) == 2)

            # the next day the failed check comes back in new words, and 'use it' with one more passes it; the day
            # after, the review asks again what it missed (Learning System Improvement Plan 2026-10, decision 2)
            real = app.clock
            app.clock = lambda: real() + timedelta(days=1)
            st, _, _, nx4 = cl.req("GET", "/api/next?concept=Counting")
            check("the next day, the failed concept is checked again through the variants", st == 200
                  and nx4["kind"] == "check" and [q["q"] for q in nx4["questions"]] == [vqs[f] for f in ("define", "work", "why")])
            for q in nx4["questions"]:
                ans = "no idea" if q["facet"] == "define" else vkeys[q["facet"]]
                cl.req("POST", "/api/attempt", {"item": nx4["item"], "qid": q["qid"], "answer": ans, "confidence": 2})
            st, _, _, v4 = cl.req("POST", "/api/verdict", {"item": nx4["item"]})
            check("'use it' and one more pass the check, and unlock what is built on it",
                  st == 200 and v4["passed"] and v4["missed"] == ["define"] and v4["unlocked"] == ["Natural number"]
                  and v4["status"] == "passed")
            app.clock = lambda: real() + timedelta(days=2)
            st, _, _, nx6 = cl.req("GET", "/api/next")
            check("the day after, the review asks again what the check missed, in new words",
                  st == 200 and nx6["kind"] == "review" and nx6["concept"] == "Counting" and nx6["ask"] == ["define"]
                  and [q["q"] for q in nx6["questions"]] == [vqs["define"]])
            app.clock = real

            outside = [cl.req("GET", u)[0] for u in ("/app/../../secret.json", "/app/%2e%2e/%2e%2e/secret.json",
                                                       r"/vendor/..\..\secret.json")]
            check("the static route cannot leave the site", outside == [404, 404, 404])
            st, hd, _, _ = cl.req("GET", "/vendor/katex/katex.min.js")
            check("a vendored script is served", st == 200 and "javascript" in hd.get("Content-Type", ""))

            note = root / "Atlas" / "Concepts" / "Counting.md"
            before = hashlib.sha256(note.read_bytes()).hexdigest()
            st, *_ = cl.req("POST", "/api/read", {"concept": "Counting"})
            check("marking a note read goes to the site's ledger", st == 200 and
                  any(json.loads(x).get("type") == "read" for x in
                      (learn / "los").glob("sessions-*.jsonl").__next__().read_text(encoding="utf-8").splitlines()))
            check("and leaves the note as it was", hashlib.sha256(note.read_bytes()).hexdigest() == before)

            cl.req("POST", "/api/focus", {"event": "start", "energy": "medium"})
            st, *_ = cl.req("POST", "/api/focus", {"event": "stop", "minutes": 24, "loops": "Counting's why"})
            st2, _, _, t = cl.req("GET", "/api/today")
            check("focused minutes reach Today", st == 200 and t["focus_minutes"] == 24 and t["streak"]["today"])

            st, _, _, pr = cl.req("GET", "/api/progress")
            check("progress counts the checks by day", st == 200 and sum(x["checks"] for x in pr["history"]) == 2
                  and pr["calibration"]["3"]["n"] == 3)

            jobs["running"] = True
            st, *_ = cl.req("POST", "/api/bank", {"concept": "Natural number"})
            check("no bank is written while a vault job runs", st == 423)
            jobs["running"] = False
            st, _, _, b = cl.req("POST", "/api/bank", {"concept": "Natural number"})
            check("a bank is written through the road's validator",
                  st == 200 and (root / "x" / "Checks" / "Natural number.json").exists())
            st, _, _, b = cl.req("POST", "/api/bank", {"concept": "Collection"})
            check("an existing bank is not overwritten", st == 409)

            app.grader = __import__("los.grade", fromlist=["SelfGrader"]).SelfGrader()
            st, _, _, nx3 = cl.req("GET", "/api/next?concept=Natural%20number")
            q = nx3["questions"][0]
            n_before = sum(1 for _ in (learn / "los").glob("attempts-*.jsonl").__next__().open(encoding="utf-8"))
            st, _, _, g = cl.req("POST", "/api/attempt", {"item": nx3["item"], "qid": q["qid"], "answer": "my words",
                                                          "confidence": 1})
            check("in self mode the key comes back for the learner to judge", st == 200 and g["needs_self"] and g["key"]
                  and g["why_code"] == "settings")
            st, _, _, g2 = cl.req("POST", "/api/attempt/self", {"attempt": g["attempt"], "correct": True})
            rows = [json.loads(x) for x in (learn / "los").glob("attempts-*.jsonl").__next__()
                    .read_text(encoding="utf-8").splitlines()]
            check("the learner's grade is recorded as self", st == 200 and len(rows) == n_before + 1
                  and rows[-1]["grader"] == "self" and rows[-1]["correct"] is True)

            st, _, _, hl = cl.req("GET", "/api/health")
            check("health names the grader and the timer", st == 200 and hl["grader"] == "self"
                  and hl["timer"] == {"focus": 24, "break": 6})

            st, *_ = cl.req("GET", "/api/nothing-here")
            check("an unknown route is 404", st == 404)
        finally:
            srv.shutdown()
            srv.server_close()
            shutil.rmtree(web.parent, ignore_errors=True)


# ------------------------------------------------------------------ the jobs
def group_jobs(ctx) -> None:
    from . import jobs as J
    check("the job check answers yes or no", J.vault_job_running() in (True, False))
    if not J.SUPPORTED:
        check("off Windows there is no job lock to see", J.vault_job_running("Local\\x") is False)
        return
    name = "Local\\LearningOSSelftest"
    h = J._create_mutex(name)
    try:
        check("a held mutex is seen", J.vault_job_running(name) is True)
    finally:
        J._close(h)
    check("a released one is not", J.vault_job_running(name) is False)


def group_gradertest(ctx) -> None:
    from . import demo, gradertest as GT
    from .vault import Vault
    cases = json.loads((SITE / "tests" / "grader-cases.json").read_text(encoding="utf-8"))["cases"]
    per = {}
    for c in cases:
        per.setdefault(c["facet"], []).append(c["expect"])
    check("the set holds 20 answers per facet, half right and half wrong",
          {f: (len(v), sum(v)) for f, v in per.items()} == {"define": (20, 10), "work": (20, 10), "why": (20, 10)})
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        demo.make_demo(root)
        v = Vault(ctx["code_root"], root)
        mini = [{"concept": "Collection", "facet": "define", "variant": 0, "expect": True, "answer": "right"},
                {"concept": "Counting", "facet": "define", "variant": 1, "expect": False, "answer": "no"}]

        class Agrees:
            name = "fake"

            def grade(self, q, answer, objection=""):
                return {"correct": answer == "right", "grader": "fake"}

        class Refuses:
            name = "fake"

            def grade(self, q, answer, objection=""):
                return {"needs_self": True, "why": "down", "why_code": "unreachable"}

        rep = GT.evaluate(mini, v, Agrees())
        check("a grader that agrees on every case passes", rep["ok"] and rep["agreed"] == 2)
        check("each case is graded against the bank's own question", rep["rows"][1]["q"].startswith("What does the last"))
        rep = GT.evaluate(mini, v, Refuses())
        check("a grader that cannot grade does not pass", not rep["ok"] and rep["agreed"] == 0)
        rep = GT.evaluate(mini + [{"concept": "Nowhere", "facet": "why", "variant": 0, "expect": True, "answer": "x"}],
                          v, Agrees())
        check("a case naming no bank is an error, not a pass", not rep["ok"] and rep["errors"] == 1)
        own = {"concept": "Nowhere", "facet": "why", "variant": 0, "expect": True, "answer": "right",
               "q": "Why?", "key": "Because.", "evidence": "Because."}
        rep = GT.evaluate([own], v, Agrees())
        check("a case carrying its own question needs no bank: the set runs on any install",
              rep["ok"] and rep["rows"][0]["q"] == "Why?")
        check("every case of the set carries its question, key and evidence",
              all(all(c.get(k) for k in ("q", "key", "evidence")) for c in cases))


# ------------------------------------------------------------------ settings
def group_config(ctx) -> None:
    from .config import Config, load_config, resolve_vault
    with tempfile.TemporaryDirectory(prefix="los-config-") as tmp:
        root = Path(tmp)
        vault = root / "vault"
        (vault / "x" / "scripts").mkdir(parents=True)
        (vault / "x" / "scripts" / "_road.py").write_text("", encoding="utf-8")
        site = vault / "x" / "apps" / "knowledge-os"          # where a vault copy carries the site
        site.mkdir(parents=True)
        alone = root / "elsewhere" / "knowledge-os"
        alone.mkdir(parents=True)
        check("the default names no vault of anyone's", Config().vault == "")
        check("an empty vault is the vault the site sits in", resolve_vault("", site) == str(vault))
        check("a vault named in the settings wins", resolve_vault(str(root / "other"), site) == str(root / "other"))
        check("a site in no vault finds none", resolve_vault("", alone) == "")
        cfgfile = site / "knowledge-os.json"
        cfgfile.write_text(json.dumps({"vault": "", "port": 4190}), encoding="utf-8")
        check("load_config finds the vault from the site's folder", load_config(cfgfile, site=site).vault == str(vault))
        check("and keeps a vault named on the command line",
              load_config(cfgfile, site=site, vault=str(root / "cli")).vault == str(root / "cli"))


# ------------------------------------------------------------------ the lab
def group_lab(ctx) -> None:
    """The Lab's server side: the worker's own policy, Python behind the token with a time limit and an output cap,
    the setting that turns Python off, and the exercise results in the site's own ledger."""
    import importlib.util
    import shutil
    import time as _time
    from . import demo
    from .app import App, TYPES
    from .config import Config
    from .grade import FakeGrader
    from .vault import Vault
    from .web import make_server

    check("the page's fonts are served as fonts", TYPES.get(".woff") == "font/woff" and TYPES.get(".ttf") == "font/ttf")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "vault"
        root.mkdir()
        demo.make_demo(root)
        web = Path(td) / "web"
        (web / "app" / "lab").mkdir(parents=True)
        shutil.copy2(SITE / "web" / "index.html", web / "index.html")
        (web / "app" / "main.js").write_text("// the page\n", encoding="utf-8")
        (web / "app" / "lab" / "worker.js").write_text("// the worker\n", encoding="utf-8")
        cfg = Config(vault=str(root), port=0, lab_python=True, lab_timeout_s=3)
        app = App(cfg, vault=Vault(ctx["code_root"], root), grader=FakeGrader(), web_dir=web)
        srv = make_server(app, "127.0.0.1", 0)
        port = srv.server_address[1]
        app.port = port
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        cl = Client(port)
        try:
            _, _, body, _ = cl.req("GET", "/")
            m = re.search(rb'name="los-token" content="([0-9a-f]{32,})"', body)
            cl.token = m.group(1).decode() if m else ""

            st, hd, *_ = cl.req("GET", "/app/lab/worker.js")
            csp = hd.get("Content-Security-Policy", "")
            check("the code lab's worker may evaluate code and reach nothing",
                  st == 200 and "'unsafe-eval'" in csp and "connect-src 'none'" in csp and "default-src 'none'" in csp)
            st, hd, *_ = cl.req("GET", "/app/main.js")
            check("no other script may evaluate code", st == 200 and "'unsafe-eval'" not in hd.get("Content-Security-Policy", ""))

            figs = Path(td) / "figures" / "bench"
            figs.mkdir(parents=True)
            (figs / "bench.html").write_text("<!doctype html><script>1</script>", encoding="utf-8")
            (figs / "build.mjs").write_text("// source\n", encoding="utf-8")
            st, hd, body, _ = cl.req("GET", "/figures/bench/bench.html")
            fcsp = hd.get("Content-Security-Policy", "")
            check("a figure is served with a policy of its own: its inline script runs, sandboxed, and reaches nothing",
                  st == 200 and b"<script>1</script>" in body and "script-src 'unsafe-inline'" in fcsp
                  and "sandbox allow-scripts" in fcsp and "default-src 'none'" in fcsp and "connect-src" not in fcsp)
            check("only the site itself may frame a figure",
                  "frame-ancestors 'self'" in fcsp and hd.get("X-Frame-Options") == "SAMEORIGIN")
            st, hd, *_ = cl.req("GET", "/")
            # the page refuses every framer but Obsidian (the vault's Knowledge OS Plugin Plan 2026-10, D2)
            check("the site's own page refuses any frame but Obsidian's",
                  "frame-ancestors 'self' app://obsidian.md;" in hd.get("Content-Security-Policy", ""))
            bad = [cl.req("GET", p)[0] for p in ("/figures/bench/build.mjs", "/figures/../web/index.html",
                                                 "/figures/bench/../../web/index.html", "/figures/Bench/bench.html",
                                                 "/figures/bench/missing.html", "/figures/bench.html")]
            check("nothing but a figure's own page is served from the figures", bad == [404] * 6)

            concepts = root / "Atlas" / "Concepts"
            (concepts / "attachments").mkdir(parents=True, exist_ok=True)
            (concepts / "attachments" / "fig.svg").write_text(
                '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', encoding="utf-8")
            (concepts / "attachments" / "notes.md").write_text("# not an image\n", encoding="utf-8")
            st, hd, body, _ = cl.req("GET", "/asset/fig.svg")
            acsp = hd.get("Content-Security-Policy", "")
            check("an image beside the notes is served, and an SVG's own script cannot run",
                  st == 200 and hd.get("Content-Type", "").startswith("image/svg+xml") and b"<svg" in body
                  and "sandbox" in acsp and "default-src 'none'" in acsp and "script-src" not in acsp)
            bad = [cl.req("GET", p)[0] for p in ("/asset/notes.md", "/asset/../fig.svg", "/asset/%2e%2e%2ffig.svg",
                                                 "/asset/missing.svg", "/asset/attachments/fig.svg", "/asset/")]
            check("nothing but an image file beside the notes is served", bad == [404] * 6)
            note = sorted(concepts.glob("*.md"))[0]
            note.write_text(note.read_text(encoding="utf-8") + "\n![[fig.svg]]\n", encoding="utf-8")
            st, _, _, info = cl.req("GET", "/api/concept?name=" + quote(note.stem))
            check("a concept's page shows the image its note embeds", st == 200
                  and '<img class="embed-img" src="/asset/fig.svg" alt="fig.svg">' in info.get("html", ""))

            st, _, _, info = cl.req("GET", "/api/lab")
            check("the lab says Python is on, and which modules it has",
                  st == 200 and info["python"] is True and set(info["modules"]) >= {"numpy", "matplotlib"})

            st, _, _, r = cl.req("POST", "/api/lab/python", {"code": "print(6 * 7)"})
            check("Python runs and its output comes back", st == 200 and r["stdout"].strip() == "42" and r["exit"] == 0)
            st, _, _, r = cl.req("POST", "/api/lab/python", {"code": "1 / 0"})
            check("an error comes back as an error", st == 200 and r["exit"] != 0 and "ZeroDivisionError" in r["stderr"])
            t0 = _time.monotonic()
            st, _, _, r = cl.req("POST", "/api/lab/python", {"code": "while True:\n    pass"})
            check("a run that does not end is stopped at the time limit",
                  st == 200 and r["timed_out"] and _time.monotonic() - t0 < 15)
            st, _, _, r = cl.req("POST", "/api/lab/python", {"code": "print('x' * 300000)"})
            check("a flood of output is cut", st == 200 and r["truncated"] and len(r["stdout"]) <= 100_000)
            if importlib.util.find_spec("matplotlib"):
                st, _, _, r = cl.req("POST", "/api/lab/python", {"code": "import matplotlib.pyplot as plt\n"
                                                                          "plt.plot([1, 2, 3], [1, 4, 9])\nplt.show()"})
                check("a figure comes back as a picture",
                      st == 200 and len(r["figures"]) == 1 and r["figures"][0].startswith("iVBOR") and r["exit"] == 0)
            saved = cl.token
            cl.token = ""
            st, *_ = cl.req("POST", "/api/lab/python", {"code": "print(1)"})
            check("Python without the page's token is refused", st == 403)
            cl.token = saved
            st, *_ = cl.req("POST", "/api/lab/python", {"code": "print(1)"}, headers={"Origin": "http://evil.example"})
            check("Python from another origin is refused", st == 403)
            app.cfg.lab_python = False
            st, _, _, r = cl.req("POST", "/api/lab/python", {"code": "print(1)"})
            check("with Python turned off in the settings, nothing runs", st == 403)
            st, _, _, info = cl.req("GET", "/api/lab")
            check("and the lab says so", st == 200 and info["python"] is False)
            app.cfg.lab_python = True

            st, _, _, r = cl.req("POST", "/api/lab/attempt", {"exercise": "softmax", "passed": 2, "total": 3})
            st2, _, _, _ = cl.req("POST", "/api/lab/attempt", {"exercise": "softmax", "passed": 3, "total": 3})
            rows = app.ledger.rows("lab")
            check("an exercise's run is kept in the site's own ledger",
                  st == 200 and st2 == 200 and len(rows) == 2 and rows[-1]["exercise"] == "softmax")
            st, *_ = cl.req("POST", "/api/lab/attempt", {"exercise": "../x", "passed": 1, "total": 1})
            st2, *_ = cl.req("POST", "/api/lab/attempt", {"exercise": "softmax", "passed": 4, "total": 3})
            check("a run that cannot be is refused", st == 400 and st2 == 400)
            st, _, _, info = cl.req("GET", "/api/lab")
            check("the lab knows each exercise's best", info["results"]["softmax"]["best"] == 3)
            check("no road verdict is written by the lab", not list((root / "x" / "reports" / "learning")
                                                                     .glob("road-verdicts-*.jsonl")))
        finally:
            srv.shutdown()
            srv.server_close()


# ------------------------------------------------------------------ placement
def group_place(ctx) -> None:
    """Placement (the vault's Learning System Improvement Plan 2026-10, decision 3), through the site: the road's
    `place` asks; no key and no grade reach the page before the end; a miss comes back once in other words; the end
    shows what was missed with its keys; a right answer places what the goal rests on as provisional."""
    import shutil
    from . import demo
    from .app import App
    from .config import Config
    from .grade import FakeGrader, SelfGrader
    from .vault import Vault
    from .web import make_server

    for flow in ("miss", "right", "dontknow", "skip"):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            demo.make_demo(root)
            learn = root / "x" / "reports" / "learning"
            if flow == "skip":
                bank_p = root / "x" / "Checks" / "Counting.json"
                kept_bank = bank_p.read_text(encoding="utf-8")
                bank_p.unlink()
            web = root.parent / f"{root.name}-web" / "web"
            web.mkdir(parents=True)
            shutil.copy2(SITE / "web" / "index.html", web / "index.html")
            app = App(Config(vault=str(root), port=0), vault=Vault(ctx["code_root"], root), grader=FakeGrader(),
                      web_dir=web)
            srv = make_server(app, "127.0.0.1", 0)
            app.port = srv.server_address[1]
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            cl = Client(app.port)
            try:
                _, _, body, _ = cl.req("GET", "/")
                cl.token = re.search(rb'name="los-token" content="([0-9a-f]{32,})"', body).group(1).decode()
                if flow == "skip":
                    # 24 Oct 2026: a concept whose bank cannot be written is stepped past, and asked once it has one
                    st, _, _, p = cl.req("GET", "/api/place?goal=Natural%20number")
                    check("[skip] a concept with no bank is offered, its bank missing",
                          st == 200 and p["kind"] == "place" and p["bank"] == "missing" and "item" not in p)
                    st, _, _, r = cl.req("POST", "/api/place/skip", {"goal": "Natural number", "concept": "Counting",
                                                                     "why": "the note cannot carry a bank yet"})
                    st2, _, _, d = cl.req("GET", "/api/place?goal=Natural%20number")
                    check("[skip] skipped, placement is done but for it, and names it as waiting",
                          st == 200 and r["skipped"] == "Counting" and d["kind"] == "done" and d["waiting"] == ["Counting"]
                          and d["unknown"] == 0 and d["placed"] == 0)
                    rows = [json.loads(x) for f in learn.glob("road-placement-*.jsonl")
                            for x in f.read_text(encoding="utf-8").splitlines() if x.strip()]
                    check("[skip] a skip settles nothing: one `skip` row", [r["kind"] for r in rows] == ["skip"])
                    bank_p.write_text(kept_bank, encoding="utf-8")
                    st, _, _, p = cl.req("GET", "/api/place?goal=Natural%20number")
                    check("[skip] with its bank, it is asked again", p["kind"] == "place" and p["concept"] == "Counting"
                          and p["bank"] == "ok")
                    st, *_ = cl.req("POST", "/api/place/skip", {"goal": "Natural number", "concept": "Counting"})
                    check("[skip] a concept with a bank is answered, never skipped", st == 409)
                    continue
                bank = json.loads((root / "x" / "Checks" / "Counting.json").read_text(encoding="utf-8"))
                work = next(q for q in bank["questions"] if q["facet"] == "work")
                st, _, raw, p = cl.req("GET", "/api/place?goal=Natural%20number")
                check(f"[{flow}] placement asks what settles the most, its 'use it' question alone",
                      st == 200 and p["kind"] == "place" and p["concept"] == "Counting" and p["variant"] == 0
                      and [q["q"] for q in p["questions"]] == [work["q"]])
                check(f"[{flow}] no key or evidence reaches the page", b'"key"' not in raw and b'"evidence"' not in raw)
                qid = p["questions"][0]["qid"]
                if flow == "miss":
                    st, _, raw, r = cl.req("POST", "/api/place/answer", {"item": p["item"], "qid": qid, "answer": "no idea"})
                    check("a placement answer is recorded, with no key and no grade", st == 200 and r["recorded"]
                          and r["again"] and b'"key"' not in raw and b'"correct"' not in raw)
                    st, *_ = cl.req("POST", "/api/place/answer", {"item": p["item"], "qid": qid, "answer": "again"})
                    check("an answered item cannot be answered again", st == 410)
                    st, _, _, p2 = cl.req("GET", "/api/place?goal=Natural%20number")
                    check("a miss comes back once more, in the bank's last variant", st == 200 and p2["again"]
                          and p2["concept"] == "Counting" and p2["variant"] == len(work["variants"])
                          and p2["questions"][0]["q"] == work["variants"][-1]["q"])
                    app.grader = SelfGrader()
                    st, _, _, g = cl.req("POST", "/api/place/answer", {"item": p2["item"],
                                                                       "qid": p2["questions"][0]["qid"],
                                                                       "answer": "still no idea"})
                    check("without Claude the learner grades it against the key", st == 200 and g["needs_self"]
                          and g["key"] == work["variants"][-1]["key"])
                    st, _, _, r = cl.req("POST", "/api/place/self", {"attempt": g["attempt"], "correct": False})
                    check("...and the self-grade is recorded", st == 200 and r["recorded"] and not r["again"])
                    app.grader = FakeGrader()
                    st, _, _, d = cl.req("GET", "/api/place?goal=Natural%20number")
                    items = (d.get("review") or [{}])[0].get("items", [])
                    check("missed twice: placement is done, and shows the questions, the answers and the keys",
                          st == 200 and d["kind"] == "done" and d["unknown"] == 1 and d["placed"] == 0
                          and [x["answer"] for x in items] == ["no idea", "still no idea"]
                          and [x["key"] for x in items] == [work["key"], work["variants"][-1]["key"]])
                    st, _, _, nx = cl.req("GET", "/api/next")
                    wq = next((q["q"] for q in nx.get("questions", []) if q["facet"] == "work"), None)
                    check("the missed concept is the first check, asked in the variants",
                          nx["kind"] == "check" and nx["concept"] == "Counting" and wq == work["variants"][0]["q"])
                    rows = [json.loads(x) for f in (learn / "los").glob("attempts-*.jsonl")
                            for x in f.read_text(encoding="utf-8").splitlines() if x.strip()]
                    check("the site keeps each placement answer in its ledger, apart from the checks",
                          [r["type"] for r in rows] == ["place", "place"] and rows[1]["grader"] == "self")
                elif flow == "dontknow":
                    graded, real_grade = [], app.grader.grade
                    app.grader.grade = lambda *a, **k: (graded.append(1), real_grade(*a, **k))[1]
                    st, _, raw, r = cl.req("POST", "/api/place/answer", {"item": p["item"], "qid": qid,
                                                                       "dont_know": True})
                    check("[dontknow] \"I don't know\" is recorded and settles at once: it does not come back",
                          st == 200 and r["recorded"] and not r["again"] and b'"key"' not in raw)
                    st, _, _, d = cl.req("GET", "/api/place?goal=Natural%20number")
                    items = (d.get("review") or [{}])[0].get("items", [])
                    check("[dontknow] placement is done; the review says \"I don't know\" and shows the key",
                          d["kind"] == "done" and d["unknown"] == 1 and [x.get("dont_know") for x in items] == [True]
                          and items[0]["key"] == work["key"])
                    st, _, _, nx = cl.req("GET", "/api/next")
                    q0 = nx["questions"][0]
                    st, _, _, g = cl.req("POST", "/api/attempt", {"item": nx["item"], "qid": q0["qid"],
                                                                  "dont_know": True})
                    check("[dontknow] on a check it is a miss with the key, no confidence asked",
                          st == 200 and g["correct"] is False and g["dont_know"] and g["key"] and g["grader"] == "self")
                    check("[dontknow] neither answer is sent to the grader", graded == [])
                    rows = [json.loads(x) for f in (learn / "los").glob("attempts-*.jsonl")
                            for x in f.read_text(encoding="utf-8").splitlines() if x.strip()]
                    check("[dontknow] the ledger marks both, with no confidence on the check",
                          [r.get("dont_know") for r in rows] == [True, True] and rows[-1]["confidence"] is None)
                else:
                    st, _, _, r = cl.req("POST", "/api/place/answer", {"item": p["item"], "qid": qid,
                                                                       "answer": work["key"]})
                    check("a right answer is recorded, and does not come back", st == 200 and r["recorded"]
                          and not r["again"])
                    st, _, _, d = cl.req("GET", "/api/place?goal=Natural%20number")
                    check("placement is done, the concept placed, and the goal ready for its full check",
                          d["kind"] == "done" and d["placed"] == 1 and d["goal_status"] == "ready" and d["review"] == [])
                    st, _, _, gr = cl.req("GET", "/api/graph")
                    check("the map shows the placed concept as provisional",
                          {n["name"]: n["status"] for n in gr["nodes"]} == {"Collection": "granted",
                                                                            "Counting": "provisional",
                                                                            "Natural number": "ready"})
                    check("placement records no road verdict", not sorted(learn.glob("road-verdicts-*.jsonl")))
                    st, _, _, c = cl.req("GET", "/api/next?concept=Counting")
                    check("a provisional concept is not offered for a check", st == 409
                          and c.get("road_status") == "provisional")
                    st, _, _, nx = cl.req("GET", "/api/next")
                    check("the road goes on with the goal's full check", nx["kind"] == "check"
                          and nx["concept"] == "Natural number")
                    # In my words (decision 6): after a pass, one sentence as written; never on a concept not passed
                    st, _, _, w = cl.req("POST", "/api/words", {"concept": "Counting", "text": "Mine."})
                    check("In my words is refused on a concept that has not passed a check", st == 409)
                    nbank = demo.bank_from_note("Natural number", (root / "Atlas" / "Concepts" / "Natural number.md")
                                                .read_text(encoding="utf-8"))
                    check("the goal's bank is written through the road's validator", app.vault.save_bank(nbank) == [])
                    st, _, _, nx = cl.req("GET", "/api/next")
                    keys = {q["facet"]: q["key"] for q in nbank["questions"]}
                    for q in nx.get("questions", []):
                        cl.req("POST", "/api/attempt", {"item": nx["item"], "qid": q["qid"], "answer": keys[q["facet"]],
                                                        "confidence": 3})
                    st, _, _, v = cl.req("POST", "/api/verdict", {"item": nx.get("item")})
                    st, _, _, w = cl.req("POST", "/api/words", {"concept": "Natural number",
                                                                "text": "  It is where   counting ends. "})
                    led = learn / "in-my-words.jsonl"
                    rows = [json.loads(x) for x in led.read_text(encoding="utf-8").splitlines()] if led.exists() else []
                    check("after a pass, In my words is kept as written, in the road's ledger",
                          v.get("passed") and st == 200 and w["ok"] and [(r["concept"], r["text"], r["source"])
                          for r in rows] == [("Natural number", "It is where counting ends.", "los")])
                    note = (root / "Atlas" / "Concepts" / "Natural number.md").read_text(encoding="utf-8")
                    check("the site writes no note: the sentence waits for the road's writer", "It is where" not in note)
                st, *_ = cl.req("GET", "/api/place?goal=Nowhere%20at%20all")
                check(f"[{flow}] a goal that is no concept note is 404", st == 404)
                st, *_ = cl.req("GET", "/api/place?goal=Stray%20idea")
                check(f"[{flow}] a concept off the graph is refused by the road", st == 409)
            finally:
                srv.shutdown()
                srv.server_close()
                shutil.rmtree(web.parent, ignore_errors=True)


# ------------------------------------------------------------------ the page's own tests
def group_js(ctx) -> None:
    """The page's pure modules (the graph's layout, the formula parser, the Lab's models and exercises), tested with
    Node's test runner when Node is installed."""
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        print("  skip  Node is not installed: the page's own tests did not run")
        return
    tests = sorted((SITE / "tests" / "js").glob("*.test.mjs"))
    check("the page's modules have tests", len(tests) >= 3)
    p = subprocess.run([node, "--test", *map(str, tests)], capture_output=True, text=True, encoding="utf-8",
                       timeout=300, cwd=str(SITE))
    plain = lambda s: s.encode("ascii", "replace").decode("ascii")   # the console may not be UTF-8
    summary = [plain(x[1:].strip()) for x in p.stdout.splitlines() if x.startswith(("ℹ pass", "ℹ fail"))]
    print("  " + ", ".join(summary))
    if p.returncode != 0:
        print(plain("\n".join(x for x in p.stdout.splitlines() if "✖" in x or "not ok" in x)[:4000]))
    check("the page's own tests pass", p.returncode == 0)


def group_tutor(ctx) -> None:
    """The course tutor (the vault's Course Tutor and 3D Viewer Plan 2026-10, §3): los/selftest_tutor.py."""
    from .selftest_tutor import group_tutor as run_tutor
    run_tutor(ctx)


GROUPS = {"render": group_render, "grade": group_grade, "ledger": group_ledger, "bridge": group_bridge,
          "jobs": group_jobs, "api": group_api, "gradertest": group_gradertest, "config": group_config,
          "lab": group_lab, "js": group_js, "tutor": group_tutor, "place": group_place}


def run(names: list[str], code_root: Path) -> int:
    ctx = {"code_root": Path(code_root)}
    for name in names or list(GROUPS):
        print(f"knowledge-os selftest: {name}")
        try:
            GROUPS[name](ctx)
        except Exception:       # a group that cannot even run is a failure of its own, not a crash of the rest
            traceback.print_exc()
            check(f"{name} ran to the end", False)
    print(f"{RESULTS['ok']} ok, {RESULTS['fail']} failed")
    return 0 if RESULTS["fail"] == 0 else 1


def group_explore(ctx) -> None:
    """Explore (the vault's Knowledge OS Design §3-§4): the disciplines, a field's record, its river and frontier, any
    note, the search, and their routes, on the demo vault with a small field added."""
    from . import demo
    from .app import App, HttpError
    from .config import Config
    from .explore import Explore
    from .grade import FakeGrader
    from .vault import Vault

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        demo.make_demo(root)
        demo.make_explore_demo(root)
        vault = Vault(ctx["code_root"], root)
        x = Explore(vault)
        tree = x.tree()
        branch = next((b for b in tree["branches"] if b["name"] == "Theoretical Disciplines"), None)
        check("the branches come from DISCIPLINES, the fields from each branch",
              branch is not None and [f["name"] for f in branch["fields"]] == ["Mechanics"])
        f = branch["fields"][0] if branch else {}
        check("a field counts its concepts and claims apart", f.get("concepts") == 3 and f.get("claims") == 1)
        check("and how many are dated", f.get("dated") == 3)
        rec = x.record(x.get("Mechanics"))
        sc = {s["key"]: s["score"] for s in rec["sections"]}
        check("scope and the drawn map are present", sc["scope"] == "present" and sc["map"] == "present")
        check("every concept dated: dated is present", sc["dated"] == "present")
        check("two events are a thin history (ten make it present)", sc["history"] == "thin")
        check("a settled debate with its type and status is present", sc["debates"] == "present")
        check("a released tool, an open question: present", sc["tools"] == "present" and sc["questions"] == "present")
        check("completeness is the sections' score", 0 < rec["completeness"] < 100)
        check("a person named with no card is a gap", rec["gaps"]["missing_people"] == ["Galileo Galilei"])
        river = x.river("Mechanics")
        lanes = {e["lane"] for e in river["events"]}
        check("the river has ideas, an experiment, a debate and a tool", {"ideas", "experiments", "debates", "tools"} <= lanes)
        p = next((e for e in river["events"] if e["label"] == "Newtonian gravity"), {})
        check("an event carries its Hijri years", p.get("hijri") == "1098–1099 AH" and p.get("hijri_ar") == "١٠٩٨–١٠٩٩ هـ")
        check("an idea's people come with it", p.get("people") == ["Isaac Newton"])
        check("the people's lives are drawn from their cards", {l["name"] for l in river["lives"]} == {"Isaac Newton", "Albert Einstein"})
        deb = next((e for e in river["events"] if e["lane"] == "debates"), {})
        check("a debate spans its argument to its settling", deb.get("lo") == 1915 and deb.get("settled_in") == 1919)
        fr = x.frontier("Mechanics")
        check("a settled debate is not on the frontier; the open question is",
              fr["open_debates"] == [] and fr["questions"] == ["What is dark matter"])
        n = x.note("Newtonian gravity")
        check("a note knows what generalizes it", n["reverse"].get("generalizes") == ["General relativity"])
        check("and where it hangs", n["chain"][:3] == ["Mechanics", "Theoretical Disciplines", "DISCIPLINES"])
        check("its date with the Hijri year", n["dates"]["introduced"]["hijri"] == "1098–1099 AH")
        check("the search finds by part of a name", "Newtonian gravity" in [h["name"] for h in x.search("grav")])
        check("a short search finds nothing", x.search("g") == [])

        cfg = Config(vault=str(root), port=0)
        app = App(cfg, vault=vault, grader=FakeGrader(), web_dir=SITE / "web")
        check("the routes answer", app.api_explore({})["root"] == "DISCIPLINES"
              and app.api_field({"name": ["Mechanics"]})["name"] == "Mechanics"
              and bool(app.api_river({"name": ["Mechanics"]})["events"]))
        try:
            app.api_field({"name": ["Nowhere"]})
            check("a field that does not exist is 404", False)
        except HttpError as e:
            check("a field that does not exist is 404", e.status == 404)
        xn = app.api_xnote({"name": ["General relativity"]})
        check("a note's links open in Explore, not on the road", "#/note/" in xn["html"] and "#/concept/" not in xn["html"])
        check("a note's text is not sent twice", "text" not in xn)


GROUPS["explore"] = group_explore


def group_teach(ctx) -> None:
    """The Teach tab (the vault's Knowledge OS Design 2026-10, §6): los/selftest_teach.py."""
    from .selftest_teach import group_teach as run_teach
    run_teach(ctx)


GROUPS["teach"] = group_teach


def group_lang(ctx) -> None:
    """The page's language and the vault's bilingual pairs (CLAUDE.md §7): los/selftest_lang.py."""
    from .selftest_lang import group_lang as run_lang
    run_lang(ctx)


GROUPS["lang"] = group_lang


def group_coach(ctx) -> None:
    """The coach (the vault's x/SYSTEM/Study Coach Plan 2026-10.md): los/selftest_coach.py."""
    from .selftest_coach import group_coach as run_coach
    run_coach(ctx)


GROUPS["coach"] = group_coach


def group_start(ctx) -> None:
    """Starting at logon before the vault's drive is there (22 Oct 2026: Google Drive mounted G: after the logon task
    ran, the server stopped with 'no learning road', and the site stayed down all day): with --wait-for-vault it waits
    and polls instead, on a fake clock here."""
    from .config import Config
    from .serve import serve, wait_for_vault

    with tempfile.TemporaryDirectory(prefix="los-start-") as tmp:
        vault = Path(tmp) / "vault"
        road = vault / "x" / "scripts" / "_road.py"
        said = []
        now = [0.0]
        slept = []

        def fake_sleep(s, appear_after=None):
            slept.append(s)
            now[0] += s
            if appear_after is not None and now[0] >= appear_after and not road.exists():
                road.parent.mkdir(parents=True)
                road.write_text("", encoding="utf-8")

        def waiting(wait_s, appear_after=None):
            said.clear(), slept.clear()
            now[0] = 0.0
            return wait_for_vault(vault, wait_s, poll_s=10, clock=lambda: now[0],
                                  sleep=lambda s: fake_sleep(s, appear_after), say=said.append)

        check("with no wait, a missing vault is reported at once", waiting(0) is False and slept == [])
        check("waiting, the vault that appears after a minute is found",
              waiting(1800, appear_after=60) is True and sum(slept) == 60 and len(said) == 2
              and "waiting" in said[0] and "found" in said[1])
        check("the wait polls every 10 seconds", slept and all(s == 10 for s in slept))
        check("a vault already there is found without a wait", waiting(1800) is True and slept == [] and said == [])
        road.unlink()
        check("one that never appears is given up at the limit, saying so",
              waiting(120) is False and sum(slept) == 120 and "gave up" in said[-1])
        cfg = Config(vault=str(Path(tmp) / "nowhere"), port=0)
        check("serve still stops with 2 when the vault is missing and no wait is asked", serve(cfg, wait_s=0) == 2)

    task = (SITE / "autostart.ps1").read_text(encoding="utf-8")
    check("the logon task asks the server to wait for the vault", "--wait-for-vault" in task)


GROUPS["start"] = group_start


def _providers():
    """The model providers and the trust gate (los/selftest_providers.py)."""
    from .selftest_providers import register
    register(GROUPS)


_providers()
