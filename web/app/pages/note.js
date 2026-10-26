// A note as Explore sees it: where it hangs, when it appeared (with the Hijri year), who introduced it, what it
// answers, refutes or generalizes and what answers it, its children, and the note itself. Any note in the Atlas or the
// Library shelves Explore reads; a road concept also links to its page on the road.

import { api, h, fill, statusBadge, conceptHref, langBar } from "../ui.js";
import { typeset } from "../typeset.js";
import { noteHref } from "./explore.js";

const REL = ["introduced_by", "responds_to", "refutes", "generalizes", "school", "parties", "settled_by", "timeline_of",
  "released_by", "superseded_by"];
const REV = ["responds_to", "refutes", "generalizes", "introduced_by", "school"];

export async function render(main, params, ctx) {
  const { t } = ctx;
  const show = ["en", "ar"].includes(params.show) ? params.show : "";      // the other note of a pair, on request
  const n = await api.get("/api/xnote?name=" + encodeURIComponent(params.arg) + "&lang=" + ctx.lang() +
    (show ? "&show=" + show : ""));
  const v = n.view;                     // its text: the Arabic counterpart on an Arabic page, when there is one
  const ar = ctx.lang() === "ar";
  const chips = (names) => h("div", { class: "chips" }, names.map((x) => h("a", { class: "chip-link", href: noteHref(x) }, x)));
  const isField = n.type === "moc" && n.chain.includes("DISCIPLINES");
  const dates = Object.entries(n.dates || {}).map(([k, d]) =>
    h("li", {}, h("strong", {}, t("n.date." + k)), " ", d.when, h("span", { class: "muted" }, " · ", ar ? d.hijri_ar : d.hijri)));
  const rel = REL.filter((k) => n.relations[k]).map((k) => h("li", {}, h("strong", {}, t("n.rel." + k)), " ", chips(n.relations[k])));
  const rev = REV.filter((k) => n.reverse[k]).map((k) => h("li", {}, h("strong", {}, t("n.rev." + k)), " ", chips(n.reverse[k])));
  const side = h("aside", { class: "side" },
    h("section", { class: "card soft" },
      h("p", { class: "muted small" }, [...n.chain].reverse().flatMap((c, i) => [i ? " › " : "", h("a", { href: noteHref(c) }, c)])),
      h("p", {}, h("span", { class: "badge" }, n.type || "note"), n.status ? h("span", { class: "muted small" }, " · " + n.status) : null,
        n.road ? [" ", statusBadge(n.road, t)] : null),
      n.counterpart ? h("p", { class: "small" }, t("n.counterpart"), " ", h("a", { href: noteHref(n.counterpart) }, n.counterpart)) : null,
      isField ? h("p", {}, h("a", { class: "button small", href: "#/field/" + encodeURIComponent(n.name) }, t("n.openfield"))) : null,
      n.road ? h("p", {}, h("a", { class: "button small", href: conceptHref(n.name) }, t("n.onroad"))) : null,
      h("p", {}, h("a", { class: "button small ghost", href: "#/teach/" + encodeURIComponent(n.name) }, t("teach.this")))),
    dates.length ? h("section", { class: "card" }, h("h3", {}, t("n.dates")), h("ul", { class: "x-list" }, dates)) : null,
    rel.length ? h("section", { class: "card" }, h("h3", {}, t("n.relations")), h("ul", { class: "x-list" }, rel)) : null,
    rev.length ? h("section", { class: "card" }, h("h3", {}, t("n.reverse")), h("ul", { class: "x-list" }, rev)) : null,
    n.children.length ? h("section", { class: "card" }, h("h3", {}, t("n.children", { n: n.children.length })), chips(n.children)) : null);
  const article = h("article", { class: "note", lang: v.lang, dir: v.lang === "ar" ? "rtl" : "ltr", html: n.html });
  const first = article.firstElementChild;          // the note's own title repeats the page's
  if (first && first.tagName === "H1" && first.textContent.trim().toLowerCase() === v.name.trim().toLowerCase()) first.remove();
  fill(main, h("div", { class: "page-head" }, h("h1", { dir: "auto", lang: v.lang }, v.name)),
    langBar(v, "note", n.name, Boolean(show), t), h("div", { class: "concept-grid" }, article, side));
  await typeset(article);
}
