// Math and diagrams in a rendered note. The server marks math as elements with `data-tex` and diagrams as
// <pre class="mermaid">; KaTeX renders the first at once, and Mermaid, 5 MB, is loaded only when a note has a diagram.

let mermaidReady = null;

function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/vendor/mermaid/mermaid.min.js";
      s.onload = () => {
        const dark = matchMedia("(prefers-color-scheme: dark)").matches;
        window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral" });
        resolve(window.mermaid);
      };
      s.onerror = () => reject(new Error("mermaid did not load"));
      document.head.append(s);
    });
  }
  return mermaidReady;
}

export async function typeset(root) {
  if (window.katex) {
    root.querySelectorAll(".math[data-tex]").forEach((el) => {
      try {
        window.katex.render(el.dataset.tex, el, {
          displayMode: el.classList.contains("display"), throwOnError: false, output: "html",
        });
      } catch (e) { el.textContent = el.dataset.tex; }
    });
  }
  const diagrams = [...root.querySelectorAll("pre.mermaid:not([data-processed])")];
  if (!diagrams.length) return;
  let m;
  try { m = await loadMermaid(); } catch (e) {
    diagrams.forEach((d) => d.classList.add("mermaid-failed"));
    return;
  }
  // one at a time: a diagram Mermaid cannot parse keeps its source on the page, and the others still draw
  for (const d of diagrams) {
    const src = d.textContent;
    try {
      await m.run({ nodes: [d] });
    } catch (e) {
      d.textContent = src;
      d.classList.add("mermaid-failed");
      d.title = String(e && e.message ? e.message : e).slice(0, 300);
    }
  }
}

// A plain string that may hold $…$ math (a question, a key, an evidence sentence), as text and math spans for
// typeset(). The rule is the server's: the opening $ not followed by a space, the closing not preceded by one.
const INLINE = /(?<![\\$])\$(?![\s$])((?:\\\$|[^$\n])+?)(?<![\s\\])\$(?![\d$])/g;
const ESCAPED_DOLLAR = /\\\$/g;

export function mathText(str) {
  const frag = document.createDocumentFragment();
  const s = String(str ?? "");
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > last) frag.append(s.slice(last, m.index).replace(ESCAPED_DOLLAR, "$"));
    const span = document.createElement("span");
    span.className = "math inline";
    span.dataset.tex = m[1];
    span.textContent = m[1];
    frag.append(span);
    last = m.index + m[0].length;
  }
  if (last < s.length) frag.append(s.slice(last).replace(ESCAPED_DOLLAR, "$"));
  return frag;
}
