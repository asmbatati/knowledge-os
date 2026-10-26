#!/usr/bin/env python3
"""The phone skill's checks and its zip (the vault's x/SYSTEM/Study Coach Plan 2026-10.md, §3).

    python skill/build.py --check    # SKILL.md: its name and description, the card's headings exactly as los/card.py
                                     # writes them, and no line that tells Claude to record a verdict
    python skill/build.py --zip      # dist/knowledge-os-coach.zip, the skill's folder with its SKILL.md and the
                                     # ADHD Study Coach's MIT notice: upload it once in claude.ai, Settings,
                                     # Capabilities, Skills

The skill runs on Claude away from the site and carries a session through the card: it may never claim a verdict, and
its card must stay readable by `los/card.py`'s parser, so a change to either fails here first.
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
sys.path.insert(0, str(SITE))
from los.card import END, HEAD, SECTIONS  # noqa: E402

NAME = "knowledge-os-coach"
FILES = ("SKILL.md", "LICENSE-ADHD-STUDY-COACH.txt")


def check(md: str) -> list[str]:
    problems = []
    m = re.match(r"\A---\n(.*?)\n---\n", md.replace("\r\n", "\n"), re.S)
    fm = m.group(1) if m else ""
    if not re.search(rf"^name:\s*{NAME}\s*$", fm, re.M):
        problems.append(f"the frontmatter does not name the skill {NAME}")
    desc = re.search(r"^description:\s*(.+)$", fm, re.M)
    if not desc or len(desc.group(1)) < 80:
        problems.append("the frontmatter needs a description of when to use the skill")
    for head in [HEAD, END, *SECTIONS.values()]:
        if head not in md:
            problems.append(f"the card heading {head!r} is not in the skill as card.py writes it")
    for sentence in re.split(r"(?<=[.!?:])\s+", md):
        if re.search(r"\bverdicts?\b", sentence, re.I) and not re.search(r"\b(never|not|only)\b", sentence, re.I):
            problems.append(f"a sentence about verdicts that does not forbid one: {sentence.strip()[:120]!r}")
    return problems


def make_zip(out_dir: Path) -> Path:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{NAME}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in FILES:
            z.write(HERE / NAME / f, f"{NAME}/{f}")
    return out


def main(argv: list[str]) -> int:
    md = (HERE / NAME / "SKILL.md").read_text(encoding="utf-8")
    problems = check(md)
    for p in problems:
        print("PROBLEM", p)
    if problems:
        return 1
    if "--zip" in argv:
        print("wrote", make_zip(SITE / "dist"))
    else:
        print("the skill passes its checks")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
