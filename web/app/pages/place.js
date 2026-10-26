// Placement: about thirty "use it" questions on what a goal rests on, each the one that settles the most whichever
// way it is answered (the road's `_road.py place`). No key and no verdict until the end: placement measures, and a
// concept missed once comes back in other words. A right answer places the concept and what it rests on as
// provisional: it stands, so what is built on it can be checked, but it is never counted as checked. At the end, what
// was missed, with its keys (Learning System Improvement Plan 2026-10, decision 3).

import { api, h, conceptHref, toast, ApiError, go, fill } from "../ui.js";
import { typeset, mathText } from "../typeset.js";

let fromStudy = false;          // opened by the coach's session (from=study): each answer leads back there

export async function render(main, params, ctx) {
  const { t } = ctx;
  const goal = params.arg;
  if (!goal) { go("#/map"); return; }
  fromStudy = params.from === "study";
  const here = "#/place/" + encodeURIComponent(goal) + (fromStudy ? "?from=study" : "");
  let nx;
  try {
    nx = await api.get("/api/place?goal=" + encodeURIComponent(goal));
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 409)) {
      main.replaceChildren(h("div", { class: "card soft" }, h("p", {}, e.message),
        h("a", { class: "button ghost", href: "#/map" }, t("place.back"))));
      return;
    }
    throw e;
  }
  const head = () => h("div", { class: "item-head" },
    h("span", { class: "kind k-place" }, t("place.title")),
    h("span", { class: "concept-name" }, nx.kind === "done" ? nx.goal : nx.concept),
    nx.kind !== "done" ? h("span", { class: "meta" }, t("place.toward", { g: nx.goal })) : null);
  if (nx.kind === "done") return renderDone(main, nx, t, head);
  if (nx.bank !== "ok") return renderNoBank(main, nx, t, head, here);
  return ask(main, nx, t, head, here);
}

function progress(nx, t) {
  return h("p", { class: "qof" }, t("place.progress", { i: nx.asked + 1, n: nx.max, u: nx.unsettled }), " · ",
    h("span", { class: "facet f-work" }, t("facet.work")));
}

// A concept with no bank: write it, or step past it (24 Oct 2026). Placement never asks a seed with no bank, since a
// seed cannot carry one; a note Claude still cannot bank is skipped, and asked again once it has a bank.
function renderNoBank(main, nx, t, head, here) {
  const status = h("div", { class: "bank-status" });
  let why = "";
  const skip = h("button", { class: "ghost", onclick: async () => {
    skip.disabled = btn.disabled = true;
    try {
      await api.post("/api/place/skip", { goal: nx.goal, concept: nx.concept, why });
      go(here);
    } catch (e) { toast(e.message); skip.disabled = btn.disabled = false; }
  } }, t("place.skip"));
  const btn = h("button", { class: "primary", onclick: async () => {
    btn.disabled = skip.disabled = true;
    status.replaceChildren(h("p", { class: "muted pulse" }, t("check.writingbank")));
    try {
      await api.post("/api/bank", { concept: nx.concept });
      go(here);
    } catch (e) {
      btn.disabled = skip.disabled = false;
      const probs = (e.body && e.body.problems) || [];
      why = probs.length ? probs.join("; ") : e.message;
      status.replaceChildren(h("div", { class: "card error" }, h("p", {}, probs.length ? t("check.badbank") : e.message),
        probs.length ? h("ul", {}, probs.map((x) => h("li", {}, x))) : null,
        h("p", { class: "meta" }, t("place.skip.d")), h("div", { class: "row" }, skip)));
    }
  } }, t("check.writebank"));
  main.replaceChildren(h("section", { class: "card" }, head(), progress(nx, t), h("p", {}, t("check.nobank")),
    h("p", { class: "muted" }, t("place.nobank")),
    h("div", { class: "row" }, btn, skip, h("a", { class: "button ghost", href: "#/map" }, t("place.stop"))), status));
}

function ask(main, nx, t, head, here) {
  const q = nx.questions[0];
  const t0 = performance.now();
  const answer = h("textarea", { class: "answer", rows: 5, dir: "auto", placeholder: t("check.answer"),
    "aria-label": t("check.answer") });
  const submit = h("button", { class: "primary", disabled: true }, t("check.submit"));
  answer.addEventListener("input", () => { submit.disabled = !answer.value.trim(); });
  answer.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter" && !submit.disabled) submit.click();
  });
  const out = h("div", { class: "result" });
  const nextRow = () => fromStudy ? h("div", { class: "row" }, h("a", { class: "button primary", href: "#/study" }, t("study.backto"))) : h("div", { class: "row" },
    h("button", { class: "primary", onclick: (ev) => { ev.currentTarget.disabled = true; go(here); } }, t("place.next")),
    h("a", { class: "button ghost", href: "#/map" }, t("place.stop")));
  const recorded = (r) => {
    fill(out, h("div", { class: "grade neutral" }, h("strong", {}, t("place.recorded")),
      r.again ? h("p", {}, t("place.again")) : null), nextRow());
  };
  const selfGrade = (r) => {
    const yes = h("button", { class: "primary" }, t("check.self.yes"));
    const no = h("button", { class: "ghost" }, t("check.self.no"));
    const choose = async (correct) => {
      yes.disabled = no.disabled = true;
      try { recorded(await api.post("/api/place/self", { attempt: r.attempt, correct })); }
      catch (e) { toast(e.message); yes.disabled = no.disabled = false; }
    };
    yes.onclick = () => choose(true);
    no.onclick = () => choose(false);
    fill(out, r.why ? h("p", { class: "meta" }, r.why_code ? t("why." + r.why_code) : r.why) : null,
      h("div", { class: "reveal" }, h("p", { class: "label" }, t("check.key")), h("p", { class: "key", dir: "auto" }, mathText(r.key))),
      h("p", { class: "label" }, t("check.self")), h("div", { class: "row" }, yes, no));
    typeset(out);
  };
  // "I don't know" is an answer of its own: nothing to grade, and it settles the concept at once (24 Oct 2026)
  const dunno = h("button", { class: "ghost", type: "button", title: t("place.dontknow.hint") }, t("dontknow"));
  const send = async (body, wait) => {
    submit.disabled = dunno.disabled = true;
    answer.readOnly = true;
    out.replaceChildren(h("p", { class: "muted pulse" }, wait));
    try {
      const r = await api.post("/api/place/answer", { item: nx.item, qid: q.qid, ...body,
        seconds: Math.round((performance.now() - t0) / 1000) });
      if (r.needs_self) selfGrade(r); else recorded(r);
    } catch (e) {
      out.replaceChildren(h("div", { class: "card error" }, h("p", {}, e.message)));
      submit.disabled = !answer.value.trim();
      dunno.disabled = false;
      answer.readOnly = false;
    }
  };
  submit.onclick = () => send({ answer: answer.value }, t("check.grading"));
  dunno.onclick = () => send({ dont_know: true }, t("check.recording"));
  main.replaceChildren(h("section", { class: "card question" }, head(), progress(nx, t),
    nx.asked === 0 ? h("p", { class: "meta" }, t("place.intro")) : null,
    nx.again ? h("p", { class: "meta" }, t("place.second")) : null,
    h("p", { class: "q", dir: "auto" }, mathText(q.q)), answer,
    h("div", { class: "row" }, submit, dunno, h("span", { class: "hint" }, t("check.submit.hint")))), out);
  typeset(main);
  answer.focus();
}

function renderDone(main, nx, t, head) {
  const review = nx.review || [];
  const goalReady = nx.goal_status === "ready" || nx.goal_status === "to-read";
  fill(main, h("section", { class: "card" }, head(),
    h("h2", {}, t("place.done")),
    h("p", {}, t("place.summary", { a: nx.asked, p: nx.placed, u: nx.unknown })),
    h("p", { class: "meta" }, t("place.provisional")),
    (nx.waiting || []).length ? h("p", { class: "meta" }, t("place.waiting", { list: "" }),
      nx.waiting.map((c, k) => [k ? " · " : "", h("a", { href: conceptHref(c) }, c)])) : null,
    review.length ? h("div", {}, h("h3", {}, t("place.review")), review.map((m) => h("div", { class: "reveal" },
      h("p", {}, h("a", { class: "concept-name", href: conceptHref(m.concept) }, m.concept)),
      m.items.map((x) => h("div", { class: "place-item" },
        h("p", { class: "q", dir: "auto" }, mathText(x.q)),
        x.answer || x.dont_know ? h("p", { class: "meta", dir: "auto" }, h("span", { class: "label" }, t("place.youranswer")), " ",
          x.dont_know ? t("place.dontknow.ans") : x.answer) : null,
        h("p", { class: "label" }, t("check.key")), h("p", { class: "key", dir: "auto" }, mathText(x.key)),
        h("blockquote", { class: "evidence", dir: "auto" }, h("span", { class: "label" }, t("check.evidence")), " ",
          h("span", { class: "ev-text" }, mathText(x.evidence)))))))) : null,
    h("div", { class: "row" },
      fromStudy ? h("a", { class: "button primary", href: "#/study" }, t("study.backto")) : null,
      goalReady ? h("a", { class: "button primary", href: "#/check?concept=" + encodeURIComponent(nx.goal) }, t("place.checkgoal")) : null,
      h("a", { class: goalReady ? "button ghost" : "button primary", href: "#/check" }, t("place.road")),
      h("a", { class: "button ghost", href: "#/map" }, t("place.back")))));
  typeset(main);
}
