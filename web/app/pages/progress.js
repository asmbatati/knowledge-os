// Progress: each road layer by layer, each goal's distance, checks and reviews by day, focused minutes, and how sure
// the answers were against how often they were right (calibration).

import { api, h, fmtDate } from "../ui.js";

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : "0");

export async function render(main, params, ctx) {
  const { t } = ctx;
  const lang = ctx.lang();
  const d = await api.get("/api/progress");

  const roads = Object.entries(d.roads).map(([name, r]) => h("section", { class: "card" },
    h("h3", {}, h("a", { href: "#/map/" + encodeURIComponent(name) }, name)),
    h("div", { class: "road-line two" }, h("div", { class: "bar big" }, h("span", { style: `width:${pct(r.mastered, r.total)}%` })),
      h("span", { class: "meta" }, `${r.mastered} / ${r.total}`)),
    h("p", { class: "meta" }, t("map.summary", { m: r.mastered, t: r.total, r: r.ready, tr: r.to_read, l: r.locked })),
    h("h4", {}, t("progress.layers")),
    h("div", { class: "layers" }, r.by_layer.map((L) => h("div", { class: "layer-cell", title: `${L.mastered} / ${L.total}` },
      h("span", { class: "meta" }, t("layer", { n: L.layer })),
      h("div", { class: "bar" }, h("span", { style: `width:${pct(L.mastered, L.total)}%` })),
      h("span", { class: "meta" }, `${L.mastered}/${L.total}`)))),
    h("h4", {}, t("progress.goals")),
    h("ul", { class: "plain goals" }, r.goal_distance.map((g) => h("li", {}, h("strong", {}, g.goal), " · ",
      g.pending ? t("progress.goal.pending") : t("progress.goal", { n: g.to_stand, of: g.of }))))));

  const hist = d.history.slice(-30);
  const maxH = Math.max(1, ...hist.map((x) => x.checks + x.reviews));
  const history = h("section", { class: "card" }, h("h3", {}, t("progress.history")),
    hist.length ? h("div", { class: "columns" }, hist.map((x) => h("div", { class: "col",
      title: `${fmtDate(x.date, lang)} · ${x.checks_passed}/${x.checks} ${t("progress.checks")} · ` +
        `${x.reviews_passed}/${x.reviews} ${t("progress.reviews")}` },
    h("span", { class: "stack", style: `height:${(100 * (x.checks + x.reviews) / maxH).toFixed(0)}%` },
      h("span", { class: "pass", style: `height:${pct(x.checks_passed + x.reviews_passed, x.checks + x.reviews)}%` })),
    h("span", { class: "col-label" }, x.date.slice(5)))))
      : h("p", { class: "muted" }, t("progress.none")));

  const maxF = Math.max(1, ...d.focus.map((x) => x.minutes));
  const focus = h("section", { class: "card" }, h("h3", {}, t("progress.focus")),
    d.focus.length ? h("div", { class: "columns" }, d.focus.map((x) => h("div", { class: "col",
      title: `${fmtDate(x.date, lang)} · ${x.minutes} min` },
    h("span", { class: "stack focus", style: `height:${(100 * x.minutes / maxF).toFixed(0)}%` }),
    h("span", { class: "col-label" }, x.date.slice(5)))))
      : h("p", { class: "muted" }, t("progress.none")));

  const cal = h("section", { class: "card" }, h("h3", {}, t("progress.cal")),
    h("table", { class: "cal" }, h("tbody", {}, ["1", "2", "3", "4"].map((c) => {
      const x = d.calibration[c];
      return h("tr", {}, h("th", {}, `${c} · ${t("conf." + c)}`),
        h("td", {}, h("div", { class: "bar" }, h("span", { style: `width:${pct(x.correct, x.n)}%` }))),
        h("td", { class: "meta" }, x.n ? t("progress.cal.row", { right: x.correct, n: x.n }) : "—"));
    }))));

  const s = d.streak;
  main.replaceChildren(h("div", { class: "page-head" }, h("h1", {}, t("nav.progress")),
    h("div", { class: "stats" }, h("span", { class: "stat" }, s.days ? t("today.streak", { n: s.days }) : t("today.streak0")),
      s.repairs ? h("span", { class: "stat soft" }, t("today.repairs", { n: s.repairs })) : null)),
  ...roads, history, focus, cal);
}
