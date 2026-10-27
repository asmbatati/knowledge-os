// The coach's session (the vault's Study Coach Plan 2026-10): one step at a time, as the server decides it. A review
// or a round of placement goes to the road's own pages and comes back; a lesson is chunks of at most five lines with
// one A–D question each; then the open loop's question, the taught concept's road check, the reflection and the end.
// A session through today's road (24 Oct 2026) teaches each of the day's checks before its check, and asks whether to
// go on once the day's quota is met.
// Keys answer: A–D or 1–4, 0 when blanking, Enter for next. Practice is never a verdict: only the road's pages record
// one.

import { api, h, fill, go, store, toast, ApiError, fmtDate } from "../ui.js";
import { typeset, mathText } from "../typeset.js";
import { checkpoint, keyOf } from "../coach/plan.js";
import { copyCard } from "./today.js";
import { figureCards } from "../lab/figure-card.js";

const SKEY = "los.coach.session";
const LETTERS = "ABCD";

export const current = () => store(SKEY);
export const remember = (s) => store(SKEY, s);
export function forget() { try { localStorage.removeItem(SKEY); } catch (e) { /* storage may be blocked */ } }

/** Start a coached session and open it: from Today, or from a concept's page on that concept (26 Oct 2026). A session
 *  still open on this page is ended first, so it keeps its end row and its lecture note. */
export async function startSession(ctx, mode, topic = "", item = "") {
  const open = current();
  if (open && open.id) {
    try { await api.post("/api/coach/end", { session: open.id }); } catch (e) { /* gone already: nothing to end */ }
    forget();
  }
  const s = await api.post("/api/coach/start", { mode, topic, lang: ctx.lang() });
  remember({ id: s.session, started: Date.now(), agenda: s.agenda });
  if (ctx.timer.state().phase === "idle") ctx.timer.startFocus("", item || topic || (mode === "road" ? ctx.t("coach.road") : ""));
  go("#/study");
  return s;
}

export function agendaLine(ag, t) {
  return ag.warmup ? t("study.agenda", { w: ag.warmup, n: ag.new, r: ag.reflect })
    : t("study.agenda.nowarm", { n: ag.new, r: ag.reflect });
}

export async function render(main, params, ctx) {
  const { t } = ctx;
  const cur = current();
  if (!cur || !cur.id) {
    fill(main, h("section", { class: "card soft" }, h("p", {}, t("study.none")),
      h("a", { class: "button primary", href: "#/today" }, t("study.back"))));
    return;
  }
  let keyHandler = null;
  const onKey = (ev) => {
    const typing = ev.target instanceof HTMLTextAreaElement || ev.target instanceof HTMLInputElement;
    if (keyHandler && !typing && !ev.ctrlKey && !ev.metaKey && !ev.altKey) keyHandler(ev);
  };
  document.addEventListener("keydown", onKey);
  const bar = h("div", { class: "study-bar" });
  const body = h("div", { class: "study-body" });
  const stopBtn = h("button", { class: "ghost small", type: "button", onclick: () => step(true) }, t("study.stop"));
  const drawBar = () => {
    const cp = checkpoint((Date.now() - cur.started) / 60000, cur.agenda);
    fill(bar, h("span", { class: "meta" }, agendaLine(cur.agenda, t)),
      h("span", { class: `chip phase-${cp.phase}` }, t("study.at", { m: cp.minute, phase: t("study.phase." + cp.phase) })),
      stopBtn);
  };
  drawBar();
  const clock = setInterval(drawBar, 30000);
  fill(main, bar, body);
  const label = (n) => ctx.label(n);

  async function step(reflect = false) {
    keyHandler = null;
    const wait = h("p", { class: "muted pulse" }, t("loading"));
    const slow = setTimeout(() => { wait.textContent = t("study.writing"); }, 1200);
    fill(body, wait);
    let st;
    try {
      st = await api.post("/api/coach/step", { session: cur.id, reflect });
    } catch (e) {
      clearTimeout(slow);
      if (e instanceof ApiError && e.status === 404) {
        forget();
        fill(body, h("section", { class: "card soft" }, h("p", {}, t("study.ended")),
          h("a", { class: "button primary", href: "#/today" }, t("study.back"))));
        return;
      }
      fill(body, h("div", { class: "card error" }, h("p", {}, e.message),
        h("button", { class: "ghost", onclick: () => step() }, t("retry"))));
      return;
    }
    clearTimeout(slow);
    if (st.kind === "review") return handOff(t("study.warmup"), t("study.review", { concept: label(st.concept) }),
      t("study.review.go"), "#/check?from=study");
    if (st.kind === "place") return handOff(t("study.placing"),
      t("study.place", { goal: label(st.goal), i: st.placed + 1, n: st.round }), t("study.place.go"),
      `#/place/${encodeURIComponent(st.goal)}?from=study`);
    if (st.kind === "check") return handOff(t("study.checking"), t("study.check", { concept: label(st.concept) }),
      t("study.check.go"), `#/check?concept=${encodeURIComponent(st.concept)}&from=study`);
    if (st.kind === "lesson") return lesson(st);
    if (st.kind === "loop") return loopView(st);
    if (st.kind === "more") return moreView(st);
    if (st.kind === "reflect") return reflectView(st);
    return end();
  }

  // a road session, the day's quota of new checks met: go on along the road, or stop and reflect
  function moreView(st) {
    const goOn = h("button", { class: "primary", onclick: async () => {
      goOn.disabled = stop.disabled = true;
      try { await api.post("/api/coach/more", { session: cur.id }); }
      catch (e) { toast(e.message); goOn.disabled = stop.disabled = false; return; }
      step();
    } }, t("study.more.go"));
    const stop = h("button", { class: "ghost", onclick: () => step(true) }, t("study.more.stop"));
    fill(body, h("section", { class: "card" }, h("h2", {}, t("study.more.title")),
      h("p", {}, t("study.more", { n: st.checked, q: st.quota, concept: label(st.next) })),
      h("div", { class: "row" }, goOn, stop)));
    goOn.focus();
  }

  function handOff(title, text, go_label, href) {
    fill(body, h("section", { class: "card" }, h("h2", {}, title), h("p", {}, text),
      h("div", { class: "row" }, h("a", { class: "button primary", href }, go_label),
        h("span", { class: "hint" }, t("study.enter")))));
    keyHandler = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(href); } };
  }

  function lesson(st) {
    if (st.empty) {
      fill(body, h("section", { class: "card soft" }, h("h2", { dir: "auto" }, st.title || ""),
        h("p", {}, t("study.empty." + st.empty)),
        h("button", { class: "primary", onclick: () => step() }, t("study.next"))));
      keyHandler = (ev) => { if (ev.key === "Enter") step(); };
      return;
    }
    const chunks = st.chunks;
    let i = chunks.findIndex((c) => !st.answered[String(c.n)]);
    if (i < 0) { step(); return; }
    let right = Object.values(st.answered).filter((a) => a.correct).length;
    const head = h("div", { class: "lesson-head" },
      h("h2", { dir: "auto" }, st.title || label(st.concept || "")),
      st.for ? h("p", { class: "meta" }, t("study.for", { concept: label(st.for) })) : null,
      st.focus && !st.for && st.focus.toLowerCase() !== String(st.concept || "").toLowerCase()
        ? h("p", { class: "meta", dir: "auto" }, t("study.focus"), " ", st.focus) : null,
      st.claude ? null : h("p", { class: "lang-bar" }, t("study.why." + (st.why_code || "no_cli"))));

    const show = () => {
      const c = chunks[i];
      const out = h("div", { class: "result" });
      const badges = h("div", { class: "row wrap" },
        h("span", { class: `badge src-${c.source}` }, c.source === "note" ? t("study.fromnote") : t("study.notinnotes")),
        c.memorize ? h("span", { class: "badge" }, t("study." + c.memorize)) : null,
        h("span", { class: "meta" }, t("study.chunk", { i: i + 1, n: chunks.length }), right ? " · " + t("study.rightn", { n: right }) : ""));
      const text = h("div", { class: "note chunk-text", dir: "auto", html: c.html });
      const figures = i === 0 && st.concept ? figureCards(st.concept, t) : [];   // with the chunk that opens the idea
      const more = explainMore(c);
      let qArea = null;
      if (c.question) {
        const buttons = c.question.choices.map((txt, j) => h("button", { class: "choice", type: "button",
          "data-key": LETTERS[j], onclick: () => answer(LETTERS[j]) }, h("strong", {}, LETTERS[j]), " ",
          h("span", { dir: "auto" }, mathText(txt))));
        const blank = h("button", { class: "ghost", type: "button", onclick: () => answer("blank") }, t("study.blank"));
        qArea = h("div", { class: "question" }, h("p", { class: "q", dir: "auto" }, mathText(c.question.stem)),
          h("div", { class: "choices" }, buttons), h("div", { class: "row wrap" }, blank, h("span", { class: "hint" }, t("study.keys"))));
        keyHandler = (ev) => {
          if (ev.key === "e" || ev.key === "E") { ev.preventDefault(); more.open(); return; }
          const k = keyOf(ev.key);
          if (!k || (k !== "blank" && LETTERS.indexOf(k) >= buttons.length)) return;
          ev.preventDefault();
          answer(k);
        };

        async function answer(choice) {
          keyHandler = null;
          buttons.concat([blank]).forEach((b) => { b.disabled = true; });
          let r;
          try {
            r = await api.post("/api/coach/answer", { session: cur.id, lesson: st.lesson, chunk: c.n, choice });
          } catch (e) {
            toast(e.message);
            buttons.concat([blank]).forEach((b) => { b.disabled = false; });
            return;
          }
          st.answered[String(c.n)] = r;
          if (r.correct) right += 1;
          buttons.forEach((b) => {
            if (b.dataset.key === r.key) b.classList.add("is-key");
            if (b.dataset.key === choice && !r.correct) b.classList.add("is-wrong");
          });
          fill(out, h("div", { class: `grade ${r.correct ? "right" : r.blank ? "neutral" : "wrong"}` },
            h("strong", {}, r.correct ? "✓ " + t("study.right") : r.blank ? t("study.blanked") : t("study.notyet"))),
          r.why ? h("p", { dir: "auto" }, mathText(r.why)) : null,
          !r.correct && r.why_key ? h("p", { dir: "auto" }, h("span", { class: "label" }, t("study.whykey", { k: r.key })), " ", mathText(r.why_key)) : null,
          r.worked ? h("div", { class: "worked", dir: "auto" }, h("p", { class: "label" }, t("study.worked")), h("p", {}, mathText(r.worked))) : null,
          r.stuck ? h("p", { class: "lang-bar" }, t("study.stuck", { to: label(r.stuck.to) })) : null,
          nextRow(r.stuck ? () => step() : advance));
          typeset(out);
        }
      } else {
        qArea = h("div", { class: "row" }, h("button", { class: "primary", onclick: () => seen() }, t("study.next")),
          h("span", { class: "hint" }, t("study.enter")));
        keyHandler = (ev) => {
          if (ev.key === "e" || ev.key === "E") { ev.preventDefault(); more.open(); return; }
          if (ev.key === "Enter") { ev.preventDefault(); seen(); }
        };
      }
      async function seen() {
        keyHandler = null;
        try { await api.post("/api/coach/answer", { session: cur.id, lesson: st.lesson, chunk: c.n, choice: "seen" }); }
        catch (e) { toast(e.message); return; }
        advance();
      }
      fill(body, head, h("section", { class: "card chunk" }, badges, text, ...figures, more.el, qArea), out);
      typeset(body);
    };

    // "Explain more" (26 Oct 2026): the same step again, another way, with what the learner asks answered; never the
    // step's answer. At most three a step, said on the button; without a model it says why and points to the note.
    const explainMore = (c) => {
      const box = h("div", { class: "explain" });
      const ask = h("input", { type: "text", class: "x-search", dir: "auto", maxlength: 400,
        placeholder: t("study.explain.ask") });
      const btn = h("button", { class: "ghost small", type: "button", onclick: () => fetchMore() },
        t("study.explain"), " ", h("span", { class: "hint" }, "E"));
      const row = h("div", { class: "row wrap explain-row" }, btn);
      ask.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); fetchMore(); } };
      async function fetchMore() {
        if (btn.disabled) return;
        btn.disabled = true;
        const wait = h("p", { class: "muted pulse" }, t("study.explain.writing"));
        box.append(wait);
        let r;
        try {
          r = await api.post("/api/coach/explain", { session: cur.id, lesson: st.lesson, chunk: c.n, ask: ask.value });
        } catch (e) {
          wait.remove();
          toast(e.message);
          btn.disabled = false;
          return;
        }
        wait.remove();
        if (!r.html) {
          box.append(h("p", { class: "lang-bar" }, t("study.why." + (r.why_code || "no_cli")), " ",
            st.concept ? h("a", { href: `#/concept/${encodeURIComponent(st.concept)}` }, t("study.explain.note")) : null));
        } else {
          box.append(h("div", { class: "explained" },
            h("span", { class: `badge src-${r.source}` }, r.source === "note" ? t("study.fromnote") : t("study.notinnotes")),
            h("div", { class: "note chunk-text", dir: "auto", html: r.html })));
          typeset(box);
        }
        ask.value = "";
        btn.disabled = r.left <= 0;
        if (r.left <= 0) btn.replaceChildren(t("study.explain.max"));
        else if (r.html && !row.contains(ask)) row.replaceChildren(ask, btn);   // a follow-up may say what is unclear
      }
      return { el: h("div", {}, box, row), open: fetchMore };
    };
    const nextRow = (fn) => {
      keyHandler = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); keyHandler = null; fn(); } };
      return h("div", { class: "row" }, h("button", { class: "primary", onclick: () => { keyHandler = null; fn(); } }, t("study.next")),
        h("span", { class: "hint" }, t("study.enter")));
    };
    const advance = () => { i += 1; if (i >= chunks.length) step(); else show(); };
    show();
  }

  function loopView(st) {
    const answer = async (clear) => {
      try { await api.post("/api/coach/loop", { session: cur.id, loop: st.loop.id, clear }); }
      catch (e) { toast(e.message); return; }
      step();
    };
    fill(body, h("section", { class: "card" }, h("h2", {}, t("study.loop.title")),
      h("blockquote", { dir: "auto" }, st.loop.text), h("p", {}, t("study.loop")),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => answer(true) }, t("study.loop.yes")),
        h("button", { class: "ghost", onclick: () => answer(false) }, t("study.loop.no")))));
  }

  function reflectView(st) {
    // The teach-back names its concept: one of the lessons the learner actually took, the last by default, and they may
    // pick another; with none taken it is about the session's topic (26 Oct 2026).
    const taken = st.concepts || [];
    let target = taken.length ? taken[taken.length - 1] : "";
    const picker = () => taken.length < 2 ? null : h("div", { class: "row wrap" },
      h("span", { class: "label" }, t("study.r2.pick")),
      ...taken.map((c) => h("button", { type: "button", class: "chip" + (c === target ? " on" : ""),
        "aria-pressed": c === target ? "true" : "false",
        onclick: () => { target = c; ask(); } }, label(c))));
    const fields = [
      ["sentence", "study.r1", h("input", { type: "text", class: "x-search", dir: "auto", maxlength: 600 })],
      ["teachback", "study.r2", h("textarea", { class: "answer", rows: 6, dir: "auto", maxlength: 4000 })],
      ["fuzzy", "study.r3", h("input", { type: "text", class: "x-search", dir: "auto", maxlength: 600 })],
    ];
    let k = 0;
    const ask = () => {
      const [, key, el] = fields[k];
      const last = k === fields.length - 1;
      const btn = h("button", { class: "primary", onclick: () => { if (last) send(); else { k += 1; ask(); } } },
        last ? t("study.r.send") : t("study.r.next"));
      el.onkeydown = (ev) => { if (ev.key === "Enter" && (el.tagName === "INPUT" || ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); btn.click(); } };
      const question = key !== "study.r2" ? t(key)
        : target ? t("study.r2.about", { concept: label(target) }) : t("study.r2.none");
      fill(body, h("section", { class: "card" }, h("h2", {}, t("study.reflect")),
        st.early ? h("p", { class: "meta" }, t("study.early")) : null,
        h("p", { class: "label" }, t("study.r.of", { i: k + 1, n: fields.length })), h("p", { class: "q" }, question),
        key === "study.r2" ? picker() : null, el,
        h("div", { class: "row" }, btn, h("span", { class: "hint" }, t(el.tagName === "INPUT" ? "study.enter" : "check.submit.hint")))));
      el.focus();
    };
    const send = async (sure = false) => {
      const v = Object.fromEntries(fields.map(([name, , el]) => [name, el.value]));
      // an empty teach-back is allowed, but said so first: nothing then goes into the session's note or the concept's
      // My lecture notes (26 Oct 2026)
      if (!sure && !v.teachback.trim()) {
        fill(body, h("section", { class: "card" }, h("h2", {}, t("study.reflect")),
          h("p", {}, t(v.sentence.trim() || v.fuzzy.trim() ? "study.empty.tb" : "study.empty.all")),
          h("div", { class: "row wrap" },
            h("button", { class: "primary", onclick: () => { k = 1; ask(); } }, t("study.empty.write")),
            h("button", { class: "ghost", onclick: () => send(true) }, t("study.empty.skip")))));
        return;
      }
      fill(body, h("p", { class: "muted pulse" }, t("study.reading")));
      let r;
      try { r = await api.post("/api/coach/reflect", { session: cur.id, ...v, concept: target }); }
      catch (e) { toast(e.message); ask(); return; }
      const propose = r.propose ? h("p", { class: "lang-bar" }, t("study.propose", { line: r.propose }), " ",
        h("button", { class: "small", onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          try { await api.post("/api/coach/profile", { add_line: r.propose }); toast(t("study.kept")); }
          catch (e) { toast(e.message); }
        } }, t("study.accept"))) : null;
      fill(body, h("section", { class: "card" }, h("h2", {}, t("study.reflect")),
        r.concept ? h("p", { class: "meta" }, t("study.r2.compared", { concept: label(r.concept) })) : null,
        r.grade ? h("div", { class: `grade ${r.grade === "solid" ? "right" : "neutral"}` }, h("strong", {}, t("study." + r.grade))) : null,
        r.refinement ? h("p", { dir: "auto" }, h("span", { class: "label" }, t("study.refine")), " ", mathText(r.refinement)) : null,
        r.missing && r.missing.length ? h("div", {}, h("p", { class: "label" }, t("study.missing")),
          h("ul", {}, r.missing.map((x) => h("li", { dir: "auto" }, mathText(x))))) : null,
        !r.grade && r.compare ? h("div", {}, h("p", { class: "label" }, t("study.compare")),
          h("blockquote", { dir: "auto" }, mathText(r.compare))) : null,
        propose,
        h("div", { class: "row" }, h("button", { class: "primary", onclick: () => end() }, t("study.finish")))));
      typeset(body);
    };
    ask();
  }

  async function end() {
    keyHandler = null;
    let r;
    try { r = await api.post("/api/coach/end", { session: cur.id }); }
    catch (e) {
      if (e instanceof ApiError && e.status === 404) { forget(); go("#/today"); return; }
      toast(e.message);
      return;
    }
    forget();
    try { await ctx.timer.stop(""); } catch (e) { /* the clock is the page's convenience */ }
    fill(body, h("section", { class: "card verdict right" }, h("h2", {}, "✓ " + t("study.done")),
      h("p", {}, t("study.summary", { m: r.minutes, c: r.concepts.map(label).join(" · ") || r.title })),
      h("p", { class: "meta" }, t("study.nextday", { date: fmtDate(r.next_day, ctx.lang()) })),
      h("div", { class: "row" }, h("a", { class: "button primary", href: "#/today" }, t("study.back")),
        h("button", { type: "button", onclick: (ev) => copyCard(ctx, ev.currentTarget) }, t("coach.card.copy")))));
    fill(bar);
  }

  step();
  return () => { clearInterval(clock); document.removeEventListener("keydown", onKey); };
}
