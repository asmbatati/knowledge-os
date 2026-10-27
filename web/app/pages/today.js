// Today: the coach's front door (the vault's Study Coach Plan 2026-10): be coached through today's road, continue toward
// the goal, or name what to learn today, and a session starts sized to the plan, with no other decision. Below it, the
// road's own day: reviews due, checks ready, readings, the courses, the roads.

import { api, h, conceptHref, fmtDate, fill, toast, go } from "../ui.js";
import { nextText, nextHref } from "../tutor/words.js";
import { current, startSession } from "./study.js";

export async function render(main, params, ctx) {
  const { t } = ctx;
  const [d, courses, coach] = await Promise.all([api.get("/api/today"), api.get("/api/courses").catch(() => null),
    api.get("/api/coach?lang=" + ctx.lang()).catch(() => null)]);
  const p = d.plan;
  const lang = ctx.lang();

  const s = d.streak;
  const streak = h("div", { class: "stats" },
    h("span", { class: "stat" }, s.days ? t("today.streak", { n: s.days }) : t("today.streak0")),
    s.repairs ? h("span", { class: "stat soft" }, t("today.repairs", { n: s.repairs })) : null,
    h("span", { class: "stat" }, t("today.focused", { n: d.focus_minutes })),
    h("span", { class: `stat soft grader${d.quiet ? " quiet" : ""}` },
      d.quiet ? t("grader.quiet")
        : ["claude", "self", "fake"].includes(d.grader) ? t(`grader.${d.grader}`)
        : t("grader.model", { label: d.model?.label || d.grader })));

  const item = (x, extra) => h("li", {},
    h("a", { href: conceptHref(x.name) }, x.name),
    h("span", { class: "meta" }, t("layer", { n: x.layer }),
      x.unlocks ? " · " + t("unlocks", { n: x.unlocks }) : "", x.stuck ? " · " + t("stuck") : ""), extra || null);
  const lists = [];
  if (p.due.length) lists.push(h("section", { class: "card" }, h("h3", {}, `${t("today.due")} · ${p.due_total}`),
    h("ul", { class: "items" }, p.due.map((x) => item(x)))));
  if (p.checks.length) lists.push(h("section", { class: "card" }, h("h3", {}, `${t("today.checks")} · ${p.checks.length}`),
    h("ul", { class: "items" }, p.checks.map((x) => item(x)))));
  if (p.readings.length) lists.push(h("section", { class: "card" }, h("h3", {}, t("today.readings")),
    h("ul", { class: "items" }, p.readings.map((x) => h("li", {},
      h("a", { href: conceptHref(x.name) }, x.name),
      x.sources.length ? h("span", { class: "meta" }, x.sources.join(" · ")) : null,
      h("a", { class: "small-link", href: "#/check?concept=" + encodeURIComponent(x.name) }, t("check.readdone")))))));
  if (d.done.length) lists.push(h("section", { class: "card" }, h("h3", {}, t("today.done")),
    h("ul", { class: "items" }, d.done.map((x) => h("li", {},
      h("span", { class: x.passed ? "ok" : "bad" }, x.passed ? "✓" : "✗"), " ",
      h("a", { href: conceptHref(x.concept) }, x.concept),
      h("span", { class: "meta" }, `${t("kind." + x.kind)} · ${x.at || ""}`))))));
  if (!lists.length && !d.done.length) lists.push(h("p", { class: "muted" }, t("today.empty")));

  const roads = h("section", { class: "card" }, h("h3", {}, t("today.roads")),
    p.roads.map((r) => h("div", { class: "road-line" },
      h("a", { href: "#/map/" + encodeURIComponent(r.name) }, r.name),
      h("div", { class: "bar" }, h("span", { style: `width:${r.total ? (100 * r.mastered / r.total).toFixed(1) : 0}%` })),
      h("span", { class: "meta" }, `${r.mastered} / ${r.total}`))));

  // the courses the tutor follows, each with its next step (the Course Tutor plan, 2 Oct 2026)
  const courseCard = courses && courses.courses.length ? h("section", { class: "card" }, h("h3", {}, t("course.today")),
    h("ul", { class: "items" }, courses.courses.map((c) => h("li", {},
      h("a", { href: "#/courses/" + encodeURIComponent(c.id) }, c.title),
      h("a", { class: "small-link", href: nextHref(c.id, c.next) }, nextText(c.next, t)))))) : null;

  fill(main,
    h("div", { class: "page-head" }, h("h1", {}, fmtDate(d.date, lang)), streak),
    p.status === "paused" ? h("p", { class: "card soft" }, t("today.paused", { date: p.paused_until })) : null,
    coach ? frontDoor(coach, ctx, p.due.length + p.checks.length + p.readings.length > 0) : null,
    h("h2", { class: "section-title" }, t("coach.road")),
    courseCard, ...lists, roads);
}

function frontDoor(coach, ctx, hasRoad) {
  const { t } = ctx;
  const p = coach.profile;
  const label = (n) => ctx.label(n);
  const buttons = [];
  const start = async (mode, topic) => {
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await startSession(ctx, mode, topic, topic || (mode === "road" ? t("coach.road") : p.goal));
    } catch (e) {
      toast(e.message);
      buttons.forEach((b) => { b.disabled = false; });
    }
  };
  const topic = h("input", { type: "text", class: "x-search", dir: "auto", maxlength: 200, placeholder: t("coach.named.ph"),
    "aria-label": t("coach.named") });
  const goNamed = h("button", { class: p.goal ? "" : "primary", type: "button",
    onclick: () => { if (topic.value.trim()) start("named", topic.value.trim()); else topic.focus(); } }, t("coach.go"));
  topic.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); goNamed.click(); } });
  buttons.push(goNamed);
  // today's road, coached: reviews recalled cold, then each of the day's checks taught before it is asked (24 Oct 2026)
  let roadPart = null;
  if (hasRoad) {
    const road = h("button", { class: "primary big", type: "button", onclick: () => start("road") }, t("coach.road.go"));
    buttons.push(road);
    roadPart = h("div", { class: "row wrap" }, road, h("span", { class: "meta" }, t("coach.road.d")));
  }
  let goalPart = null;
  if (p.goal) {
    const cont = h("button", { class: hasRoad ? "big" : "primary big", type: "button", onclick: () => start("goal") },
      t("coach.continue", { goal: label(p.goal) }));
    buttons.push(cont);
    goalPart = h("div", { class: "row wrap" }, cont,
      h("span", { class: "meta" }, coach.next ? t("coach.next", { concept: label(coach.next) })
        : t("coach.goalstands", { goal: label(p.goal) })));
  }
  const cur = current();
  const loop = coach.loops[0];
  return h("section", { class: "card start coach" },
    h("h2", {}, t("coach.title")),
    cur && cur.id ? h("p", {}, h("a", { class: "button", href: "#/study" }, t("coach.resume"))) : null,
    roadPart,
    goalPart,
    !p.goal ? h("p", { class: "meta" }, t("coach.nogoal")) : null,
    h("p", { class: "label" }, t("coach.named")), h("div", { class: "row wrap named" }, topic, goNamed),
    loop ? h("p", { class: "meta", dir: "auto" }, t("coach.loop", { date: fmtDate(loop.date, ctx.lang()) }), " ", loop.text) : null,
    coach.last ? h("p", { class: "meta", dir: "auto" },
      t("coach.last", { title: coach.last.title || "", date: fmtDate(coach.last.date, ctx.lang()) })) : null,
    !coach.available ? h("p", { class: "lang-bar" }, t("study.why." + (coach.why_code || "no_cli"))) : null,
    coach.elsewhere && coach.elsewhere.length ? h("p", { class: "meta" }, t("coach.elsewhere"), " ",
      coach.elsewhere.map((c) => h("a", { class: "chip-link", href: "#/check?concept=" + encodeURIComponent(c) }, c))) : null,
    h("p", { class: "meta" }, t("coach.plan.line", { d: p.plan.days, m: p.plan.minutes })),
    h("details", { class: "coach-setup", open: !p.goal && !coach.sessions ? true : null },
      h("summary", {}, p.goal ? t("coach.change") : t("coach.setup")), setupForm(p, ctx)),
    h("details", { class: "coach-setup" }, h("summary", {}, t("coach.card")), cardBox(p, ctx)));
}

// The portable card (the plan's §3): copied for the phone or another chat, and pasted back to bring a session home.
export async function copyCard(ctx, btn) {
  const { t } = ctx;
  try {
    const r = await api.get("/api/coach/card?lang=" + ctx.lang());
    await navigator.clipboard.writeText(r.text);
    toast(t("coach.card.copied"));
  } catch (e) {
    toast(e.message);
    if (btn) btn.disabled = false;
  }
}

function cardBox(p, ctx) {
  const { t } = ctx;
  const copy = h("button", { type: "button", onclick: (ev) => copyCard(ctx, ev.currentTarget) }, t("coach.card.copy"));
  const paste = h("textarea", { class: "answer", rows: 6, dir: "auto", placeholder: t("coach.card.paste.ph"),
    "aria-label": t("coach.card.paste") });
  const out = h("div", { class: "result" });
  const bring = h("button", { class: "primary", type: "button", onclick: async () => {
    if (!paste.value.trim()) { paste.focus(); return; }
    bring.disabled = true;
    let r;
    try { r = await api.post("/api/coach/import", { text: paste.value }); }
    catch (e) { toast(e.message); bring.disabled = false; return; }
    paste.value = "";
    const pr = r.propose || {};
    const any = pr.plan || pr.goal || (pr.lines && pr.lines.length);
    const use = any ? h("button", { class: "primary small", type: "button", onclick: async (ev) => {
      ev.currentTarget.disabled = true;
      const d = { lines: [...p.lines, ...(pr.lines || [])] };
      if (pr.plan) d.plan = pr.plan;
      if (pr.goal) d.goal = pr.goal;
      try { await api.post("/api/coach/profile", d); toast(t("coach.saved")); go("#/today"); }
      catch (e) { toast(e.message); }
    } }, t("coach.card.use")) : null;
    fill(out, h("p", {}, t("coach.card.brought", { r: r.rows, l: r.loops.length, c: r.concepts.length })),
      any ? h("div", { class: "lang-bar" }, h("span", {}, t("coach.card.propose")),
        pr.goal ? h("span", {}, t("coach.card.goal", { g: pr.goal })) : null,
        pr.plan ? h("span", {}, t("coach.card.plan", { d: pr.plan.days, m: pr.plan.minutes })) : null,
        pr.lines && pr.lines.length ? h("span", { dir: "auto" }, pr.lines.join("; ")) : null, use) : null,
      h("button", { class: "ghost small", type: "button", onclick: () => go("#/today") }, t("coach.card.done")));
    bring.disabled = false;
  } }, t("coach.card.bring"));
  return h("div", { class: "setup" }, h("p", { class: "meta" }, t("coach.card.d")), h("div", { class: "row" }, copy),
    h("label", { class: "field" }, t("coach.card.paste"), paste), h("div", { class: "row" }, bring), out);
}

function setupForm(p, ctx) {
  const { t } = ctx;
  const goal = h("input", { type: "text", class: "x-search", dir: "auto", value: p.goal, placeholder: t("coach.goal.ph"),
    "aria-label": t("coach.goal") });
  const days = h("input", { type: "number", min: 1, max: 7, value: p.plan.days, "aria-label": t("coach.days") });
  const minutes = h("input", { type: "number", min: 10, max: 120, step: 5, value: p.plan.minutes,
    "aria-label": t("coach.minutes") });
  const lines = h("textarea", { class: "answer", rows: 3, dir: "auto", placeholder: t("coach.lines.ph"),
    "aria-label": t("coach.lines") });
  lines.value = p.lines.join("\n");
  const save = h("button", { class: "primary", type: "button", onclick: async () => {
    save.disabled = true;
    try {
      await api.post("/api/coach/profile", { goal: goal.value.trim(),
        plan: { days: Number(days.value), minutes: Number(minutes.value) },
        lines: lines.value.split("\n").map((x) => x.trim()).filter(Boolean) });
      toast(t("coach.saved"));
      go("#/today");
    } catch (e) { toast(e.message); save.disabled = false; }
  } }, t("coach.save"));
  return h("div", { class: "setup" },
    h("label", { class: "field" }, t("coach.goal"), goal),
    h("div", { class: "row wrap" }, h("label", { class: "field" }, t("coach.days"), days),
      h("label", { class: "field" }, t("coach.minutes"), minutes)),
    h("label", { class: "field" }, t("coach.lines"), lines),
    h("div", { class: "row" }, save));
}
