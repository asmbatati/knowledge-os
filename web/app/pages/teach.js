// Teach: explain a concept to a student who knows nothing of it, Feynman's way (the vault's Knowledge OS Design §6).
// The student is Claude playing a beginner at the level chosen for the session; it is never given the note. When the
// session ends, a separate reviewer reads the transcript and the note and says what was wrong, what was missing, which
// words went unexplained, how the teaching went, and one thing to do better. Never a verdict, never a score.

import { api, h, fill, toast } from "../ui.js";
import { pickVoice, minutesSince, reviewSections, gapsOf } from "../teach/voice.js";

const enc = encodeURIComponent;
let live = null;            // the session under way survives a visit to another tab

function why(code, t) {
  return h("p", { class: "card warn" }, t("teach.why." + (code || "unreachable")));
}

export async function render(main, params, ctx) {
  const { t } = ctx;
  if (params.past) return pastView(main, params.past, ctx);
  if (live && (!params.arg || params.arg === live.subject)) return sessionView(main, ctx);
  const d = await api.get("/api/teach?lang=" + ctx.lang() + (params.arg ? "&name=" + enc(params.arg) : ""));
  return startView(main, d, params.arg, ctx);
}

// ------------------------------------------------------------------ choosing what to teach, and to whom
function startView(main, d, chosen, ctx) {
  const { t } = ctx;
  let subject = d.subject || null;
  let level = "first-year";
  const subjectBox = h("div", { class: "teach-subject" });
  const hits = h("div", { class: "x-results" });
  let timer = null;
  const search = h("input", {
    type: "search", class: "x-search", placeholder: t("teach.find"), "aria-label": t("teach.find"),
    value: subject ? subject.name : (chosen || ""),
    oninput: () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = search.value.trim();
        if (q.length < 2) { fill(hits); return; }
        const r = await api.get("/api/xsearch?q=" + enc(q));
        fill(hits, r.hits.length ? h("div", { class: "chips" }, r.hits.slice(0, 12).map((x) => h("button", {
          class: "chip-link", type: "button", onclick: async () => {
            const s = await api.get("/api/teach?lang=" + ctx.lang() + "&name=" + enc(x.name));
            subject = s.subject; search.value = subject.name; fill(hits); drawSubject();
          },
        }, x.name, h("span", { class: "muted small" }, " · " + (x.type || "note")))))
          : h("p", { class: "muted" }, t("x.nohits")));
      }, 220);
    },
  });
  const drawSubject = () => fill(subjectBox, subject ? h("div", { class: "card soft" },
    h("h3", { dir: "auto" }, subject.label || subject.name),
    subject.abstract ? h("p", { lang: subject.abstract_lang || "en", dir: "auto" }, subject.abstract)
      : h("p", { class: "muted" }, t("teach.noabstract")),
    subject.missing && subject.abstract ? h("p", { class: "muted small" }, t("lang.missing." + subject.missing)) : null)
    : null);
  drawSubject();

  const levels = h("div", { class: "teach-levels", role: "radiogroup", "aria-label": t("teach.level") });
  const drawLevels = () => fill(levels, d.levels.map((l) => h("button", {
    type: "button", role: "radio", "aria-checked": String(l === level), class: "level" + (l === level ? " active" : ""),
    onclick: () => { level = l; drawLevels(); },
  }, h("strong", {}, t("teach.lv." + l)), h("span", { class: "muted small" }, t("teach.lv." + l + ".d")))));
  drawLevels();

  const start = h("button", { class: "primary", type: "button" }, t("teach.start"));
  start.onclick = async () => {
    if (!subject) { toast(t("teach.pick")); return; }
    start.disabled = true;
    try {
      const r = await api.post("/api/teach/start", { name: subject.name, level, lang: ctx.lang() });
      if (r.unavailable) { fill(note, why(r.why_code, t)); return; }
      live = { session: r.session, subject: r.subject, level: r.level, started: Date.now(),
               turns: [{ who: "student", text: r.student }], busy: false, voice: false };
      const target = "#/teach/" + enc(r.subject);
      if (location.hash === target) sessionView(main, ctx);
      else location.hash = target;            // the router draws the session
    } finally { start.disabled = false; }
  };
  const note = h("div", {}, d.available ? null : why(d.why_code, t));

  fill(main,
    h("div", { class: "page-head" }, h("h1", {}, t("teach.title"))),
    h("p", { class: "muted" }, t("teach.lede")),
    note,
    h("section", { class: "card" }, h("h3", {}, t("teach.what")), search, hits, subjectBox),
    h("section", { class: "card" }, h("h3", {}, t("teach.level")), levels, h("div", { class: "row" }, start)),
    measuresView(d.measures, t));
}

function measuresView(m, t) {
  if (!m || !m.sessions) return h("section", { class: "card soft" }, h("p", { class: "muted" }, t("teach.m.none")));
  return h("section", { class: "card" }, h("h3", {}, t("teach.m.title")),
    h("p", {}, t("teach.m.counts", { s: m.sessions, c: m.concepts, w: m.this_week })),
    m.habits.length ? h("div", {}, h("p", { class: "muted small" }, t("teach.m.habits")),
      h("div", { class: "chips" }, m.habits.map(([k, n]) => h("span", { class: "chip" }, `${t("teach.h." + k)} · ${n}`)))) : null,
    h("ul", { class: "items" }, m.recent.map((r) => h("li", {},
      h("a", { href: "#/teach?past=" + enc(r.id) }, r.concept),
      h("span", { class: "meta" }, ` ${r.date} · ${t("teach.lv." + r.level)} · ${t("teach.min", { n: r.minutes })}`),
      r.one_thing ? h("div", { class: "muted small" }, r.one_thing) : null))),
    h("p", { class: "muted small" }, t("teach.m.never")));
}

// ------------------------------------------------------------------ the session
function sessionView(main, ctx) {
  const { t } = ctx;
  window.scrollTo(0, 0);
  const s = live;
  const log = h("div", { class: "teach-log", "aria-live": "polite" });
  const bubble = (turn) => h("div", { class: "bubble " + turn.who },
    h("span", { class: "who muted small" }, turn.who === "student" ? t("teach.student") : t("teach.you")),
    h("p", {}, turn.text));
  const drawLog = () => { fill(log, s.turns.map(bubble), s.busy ? h("p", { class: "muted loading" }, t("teach.thinking")) : null); log.scrollTop = log.scrollHeight; };
  const area = h("textarea", { rows: 4, placeholder: t("teach.ph"), "aria-label": t("teach.ph") });
  const send = h("button", { class: "primary", type: "button" }, t("teach.send"));
  const end = h("button", { class: "ghost", type: "button" }, t("teach.end"));
  const clock = h("span", { class: "stat soft" });
  const status = h("div", {});
  const voices = () => (typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : []);
  const voice = pickVoice(voices(), ctx.lang());
  const speak = (text) => {
    const v = pickVoice(voices(), ctx.lang());
    if (!s.voice || !v) return;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v; u.lang = v.lang;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  };
  const voiceBox = voice ? h("label", { class: "row small" }, h("input", {
    type: "checkbox", checked: s.voice || null, onchange: (e) => { s.voice = e.target.checked; if (!s.voice) speechSynthesis.cancel(); },
  }), " ", t("teach.voice")) : h("span", { class: "muted small" }, t("teach.novoice"));

  const tick = () => { clock.textContent = t("teach.min", { n: minutesSince(s.started, Date.now()) }); };
  tick();
  const iv = setInterval(tick, 20000);

  send.onclick = async () => {
    const text = area.value.trim();
    if (!text || s.busy) return;
    s.busy = true; send.disabled = true; fill(status);
    s.turns.push({ who: "teacher", text });
    area.value = "";
    drawLog();
    try {
      const r = await api.post("/api/teach/say", { session: s.session, text });
      if (r.unavailable) {
        s.turns.pop(); area.value = text;
        fill(status, why(r.why_code, t));
      } else {
        s.turns.push({ who: "student", text: r.student });
        speak(r.student);
      }
    } catch (e) {
      s.turns.pop(); area.value = text;
      fill(status, h("p", { class: "card error" }, e.message || String(e)));
      if (e.status === 404) live = null;
    } finally { s.busy = false; send.disabled = false; drawLog(); area.focus(); }
  };
  area.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send.click(); } });
  end.onclick = async () => {
    if (!s.turns.some((x) => x.who === "teacher")) { toast(t("teach.nothing")); return; }
    end.disabled = true; send.disabled = true;
    fill(status, h("p", { class: "muted loading" }, t("teach.reviewing")));
    try {
      const r = await api.post("/api/teach/end", { session: s.session });
      if (r.unavailable) { fill(status, why(r.why_code, t)); return; }
      clearInterval(iv);
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      const subject = s.subject;
      live = null;
      reviewView(main, { ...r, concept: subject, level: s.level }, ctx);
    } catch (e) {
      fill(status, h("p", { class: "card error" }, e.message || String(e)));
      if (e.status === 404) live = null;
    } finally { end.disabled = false; send.disabled = false; }
  };

  drawLog();
  fill(main,
    h("div", { class: "page-head" }, h("h1", {}, s.subject),
      h("div", { class: "row" }, h("span", { class: "chip" }, t("teach.lv." + s.level)), clock)),
    h("p", { class: "muted" }, t("teach.how")),
    h("section", { class: "card teach-chat" }, log, area,
      h("div", { class: "row wrap" }, send, end, voiceBox), h("p", { class: "muted small" }, t("teach.keys")), status));
  area.focus();
  return () => clearInterval(iv);
}

// ------------------------------------------------------------------ the review
function reviewView(main, r, ctx) {
  const { t } = ctx;
  window.scrollTo(0, 0);
  const rv = r.review || {};
  const gaps = gapsOf(rv);
  fill(main,
    h("div", { class: "page-head" }, h("h1", {}, t("teach.r.title", { name: r.concept })),
      h("span", { class: "stat soft" }, `${t("teach.lv." + r.level)} · ${t("teach.min", { n: r.minutes })}`)),
    rv.one_thing ? h("section", { class: "card highlight" }, h("h3", {}, t("teach.r.one")), h("p", {}, rv.one_thing)) : null,
    h("section", { class: "card" }, h("h3", {}, t("teach.r.content")),
      reviewSections(rv).map((sec) => h("div", {}, h("h4", {}, t("teach.r." + sec.key)),
        h("ul", { class: "items" }, sec.items.map((x) => h("li", {}, x))))),
      reviewSections(rv).length ? null : h("p", { class: "muted" }, t("teach.r.clean"))),
    h("section", { class: "card" }, h("h3", {}, t("teach.r.teaching")),
      h("dl", { class: "teach-dl" },
        h("dt", {}, t("teach.r.structure")), h("dd", {}, rv.structure || "—"),
        h("dt", {}, t("teach.r.analogies")), h("dd", {}, rv.analogies || "—"),
        h("dt", {}, t("teach.r.pacing")), h("dd", {}, rv.pacing || "—"),
        h("dt", {}, t("teach.r.checked")), h("dd", {}, rv.checked ? t("teach.r.yes") : t("teach.r.no"))),
      (rv.habits || []).length ? h("div", { class: "chips" }, rv.habits.map((k) => h("span", { class: "chip" }, t("teach.h." + k)))) : null),
    (rv.confusions || []).length ? h("section", { class: "card" }, h("h3", {}, t("teach.r.confusions")),
      h("ul", { class: "items" }, rv.confusions.map((c) => h("li", {}, c.text,
        c.note_answers ? h("span", { class: "meta" }, " · " + t("teach.r.innote"))
          : h("span", { class: "badge" }, t("teach.r.gap"))))),
      gaps.length ? h("p", { class: "muted small" }, t("teach.r.gapsnote", { n: gaps.length })) : null) : null,
    h("div", { class: "row wrap" },
      h("a", { class: "button primary", href: "#/teach/" + enc(r.concept), onclick: (e) => {
        if (location.hash === "#/teach/" + enc(r.concept)) { e.preventDefault(); render(main, { arg: r.concept }, ctx); }
      } }, t("teach.again")),
      h("a", { class: "button ghost", href: "#/teach" }, t("teach.other")),
      h("a", { class: "button ghost", href: "#/note/" + enc(r.concept) }, t("teach.open"))));
}

async function pastView(main, id, ctx) {
  const r = await api.get("/api/teach/past?id=" + enc(id));
  reviewView(main, r, ctx);
}
