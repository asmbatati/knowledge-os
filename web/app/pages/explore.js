// Explore: the disciplines (the vault's Knowledge OS Design §3). The six branches under DISCIPLINES, each field with
// its completeness, its concepts and how many of them a road walks. The whole Atlas by default, with the roads laid
// over it (the owner's choice, 8 Oct 2026); one toggle narrows to what no road reaches. A search finds any note.

import { api, h, fill, store } from "../ui.js";

const fieldHref = (name) => "#/field/" + encodeURIComponent(name);
export const noteHref = (name) => "#/note/" + encodeURIComponent(name);

export async function render(main, params, ctx) {
  const { t } = ctx;
  const data = await api.get("/api/explore?lang=" + ctx.lang());
  let off = store("los.explore.off") ?? false;

  const results = h("div", { class: "x-results" });
  let timer = null;
  const search = h("input", {
    type: "search", class: "x-search", placeholder: t("x.search"), "aria-label": t("x.search"),
    oninput: () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = search.value.trim();
        if (q.length < 2) { fill(results); return; }
        const r = await api.get("/api/xsearch?q=" + encodeURIComponent(q));
        fill(results, r.hits.length
          ? h("div", { class: "chips" }, r.hits.map((x) => h("a", { class: "chip-link", href: noteHref(x.name), title: x.rel },
            x.name, h("span", { class: "muted small" }, " · " + (x.type || "note")))))
          : h("p", { class: "muted" }, t("x.nohits")));
      }, 220);
    },
  });
  const toggle = h("button", { class: "ghost small", type: "button" });
  const grid = h("div", { class: "x-grid" });

  const draw = () => {
    toggle.textContent = off ? t("x.showall") : t("x.offonly");
    fill(grid, data.branches.map((b) => {
      let fields = b.fields;
      if (off) fields = fields.filter((f) => f.off_road > 0).sort((a, c) => c.off_road - a.off_road);
      return h("section", { class: "card x-branch" },
        h("h2", {}, h("a", { href: noteHref(b.name) }, b.name)),
        b.first ? h("p", { class: "muted small", lang: b.first_lang || "en", dir: "auto" }, b.first.replace(/\*+/g, "")) : null,
        fields.length ? h("ul", { class: "x-fields" }, fields.map((f) => h("li", { class: "x-field" },
          h("a", { class: "x-name", href: fieldHref(f.name) }, f.name),
          h("div", { class: "bar", title: t("x.complete", { n: f.completeness }) },
            h("span", { style: `width:${Math.max(2, f.completeness)}%` })),
          h("span", { class: "x-pct" }, `${f.completeness}%`),
          h("span", { class: "muted small x-counts" }, off
            ? t("x.offcount", { n: f.off_road })
            : t("x.counts", { c: f.concepts, k: f.claims, r: f.on_road, d: f.dated }))))) :
          h("p", { class: "muted small" }, off ? t("x.alloff") : t("x.nofields")));
    }));
  };
  toggle.onclick = () => { off = !off; store("los.explore.off", off); draw(); };
  draw();

  fill(main,
    h("div", { class: "page-head" }, h("h1", {}, t("x.title")), h("div", { class: "row" }, toggle)),
    h("p", { class: "muted" }, t("x.lede")),
    h("div", { class: "card soft" }, search, results),
    grid);
}
