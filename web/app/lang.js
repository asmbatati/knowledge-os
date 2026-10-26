// The vault's bilingual pairs on the page (CLAUDE.md §7). In Arabic a link to a note shows the note's Arabic name when
// it has one, from the names the server sends (/api/labels). Only a link whose words are the note's own name is
// renamed, so a sentence or a button that opens a note keeps its words, and a link inside a note's text is left as the
// note wrote it. The pure parts are tested in Node (tests/js/lang.test.mjs).

const TARGET = /^#\/(concept|note|field)\/([^?]*)/;

export function targetOf(href) {
  const m = TARGET.exec(href || "");
  if (!m) return null;
  try { return decodeURIComponent(m[2]); } catch (e) { return m[2]; }
}

export function labelFor(name, labels) {
  return (labels && name && labels[String(name).toLowerCase()]) || null;
}

export function relabelText(href, text, labels) {
  const name = targetOf(href);
  if (!name || String(text || "").trim() !== name) return null;
  return labelFor(name, labels);
}

// The other note of a pair, on the same page: `?show=<lang>` asks for it; from there, the plain address comes back.
export function otherHref(kind, base, otherLang, showing) {
  const href = `#/${kind}/${encodeURIComponent(base)}`;
  return showing ? href : `${href}?show=${otherLang}`;
}

export function relabel(root, labels) {
  if (!root || !labels || !root.querySelectorAll) return;
  const sel = 'a[href^="#/concept/"], a[href^="#/note/"], a[href^="#/field/"]';
  const links = [...(root.matches && root.matches(sel) ? [root] : []), ...root.querySelectorAll(sel)];
  for (const a of links) {
    if (a.closest("article.note")) continue;           // a note's own text keeps its own words
    const label = relabelText(a.getAttribute("href"), a.textContent, labels);
    if (!label) continue;
    const name = a.textContent.trim();
    let el = a;                                         // keep <strong> and the like: rename the innermost words
    while (el.children.length === 1 && el.firstElementChild.textContent === el.textContent) el = el.firstElementChild;
    el.textContent = label;
    a.lang = "ar";
    if (!a.title) a.title = name;
  }
}
