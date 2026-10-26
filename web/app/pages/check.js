// A session on the road: the next item, one question at a time. Confidence is asked before the key (hypercorrection:
// a confident miss is remembered), the key and the note's sentence come only after the answer, and the verdict is
// recorded by the server from the answers it graded — the page sends only which item is done.

import { api, h, conceptHref, toast, ApiError, go, fill } from "../ui.js";
import { typeset, mathText } from "../typeset.js";
import { figuresFor } from "../lab/registry.js";
import { figureCards } from "../lab/figure-card.js";
import { remember, current } from "./study.js";

let fromStudy = false;          // opened by the coach's session (from=study): its last screen leads back there
const suffix = () => (fromStudy ? "&from=study" : "");

const GAP_AR = { prerequisite: "متطلب سابق", misconception: "فهم خاطئ", notation: "رموز", method: "طريقة",
  reasoning: "استدلال", none: "لا شيء" };

export async function render(main, params, ctx) {
  const { t, timer } = ctx;
  fromStudy = params.from === "study";
  const url = params.concept ? "/api/next?concept=" + encodeURIComponent(params.concept) : "/api/next";
  let nx;
  try {
    nx = await api.get(url);
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      main.replaceChildren(h("div", { class: "card soft" }, h("p", {}, e.message),
        fromStudy ? h("a", { class: "button primary", href: "#/study" }, t("study.backto")) : h("a", { class: "button ghost", href: "#/check" }, t("check.next"))));
      return;
    }
    throw e;
  }
  const head = () => h("div", { class: "item-head" },
    h("span", { class: `kind k-${nx.kind}` }, t(`kind.${nx.kind}`)),
    nx.concept ? h("a", { class: "concept-name", href: conceptHref(nx.concept) }, nx.concept) : null,
    nx.layer !== undefined && nx.concept ? h("span", { class: "meta" }, t("layer", { n: nx.layer })) : null,
    nx.questions && ctx.lang() === "ar" ? h("p", { class: "lang-bar" }, t("check.lang")) : null,
    nx.stuck ? h("span", { class: "badge s-due" }, t("stuck")) : null);

  if (nx.kind === "none") return renderNone(main, nx, t);
  if (nx.kind === "reading") return renderReading(main, nx, t, head);
  if (nx.kind === "check" && !fromStudy) return teachFirst(main, nx, ctx, head);
  return begin(main, nx, ctx, head);
}

function begin(main, nx, ctx, head) {
  if (nx.bank !== "ok") return renderNoBank(main, nx, ctx.t, head);
  if (nx.kind === "check" && figuresFor(nx.concept).length) return lookFirst(main, nx, ctx, head);
  return runQuestions(main, nx, ctx, head);
}

// A check is a concept new on the road: the coach teaches it first, then hands back to this page for its check, and
// goes on through the day's other checks (a road session, 24 Oct 2026). A review goes straight to its questions:
// recalling it cold is what a review is for.
function teachFirst(main, nx, ctx, head) {
  const { t, timer } = ctx;
  const teach = h("button", { class: "primary", onclick: async () => {
    teach.disabled = skip.disabled = true;
    try {
      const s = await api.post("/api/coach/start", { mode: "road", topic: nx.concept, lang: ctx.lang() });
      remember({ id: s.session, started: Date.now(), agenda: s.agenda });
      if (timer.state().phase === "idle") timer.startFocus("", nx.concept);
      go("#/study");
    } catch (e) { toast(e.message); teach.disabled = skip.disabled = false; }
  } }, t("check.teach.go"));
  const skip = h("button", { class: "ghost", onclick: () => begin(main, nx, ctx, head) }, t("check.teach.skip"));
  main.replaceChildren(h("section", { class: "card" }, head(), h("h2", {}, t("check.teach.title")),
    h("p", {}, t("check.teach.d", { concept: ctx.label ? ctx.label(nx.concept) : nx.concept })), sourcesLine(nx, t),
    h("div", { class: "row" }, teach, skip,
      h("a", { class: "button ghost", href: conceptHref(nx.concept) }, t("check.opennote")))));
  teach.focus();
}

// A figure that explains the concept comes before a check's first question, never during one: the questions start,
// and their clock with them, only when the learner begins. A review and placement go straight to their questions.
function lookFirst(main, nx, ctx, head) {
  const { t } = ctx;
  const begin = h("button", { class: "primary", onclick: () => runQuestions(main, nx, ctx, head) }, t("check.begin"));
  main.replaceChildren(h("section", { class: "card" }, head(), h("p", { class: "muted" }, t("check.figure")),
    ...figureCards(nx.concept, t), h("div", { class: "row" }, begin)));
  begin.focus();
}

// In my words (decision 6): after a passed check, one sentence of the learner's own, kept as written. The road keeps it
// in its ledger and writes it into the note's In my words section; nothing else writes there.
function wordsBox(concept, t) {
  const input = h("textarea", { class: "answer", rows: 2, dir: "auto", maxlength: 400, placeholder: t("words.ph"),
    "aria-label": t("words.ask") });
  const save = h("button", { class: "primary", disabled: true }, t("words.save"));
  const box = h("div", { class: "words-box" }, h("p", { class: "label" }, t("words.ask")), input,
    h("div", { class: "row" }, save, h("span", { class: "hint" }, t("words.hint"))));
  input.addEventListener("input", () => { save.disabled = !input.value.trim(); });
  save.onclick = async () => {
    save.disabled = true;
    try {
      await api.post("/api/words", { concept, text: input.value });
      fill(box, h("p", { class: "meta" }, "✓ " + t("words.saved")));
    } catch (e) { toast(e.message); save.disabled = false; }
  };
  return box;
}

function sourcesLine(nx, t) {
  return nx.sources && nx.sources.length
    ? h("p", { class: "meta" }, `${t("check.sources")}: `, nx.sources.join(" · ")) : null;
}

function renderNone(main, nx, t) {
  main.replaceChildren(h("section", { class: "card" }, h("h2", {}, t("kind.none")), h("p", {}, t("check.none")),
    (nx.readings || []).length ? h("div", {}, h("h3", {}, t("check.readings")), h("ul", { class: "items" },
      nx.readings.map((r) => h("li", {}, h("a", { href: conceptHref(r.concept) }, r.concept),
        h("a", { class: "small-link", href: "#/check?concept=" + encodeURIComponent(r.concept) }, t("check.readdone"))))))
      : null,
    fromStudy ? h("a", { class: "button primary", href: "#/study" }, t("study.backto")) : h("a", { class: "button ghost", href: "#/today" }, t("back.today"))));
}

function renderReading(main, nx, t, head) {
  const done = h("button", { class: "primary", onclick: async () => {
    done.disabled = true;
    try { await api.post("/api/read", { concept: nx.concept }); } catch (e) { /* the check still opens */ }
    go("#/check?concept=" + encodeURIComponent(nx.concept) + suffix());
  } }, t("check.readdone"));
  main.replaceChildren(h("section", { class: "card" }, head(), h("p", {}, t("check.reading")), sourcesLine(nx, t),
    h("div", { class: "row" }, h("a", { class: "button ghost", href: conceptHref(nx.concept) }, t("check.opennote")), done)));
}

function renderNoBank(main, nx, t, head) {
  const status = h("div", { class: "bank-status" });
  const btn = h("button", { class: "primary", onclick: async () => {
    btn.disabled = true;
    status.replaceChildren(h("p", { class: "muted pulse" }, t("check.writingbank")));
    try {
      await api.post("/api/bank", { concept: nx.concept });
      go("#/check?concept=" + encodeURIComponent(nx.concept) + suffix());
    } catch (e) {
      btn.disabled = false;
      const probs = (e.body && e.body.problems) || [];
      status.replaceChildren(h("div", { class: "card error" }, h("p", {}, probs.length ? t("check.badbank") : e.message),
        probs.length ? h("ul", {}, probs.map((x) => h("li", {}, x))) : null));
    }
  } }, t("check.writebank"));
  // in a coached session, a check whose bank cannot be written yet is stepped past: the session goes on
  const cur = fromStudy ? current() : null;
  const skip = cur && cur.id ? h("button", { class: "ghost", onclick: async (ev) => {
    ev.currentTarget.disabled = true;
    try { await api.post("/api/coach/skip", { session: cur.id, concept: nx.concept }); } catch (e) { /* back anyway */ }
    go("#/study");
  } }, t("check.skip.session")) : null;
  main.replaceChildren(h("section", { class: "card" }, head(), h("p", {}, t("check.nobank")),
    h("p", { class: "muted" }, t("check.nobank.d")), sourcesLine(nx, t),
    h("div", { class: "row" }, btn, skip, h("a", { class: "button ghost", href: conceptHref(nx.concept) }, t("check.opennote"))),
    status));
}

function runQuestions(main, nx, ctx, head) {
  const { t, timer } = ctx;
  const qs = nx.questions;
  let i = 0;

  const show = () => {
    const q = qs[i];
    let conf = 0;
    const t0 = performance.now();
    const answer = h("textarea", { class: "answer", rows: 5, dir: "auto", placeholder: t("check.answer"),
      "aria-label": t("check.answer") });
    const submit = h("button", { class: "primary", disabled: true }, t("check.submit"));
    const ready = () => { submit.disabled = !(answer.value.trim() && conf); };
    const confs = h("div", { class: "confs", role: "radiogroup", "aria-label": t("check.conf") },
      [1, 2, 3, 4].map((c) => h("button", { type: "button", class: "conf", role: "radio", "aria-checked": "false",
        onclick: (ev) => {
          conf = c;
          confs.querySelectorAll(".conf").forEach((b) => b.setAttribute("aria-checked", b === ev.currentTarget ? "true" : "false"));
          ready();
        } }, h("strong", {}, String(c)), " ", t(`conf.${c}`))));
    answer.addEventListener("input", ready);
    answer.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter" && !submit.disabled) submit.click();
    });
    const out = h("div", { class: "result" });
    // "I don't know": a miss with nothing to grade and no confidence asked; the key follows at once (24 Oct 2026)
    const dunno = h("button", { class: "ghost", type: "button", title: t("check.dontknow.hint") }, t("dontknow"));
    const send = async (body, wait) => {
      submit.disabled = dunno.disabled = true;
      answer.readOnly = true;
      confs.querySelectorAll(".conf").forEach((b) => { b.disabled = true; });
      out.replaceChildren(h("p", { class: "muted pulse" }, wait));
      try {
        const g = await api.post("/api/attempt", { item: nx.item, qid: q.qid, ...body,
          seconds: Math.round((performance.now() - t0) / 1000) });
        if (g.needs_self) selfGrade(g, out); else showGrade(g, out, answer.value);
      } catch (e) {
        out.replaceChildren(h("div", { class: "card error" }, h("p", {}, e.message)));
        dunno.disabled = false; answer.readOnly = false; ready();
        confs.querySelectorAll(".conf").forEach((b) => { b.disabled = false; });
      }
    };
    submit.onclick = () => send({ answer: answer.value, confidence: conf }, t("check.grading"));
    dunno.onclick = () => send({ dont_know: true }, t("check.recording"));
    main.replaceChildren(h("section", { class: "card question" }, head(),
      h("p", { class: "qof" }, t("check.qof", { i: i + 1, n: qs.length }), " · ",
        h("span", { class: `facet f-${q.facet}` }, t(`facet.${q.facet}`))),
      h("p", { class: "q", dir: "auto" }, mathText(q.q)), answer,
      h("p", { class: "label" }, t("check.conf")), confs,
      h("div", { class: "row" }, submit, dunno, h("span", { class: "hint" }, t("check.submit.hint")))), out);
    typeset(main);
    answer.focus();
  };

  const reveal = (g) => h("div", { class: "reveal" },
    h("p", { class: "label" }, t("check.key")), h("p", { class: "key", dir: "auto" }, mathText(g.key)),
    h("blockquote", { class: "evidence", dir: "auto" }, h("span", { class: "label" }, t("check.evidence")), " ",
      h("span", { class: "ev-text" }, mathText(g.evidence))));

  const after = () => {
    const last = i === qs.length - 1;
    return h("button", { class: "primary", onclick: (ev) => {
      ev.currentTarget.disabled = true;
      if (last) record(); else { i += 1; show(); }
    } }, last ? t("check.record") : t("check.nextq"));
  };

  function showGrade(g, out, answerText) {
    const gapLabel = ctx.lang() === "ar" ? (GAP_AR[g.gap] || g.gap) : g.gap;
    const verdict = h("div", { class: `grade ${g.correct ? "right" : g.dont_know ? "neutral" : "wrong"}` },
      h("strong", {}, g.correct ? "✓ " + t("check.right") : g.dont_know ? t("check.dontknow.got") : "✗ " + t("check.wrong")),
      g.credited ? h("p", {}, h("span", { class: "label" }, t("check.credited")), " ",
        h("mark", { dir: "auto" }, g.credited)) : null,
      !g.correct && g.missing ? h("p", {}, h("span", { class: "label" }, t("check.missing")), " ",
        h("span", { dir: "auto" }, g.missing)) : null,
      !g.correct && g.gap && g.gap !== "none" ? h("p", { class: "meta" }, t("check.gap", { gap: gapLabel })) : null,
      g.disagreed ? h("p", { class: "meta" }, t("check.disagreed")) : null);
    const kids = [verdict, reveal(g)];
    if (!g.correct && g.grader && g.grader !== "self" && g.grader !== "fake") kids.push(disputeBox(g, out, answerText));
    kids.push(h("div", { class: "row" }, after()));
    out.replaceChildren(...kids);
    typeset(out);
  }

  function disputeBox(g, out, answerText) {
    const reason = h("textarea", { rows: 2, dir: "auto", placeholder: t("check.dispute.ph") });
    const send = h("button", { class: "ghost", onclick: async () => {
      send.disabled = true;
      try {
        const g2 = await api.post("/api/dispute", { attempt: g.attempt, reason: reason.value });
        showGrade({ ...g, ...g2, key: g.key, evidence: g.evidence }, out, answerText);
      } catch (e) { toast(e.message); send.disabled = false; }
    } }, t("check.dispute.send"));
    return h("details", { class: "dispute" }, h("summary", {}, t("check.dispute")), reason, send);
  }

  function selfGrade(g, out) {
    const yes = h("button", { class: "primary" }, t("check.self.yes"));
    const no = h("button", { class: "ghost" }, t("check.self.no"));
    const choose = async (correct) => {
      yes.disabled = no.disabled = true;
      try {
        await api.post("/api/attempt/self", { attempt: g.attempt, correct });
        out.replaceChildren(h("div", { class: `grade ${correct ? "right" : "wrong"}` },
          h("strong", {}, correct ? "✓ " + t("check.right") : "✗ " + t("check.wrong"))), reveal(g),
          h("div", { class: "row" }, after()));
        typeset(out);
      } catch (e) { toast(e.message); yes.disabled = no.disabled = false; }
    };
    yes.onclick = () => choose(true);
    no.onclick = () => choose(false);
    fill(out, g.why ? h("p", { class: "meta" }, g.why_code ? t("why." + g.why_code) : g.why) : null, reveal(g),
      h("p", { class: "label" }, t("check.self")), h("div", { class: "row" }, yes, no));
    typeset(out);
  }

  async function record() {
    main.append(h("p", { class: "muted pulse" }, t("check.recording")));
    let v;
    try {
      v = await api.post("/api/verdict", { item: nx.item });
    } catch (e) {
      main.replaceChildren(h("div", { class: "card error" }, h("p", {}, e.message),
        h("a", { class: "button ghost", href: "#/today" }, t("back.today"))));
      return;
    }
    timer.countSession(v.kind);
    let nextKind = null;
    try { nextKind = (await api.get("/api/next")).kind; } catch (e) { nextKind = null; }
    const spent = timer.budgetSpent(nextKind);
    const goNext = h("button", { class: "primary", onclick: () => go("#/check") }, spent ? t("check.goon") : t("check.next"));
    main.replaceChildren(h("section", { class: `card verdict ${v.passed ? "right" : "wrong"}` },
      h("div", { class: "item-head" }, h("span", { class: `kind k-${v.kind}` }, t(`kind.${v.kind}`)),
        h("a", { class: "concept-name", href: conceptHref(v.concept) }, v.concept)),
      h("h2", {}, v.passed ? "✓ " + t("check.passed") : t("check.failed")),
      v.passed && v.missed && v.missed.length ? h("p", {}, t("check.passed.miss")) : null,
      v.passed && v.status === "passed" && v.kind === "check" ? h("p", { class: "meta" }, t("check.passed.confirm")) : null,
      v.passed && v.kind === "check" ? wordsBox(v.concept, t) : null,
      v.unlocked && v.unlocked.length ? h("p", {}, h("span", { class: "label" }, t("check.unlocked")), " ",
        v.unlocked.map((n, k) => [k ? " · " : "", h("a", { href: conceptHref(n) }, n)])) : null,
      spent ? h("p", { class: "soft-note" }, t("check.enough")) : null,
      fromStudy ? h("div", { class: "row" }, h("a", { class: "button primary", href: "#/study" }, t("study.backto"))) :
        h("div", { class: "row" }, nextKind && nextKind !== "none" ? goNext : null,
          h("a", { class: "button ghost", href: "#/today" }, spent ? t("check.stop") : t("back.today")))));
  }

  show();
}
