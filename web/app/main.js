// The shell: the router, the header (tabs, timer chip, language), and the pages loaded on demand.

import { t, setLang, getLang, initialLang, applyStatic } from "./i18n.js";
import { api, h, ApiError } from "./ui.js";
import * as timer from "./timer.js";
import { labelFor, relabel } from "./lang.js";
import { embedded } from "./embed.js";

if (embedded()) document.documentElement.classList.add("embed");   // in an Obsidian tab

const PAGES = {
  today: () => import("./pages/today.js"),
  check: () => import("./pages/check.js"),
  concept: () => import("./pages/concept.js"),
  map: () => import("./pages/map.js"),
  progress: () => import("./pages/progress.js"),
  focus: () => import("./pages/focus.js"),
  lab: () => import("./pages/lab.js"),
  courses: () => import("./pages/courses.js"),
  place: () => import("./pages/place.js"),
  explore: () => import("./pages/explore.js"),
  field: () => import("./pages/field.js"),
  note: () => import("./pages/note.js"),
  teach: () => import("./pages/teach.js"),
  study: () => import("./pages/study.js"),
  settings: () => import("./pages/settings.js"),
};
const TAB_OF = { check: "today", concept: "map", place: "map", field: "explore", note: "explore", study: "today" };

// `label(name)`: the name a note is shown by in the page's language, its Arabic counterpart's when it has one
export const ctx = { t, lang: getLang, timer, health: null, labels: null,
  label: (name) => (getLang() === "ar" && labelFor(name, ctx.labels)) || name };

// The Arabic names are asked for and never waited on: until the server has them (Explore's first index, half a
// minute on the Drive mount), the links keep their English names, and they are renamed in place when the names come.
let labelTry = 0;
async function loadLabels() {
  const mine = ++labelTry;
  ctx.labels = null;
  for (let i = 0; i < 40 && mine === labelTry && getLang() === "ar"; i++) {
    try {
      const r = await api.get("/api/labels?lang=ar");
      if (mine !== labelTry || getLang() !== "ar") return;
      if (r.ready) {
        ctx.labels = r.labels;
        relabel(document.getElementById("page"), ctx.labels);
        return;
      }
    } catch (e) { return; /* the English names stay */ }
    await new Promise((ok) => setTimeout(ok, 4000));
  }
}
const briefly = (p) => Promise.race([p, new Promise((ok) => setTimeout(ok, 600))]);

function parse() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = raw.split("?");
  const segs = (pathPart || "").split("/").filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  });
  const name = PAGES[segs[0]] ? segs[0] : "today";
  const params = Object.fromEntries(new URLSearchParams(queryPart || ""));
  params.arg = segs.slice(1).join("/");
  return { name, params };
}

export function showError(main, e) {
  const msg = e instanceof ApiError && e.status === 403 ? t("err.token") : t("err", { msg: e.message || String(e) });
  main.replaceChildren(h("div", { class: "card error" }, h("p", {}, msg),
    h("button", { class: "ghost", onclick: () => route() }, t("retry"))));
}

let cleanup = null;
let seq = 0;

export async function route() {
  const { name, params } = parse();
  const mine = ++seq;
  if (cleanup) { try { cleanup(); } catch (e) { /* a page's own teardown */ } cleanup = null; }
  const tab = TAB_OF[name] || name;
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.page === tab));
  document.body.dataset.page = name;
  const main = document.getElementById("page");
  main.replaceChildren(h("p", { class: "muted loading" }, t("loading")));
  try {
    const mod = await PAGES[name]();
    if (mine !== seq) return;
    const done = await mod.render(main, params, ctx);
    if (mine === seq) cleanup = typeof done === "function" ? done : null;
  } catch (e) {
    if (mine === seq) showError(main, e);
  }
}

function header() {
  const btn = document.getElementById("lang-toggle");
  const chip = document.getElementById("timer-chip");
  btn.textContent = t("lang.switch");
  btn.onclick = async () => {
    setLang(getLang() === "ar" ? "en" : "ar");
    applyStatic();
    btn.textContent = t("lang.switch");
    await briefly(loadLabels());
    route();
  };
  chip.onclick = () => { location.hash = "#/focus"; };
  // The timer's notice, under the header until it is answered: the focus is done and the break has started, or the
  // break is over and the next focus waits for a click (26 Oct 2026).
  const notice = h("div", { class: "timer-notice", role: "status", hidden: true });
  document.querySelector("header.top")?.after(notice);
  let shown = "";
  timer.onChange((s) => {
    chip.hidden = s.phase === "idle";
    if (!chip.hidden) {
      chip.textContent = `${t("focus." + s.phase)} ${timer.mmss(s.remaining)}${s.paused ? " ⏸" : ""}`;
      chip.className = `chip timer-${s.phase}`;
    }
    const kind = s.notice === "done" && s.phase === "break" ? "done" : s.notice === "break" && s.phase === "idle" ? "break" : "";
    if (kind === shown) return;
    shown = kind;
    notice.hidden = !kind;
    if (!kind) { notice.replaceChildren(); return; }
    const L = timer.lengths();
    const act = (label, fn, primary) => h("button", { type: "button", class: primary ? "primary small" : "ghost small",
      onclick: fn }, label);
    notice.replaceChildren(
      h("p", {}, kind === "done" ? t("focus.notice.done", { m: L.focus, b: L.brk }) : t("focus.notice.break", { m: L.focus })),
      h("div", { class: "row wrap" }, ...(kind === "done"
        ? [act(t("focus.ok"), () => timer.dismiss(), true), act(t("focus.skip"), () => timer.nextFocus())]
        : [act(t("focus.next"), () => timer.nextFocus(), true), act(t("focus.today"), () => timer.dismiss())])));
  });
}

async function boot() {
  setLang(initialLang(document.documentElement.dataset.lang));
  applyStatic();
  header();
  try {
    ctx.health = await api.get("/api/health");
    timer.configure(ctx.health.timer);
  } catch (e) { /* the pages will say what is wrong */ }
  timer.boot();
  await briefly(loadLabels());
  // every link a page draws to a note shows the note's Arabic name, as the page draws it (lang.js)
  new MutationObserver((muts) => {
    if (getLang() !== "ar" || !ctx.labels) return;
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) relabel(n, ctx.labels);
  }).observe(document.getElementById("page"), { childList: true, subtree: true });
  window.addEventListener("hashchange", route);
  route();
}

boot();
