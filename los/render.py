"""A note as HTML for the page: Obsidian's markdown with its math, diagrams, callouts and wikilinks.

The server renders; the page only typesets math (KaTeX, from each element's `data-tex`) and draws diagrams (Mermaid,
from `<pre class="mermaid">`). An image a note embeds is shown when it sits beside the notes, through the site's
`/asset/` route; any other embed is named. Everything the note says is protected before Markdown runs (code, math, wikilinks,
callouts), restored after, and the whole passes an allowlist sanitizer. The page's content security policy runs no
inline script either way; the sanitizer is the second line.
"""
from __future__ import annotations

import html
import re
from html.parser import HTMLParser
from urllib.parse import quote

import markdown

FM_RE = re.compile(r"\A﻿?---\n.*?\n---[ \t]*(?:\n|\Z)", re.S)
FENCE_RE = re.compile(r"^(?P<fence>`{3,}|~{3,})[ \t]*(?P<info>[^\n`]*)\n(?P<body>.*?)^(?P=fence)[ \t]*$", re.S | re.M)
DROP_FENCES = {"nav", "dataview", "dataviewjs", "base", "tasks", "query", "figure"}   # a figure: the page shows it
# A figure's still drawing: a callout holding only ![[<id>.svg]], right after its ```figure block, for an Obsidian that
# cannot run the block (the vault's Anatomy Figures Plan, D4). The page shows the live figure, so the still goes too.
STILL_RE = re.compile(r"^(?P<fence>`{3,})[ \t]*figure\b[^\n]*\n.*?^(?P=fence)[ \t]*\r?\n(?:[ \t]*\r?\n)*"
                      r">[ \t]*\[![A-Za-z-]+\][+-]?[^\n]*\n>[ \t]*!\[\[[^\]\n]+\.svg(?:\|[^\]\n]*)?\]\][ \t]*\r?$",
                      re.S | re.M)
IMAGE_EXTS = (".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp")
COMMENT_RE = re.compile(r"%%.*?%%", re.S)
BLOCK_ID_RE = re.compile(r"[ \t]+\^[A-Za-z0-9-]+[ \t]*$", re.M)
CODE_SPAN_RE = re.compile(r"(`+)(.+?)\1", re.S)
DISPLAY_MATH_RE = re.compile(r"\$\$(.+?)\$\$", re.S)
INLINE_MATH_RE = re.compile(r"(?<![\\$])\$(?![\s$])((?:\\\$|[^$\n])+?)(?<![\s\\])\$(?![\d$])")
WIKI_RE = re.compile(r"(!?)\[\[([^\[\]\n]+?)\]\]")
HIGHLIGHT_RE = re.compile(r"==(?=\S)(.+?)(?<=\S)==")
CALLOUT_HEAD_RE = re.compile(r"^\[!(?P<kind>[A-Za-z-]+)\][+-]?[ \t]*(?P<title>.*)$")


class _Holder:
    """Placeholders that survive Markdown: letters and digits only, so no Markdown rule touches them."""

    def __init__(self):
        self.items: list[tuple[str, str, bool]] = []

    def put(self, html_text: str, block: bool = False) -> str:
        token = f"LOSPH{len(self.items):05d}X"
        self.items.append((token, html_text, block))
        return f"\n\n{token}\n\n" if block else token

    def restore(self, text: str) -> str:
        # later placeholders may sit inside earlier ones' HTML (a callout holds math): restore until none is left
        for _ in range(4):
            changed = False
            for token, frag, block in self.items:
                if token not in text:
                    continue
                changed = True
                if block:
                    text = text.replace(f"<p>{token}</p>", frag)
                text = text.replace(token, frag)
            if not changed:
                break
        return text


def _link(target: str, label: str, known: dict[str, str]) -> str:
    name = target.split("#", 1)[0].strip()
    canon = known.get(name.lower())
    if canon:
        return f'<a class="wikilink" href="#/concept/{quote(canon)}">{html.escape(label)}</a>'
    return f'<span class="wikilink missing" title="{html.escape(name)}">{html.escape(label)}</span>'


def _wikilinks(text: str, known: dict[str, str], hold: _Holder, assets: dict[str, str] | None = None) -> str:
    def sub(m):
        embed, inner = m.group(1), m.group(2).replace("\\|", "|")
        target, _, alias = inner.partition("|")
        target = target.strip()
        if embed:
            name = target.split("#", 1)[0].strip()
            hit = (assets or {}).get(name.lower()) if name.lower().endswith(IMAGE_EXTS) else None
            if hit:                                 # an image beside the notes, shown as Obsidian shows it
                size = alias.strip()
                width = f' width="{size}"' if size.isdigit() and 0 < int(size) <= 4000 else ""
                return hold.put(f'<img class="embed-img" src="/asset/{quote(hit)}" alt="{html.escape(hit)}"{width}>')
            return hold.put(f'<span class="embed" title="shown in Obsidian">{html.escape(target)}</span>')
        label = alias.strip() or target.split("#", 1)[0].strip() or target
        return hold.put(_link(target, label, known))
    return WIKI_RE.sub(sub, text)


def _callouts(text: str, known: dict[str, str], hold: _Holder, assets: dict[str, str] | None = None) -> str:
    lines, out, i = text.split("\n"), [], 0
    while i < len(lines):
        line = lines[i]
        head = CALLOUT_HEAD_RE.match(line[1:].lstrip()) if line.startswith(">") else None
        if not head:
            out.append(line)
            i += 1
            continue
        body = []
        i += 1
        while i < len(lines) and lines[i].startswith(">"):
            body.append(re.sub(r"^> ?", "", lines[i]))
            i += 1
        kind = head.group("kind").lower()
        title = head.group("title").strip() or kind.replace("-", " ").capitalize()
        inner = _render(("\n".join(body)), known, assets)
        frag = (f'<div class="callout callout-{html.escape(kind)}"><div class="callout-title">'
                f"{_inline(title, known)}</div><div class=\"callout-body\">{inner}</div></div>")
        out.append(hold.put(frag, block=True))
    return "\n".join(out)


def _inline(text: str, known: dict[str, str]) -> str:
    """A callout's title: inline Markdown only, without the paragraph."""
    h = _render(text, known)
    return re.sub(r"^<p>(.*)</p>$", r"\1", h.strip(), flags=re.S)


def _render(text: str, known: dict[str, str], assets: dict[str, str] | None = None) -> str:
    hold = _Holder()

    def fence(m):
        info = (m.group("info") or "").strip().split()
        lang = info[0].lower() if info else ""
        body = m.group("body")
        if lang in DROP_FENCES:
            return ""
        if lang == "mermaid":
            return hold.put(f'<pre class="mermaid">{html.escape(body)}</pre>', block=True)
        cls = f' class="language-{html.escape(lang)}"' if lang else ""
        return hold.put(f"<pre><code{cls}>{html.escape(body)}</code></pre>", block=True)

    text = STILL_RE.sub("", text)
    text = FENCE_RE.sub(fence, text)
    text = COMMENT_RE.sub("", text)
    text = BLOCK_ID_RE.sub("", text)
    text = _callouts(text, known, hold, assets)
    text = CODE_SPAN_RE.sub(lambda m: hold.put(f"<code>{html.escape(m.group(2).strip())}</code>"), text)
    text = DISPLAY_MATH_RE.sub(
        lambda m: hold.put(f'<div class="math display" data-tex="{html.escape(m.group(1).strip())}"></div>',
                           block=True), text)
    text = INLINE_MATH_RE.sub(
        lambda m: hold.put(f'<span class="math inline" data-tex="{html.escape(m.group(1))}"></span>'), text)
    text = text.replace("\\$", hold.put("$"))
    text = _wikilinks(text, known, hold, assets)
    text = HIGHLIGHT_RE.sub(r"<mark>\1</mark>", text)
    out = markdown.markdown(text, extensions=["tables", "sane_lists", "nl2br"], output_format="html")
    return hold.restore(out)


NAV_FENCE_RE = re.compile(r"\A\s*```nav[ \t]*\n```[ \t]*(?:\n|\Z)")
NAV_LINE_RE = re.compile(r"^\s*(?:\[\[[^\]\n]*\|AR\]\]\s*\|\s*\[\[[^\]\n]*\|EN\]\]|🏡.*|~ .*)\s*$")
UP_LINE_RE = re.compile(r"^\s*~ \[\[[^\]\n]*\|UP\]\]\s*$")


def _strip_nav(text: str) -> str:
    """The note's own navigation (CLAUDE.md §7: the AR|EN line, HOME, UP, siblings, children) at its top, and a
    closing UP line: the side panel shows where the note stands, so the page leaves them out. The note is unchanged."""
    lines = NAV_FENCE_RE.sub("", text, count=1).split("\n")
    i = 0
    while i < len(lines) and (not lines[i].strip() or NAV_LINE_RE.match(lines[i])):
        i += 1
    j = len(lines)
    while j > i and (not lines[j - 1].strip() or UP_LINE_RE.match(lines[j - 1])):
        j -= 1
    return "\n".join(lines[i:j])


def render_note(text: str, known: dict[str, str], assets: dict[str, str] | None = None) -> str:
    """`known` maps each linkable note's lower-case name to its name, and `assets` each image beside the notes the same
    way (`Vault.assets`). Returns sanitized HTML."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _strip_nav(FM_RE.sub("", text, count=1))
    return sanitize(_render(text, known, assets))


# ------------------------------------------------------------------ sanitizer
_ALLOWED = {
    "p": (), "br": (), "hr": (), "h1": (), "h2": (), "h3": (), "h4": (), "h5": (), "h6": (),
    "strong": (), "em": (), "b": (), "i": (), "u": (), "s": (), "del": (), "mark": (), "sup": (), "sub": (),
    "small": (), "kbd": (), "ul": (), "ol": ("start",), "li": (), "blockquote": (), "pre": ("class",),
    "code": ("class",), "table": (), "thead": (), "tbody": (), "tr": (), "th": ("style",), "td": ("style",),
    "a": ("href", "class", "title"), "span": ("class", "data-tex", "title"), "div": ("class", "data-tex"),
    "details": (), "summary": (), "img": ("src", "alt", "class", "width"),
}
_DROP_WITH_CONTENT = {"script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math",
                      "textarea", "select", "button", "form"}
_ALIGN_RE = re.compile(r"^text-align: ?(left|right|center);?$")
_VOID = {"br", "hr", "img"}


class _Sanitizer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip = 0
        self.open: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in _DROP_WITH_CONTENT:
            self.skip += 1
            return
        if self.skip or tag not in _ALLOWED:
            return
        keep = []
        for k, v in attrs:
            if k not in _ALLOWED[tag] or v is None:
                continue
            if k == "href":
                if not (v.startswith("#/") or v.startswith("https://") or v.startswith("http://")
                        or v.startswith("mailto:")):
                    continue
            if k == "style" and not _ALIGN_RE.match(v.strip()):
                continue
            if tag == "img" and ((k == "src" and not v.startswith("/asset/")) or (k == "width" and not v.isdigit())):
                continue
            keep.append(f' {k}="{html.escape(v, quote=True)}"')
        if tag == "img" and not any(a.startswith(" src=") for a in keep):
            return                                  # an image only from the site's own asset route
        if tag == "a" and any(a.startswith(' href="http') for a in keep):
            keep.append(' target="_blank" rel="noopener noreferrer"')
        self.out.append(f"<{tag}{''.join(keep)}>")
        if tag not in _VOID:
            self.open.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag in _DROP_WITH_CONTENT:
            self.skip -= 1

    def handle_endtag(self, tag):
        if tag in _DROP_WITH_CONTENT:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip or tag not in _ALLOWED or tag in _VOID:
            return
        if tag in self.open:
            while self.open:
                t = self.open.pop()
                self.out.append(f"</{t}>")
                if t == tag:
                    break

    def handle_data(self, data):
        if not self.skip:
            self.out.append(html.escape(data, quote=False))

    def close_all(self) -> str:
        self.close()
        while self.open:
            self.out.append(f"</{self.open.pop()}>")
        return "".join(self.out)


def sanitize(fragment: str) -> str:
    s = _Sanitizer()
    s.feed(fragment)
    return s.close_all()
