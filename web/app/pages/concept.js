// A concept: the note rendered (math, diagrams, callouts), where it stands on the road, what it rests on and what it
// opens, the lectures and chapters that teach it, and its verdicts. "I have read it" goes to the site's own ledger;
// `read_on` stays the owner's click in Obsidian (CLAUDE.md §8.3). A figure that explains it is shown above the note,
// in a sandboxed frame (figures/README.md).

import { api, h, conceptHref, statusBadge, fmtDate, toast, langBar } from "../ui.js";
import { typeset } from "../typeset.js";
import { labFor } from "../lab/registry.js";
import { figureCards } from "../lab/figure-card.js";
import { embedded, openInObsidian } from "../embed.js";

export async function render(main, params, ctx) {
  const { t } = ctx;
  const lang = ctx.lang();
  const show = ["en", "ar"].includes(params.show) ? params.show : "";      // the other note of a pair, on request
  const c = await api.get("/api/concept?name=" + encodeURIComponent(params.arg || "") + "&lang=" + lang +
    (show ? "&show=" + show : ""));
  const v = c.view;                     // the note shown: the Arabic counterpart on an Arabic page, when there is one

  const chips = (list, withStatus) => list.length
    ? h("div", { class: "chips" }, list.map((x) => {
      const name = typeof x === "string" ? x : x.name;
      return h("a", { class: `chip-link${withStatus && x.status ? " s-" + x.status : ""}`, href: conceptHref(name) }, name);
    }))
    : h("span", { class: "muted" }, t("concept.none"));

  const readBtn = h("button", { class: "ghost", onclick: async () => {
    readBtn.disabled = true;
    try {
      await api.post("/api/read", { concept: c.name });
      toast(t("concept.noted"));
      readNote.textContent = t("concept.readon", { date: fmtDate(new Date().toLocaleDateString("en-CA"), lang) });
    } catch (e) { toast(e.message); readBtn.disabled = false; }
  } }, t("concept.read"));
  const readNote = h("span", { class: "meta" }, c.read_on_site ? t("concept.readon", { date: fmtDate(c.read_on_site, lang) }) : "");
  const canCheck = c.in_graph && (c.status === "ready" || c.status === "to-read");
  const lab = labFor(c.name);

  const side = h("aside", { class: "card side" },
    c.in_graph ? h("div", { class: "row wrap" }, statusBadge(c.status, t),
      c.due ? h("span", { class: "badge s-due" }, t("concept.due", { date: fmtDate(c.due, lang) })) : null,
      h("span", { class: "meta" }, t("layer", { n: c.layer })), c.axiom ? h("span", { class: "meta" }, t("concept.axiom")) : null)
      : h("p", { class: "muted" }, t("concept.offroad")),
    c.in_graph ? [
      h("h4", {}, t("concept.requires")), chips(c.requires, true),
      h("h4", {}, t("concept.unlocks")), chips(c.unlocks, false),
      h("h4", {}, t("concept.sources")), c.sources.length ? h("ul", { class: "plain" }, c.sources.map((s) => h("li", {}, s)))
        : h("span", { class: "muted" }, t("concept.none")),
      h("h4", {}, t("concept.bank")), h("span", { class: "meta" }, t(`concept.bank.${c.bank}`)),
      c.history.length ? [h("h4", {}, t("concept.history")), h("ul", { class: "plain" }, c.history.map((r) =>
        h("li", {}, h("span", { class: r.passed ? "ok" : "bad" }, r.passed ? "✓" : "✗"), " ",
          `${t("kind." + r.kind)} · ${fmtDate(r.date, lang)}`)))] : null,
    ] : null,
    lab.length ? [h("h4", {}, "🔬 ", t("concept.lab")), h("div", { class: "chips" }, lab.map((x) =>
      h("a", { class: "chip-link lab", href: `#/lab/${x.kind}/${x.id}` },
        x.kind === "figures" ? `${t("lab.figure.kind")} · ${t("lab.f." + x.id)}`
          : x.kind === "models" ? `${t("lab.model")} · ${t("lab.m." + x.id)}` : `${t("lab.exercise")} · ${x.title}`)))] : null,
    h("div", { class: "row wrap actions" }, readBtn,
      embedded() ? h("button", { class: "ghost", onclick: () => openInObsidian(c.name) }, t("concept.obsidian")) : null,
      canCheck ? h("a", { class: "button primary", href: "#/check?concept=" + encodeURIComponent(c.name) }, t("concept.check")) : null,
      h("a", { class: "button ghost", href: "#/teach/" + encodeURIComponent(c.name) }, t("teach.this"))),
    readNote);

  const body = h("article", { class: "note", lang: v.lang, dir: v.lang === "ar" ? "rtl" : "ltr", html: c.html });
  const first = body.firstElementChild;          // the note's own title repeats the page's
  if (first && first.tagName === "H1" && first.textContent.trim().toLowerCase() === String(v.title).trim().toLowerCase()) {
    first.remove();
  }
  const figures = figureCards(c.name, t);
  main.replaceChildren(h("div", { class: "page-head" }, h("h1", { dir: "auto", lang: v.lang }, v.title),
    c.domain ? h("span", { class: "meta" }, c.domain) : null),
  ...[langBar(v, "concept", c.name, Boolean(show), t)].filter(Boolean),     // a note with no pair has no bar
  ...figures,
  h("div", { class: "concept-grid" }, body, side));
  await typeset(body);
}
