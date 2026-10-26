"""A small vault to learn on without touching yours: three concepts on one road, two banks, a lecture, and a course
of three lectures for the tutor.

Used by the selftest and by `python server.py --demo`. Its notes are written the way the vault writes them (CRLF,
the road's frontmatter), so the road's own code reads them as it reads the real ones.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROAD = "Road to Numbers"
COURSE = "Numbers - A Demo Course"
LECTURES = [
    ("l1", "Collections", "Collection", "Many things can be taken together as one.", ["Things taken together"]),
    ("l2", "Counting", "Counting", "Counting turns a collection into a number.",
     ["Pairing members with numbers", "The last number said"]),
    ("l3", "Natural numbers", "Natural number", "The natural numbers are where counting ends.",
     ["Counting finite collections", "One more, and one more"]),
]

NOTES = {
    "Collection": {
        "axiom": True,
        "body": [
            "> [!abstract] In one sentence",
            "> A collection is many things taken together as one.",
            "",
            "## Definition",
            "",
            "A collection is many things taken together as one. The things in it are its members, and the collection "
            "is one thing of its own, which can be named, moved and counted as a whole.",
            "",
            "## Worked example",
            "",
            "Three cups on a tray are a collection: the tray carries all three at once. Written with braces, the "
            "collection of the numbers one to three is $\\{1, 2, 3\\}$, and it has $|\\{1,2,3\\}| = 3$ members.",
            "",
            "```mermaid",
            "graph LR",
            "    A[cup] --> T((tray))",
            "    B[cup] --> T",
            "    C[cup] --> T",
            "```",
            "",
            "## Why it matters",
            "",
            "Treating many things as one lets a rule speak about all of them at once instead of one at a time.",
        ],
    },
    "Counting": {
        "requires": ["Collection"],
        "body": [
            "> [!abstract] In one sentence",
            "> Counting pairs the members of a collection with the numbers one, two, three, in order.",
            "",
            "## Definition",
            "",
            "Counting pairs the members of a collection with the numbers one, two, three, in order. The last number "
            "said is how many members the collection has.",
            "",
            "## Worked example",
            "",
            "Point at each of four apples in turn and say one, two, three, four: the last number said is four.",
            "",
            "$$",
            "n = |\\{a_1, a_2, a_3, a_4\\}| = 4",
            "$$",
            "",
            "## Why it matters",
            "",
            "Counting turns the question how many into a procedure that anyone can repeat and check.",
        ],
    },
    "Natural number": {
        "requires": ["Counting"],
        "body": [
            "> [!abstract] In one sentence",
            "> A natural number is what counting a finite collection ends on.",
            "",
            "## Definition",
            "",
            "A natural number is what counting a finite collection ends on. The natural numbers are one, two, three "
            "and every number reached by adding one more.",
            "",
            "## Worked example",
            "",
            "Counting the five fingers of one hand ends on five, so five is a natural number.",
            "",
            "## Why it matters",
            "",
            "Natural numbers are the first numbers, and every other kind of number is built from them.",
        ],
    },
    "Stray idea": {
        "body": ["A concept note that is not on any road yet."],
    },
}

BANKS = {
    "Collection": [
        ("define", "What is a collection?", "Many things taken together as one.",
         "A collection is many things taken together as one.",
         ("In your own words, what makes several things a collection?", "They are taken together as one thing.",
          "A collection is many things taken together as one.")),
        ("work", "Give a collection from the note and say how many members it has.",
         "The numbers one to three, written {1, 2, 3}, has three members.",
         "Written with braces, the collection of the numbers one to three is $\\{1, 2, 3\\}$, and it has "
         "$|\\{1,2,3\\}| = 3$ members.",
         ("What carries the three cups at once in the note's example?", "The tray.",
          "Three cups on a tray are a collection: the tray carries all three at once.")),
        ("why", "Why treat many things as one?", "So a rule can speak about all of them at once.",
         "Treating many things as one lets a rule speak about all of them at once instead of one at a time.",
         ("What does a collection let a rule do?", "Speak about all its members at once.",
          "Treating many things as one lets a rule speak about all of them at once instead of one at a time.")),
    ],
    "Counting": [
        ("define", "What is counting?", "Pairing the members of a collection with one, two, three, in order.",
         "Counting pairs the members of a collection with the numbers one, two, three, in order.",
         ("What does the last number said tell you?", "How many members the collection has.",
          "The last number said is how many members the collection has.")),
        ("work", "Count four apples: what number do you end on?", "Four.",
         "Point at each of four apples in turn and say one, two, three, four: the last number said is four.",
         ("Counting a collection ends on four. How many members has it?", "Four.",
          "The last number said is how many members the collection has.")),
        ("why", "Why count instead of guessing how many?", "It is a procedure anyone can repeat and check.",
         "Counting turns the question how many into a procedure that anyone can repeat and check.",
         ("What does counting turn the question how many into?", "A procedure anyone can repeat and check.",
          "Counting turns the question how many into a procedure that anyone can repeat and check.")),
    ],
}


def _write(root: Path, rel: str, lines: list[str]) -> Path:
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\r\n")      # CRLF, like most of the vault
    return p


def make_demo(root: Path) -> dict:
    root = Path(root)
    for name, spec in NOTES.items():
        fm = ["---", f'title: "{name}"', "type: concept", "status: growing", "domain: mathematics"]
        if spec.get("axiom"):
            fm += ["axiom: true", "requires: []"]
        elif "requires" in spec:
            fm += ["requires:"] + [f'  - "[[{r}]]"' for r in spec["requires"]]
        _write(root, f"Atlas/Concepts/{name}.md", fm + ["---", "```nav", "```", "", f"# {name}", ""] + spec["body"])
    _write(root, f"Areas/Education/Roads/{ROAD}.md",
           ["---", f"title: {ROAD}", "type: road", "active: true", "priority: 1", "daily_new: 2", "goals:",
            '  - "[[Natural number]]"', "---", "", f"# {ROAD}"])
    _write(root, "Library/Sources/demo/Demo L01 - Counting.md",
           ["---", "title: Demo L01 - Counting", "type: source-summary", "source_type: lecture",
            "teaches:", '  - "[[Counting]]"', "---", "", "# Demo L01 - Counting"])
    # A course of three lectures for the tutor (2 Oct 2026): a card, and lecture notes that name it, in order.
    _write(root, f"Library/Courses/{COURSE}.md",
           ["---", f'title: "{COURSE}"', "type: course", "status: growing", "---", "", f"# {COURSE}", "",
            "A short course from collections to the natural numbers, in three lectures."])
    for n, (slug, title, concept, one_line, parts) in enumerate(LECTURES, 1):
        name = f"Numbers L0{n} - {title}"
        body = ["---", f'title: "{name}"', "type: lecture", "source_type: lecture", f'course: "[[{COURSE}]]"',
                f"number: {n}", f'up: "[[{COURSE}]]"', "teaches:", f'  - "[[{concept}]]"', "---", "```nav", "```",
                "", f"# {name}", "", "> [!abstract] The lecture in one line", f"> {one_line}", "", "## Arc", ""]
        for i, part in enumerate(parts):
            body += [f"### {i + 1}. {part} — [{i * 10:02d}:00](https://example.org/{slug}&t={i * 600})", "",
                     f"The lecture's part on {part.lower()}.", ""]
        _write(root, f"Library/Sources/numbers/{name}.md", body)
    for concept, qs in BANKS.items():
        bank = {"concept": concept, "written": "2026-09-29", "questions": [
            {"facet": f, "q": q, "key": k, "evidence": e, "variants": [{"q": vq, "key": vk, "evidence": ve}]}
            for f, q, k, e, (vq, vk, ve) in qs]}
        p = root / "x" / "Checks" / f"{concept}.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(bank, ensure_ascii=False, indent=2), encoding="utf-8")
    (root / "x" / "reports" / "learning").mkdir(parents=True, exist_ok=True)
    return {"road": ROAD, "concepts": list(NOTES)}


def bank_from_note(concept: str, note_text: str) -> dict:
    """The tests' bank writer: the note's first three full sentences, each its own evidence."""
    body = re.sub(r"\A.*?\n---[ \t]*\r?\n", "", note_text.replace("\r\n", "\n"), count=1, flags=re.S)
    sents = []
    for line in body.split("\n"):
        line = line.strip().lstrip(">").strip()
        if not line or line.startswith(("#", "`", "$", "[!")):
            continue
        for s in re.split(r"(?<=\.)\s+", line):
            if len(s.split()) >= 5 and s.endswith(".") and s not in sents:
                sents.append(s)
    sents = (sents + sents * 3)[:3]
    return {"concept": concept, "questions": [
        {"facet": f, "q": f"{f.capitalize()}: say it in your words.", "key": s, "evidence": s,
         "variants": [{"q": f"{f.capitalize()}, again.", "key": s, "evidence": s}]}
        for f, s in zip(("define", "work", "why"), sents)]}


# Explore's demo (8 Oct 2026): a small field under DISCIPLINES with dated concepts, a claim, a history, a settled debate,
# an open question, a tool and two people, so the record, the river and the frontier have something of each kind.
EXPLORE = {
    "Atlas/Topics/DISCIPLINES.md": ["type: moc", 'up: "[[ATLAS]]"'],
    "Atlas/Topics/Theoretical Disciplines.md": ["type: moc", 'up: "[[DISCIPLINES]]"'],
    "Atlas/Topics/Mechanics.md": ["type: moc", 'up: "[[Theoretical Disciplines]]"'],
    "Atlas/Concepts/Newtonian gravity.md": ["type: concept", "status: growing", 'up: "[[Mechanics]]"', "introduced: 1687",
                                            'introduced_by: ["[[Isaac Newton]]"]'],
    "Atlas/Concepts/General relativity.md": ["type: concept", "status: growing", 'up: "[[Mechanics]]"', "introduced: 1915",
                                             'introduced_by: ["[[Albert Einstein]]"]', 'generalizes: ["[[Newtonian gravity]]"]'],
    "Atlas/Concepts/Inertia.md": ["type: concept", "status: growing", 'up: "[[Mechanics]]"', "introduced: 1638",
                                  'introduced_by: ["[[Galileo Galilei]]"]'],
    "Atlas/Concepts/Gravity bends light.md": ["type: concept", "status: growing", 'up: "[[General relativity]]"'],
    "Atlas/Timelines/History of Mechanics.md": ["type: timeline", 'up: "[[TIMELINES]]"', 'timeline_of: "[[Mechanics]]"'],
    "Atlas/Debates/Is gravity a force or curvature.md": ["type: debate", 'up: "[[DEBATES]]"', 'related: ["[[Mechanics]]"]',
                                                        "debate_type: school", "debate_status: settled", 'period: "1915/1919"',
                                                        "settled_in: 1919"],
    "Atlas/Questions/What is dark matter.md": ["type: question", 'up: "[[OPEN QUESTIONS]]"', 'related: ["[[Mechanics]]"]'],
    "Library/People/Isaac Newton.md": ["type: person", "born: 1643", "died: 1727"],
    "Library/People/Albert Einstein.md": ["type: person", "born: 1879", "died: 1955"],
    "Library/Things/Orrery Simulator.md": ["type: entity", 'related: ["[[Mechanics]]"]', "released: 2020"],
}
EXPLORE_BODY = {
    "Atlas/Topics/Mechanics.md": ["> [!abstract] The science of motion and its causes.", "",
                                  " ".join(["Mechanics studies how bodies move and why, from the fall of a stone to the orbit of a planet."] * 12),
                                  "", "## The map", "", "A drawing of the field."],
    "Atlas/Concepts/General relativity.md": ["It generalizes [[Newtonian gravity]]: gravity is the curvature of spacetime."],
    "Atlas/Timelines/History of Mechanics.md": ["## Events", "", "| When | Event | Kind | Links | Impact |", "|---|---|---|---|---|",
                                                "| 1687 | The Principia | idea | [[Newtonian gravity]] | One law for heaven and earth |",
                                                "| 1919 | The eclipse expedition | experiment |  | Light bends by the predicted angle |"],
}


def make_explore_demo(root: Path) -> dict:
    root = Path(root)
    for rel, fm in EXPLORE.items():
        name = Path(rel).stem
        body = EXPLORE_BODY.get(rel, [f"The note on {name.lower()}."])
        _write(root, rel, ["---", f'title: "{name}"'] + fm + ["---", "```nav", "```", "", f"# {name}", ""] + body)
    return {"field": "Mechanics", "branch": "Theoretical Disciplines"}


# The bilingual demo (19 Oct 2026): two pairs wired the vault's way (CLAUDE.md §7), a concept on the road and a field
# map, each naming the other in `counterpart:` with the Arabic side marked `language: ar`. Run after the two above.
BILINGUAL = {
    "Atlas/Concepts/العد.md": ("Counting", ["type: concept", "status: growing", "domain: mathematics"], [
        "> [!abstract] في جملة واحدة",
        "> العدّ يقرن عناصر المجموعة بالأعداد واحد، اثنان، ثلاثة، بالترتيب.",
        "",
        "## التعريف",
        "",
        "العدّ يقرن عناصر المجموعة بالأعداد بالترتيب، وآخر عدد يُقال هو عدد عناصرها: $|\\{a,b,c\\}| = 3$."]),
    "Atlas/Topics/خارطة الميكانيكا.md": ("Mechanics", ["type: moc", 'up: "[[العلوم النظرية]]"'], [
        "> [!abstract] علم الحركة وأسبابها.", "", "الميكانيكا تدرس كيف تتحرك الأجسام ولماذا."]),
    "Atlas/Topics/العلوم النظرية.md": ("Theoretical Disciplines", ["type: moc", 'up: "[[فروع المعرفة]]"'], [
        "العلوم التي تطلب معرفة الطبيعة لذاتها."]),
}


def make_bilingual_demo(root: Path) -> dict:
    root = Path(root)
    pairs = {}
    for rel, (english, fm, body) in BILINGUAL.items():
        name = Path(rel).stem
        _write(root, rel, ["---", f'title: "{name}"', "language: ar", f'counterpart: "[[{english}]]"',
                           "translation_status: aligned"] + fm + ["---", "```nav", "```", "", f"# {name}", ""] + body)
        p = Path(root) / Path(rel).parent / f"{english}.md"
        text = p.read_text(encoding="utf-8").replace("\r\n", "\n")
        p.write_text(text.replace("---\n", f'---\nlanguage: en\ncounterpart: "[[{name}]]"\n', 1),
                     encoding="utf-8", newline="\r\n")
        pairs[english] = name
    return pairs
