// The course tutor (the vault's Course Tutor and 3D Viewer Plan 2026-10, §3): the courses, a course's sessions and its
// next step, a session before it, after it and with questions, and an exam's scope, plan and practice. Everything is
// read from the server; the page writes only the learner's dates, marks, recalls, questions and practice answers,
// through the tutor's API. A check is still the road's own (#/check).

import { api, h, fill, fmtDate, conceptHref, statusBadge, toast, go } from "../ui.js";
import { typeset } from "../typeset.js";
import { labFor } from "../lab/registry.js";
import { parseSyllabus, relDays } from "../tutor/syllabus.js";
import { whenWord, nextText, nextHref } from "../tutor/words.js";

const enc = encodeURIComponent;
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export async function render(main, params, ctx) {
  const segs = (params.arg || "").split("/").filter(Boolean);
  if (!segs.length) return list(main, ctx);
  if (segs[0] === "new") return setup(main, params, ctx, null);
  const id = segs[0];
  if (segs[1] === "edit") return setup(main, params, ctx, id);
  if (segs[1] === "s" && segs[2]) return session(main, id, segs[2], params.tab || "", ctx);
  if (segs[1] === "e" && segs[2]) return exam(main, id, segs[2], ctx);
  return course(main, id, ctx);
}

const back = (href, label) => h("a", { class: "small-link back", href }, label);   // its arrow follows the direction
const why = (code, t) => h("p", { class: "card soft why" }, t(`course.why.${code || "unreachable"}`));

// ------------------------------------------------------------------ the list
async function list(main, ctx) {
  const { t } = ctx;
  const d = await api.get("/api/courses");
  const mine = d.courses.length
    ? h("section", { class: "card" }, h("h3", {}, t("course.yours")),
      h("ul", { class: "items" }, d.courses.map((c) => h("li", {},
        h("a", { href: "#/courses/" + enc(c.id) }, c.title),
        h("span", { class: "meta" }, t("course.count", { n: c.sessions })),
        h("a", { class: "small-link", href: nextHref(c.id, c.next) }, nextText(c.next, t))))))
    : h("p", { class: "card soft" }, t("course.none"));
  const vault = h("section", { class: "card" }, h("h3", {}, t("course.vault")),
    h("p", { class: "muted" }, t("course.vault.d")),
    d.catalog.length ? h("ul", { class: "items" }, d.catalog.map((c) => h("li", {},
      h("strong", {}, c.card), h("span", { class: "meta" }, t("course.count", { n: c.sessions })),
      h("button", { class: "ghost small", onclick: () => go("#/courses/new?card=" + enc(c.card)) }, t("course.take")))))
      : h("p", { class: "muted" }, t("course.vault.none")));
  const syl = h("section", { class: "card" }, h("h3", {}, t("course.syllabus")),
    h("p", { class: "muted" }, t("course.syllabus.d")),
    h("button", { class: "primary", onclick: () => go("#/courses/new?from=syllabus") }, t("course.syllabus.start")));
  fill(main, h("div", { class: "page-head" }, h("h1", {}, t("course.title"))), mine, vault, syl);
}

// ------------------------------------------------------------------ setting a course up
async function setup(main, params, ctx, id) {
  const { t } = ctx;
  let draft;
  if (id) {
    const v = await api.get("/api/course?id=" + enc(id));
    draft = { id: v.id, title: v.title, source: v.source, prep_days: v.prep_days, exam_days: v.exam_days,
      sessions: v.sessions.map((s) => ({ n: s.n, title: s.title, date: s.date, concepts: s.concepts })),
      exams: v.exams.map((e) => ({ id: e.id, title: e.title, date: e.date, covers: e.covers })) };
  } else if (params.card) {
    draft = await api.get("/api/course/draft?card=" + enc(params.card));
    delete draft.id;
  } else {
    draft = { title: "", source: { kind: "syllabus" }, sessions: [], exams: [], prep_days: 2, exam_days: 14 };
  }
  const card = draft.source.kind === "card";
  const titleIn = h("input", { type: "text", value: draft.title, placeholder: t("course.ctitle") });
  const sessionsBox = h("div", { class: "sessions-edit" });
  const examsBox = h("div", { class: "exams-edit" });
  const suggestions = new Map();              // session n -> concept names offered

  const conceptChips = (s) => {
    if (card) return h("div", { class: "chips" }, s.concepts.map((c) => h("a", { class: "chip-link", href: conceptHref(c) }, c)));
    const offered = [...new Set([...(suggestions.get(s.n) || []), ...s.concepts])];
    const box = h("div", { class: "chips" }, offered.map((c) => h("label", { class: "chip-link pick" },
      h("input", { type: "checkbox", checked: s.concepts.includes(c), onchange: (ev) => {
        s.concepts = ev.target.checked ? [...s.concepts, c] : s.concepts.filter((x) => x !== c);
      } }), " ", c)));
    const add = h("input", { type: "text", placeholder: t("course.addname"), class: "addname" });
    const addBtn = h("button", { class: "ghost small", type: "button", onclick: async () => {
      const text = add.value.trim();
      if (!text) return;
      const r = await api.post("/api/course/match", { topics: text });
      const hit = (r.topics[0] && r.topics[0].concepts[0]) || null;
      if (!hit) return toast(t("course.nomatch", { name: text }));
      if (!s.concepts.includes(hit)) s.concepts.push(hit);
      suggestions.set(s.n, [...(suggestions.get(s.n) || []), hit]);
      drawSessions();
    } }, t("course.add"));
    return h("div", {}, box, h("div", { class: "row" }, add, addBtn));
  };

  function drawSessions() {
    fill(sessionsBox, draft.sessions.length ? h("table", { class: "plain sessions-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, t("course.stitle")), h("th", {}, t("course.date")),
        h("th", {}, t("course.concepts")))),
      h("tbody", {}, draft.sessions.map((s) => h("tr", {},
        h("td", {}, String(s.n)),
        h("td", {}, card ? s.title : h("input", { type: "text", value: s.title, oninput: (ev) => { s.title = ev.target.value; } })),
        h("td", {}, h("input", { type: "date", value: s.date || "", oninput: (ev) => { s.date = ev.target.value; } })),
        h("td", {}, conceptChips(s)))))) : h("p", { class: "muted" }, t("course.nosessions")));
  }

  function drawExams() {
    const nums = draft.sessions.map((s) => s.n);
    fill(examsBox, draft.exams.map((e, i) => {
      const lo = e.covers.length ? Math.min(...e.covers) : (nums[0] || 1);
      const hi = e.covers.length ? Math.max(...e.covers) : (nums[nums.length - 1] || 1);
      const from = h("input", { type: "number", min: 1, value: lo, class: "num" });
      const to = h("input", { type: "number", min: 1, value: hi, class: "num" });
      const setCovers = () => { e.covers = nums.filter((n) => n >= +from.value && n <= +to.value); };
      from.oninput = setCovers; to.oninput = setCovers; setCovers();
      return h("div", { class: "row wrap exam-row" },
        h("input", { type: "text", value: e.title, placeholder: t("course.exam.title"), oninput: (ev) => { e.title = ev.target.value; } }),
        h("input", { type: "date", value: e.date || "", oninput: (ev) => { e.date = ev.target.value; } }),
        h("span", { class: "meta" }, t("course.from")), from, h("span", { class: "meta" }, t("course.to")), to,
        h("button", { class: "ghost small", type: "button", onclick: () => { draft.exams.splice(i, 1); drawExams(); } }, t("course.remove")));
    }), h("button", { class: "ghost small", type: "button", onclick: () => {
      draft.exams.push({ title: "", date: "", covers: draft.sessions.map((s) => s.n) });
      drawExams();
    } }, t("course.exam.add")));
  }

  let paste = null;
  if (!card && !id) {
    const area = h("textarea", { rows: 7, placeholder: t("course.syllabus.ph") });
    const readBtn = h("button", { class: "primary", type: "button", onclick: async () => {
      const parsed = parseSyllabus(area.value);
      if (!parsed.sessions.length) return toast(t("course.syllabus.empty"));
      draft.sessions = parsed.sessions.map((s) => ({ n: s.n, title: s.title, date: s.date, concepts: [] }));
      draft.exams = parsed.exams.map((e) => ({ title: e.title, date: e.date, covers: draft.sessions.map((s) => s.n) }));
      readBtn.disabled = true;
      try {
        const lines = parsed.sessions.map((s) => (s.topics.length ? s.topics : [s.title]));
        const r = await api.post("/api/course/match", { topics: lines.flat().join("\n") });
        let k = 0;
        lines.forEach((ls, i) => {
          const names = [];
          ls.forEach(() => { for (const c of (r.topics[k] || { concepts: [] }).concepts) if (!names.includes(c)) names.push(c); k++; });
          suggestions.set(draft.sessions[i].n, names.slice(0, 8));
        });
      } finally { readBtn.disabled = false; }
      drawSessions(); drawExams();
    } }, t("course.read"));
    paste = h("section", { class: "card" }, h("h3", {}, t("course.syllabus")), h("p", { class: "muted" }, t("course.syllabus.d")),
      area, h("div", { class: "row" }, readBtn));
  }

  const saveBtn = h("button", { class: "primary big", type: "button", onclick: async () => {
    draft.title = titleIn.value.trim();
    saveBtn.disabled = true;
    try {
      const saved = await api.post("/api/course/save", { course: draft });
      toast(t("course.saved"));
      go("#/courses/" + enc(saved.id));
    } catch (e) {
      toast(e.message || String(e), 6000);
    } finally { saveBtn.disabled = false; }
  } }, t("course.save"));

  drawSessions(); drawExams();
  fill(main, back("#/courses", t("course.title")),
    h("div", { class: "page-head" }, h("h1", {}, id ? t("course.edit") : t("course.setup")),
      card ? h("span", { class: "stat soft" }, t("course.fromcard", { card: draft.source.card })) : null),
    h("section", { class: "card" }, h("label", { class: "field" }, h("span", {}, t("course.ctitle")), titleIn)),
    paste,
    h("section", { class: "card" }, h("h3", {}, t("course.sessions")), card ? h("p", { class: "muted" }, t("course.cardnote")) : null, sessionsBox),
    h("section", { class: "card" }, h("h3", {}, t("course.exams")), examsBox),
    h("div", { class: "row" }, saveBtn));
}

// ------------------------------------------------------------------ a course
async function course(main, id, ctx) {
  const { t } = ctx;
  const lang = ctx.lang();
  const v = await api.get("/api/course?id=" + enc(id));
  const nx = h("section", { class: "card hero next-step" }, h("h3", {}, t("course.next")),
    h("p", { class: "big" }, nextText(v.next, t)),
    v.next.kind !== "done" ? h("div", { class: "row" }, h("button", { class: "primary", onclick: () => go(nextHref(v.id, v.next)) }, t("course.go"))) : null);
  const sessions = h("section", { class: "card" }, h("h3", {}, t("course.sessions")),
    h("ol", { class: "timeline" }, v.sessions.map((s) => h("li", { class: `tl st-${s.status}` },
      h("span", { class: "tl-n" }, String(s.n)),
      h("a", { href: `#/courses/${enc(v.id)}/s/${s.n}` }, s.title),
      h("span", { class: "meta" }, s.date ? fmtDate(s.date, lang) : t("course.st.undated")),
      h("span", { class: `badge tb-${s.status}` }, t(`course.st.${s.status}`)),
      s.marks.map((m) => h("span", { class: "badge soft" }, t(`course.mark.${m}`)))))));
  const exams = v.exams.length ? h("section", { class: "card" }, h("h3", {}, t("course.exams")),
    h("ul", { class: "items" }, v.exams.map((e) => h("li", {},
      h("a", { href: `#/courses/${enc(v.id)}/e/${enc(e.id)}` }, e.title),
      h("span", { class: "meta" }, fmtDate(e.date, lang), " · ", whenWord(e.days, t)),
      e.open ? h("span", { class: "badge s-due" }, t("course.e.open")) : null)))) : null;
  const tools = h("div", { class: "row wrap" },
    h("button", { class: "ghost", onclick: () => go(`#/courses/${enc(v.id)}/edit`) }, t("course.edit")),
    h("button", { class: "ghost", onclick: async () => {
      if (!confirm(t("course.archive.q"))) return;
      await api.post("/api/course/archive", { id: v.id });
      toast(t("course.archived"));
      go("#/courses");
    } }, t("course.archive")));
  fill(main, back("#/courses", t("course.title")),
    h("div", { class: "page-head" }, h("h1", {}, v.title),
      h("span", { class: "stat soft" }, v.source.kind === "card" ? t("course.fromcard", { card: v.source.card }) : t("course.fromsyl"))),
    nx, sessions, exams, tools);
}

// ------------------------------------------------------------------ a session: before, after, ask
async function session(main, id, n, tab, ctx) {
  const { t } = ctx;
  const lang = ctx.lang();
  const d = await api.get(`/api/tutor/session?id=${enc(id)}&n=${enc(n)}&lang=${ctx.lang()}`);
  const s = d.session;
  if (!["before", "after", "ask"].includes(tab)) tab = s.date && relDays(todayIso(), s.date) > 0 ? "before" : "after";
  const base = `#/courses/${enc(id)}/s/${s.n}`;
  const tabs = h("nav", { class: "lab-tabs" }, ["before", "after", "ask"].map((k) => h("a",
    { href: `${base}?tab=${k}`, class: k === tab ? "active" : "" }, t(`course.tab.${k}`))));
  const mark = (what) => h("button", { class: "ghost", onclick: async (ev) => {
    await api.post("/api/tutor/mark", { id, n: s.n, what });
    ev.target.disabled = true;
    toast(t(`course.mark.${what}`));
  } }, t(`course.do.${what}`));
  const body = h("div", { class: "session-body" });
  if (tab === "before") fill(body, ...beforeView(d, t, mark));
  else if (tab === "after") fill(body, ...afterView(d, id, t, mark, lang));
  else fill(body, askView(d, id, t));
  fill(main, back(`#/courses/${enc(id)}`, d.course.title),
    h("div", { class: "page-head" }, h("h1", {}, s.title),
      h("span", { class: "stat soft" }, s.date ? fmtDate(s.date, lang) : t("course.st.undated"))),
    tabs, body);
  await typeset(body);
}

function beforeView(d, t, mark) {
  const b = d.before;
  const out = [];
  if (b.lecture) {
    out.push(h("section", { class: "card" }, h("h3", {}, t("course.b.lecture")),
      b.lecture.one_line ? h("blockquote", { class: "one-line" }, b.lecture.one_line) : null,
      b.lecture.parts.length ? [h("h4", {}, t("course.b.parts")), h("ol", {}, b.lecture.parts.map((p) => h("li", {}, p.replace(/^\d+\.\s*/, ""))))] : null));
  }
  out.push(h("section", { class: "card" }, h("h3", {}, t("course.b.teaches")),
    b.concepts.length ? b.concepts.map((c) => h("div", { class: "concept-pre" },
      h("div", { class: "row wrap" }, h("a", { href: conceptHref(c.name) }, h("strong", {}, c.name)),
        c.status === "off" ? h("span", { class: "badge" }, t("status.off")) : statusBadge(c.status, t)),
      h("p", { class: c.abstract ? "" : "muted", lang: c.abstract_lang || "en", dir: "auto" }, c.abstract || t("course.b.noabstract")),
      c.requires.length ? h("div", { class: "chips" }, h("span", { class: "meta" }, t("course.b.rests")),
        c.requires.map((r) => h("a", { class: `chip-link s-${r.status}`, href: conceptHref(r.name) }, r.name))) : null))
      : h("p", { class: "muted" }, t("course.b.none"))));
  out.push(h("section", { class: "card" }, h("h3", {}, t("course.b.first")),
    b.first.length ? h("ul", { class: "items" }, b.first.map((x) => h("li", {},
      h("a", { href: conceptHref(x.name) }, x.name), h("span", { class: "meta" }, t("layer", { n: x.layer })),
      x.action === "check"
        ? h("a", { class: "small-link", href: "#/check?concept=" + encodeURIComponent(x.name) }, t("course.b.check"))
        : h("a", { class: "small-link", href: conceptHref(x.name) }, t("course.b.read")))))
      : h("p", { class: "muted" }, t("course.b.firstnone")),
    b.waiting ? h("p", { class: "meta" }, t("course.b.waiting", { n: b.waiting })) : null));
  if (b.listen.length) {
    out.push(h("section", { class: "card" }, h("h3", {}, t("course.b.listen")),
      h("ul", {}, b.listen.map((x) => h("li", {}, h("span", { class: "meta" }, x.concept, ": "), x.q)))));
  }
  out.push(h("div", { class: "row" }, mark("prepped")));
  return out;
}

function afterView(d, id, t, mark, lang) {
  const a = d.after;
  const s = d.session;
  const result = h("div", { class: "recall-result" });
  const area = h("textarea", { rows: 6, placeholder: t("course.a.recall.ph") });
  const btn = h("button", { class: "primary", type: "button" }, t("course.a.compare"));
  const selfList = (names, code) => {
    const picks = names.map((c) => h("label", { class: "pick-line" }, h("input", { type: "checkbox", value: c }), " ", c));
    const save = h("button", { class: "ghost", type: "button", onclick: async () => {
      const recalled = picks.map((p) => p.querySelector("input")).filter((i) => i.checked).map((i) => i.value);
      await api.post("/api/tutor/recall/self", { id, n: s.n, recalled });
      save.disabled = true;
      toast(t("course.saved"));
    } }, t("course.a.selfsave"));
    fill(result, why(code, t), h("h4", {}, t("course.a.self")), picks, h("div", { class: "row" }, save));
  };
  btn.onclick = async () => {
    const text = area.value.trim();
    if (!text) return toast(t("course.a.recall.empty"));
    btn.disabled = true;
    btn.textContent = t("course.a.comparing");
    try {
      const r = await api.post("/api/tutor/recall", { id, n: s.n, text });
      if (r.needs_self) return selfList(r.checklist, r.why_code);
      fill(result,
        r.recalled.length ? [h("h4", {}, t("course.a.recalled")), h("div", { class: "chips" }, r.recalled.map((c) => h("a", { class: "chip-link s-mastered", href: conceptHref(c) }, c)))] : null,
        r.missed.length ? [h("h4", {}, t("course.a.missed")), h("div", { class: "chips" }, r.missed.map((c) => h("a", { class: "chip-link s-to-read", href: conceptHref(c) }, c)))] : null,
        r.notes ? h("p", {}, r.notes) : null,
        r.question ? [h("h4", {}, t("course.a.question")), h("p", { class: "one-line" }, r.question)] : null);
    } finally { btn.disabled = false; btn.textContent = t("course.a.compare"); }
  };
  const road = h("section", { class: "card" }, h("h3", {}, t("course.a.road")),
    a.concepts.length ? h("ul", { class: "items" }, a.concepts.map((c) => h("li", {},
      h("a", { href: conceptHref(c.name) }, c.name),
      c.status === "off" ? h("span", { class: "badge" }, t("status.off")) : statusBadge(c.status, t),
      c.due ? h("span", { class: "meta" }, t("course.a.due", { date: fmtDate(c.due, lang) })) : null,
      c.check ? h("a", { class: "small-link", href: "#/check?concept=" + encodeURIComponent(c.name) }, t("course.a.check")) : null)))
      : h("p", { class: "muted" }, t("course.b.none")));
  const labs = a.concepts.flatMap((c) => labFor(c.name).map((x) => ({ ...x, concept: c.name })));
  const lab = labs.length ? h("section", { class: "card" }, h("h3", {}, "🔬 ", t("course.a.lab")),
    h("div", { class: "chips" }, labs.map((x) => h("a", { class: "chip-link lab", href: `#/lab/${x.kind}/${x.id}` },
      x.kind === "models" ? `${t("lab.model")} · ${t("lab.m." + x.id)}` : `${t("lab.exercise")} · ${x.title}`)))) : null;
  const recall = h("section", { class: "card" }, h("h3", {}, t("course.a.recall")),
    h("p", { class: "muted" }, t("course.a.recall.d")),
    a.recall.available ? null : why(a.recall.why_code, t),
    area, h("div", { class: "row" }, btn), result);
  return [recall, road, lab, h("div", { class: "row wrap" }, mark("attended"), mark("reviewed"))];
}

function askView(d, id, t) {
  const s = d.session;
  const area = h("textarea", { rows: 3, placeholder: t("course.k.ph") });
  const out = h("div", { class: "answer" });
  const btn = h("button", { class: "primary", type: "button" }, t("course.k.send"));
  btn.onclick = async () => {
    const question = area.value.trim();
    if (!question) return;
    btn.disabled = true;
    btn.textContent = t("course.k.asking");
    try {
      const r = await api.post("/api/tutor/ask", { id, n: s.n, question });
      if (r.unavailable) { fill(out, why(r.why_code, t)); return; }
      fill(out, h("div", { class: "note answer-note", html: r.html }),
        r.covered ? null : h("p", { class: "meta" }, t("course.k.notcovered")),
        r.sources.length ? h("p", { class: "meta" }, t("course.k.sources", { list: r.sources.join(" · ") })) : null);
      await typeset(out);
    } finally { btn.disabled = false; btn.textContent = t("course.k.send"); }
  };
  return h("section", { class: "card" }, h("h3", {}, t("course.k.ask")),
    h("p", { class: "muted" }, t("course.k.d")), area, h("div", { class: "row" }, btn), out);
}

// ------------------------------------------------------------------ an exam: scope, plan, practice
async function exam(main, id, eid, ctx) {
  const { t } = ctx;
  const lang = ctx.lang();
  const d = await api.get(`/api/tutor/exam?id=${enc(id)}&exam=${enc(eid)}`);
  const head = h("div", { class: "page-head" }, h("h1", {}, d.exam.title),
    h("span", { class: "stat soft" }, fmtDate(d.exam.date, lang), " · ", whenWord(d.days_left, t)));
  const scope = h("section", { class: "card" }, h("h3", {}, t("course.e.scope")),
    h("ul", { class: "items" }, d.scope.map((c) => h("li", {},
      h("a", { href: conceptHref(c.name) }, c.name),
      h("span", { class: `badge cat-${c.category}` }, t(`course.cat.${c.category}`)),
      c.status === "ready" || c.status === "to-read"
        ? h("a", { class: "small-link", href: "#/check?concept=" + encodeURIComponent(c.name) }, t("course.a.check")) : null))));
  const plan = d.plan.length ? h("section", { class: "card" }, h("h3", {}, t("course.e.plan")),
    h("ul", { class: "items" }, d.plan.map((p) => h("li", {},
      h("strong", {}, fmtDate(p.date, lang)),
      p.kind === "practice" ? h("span", {}, t("course.e.practice"))
        : h("span", { class: "chips" }, p.concepts.map((c) => h("a", { class: "chip-link", href: conceptHref(c) }, c)))))))
    : h("p", { class: "card soft" }, d.days_left < 0 ? t("course.e.past") : t("course.e.noplan"));
  const practice = h("section", { class: "card" }, h("h3", {}, t("course.e.practice")));
  const startBtn = h("button", { class: "primary", type: "button" }, t("course.e.start"));
  startBtn.onclick = async () => {
    startBtn.disabled = true;
    try {
      const p = await api.post("/api/tutor/practice", { id, exam: eid });
      runPractice(practice, p, t);
    } catch (e) {
      startBtn.disabled = false;
      toast(e.message || String(e), 6000);
    }
  };
  fill(practice, h("h3", {}, t("course.e.practice")),
    d.practice.questions ? [h("p", { class: "muted" }, t("course.e.practice.d", { n: d.practice.questions })), h("div", { class: "row" }, startBtn)]
      : h("p", { class: "muted" }, t("course.e.none")));
  fill(main, back(`#/courses/${enc(id)}`, d.course.title), head, scope, plan, practice);
}

function runPractice(box, p, t) {
  let i = 0;
  let right = 0;
  const qs = p.questions;
  const show = () => {
    if (i >= qs.length) {
      fill(box, h("h3", {}, t("course.e.practice")), h("p", { class: "big" }, t("course.e.done", { right, n: qs.length })));
      return;
    }
    const q = qs[i];
    const area = h("textarea", { rows: 4, placeholder: t("check.answer") });
    const result = h("div", {});
    const submit = h("button", { class: "primary", type: "button" }, t("course.e.submit"));
    const nextBtn = h("button", { class: "ghost", type: "button", hidden: true, onclick: () => { i += 1; show(); } }, t("course.e.next"));
    submit.onclick = async () => {
      const answer = area.value.trim();
      if (!answer) return;
      submit.disabled = true;
      const r = await api.post("/api/tutor/practice/answer", { item: p.item, qid: q.qid, answer });
      const key = [h("h4", {}, t("course.e.key")), h("p", {}, r.key)];
      if (r.needs_self) {
        const yes = h("button", { class: "ghost", type: "button" }, t("course.e.yes"));
        const no = h("button", { class: "ghost", type: "button" }, t("course.e.no"));
        const pick = async (correct) => {
          await api.post("/api/tutor/practice/self", { handle: r.handle, correct });
          if (correct) right += 1;
          yes.disabled = no.disabled = true;
          nextBtn.hidden = false;
        };
        yes.onclick = () => pick(true);
        no.onclick = () => pick(false);
        fill(result, key, h("p", {}, t("course.e.selfq")), h("div", { class: "row" }, yes, no));
        return;
      }
      if (r.correct) right += 1;
      fill(result, h("p", { class: r.correct ? "ok big" : "bad big" }, r.correct ? t("course.e.right") : t("course.e.wrong")),
        r.missing && !r.correct ? h("p", { class: "meta" }, r.missing) : null, key);
      nextBtn.hidden = false;
    };
    fill(box, h("h3", {}, t("course.e.practice")),
      h("p", { class: "meta" }, t("course.e.q", { i: i + 1, n: qs.length }), " · ", q.concept, " · ", t(`facet.${q.facet}`)),
      h("p", { class: "question" }, q.q), area, h("div", { class: "row" }, submit, nextBtn), result);
    typeset(box);
  };
  show();
}
