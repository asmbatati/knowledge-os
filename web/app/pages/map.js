// The road as a graph: every concept on the road, a column per layer, coloured by where it stands. Drag to move,
// scroll or use the buttons to zoom, find a concept by name, light a goal's whole tree, and see what comes next. A
// click on a concept lights what it rests on (blue) and what it opens (orange); a double click opens it. SVG, no
// library; the layout and the "what comes next" are pure modules (web/app/graph), tested in Node.

import { api, h, conceptHref, store, fill, go } from "../ui.js";
import { layoutGraph } from "../graph/layout.js";
import { closure, comingNext, indexEdges, STANDING } from "../graph/next.js";

const NS = "http://www.w3.org/2000/svg";
const NODEW = 196, NODEH = 28, COLW = 250, ROWH = 40;

function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  kids.flat().forEach((k) => k !== null && k !== undefined && el.append(k instanceof Node ? k : document.createTextNode(String(k))));
  return el;
}

const short = (name, n = 27) => (name.length > n ? name.slice(0, n - 1) + "…" : name);

export async function render(main, params, ctx) {
  const { t } = ctx;
  const data = await api.get("/api/graph" + (params.arg ? "?road=" + encodeURIComponent(params.arg) : ""));
  const all = data.nodes;
  const idx = indexEdges(data.edges);
  const byName = new Map(all.map((n) => [n.name, n]));
  const count = (st) => all.filter((n) => n.status === st).length;
  let hide = store("los.map.hide") ?? false;
  let selected = null, goal = "";
  const view = { k: 1, tx: 0, ty: 0 };
  let L = null, svg, world, nodeEls = new Map(), edgeEls = [], mini, miniView;

  const box = h("div", { class: "graph-view", tabindex: "0", "aria-label": data.road || t("nav.map") });
  const side = h("div", { class: "graph-side" });
  const selCard = h("section", { class: "card sel-card", hidden: true });
  const treeCard = h("section", { class: "card", hidden: true });

  const apply = () => {
    if (world) world.setAttribute("transform", `translate(${view.tx.toFixed(1)},${view.ty.toFixed(1)}) scale(${view.k.toFixed(4)})`);
    if (miniView && L) {
      const W = box.clientWidth || 800, H = box.clientHeight || 600;
      miniView.setAttribute("x", (-view.tx / view.k).toFixed(1));
      miniView.setAttribute("y", (-view.ty / view.k).toFixed(1));
      miniView.setAttribute("width", (W / view.k).toFixed(1));
      miniView.setAttribute("height", (H / view.k).toFixed(1));
    }
  };
  const zoomAt = (factor, cx, cy) => {
    const k = Math.min(2.5, Math.max(0.12, view.k * factor));
    view.tx = cx - ((cx - view.tx) * k) / view.k;
    view.ty = cy - ((cy - view.ty) * k) / view.k;
    view.k = k;
    apply();
  };
  const fit = () => {
    if (!L) return;
    const W = box.clientWidth || 800, H = box.clientHeight || 600;
    view.k = Math.min(1.2, Math.max(0.12, Math.min(W / L.width, H / L.height)));
    view.tx = (W - L.width * view.k) / 2;
    view.ty = (H - L.height * view.k) / 2;
    apply();
  };
  const centreOn = (name, k) => {
    const p = L && L.pos.get(name);
    if (!p) return;
    const W = box.clientWidth || 800, H = box.clientHeight || 600;
    if (k) view.k = k;
    view.tx = W / 2 - view.k * (p.x + NODEW / 2);
    view.ty = H / 2 - view.k * (p.y + NODEH / 2);
    apply();
  };

  // light a set of concepts and the edges among them; up edges blue, down edges orange
  const light = (focus, up, down) => {
    const on = !!focus;
    svg.classList.toggle("focus", on);
    const lit = new Set(on ? [focus, ...up, ...down] : []);
    nodeEls.forEach((g, name) => {
      g.classList.toggle("hl", lit.has(name));
      g.classList.toggle("sel", on && name === focus);
    });
    edgeEls.forEach((p) => {
      const a = p.dataset.from, b = p.dataset.to;
      p.classList.toggle("hl-up", on && (b === focus || up.has(b)) && (up.has(a)));
      p.classList.toggle("hl-down", on && (a === focus || down.has(a)) && (down.has(b)));
    });
  };

  const select = (name, { centre = false } = {}) => {
    selected = name;
    goal = "";
    goalSel.value = "";
    treeCard.hidden = true;
    if (!name || !byName.has(name)) {
      selected = null;
      light(null, new Set(), new Set());
      selCard.hidden = true;
      return;
    }
    const up = closure(idx, name, "up"), down = closure(idx, name, "down");
    light(name, up, down);
    const n = byName.get(name);
    const waiting = [...up].filter((m) => byName.get(m) && !STANDING.has(byName.get(m).status)).length;
    const canCheck = n.status === "ready" || n.status === "to-read";
    fill(selCard, h("div", { class: "row wrap" }, h("span", { class: `badge s-${n.status}` }, t("status." + n.status)),
      n.due ? h("span", { class: "badge s-due" }, t("status.due")) : null,
      h("span", { class: "meta" }, t("layer", { n: n.layer })), n.goal ? h("span", { class: "meta" }, "★ " + t("map.goal")) : null),
    h("div", { class: "big-name", dir: "auto" }, ctx.label(n.name)),
    h("p", { class: "meta" }, t("map.sel.rests", { n: up.size, m: waiting })),
    h("p", { class: "meta" }, t("map.sel.opens", { n: down.size })),
    h("div", { class: "row wrap" },
      h("a", { class: "button small", href: conceptHref(n.name) }, t("map.open")),
      canCheck ? h("a", { class: "button small primary", href: "#/check?concept=" + encodeURIComponent(n.name) }, t("concept.check")) : null));
    selCard.hidden = false;
    if (centre) centreOn(name, Math.max(view.k, 0.85));
  };

  const showGoal = (name) => {
    goal = name;
    selCard.hidden = true;
    selected = null;
    if (!name) {
      light(null, new Set(), new Set());
      treeCard.hidden = true;
      return;
    }
    const up = closure(idx, name, "up");
    light(name, up, new Set());
    const tree = [name, ...up].map((m) => byName.get(m)).filter(Boolean);
    const done = tree.filter((m) => STANDING.has(m.status)).length;
    fill(treeCard, h("h3", {}, "★ ", h("span", { dir: "auto" }, name)),
      h("p", { class: "meta" }, t("map.tree", { m: done, n: tree.length })),
      h("div", { class: "bar big tree-bar" }, h("span", { style: `width:${tree.length ? (100 * done / tree.length).toFixed(1) : 0}%` })),
      h("p", { class: "meta" }, t("map.tree.left", { n: tree.length - done })));
    treeCard.hidden = false;
    centreOn(name, Math.min(view.k, 0.7));
  };

  const draw = () => {
    const nodes = all.filter((n) => !hide || n.status !== "locked");
    const keep = new Set(nodes.map((n) => n.name));
    const edges = data.edges.filter(([a, b]) => keep.has(a) && keep.has(b));
    L = layoutGraph(nodes, edges, { colW: COLW, rowH: ROWH, padX: 30, padY: 56 });
    nodeEls = new Map();
    edgeEls = [];
    world = s("g", { class: "world" });
    const bands = s("g");
    L.layers.forEach((layer, col) => {
      const x = 30 + col * COLW - 14;
      if (col % 2 === 0) bands.append(s("rect", { class: "layer-band", x, y: 20, width: COLW, height: L.height - 20, rx: 14 }));
      bands.append(s("text", { class: "layer-label", x: x + 14, y: 40 }, t("layer", { n: layer })));
    });
    const eg = s("g", { class: "edges" });
    for (const [a, b] of edges) {
      const p = L.pos.get(a), q = L.pos.get(b);
      const x1 = p.x + NODEW, y1 = p.y + NODEH / 2, x2 = q.x, y2 = q.y + NODEH / 2;
      const dx = Math.max(30, (x2 - x1) / 2);
      const path = s("path", { d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, "data-from": a, "data-to": b });
      edgeEls.push(path);
      eg.append(path);
    }
    const ng = s("g", { class: "nodes" });
    for (const n of nodes) {
      const p = L.pos.get(n.name);
      const g = s("g", { class: `node s-${n.status}${n.due ? " is-due" : ""}${n.goal ? " is-goal" : ""}`, tabindex: "0",
        "data-name": n.name, transform: `translate(${p.x},${p.y})`, role: "button" },
      s("title", {}, `${ctx.label(n.name)} · ${t("status." + n.status)}${n.due ? " · " + t("status.due") : ""}`),
      s("rect", { width: NODEW, height: NODEH, rx: 9 }),
      s("text", { x: 11, y: 18.5 }, short(ctx.label(n.name), n.goal ? 24 : 27)),
      n.goal ? s("text", { class: "goal-star", x: NODEW - 18, y: 19 }, "★") : null);
      g.addEventListener("click", (ev) => { ev.stopPropagation(); select(n.name); });
      g.addEventListener("dblclick", () => { location.hash = conceptHref(n.name); });
      g.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") location.hash = conceptHref(n.name);
        if (ev.key === " ") { ev.preventDefault(); select(n.name); }
      });
      nodeEls.set(n.name, g);
      ng.append(g);
    }
    world.append(bands, eg, ng);
    svg = s("svg", { class: "road", role: "img", "aria-label": data.road || "" }, world);

    // the minimap: the whole road small, and the part in view
    const ms = s("svg", { viewBox: `0 0 ${L.width} ${L.height}`, preserveAspectRatio: "xMidYMid meet" });
    for (const n of nodes) {
      const p = L.pos.get(n.name);
      ms.append(s("rect", { x: p.x, y: p.y, width: NODEW, height: NODEH, rx: 6, class: `s-${n.status}`,
        style: "fill:currentColor;opacity:.75" }));
    }
    miniView = s("rect", { class: "view", x: 0, y: 0, width: 10, height: 10 });
    ms.append(miniView);
    mini = h("div", { class: "minimap", title: t("map.minimap") }, ms);
    const moveTo = (ev) => {
      const r = ms.getBoundingClientRect();
      const scale = Math.max(L.width / r.width, L.height / r.height);
      const offX = (r.width * scale - L.width) / 2, offY = (r.height * scale - L.height) / 2;
      const wx = (ev.clientX - r.left) * scale - offX, wy = (ev.clientY - r.top) * scale - offY;
      const W = box.clientWidth, H = box.clientHeight;
      view.tx = W / 2 - view.k * wx;
      view.ty = H / 2 - view.k * wy;
      apply();
    };
    let miniDrag = false;
    mini.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); miniDrag = true; mini.setPointerCapture(ev.pointerId); moveTo(ev); });
    mini.addEventListener("pointermove", (ev) => { if (miniDrag) moveTo(ev); });
    mini.addEventListener("pointerup", () => { miniDrag = false; });

    const zoom = h("div", { class: "graph-zoom" },
      h("button", { type: "button", title: t("map.zoomin"), "aria-label": t("map.zoomin"),
        onclick: (ev) => { ev.stopPropagation(); zoomAt(1.25, box.clientWidth / 2, box.clientHeight / 2); } }, "+"),
      h("button", { type: "button", title: t("map.zoomout"), "aria-label": t("map.zoomout"),
        onclick: (ev) => { ev.stopPropagation(); zoomAt(0.8, box.clientWidth / 2, box.clientHeight / 2); } }, "−"),
      h("button", { type: "button", title: t("map.fit"), "aria-label": t("map.fit"),
        onclick: (ev) => { ev.stopPropagation(); fit(); } }, "⤢"));
    box.replaceChildren(svg, zoom, mini);
    if (selected && keep.has(selected)) select(selected);
    else if (goal && keep.has(goal)) showGoal(goal);
  };

  // pan by dragging the background; a press and release in place clears the selection
  let pan = null;
  box.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || ev.target.closest(".node, .minimap, .graph-zoom")) return;
    pan = { x: ev.clientX, y: ev.clientY, tx: view.tx, ty: view.ty, moved: false };
    box.setPointerCapture(ev.pointerId);
    box.classList.add("panning");
  });
  box.addEventListener("pointermove", (ev) => {
    if (!pan) return;
    const dx = ev.clientX - pan.x, dy = ev.clientY - pan.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
    view.tx = pan.tx + dx;
    view.ty = pan.ty + dy;
    apply();
  });
  const endPan = () => {
    if (pan && !pan.moved) { select(null); if (goal) showGoal(""); }
    pan = null;
    box.classList.remove("panning");
  };
  box.addEventListener("pointerup", endPan);
  box.addEventListener("pointercancel", () => { pan = null; box.classList.remove("panning"); });
  box.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const r = box.getBoundingClientRect();
    zoomAt(ev.deltaY < 0 ? 1.12 : 1 / 1.12, ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });
  box.addEventListener("keydown", (ev) => {
    if (ev.target !== box) return;
    if (ev.key === "+" || ev.key === "=") zoomAt(1.2, box.clientWidth / 2, box.clientHeight / 2);
    if (ev.key === "-") zoomAt(1 / 1.2, box.clientWidth / 2, box.clientHeight / 2);
    if (ev.key === "0") fit();
    if (ev.key === "Escape") select(null);
  });

  // find a concept by name
  const list = h("datalist", { id: "road-names" }, all.map((n) => h("option", { value: n.name })));
  const search = h("input", { type: "search", list: "road-names", placeholder: t("map.search"), "aria-label": t("map.search") });
  const find = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    const hit = all.find((n) => n.name.toLowerCase() === q) || all.find((n) => n.name.toLowerCase().includes(q));
    if (!hit) return;
    if (hide && hit.status === "locked") { hide = false; store("los.map.hide", hide); hideBox.checked = false; draw(); }
    select(hit.name, { centre: true });
  };
  search.addEventListener("change", find);
  search.addEventListener("keydown", (ev) => { if (ev.key === "Enter") find(); });

  const goals = all.filter((n) => n.goal);
  const goalSel = h("select", { "aria-label": t("map.goalpick"), onchange: (ev) => showGoal(ev.target.value) },
    h("option", { value: "" }, t("map.goalpick")), goals.map((g) => h("option", { value: g.name }, "★ " + short(g.name, 48))));

  const hideBox = h("input", { type: "checkbox", checked: hide ? true : null, onchange: (ev) => {
    hide = ev.target.checked;
    store("los.map.hide", hide);
    draw();
    fit();
  } });

  const next = comingNext(all, data.edges).slice(0, 18);
  const nextCard = h("section", { class: "card" }, h("h3", {}, "🧭 ", t("map.next")),
    next.length ? h("ul", { class: "next-list" }, next.map((x) => h("li", { onclick: () => {
      if (hide && x.status === "locked") { hide = false; store("los.map.hide", hide); hideBox.checked = false; draw(); }
      select(x.name, { centre: true });
    } },
    h("span", { class: `dot s-${x.status}` }),
    h("span", { dir: "auto" }, short(ctx.label(x.name), 34)),
    h("span", { class: "n" }, x.waiting ? t("map.next.after", { n: x.waiting }) : t("status." + x.status)))))
      : h("p", { class: "muted" }, t("map.next.none")));
  side.append(selCard, treeCard, nextCard);

  const tabs = h("div", { class: "road-tabs" }, data.roads.map((r) => h("a", {
    class: r.name === data.road ? "active" : "", href: "#/map/" + encodeURIComponent(r.name) }, r.name)));
  const legend = h("div", { class: "legend" }, ["granted", "provisional", "passed", "mastered", "ready", "to-read", "locked"].map((st) =>
    h("span", { class: `badge s-${st}` }, t("status." + st))), h("span", { class: "badge s-due" }, t("status.due")),
  h("span", { class: "meta" }, "★ " + t("map.goal")));

  // placement toward one of the road's goals (decision 3): about thirty questions that settle what already stands
  const placeSel = h("select", { "aria-label": t("map.place.goal") }, goals.map((g) => h("option", { value: g.name },
    "★ " + short(g.name, 48))));
  const pick = goals.find((g) => g.status === "locked" && /SE\(3\)/.test(g.name)) || goals.find((g) => g.status === "locked");
  if (pick) placeSel.value = pick.name;
  const placeRow = goals.length ? h("div", { class: "row place-row" }, h("span", { class: "meta" }, t("map.place.d")),
    placeSel, h("button", { class: "primary", onclick: () => go("#/place/" + encodeURIComponent(placeSel.value)) },
      t("map.place"))) : null;

  fill(main, h("div", { class: "page-head" }, h("h1", {}, data.road || t("nav.map")), tabs),
    h("p", { class: "meta" }, t("map.summary", { s: all.filter((n) => STANDING.has(n.status)).length,
      m: count("mastered"), p: count("passed"), pv: count("provisional"), g: count("granted"), t: all.length, r: count("ready"),
      tr: count("to-read"), l: count("locked") })),
    data.pending_goals && data.pending_goals.length ? h("p", { class: "meta" }, t("map.pending", { g: data.pending_goals.join(", ") })) : null,
    placeRow,
    h("div", { class: "graph-tools" }, search, list, goalSel, h("label", { class: "toggle" }, hideBox, t("map.hide")), legend),
    h("p", { class: "hint" }, t("map.hint")),
    h("div", { class: "graph-wrap" }, box, side));

  draw();
  // start where the work is: the first concept that comes next, or the whole road when it is small
  requestAnimationFrame(() => {
    fit();
    if (view.k < 0.55 && next[0] && L.pos.has(next[0].name)) centreOn(next[0].name, 0.9);
  });
  const onResize = () => apply();
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
}
