// A field: its record (each section present, thin or missing), its river (the dated events of its people, ideas,
// tools and debates laid out in time, with the Hijri year beside each), and its frontier (what is open at the right
// edge). The vault's Knowledge OS Design §3-§4. Reads only.

import { api, h, fill, store, statusBadge } from "../ui.js";
import { makeScale, ticks, yearText, labelWidth, packRows } from "../graph/river.js";
import { noteHref } from "./explore.js";

const NS = "http://www.w3.org/2000/svg";
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  kids.flat().forEach((k) => k !== null && k !== undefined && el.append(k instanceof Node ? k : document.createTextNode(String(k))));
  return el;
}

const VIEWS = ["record", "river", "frontier"];

export async function render(main, params, ctx) {
  const { t } = ctx;
  const name = params.arg;
  const view = VIEWS.includes(params.view) ? params.view : "record";
  const href = (v) => `#/field/${encodeURIComponent(name)}?view=${v}`;
  const rec = await api.get("/api/field?name=" + encodeURIComponent(name) + "&lang=" + ctx.lang());
  const head = h("div", { class: "page-head" },
    h("div", {},
      h("p", { class: "muted small" }, h("a", { href: "#/explore" }, t("nav.explore")), rec.up ? [" · ", h("a", { href: noteHref(rec.up) }, rec.up)] : null),
      h("h1", { dir: "auto" }, ctx.label(rec.name))),
    h("div", { class: "x-score" }, h("div", { class: "bar big" }, h("span", { style: `width:${Math.max(2, rec.completeness)}%` })),
      h("span", {}, t("x.complete", { n: rec.completeness }))));
  const tabs = h("nav", { class: "x-tabs" }, VIEWS.map((v) =>
    h("a", { href: href(v), class: v === view ? "active" : null }, t("f.view." + v))));
  const body = h("div", {});
  fill(main, head, rec.first ? h("p", { class: "muted", lang: rec.first_lang || "en", dir: "auto" },
    rec.first.replace(/\*+/g, "")) : null, tabs, body);
  if (view === "record") return drawRecord(body, rec, t);
  if (view === "river") return drawRiver(body, name, t, ctx);
  return drawFrontier(body, name, t);
}

function links(names, cls = "chip-link") {
  return h("div", { class: "chips" }, names.map((n) => h("a", { class: cls, href: noteHref(n) }, n)));
}

function drawRecord(body, rec, t) {
  const sec = (key) => rec.sections.find((x) => x.key === key) || {};
  const detail = {
    scope: (x) => t("f.d.scope", { n: x.n }),
    map: (x) => (x.n ? t("f.d.map1") : t("f.d.map0")),
    concepts: (x) => t("f.d.concepts", { n: x.n, k: x.claims, s: x.seeds }),
    history: (x) => t("f.d.history", { n: x.n, k: x.timelines }),
    dated: (x) => t("f.d.of", { n: x.n, of: x.of }),
    people: (x) => t("f.d.of", { n: x.n, of: x.of }),
    tools: (x) => t("f.d.n", { n: x.n }),
    literature: (x) => t("f.d.n", { n: x.n }),
    debates: (x) => t("f.d.debates", { n: x.n, k: x.typed }),
    questions: (x) => t("f.d.n", { n: x.n }),
  };
  const grid = h("div", { class: "x-sections" }, rec.sections.map((x) =>
    h("div", { class: `x-sec s-${x.score}` },
      h("div", { class: "x-sec-head" }, h("strong", {}, t("f.sec." + x.key)), h("span", { class: `x-chip ${x.score}` }, t("f.score." + x.score))),
      h("p", { class: "muted small" }, detail[x.key] ? detail[x.key](x) : ""))));
  const concepts = h("section", { class: "card" }, h("h2", {}, t("f.concepts", { n: rec.concepts.length, k: rec.claims })),
    rec.concepts.length ? h("ul", { class: "x-list" }, rec.concepts.map((c) => h("li", {},
      h("a", { href: noteHref(c.name) }, c.name),
      c.when ? h("span", { class: "x-when" }, c.when) : null,
      c.road ? statusBadge(c.road, t) : h("span", { class: "muted small" }, t("f.offroad")),
      c.status === "seed" ? h("span", { class: "muted small" }, " · seed") : null))) : h("p", { class: "muted" }, t("f.none")));
  const debates = rec.debates.length ? h("section", { class: "card" }, h("h2", {}, t("f.sec.debates")),
    h("ul", { class: "x-list" }, rec.debates.map((d) => h("li", {}, h("a", { href: noteHref(d.name) }, d.name),
      h("span", { class: "muted small" }, [d.type, d.status, d.period, d.settled_in && t("f.settled", { y: d.settled_in })].filter(Boolean).join(" · ")))))) : null;
  const lists = [["timelines", rec.timelines], ["questions", rec.questions], ["tools", rec.tools], ["literature", rec.literature], ["maps", rec.maps.map((m) => m.name)]]
    .filter(([, v]) => v.length).map(([k, v]) => h("section", { class: "card" }, h("h2", {}, t("f.list." + k, { n: v.length })), links(v)));
  const gaps = rec.gaps;
  const gapCard = h("section", { class: "card soft" }, h("h2", {}, t("f.sec.gaps")),
    h("p", { class: "muted small" }, t("f.gapline", { s: gaps.seeds.length, u: gaps.undated.length, p: gaps.missing_people.length })),
    gaps.missing_people.length ? [h("h3", {}, t("f.missingpeople")), links(gaps.missing_people)] : null);
  fill(body, grid, h("p", { class: "muted small" }, t("f.thresholds", rec.thresholds ? {
    a: rec.thresholds.scope_bytes, b: rec.thresholds.history_events, c: Math.round(100 * rec.thresholds.dated_share) } : {})),
  concepts, debates, lists, gapCard);
}

async function drawRiver(body, name, t, ctx) {
  const data = await api.get("/api/river?name=" + encodeURIComponent(name));
  if (!data.events.length) {
    fill(body, h("section", { class: "card" }, h("p", {}, t("r.empty")), h("p", { class: "muted small" }, t("r.howto"))));
    return;
  }
  let mode = store("los.river.mode") ?? "log";
  let zoom = 1;
  const ar = ctx.lang() === "ar";
  const wrap = h("div", { class: "river-wrap" });
  const info = h("div", { class: "card soft river-info" }, h("p", { class: "muted small" }, t("r.hint")));
  const modeBtn = h("button", { class: "ghost small", type: "button" });
  const bar = h("div", { class: "row wrap" }, modeBtn,
    h("button", { class: "ghost small", type: "button", onclick: () => { zoom = Math.min(6, zoom * 1.5); draw(); } }, "+"),
    h("button", { class: "ghost small", type: "button", onclick: () => { zoom = Math.max(1, zoom / 1.5); draw(); } }, "−"),
    h("span", { class: "muted small" }, t("r.count", { n: data.events.length, u: data.undated })));
  modeBtn.onclick = () => { mode = mode === "log" ? "linear" : "log"; store("los.river.mode", mode); draw(); };

  const show = (e) => fill(info,
    h("p", {}, h("strong", {}, e.note ? h("a", { href: noteHref(e.note) }, e.label) : e.label)),
    h("p", { class: "small" }, eventWhen(e), " · ", h("strong", {}, ar ? e.hijri_ar : e.hijri), " · ", t("lane." + e.lane)),
    e.detail ? h("p", { class: "muted small" }, e.detail) : null,
    e.people && e.people.length ? links(e.people) : null,
    e.source ? h("p", { class: "muted small" }, t("r.from"), " ", h("a", { href: noteHref(e.source) }, e.source)) : null,
    e.road ? statusBadge(e.road, t) : null);

  const draw = () => {
    modeBtn.textContent = mode === "log" ? t("r.linear") : t("r.log");
    const W = Math.max(720, (wrap.clientWidth || 900) * zoom), LANEH = 22, PAD = 70, TOP = 10;
    const min = Math.min(...data.events.map((e) => e.lo), ...data.lives.map((l) => l.lo));
    const max = Math.max(...data.events.map((e) => e.hi));
    const sc = makeScale({ min, max, width: W - PAD - 20, mode });
    const X = (y) => PAD + sc.x(y);
    const items = data.events.map((e) => { const x0 = X(e.lo); return { e, lane: e.lane, x0, x1: Math.max(X(e.hi), x0) + labelWidth(e.label) }; });
    const { rows, height } = packRows(items, 8);
    const laneY = new Map();
    let y = TOP;
    for (const lane of data.lanes) { laneY.set(lane, y); y += Math.max(1, height.get(lane) || 1) * LANEH + 26; }
    const H = y + 30;
    const svg = s("svg", { class: "river", width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    for (const lane of data.lanes) {
      const ly = laneY.get(lane);
      svg.append(s("rect", { class: `lane-bg l-${lane}`, x: 0, y: ly - 6, width: W, height: (height.get(lane) || 1) * LANEH + 14, rx: 8 }));
      svg.append(s("text", { class: "lane-name", x: 8, y: ly + 12 }, t("lane." + lane)));
    }
    if (laneY.has("people")) {
      const ly = laneY.get("people");
      for (const l of data.lives) {
        if (l.hi === null) continue;
        svg.append(s("rect", { class: "life", x: X(l.lo), y: ly - 3, width: Math.max(2, X(l.hi) - X(l.lo)), height: 4, rx: 2 },
          s("title", {}, `${l.name}: ${yearText(l.lo)}–${yearText(l.hi)}`)));
      }
    }
    for (const it of items) {
      const e = it.e, ly = laneY.get(e.lane) + rows.get(it) * LANEH;
      const g = s("g", { class: `ev l-${e.lane}${e.road ? " s-" + e.road : ""}${e.status ? " d-" + e.status : ""}`, tabindex: "0" });
      if (e.hi > e.lo) g.append(s("rect", { class: "span", x: X(e.lo), y: ly + 5, width: Math.max(3, X(e.hi) - X(e.lo)), height: 6, rx: 3 }));
      g.append(s("circle", { cx: X(e.lo), cy: ly + 8, r: 4.5 }));
      g.append(s("text", { x: X(e.lo) + 8, y: ly + 12 }, e.label.length > 34 ? e.label.slice(0, 33) + "…" : e.label));
      g.append(s("title", {}, `${eventWhen(e)} · ${ar ? e.hijri_ar : e.hijri}\n${e.label}`));
      g.addEventListener("click", () => show(e));
      g.addEventListener("keydown", (ev) => { if (ev.key === "Enter") show(e); });
      g.addEventListener("dblclick", () => { if (e.note) location.hash = noteHref(e.note); });
      svg.append(g);
    }
    for (const tk of ticks(sc, 56)) {
      const x = PAD + tk.x;
      svg.append(s("line", { class: "tick", x1: x, x2: x, y1: TOP - 4, y2: H - 22 }));
      svg.append(s("text", { class: "tick-label", x, y: H - 6, "text-anchor": "middle" }, yearText(tk.year)));
    }
    fill(wrap, svg);
  };
  fill(body, bar, wrap, info);
  draw();
  const onResize = () => draw();
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
}

function eventWhen(e) {
  return e.when || (e.lo === e.hi ? yearText(e.lo) : `${yearText(e.lo)}–${yearText(e.hi)}`);
}

async function drawFrontier(body, name, t) {
  const f = await api.get("/api/frontier?name=" + encodeURIComponent(name));
  const card = (key, list, render) => h("section", { class: "card" }, h("h2", {}, t("fr." + key, { n: list.length })),
    list.length ? render(list) : h("p", { class: "muted" }, t("f.none")));
  fill(body,
    h("p", { class: "muted" }, t("fr.lede")),
    f.no_history ? h("section", { class: "card soft" }, h("p", {}, t("fr.nohistory"))) : null,
    card("debates", f.open_debates, (l) => h("ul", { class: "x-list" }, l.map((d) => h("li", {}, h("a", { href: noteHref(d.name) }, d.name),
      h("span", { class: "muted small" }, [d.type, d.status || "open"].filter(Boolean).join(" · ")))))),
    card("questions", f.questions, links),
    card("seeds", f.seeds, links),
    card("undated", f.undated, links),
    card("people", f.missing_people, links));
}
