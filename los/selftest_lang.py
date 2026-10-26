"""The page's language and the vault's bilingual pairs (CLAUDE.md §7), on the demo vault with two pairs added: in
Arabic, a note's view shows its Arabic counterpart, and says plainly why when there is none; the road's numbers stay
the English note's. No call reaches Claude."""
from __future__ import annotations

import tempfile
from pathlib import Path

from .selftest import SITE, check


def group_lang(ctx) -> None:
    from . import demo
    from .app import App
    from .config import Config
    from .grade import FakeGrader
    from .vault import Vault

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        demo.make_demo(root)
        demo.make_explore_demo(root)
        pairs = demo.make_bilingual_demo(root)
        vault = Vault(ctx["code_root"], root)
        app = App(Config(vault=str(root), port=0), vault=vault, grader=FakeGrader(), web_dir=SITE / "web")
        ar = pairs["Counting"]

        # ---------------------------------------------------------------- a cold start waits for nothing
        # Explore's first index reads every Atlas and Library note: 32 s on the Drive mount (19 Oct 2026). The concept
        # page reads the pair from its two notes, and the Arabic names say they are not ready rather than wait.
        cold = app.api_labels({"lang": ["ar"]})
        check("before Explore's index is built, the names say they are not ready, and nothing waits",
              cold["ready"] is False and cold["labels"] == {} and not app.explore.notes)
        first = app.api_concept({"name": ["Counting"], "lang": ["ar"]})
        check("and the concept page finds the Arabic note from the two notes alone",
              first["view"]["name"] == ar and "يقرن عناصر المجموعة" in first["html"] and not app.explore.notes)

        # ---------------------------------------------------------------- the road's concept page
        en = app.api_concept({"name": ["Counting"]})
        check("in English the concept page shows the English note, as before",
              en["view"]["lang"] == "en" and en["view"]["missing"] is None and "pairs the members" in en["html"])
        c = app.api_concept({"name": ["Counting"], "lang": ["ar"]})
        check("in Arabic the concept page shows the note's Arabic counterpart",
              c["view"]["lang"] == "ar" and c["view"]["name"] == ar and "يقرن عناصر المجموعة" in c["html"]
              and "pairs the members" not in c["html"])
        check("and its Arabic title", c["view"]["title"] == ar)
        check("while the road's numbers stay the English note's",
              c["name"] == "Counting" and c["in_graph"] and [r["name"] for r in c["requires"]] == ["Collection"])
        none = app.api_concept({"name": ["Collection"], "lang": ["ar"]})
        check("a concept with no Arabic note says so, and shows the English one",
              none["view"]["missing"] == "none" and none["view"]["lang"] == "en" and "taken together as one" in none["html"])
        back = app.api_concept({"name": [ar], "lang": ["ar"]})
        check("the Arabic note opened by its own name finds its place on the road",
              back["name"] == "Counting" and back["in_graph"] and back["view"]["name"] == ar)
        en_of_ar = app.api_concept({"name": [ar], "lang": ["en"]})
        check("and in English it shows the English counterpart", en_of_ar["view"]["name"] == "Counting"
              and "pairs the members" in en_of_ar["html"])
        show = app.api_concept({"name": ["Counting"], "lang": ["ar"], "show": ["en"]})
        check("the Arabic page can still open the English note on request",
              show["view"]["lang"] == "en" and show["view"]["missing"] is None and "pairs the members" in show["html"]
              and show["view"]["other"] == ar)
        check("and the Arabic view names the English one beside it", c["view"]["other"] == "Counting")

        # ---------------------------------------------------------------- Explore's note page: why there is none
        claim = app.api_xnote({"name": ["Gravity bends light"], "lang": ["ar"]})
        check("a claim is English by design, and the view says so", claim["view"]["missing"] == "claim")
        q = app.api_xnote({"name": ["What is dark matter"], "lang": ["ar"]})
        check("a question is English by design, and the view says so", q["view"]["missing"] == "question")
        person = app.api_xnote({"name": ["Isaac Newton"], "lang": ["ar"]})
        check("a Library card is English by design", person["view"]["missing"] == "english-primary")
        gr = app.api_xnote({"name": ["General relativity"], "lang": ["ar"]})
        check("any other note simply has no Arabic version yet", gr["view"]["missing"] == "none")
        mech = app.api_xnote({"name": ["Mechanics"], "lang": ["ar"]})
        check("a map with an Arabic counterpart is shown in Arabic",
              mech["view"]["lang"] == "ar" and "علم الحركة" in mech["html"] and "science of motion" not in mech["html"])
        check("with the English note's place in the tree", mech["name"] == "Mechanics"
              and mech["chain"][:2] == ["Theoretical Disciplines", "DISCIPLINES"])
        check("in English, Explore's note is the English one", app.api_xnote({"name": ["Mechanics"]})["view"]["lang"] == "en")

        # ---------------------------------------------------------------- the names and the one-line summaries
        check("once the index is built, the names are ready", app.api_labels({"lang": ["ar"]})["ready"] is True)
        labels = app.api_labels({"lang": ["ar"]})["labels"]
        check("the Arabic names the page shows for linked notes", labels.get("counting") == ar
              and labels.get("mechanics") == pairs["Mechanics"] and "collection" not in labels)
        check("in English there is nothing to rename", app.api_labels({"lang": ["en"]})["labels"] == {})
        fld = app.api_field({"name": ["Mechanics"], "lang": ["ar"]})
        check("a field's summary line comes from its Arabic map", fld["first"].startswith("الميكانيكا تدرس")
              and fld["first_lang"] == "ar")
        check("and stays English in English", app.api_field({"name": ["Mechanics"]})["first"].startswith("Mechanics studies"))
        branch = next(b for b in app.api_explore({"lang": ["ar"]})["branches"] if b["name"] == "Theoretical Disciplines")
        check("a branch's summary line comes from its Arabic map", branch["first"].startswith("العلوم التي")
              and branch["first_lang"] == "ar")
        branch_en = next(b for b in app.api_explore({})["branches"] if b["name"] == "Theoretical Disciplines")
        check("and an Arabic read leaves the English tree English", branch_en["first"].startswith("The note on")
              and branch_en.get("first_lang", "en") == "en")

        # ---------------------------------------------------------------- Teach and the tutor
        t = app.api_teach({"name": ["Counting"], "lang": ["ar"]})["subject"]
        check("Teach's subject summary is the Arabic note's", t["name"] == "Counting" and t["label"] == ar
              and "يقرن" in t["abstract"] and t["abstract_lang"] == "ar")
        t2 = app.api_teach({"name": ["Collection"], "lang": ["ar"]})["subject"]
        check("and English, said so, when there is none", t2["abstract_lang"] == "en" and t2["missing"] == "none")
        draft = app.tutor.draft(demo.COURSE)
        saved = app.tutor.save(dict(draft, sessions=[dict(s, date=d) for s, d in
                                                     zip(draft["sessions"], ["2027-01-10", "2027-01-17", "2027-01-24"])]))
        sess = app.api_tutor_session({"id": [saved["id"]], "n": ["2"], "lang": ["ar"]})
        cc = next(x for x in sess["before"]["concepts"] if x["name"] == "Counting")
        check("the tutor's preview of a concept is the Arabic note's sentence", "يقرن" in cc["abstract"]
              and cc["abstract_lang"] == "ar" and cc["label"] == ar)
        sess_en = app.api_tutor_session({"id": [saved["id"]], "n": ["2"]})
        check("and English in English", "pairs" in next(x for x in sess_en["before"]["concepts"]
                                                       if x["name"] == "Counting")["abstract"])
