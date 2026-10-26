// Settings: the model behind the grader, the coach, the tutor and Teach (the vault's Knowledge OS Plugin Plan 2026-10).
// The choice is kept in knowledge-os.json; an API key never is: the Obsidian plugin hands it over from Obsidian's
// keychain, or it is set in the environment the site starts in. A model grades only once it has passed the grader
// test, and plays Teach only once it has passed the Teach test; both run here, in the background.

import { api, h, fill, toast, ApiError } from "../ui.js";

const TEST_CALLS = { grader: 66, teach: 32 };            // the test sets' calls, borderline answers graded twice
const TEST_TOKENS = { grader: [1200, 150], teach: [2500, 400] };

export function testCost(model, kind) {
  if (!model || model.input_price == null || model.output_price == null) return null;
  const [i, o] = TEST_TOKENS[kind];
  return (TEST_CALLS[kind] * (i * model.input_price + o * model.output_price)) / 1e6;
}

export async function render(main, params, ctx) {
  const { t } = ctx;
  let data = await api.get("/api/models");
  let picked = { provider: data.current?.provider || "", model: data.current?.model || "" };
  let poll = null;

  const money = (v) => (v == null ? t("settings.price.unknown") : v === 0 ? t("settings.price.free")
    : v < 0.01 ? "< $0.01" : `$${v.toFixed(2)}`);
  const providerOf = (id) => data.providers.find((p) => p.id === id);
  const modelOf = () => providerOf(picked.provider)?.models.find((m) => m.id === picked.model)
    || { id: picked.model, label: picked.model, input_price: null, output_price: null };

  async function save(changes) {
    try {
      data = await api.post("/api/models/save", changes);
      picked = { provider: data.current?.provider || "", model: data.current?.model || "" };
      toast(t("settings.saved"));
      paint();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 6000);
    }
  }

  async function check(p, out) {
    fill(out, h("span", { class: "muted" }, t("settings.checking")));
    try {
      const r = await api.get(`/api/models/check?provider=${encodeURIComponent(p.id)}`);
      const msg = r.ready ? t("settings.check.ready") : t("settings.check." + (r.message || "no_cli"));
      fill(out, h("span", { class: r.ready ? "ok" : "bad" }, [r.version, msg].filter(Boolean).join(" · ")));
    } catch (e) {
      fill(out, h("span", { class: "bad" }, String(e.message || e)));
    }
  }

  function providerCard(p) {
    const on = picked.provider === p.id;
    const out = h("span", { class: "meta" });
    const head = h("label", { class: "row between" },
      h("span", {},
        h("input", { type: "radio", name: "provider", checked: on, onchange: () => {
          picked = { provider: p.id, model: p.models[0]?.id || "" };
          paint();
        } }), " ", h("strong", { dir: "auto" }, p.label), " ",
        h("span", { class: `tier ${p.tier}` }, t("settings.tier." + p.tier))),
      h("span", { class: p.ready ? "status ok" : "status bad" },
        p.ready ? t("settings.ready") : t("settings.why." + (p.why_code || "no_cli"))));
    const kids = [head];
    if (p.notes) kids.push(h("p", { class: "meta", dir: "auto" }, p.notes));
    if (!p.ready && p.setup_hint) kids.push(h("p", { class: "meta bad", dir: "auto" }, p.setup_hint));
    if (on) {
      kids.push(h("div", { class: "models" }, p.models.map((m) => h("label", { class: "row" },
        h("input", { type: "radio", name: "model", checked: picked.model === m.id,
          onchange: () => { picked.model = m.id; paint(); } }),
        h("span", { dir: "auto" }, " ", h("code", {}, m.id), " ", m.label,
          p.metered ? h("span", { class: "meta" }, ` · $${m.input_price ?? "?"} / $${m.output_price ?? "?"} ${t("settings.per_m")}`) : null,
          m.notes ? h("span", { class: "meta" }, " · " + m.notes) : null)))));
      const other = h("input", { type: "text", placeholder: t("settings.other_model"), value: p.models.some((m) => m.id === picked.model) ? "" : picked.model,
        oninput: (e) => { if (e.target.value.trim()) picked.model = e.target.value.trim(); } });
      kids.push(h("div", { class: "row" }, other,
        p.kind.endsWith("-cli") || p.tier === "local"
          ? h("button", { class: "ghost", onclick: () => check(p, out) }, t("settings.check")) : null, out));
    }
    return h("section", { class: `card provider${on ? " selected" : ""}` }, kids);
  }

  function trustBlock(kind) {
    const st = (data.trust || {})[kind] || {};
    const line = st.counts ? t("settings.trust.passed", { agreed: st.agreed ?? "?", total: st.total ?? "?", date: st.date || "" })
      : st.stale ? t("settings.trust.stale", { date: st.date || "" })
      : st.never ? t("settings.trust.never")
      : t("settings.trust.failed", { agreed: st.agreed ?? "?", total: st.total ?? "?", date: st.date || "" });
    const p = providerOf(data.current?.provider);
    const cost = !p ? "" : p.metered ? money(testCost(modelOf(), kind))
      : p.tier === "local" ? t("settings.price.local") : t("settings.price.plan");
    const job = data.test && data.test.kind === kind ? data.test : null;
    const running = data.test && data.test.running;
    const run = h("button", { class: running ? "ghost" : "primary", disabled: running || !data.current?.available,
      onclick: async () => {
        try {
          data.test = await api.post("/api/models/test", { kind });
          paint();
          follow();
        } catch (e) { toast(e.message, 6000); }
      } }, t("settings.trust.run"));
    return h("div", { class: "trust" },
      h("h3", {}, t("settings.trust." + kind)),
      h("p", { class: st.counts ? "ok" : "meta" }, line),
      h("p", { class: "meta" }, t("settings.trust.cost", { calls: TEST_CALLS[kind], cost })),
      run,
      job ? h("div", { class: "job" },
        h("p", { class: "meta" }, job.running ? t("settings.trust.progress", { done: job.done, total: job.total || "…" })
          : t("settings.trust.result." + (job.result || "error"))),
        h("pre", { class: "log" }, (job.lines || []).slice(-8).join("\n"))) : null);
  }

  function follow() {
    clearInterval(poll);
    poll = setInterval(async () => {
      const s = await api.get("/api/models/test");
      data.test = s;
      if (!s.running) {
        clearInterval(poll);
        data = await api.get("/api/models");
      }
      paint();
    }, 1500);
  }

  function paint() {
    const cur = data.current;
    const p = providerOf(picked.provider);
    const changed = picked.provider !== (cur?.provider || "") || picked.model !== (cur?.model || "");
    const effort = h("select", { onchange: (e) => save({ effort: e.target.value }) },
      ["", "low", "medium", "high"].map((v) => h("option", { value: v, selected: (data.effort || "") === v }, t("settings.effort." + (v || "auto")))));
    const budget = h("input", { type: "number", min: 0, max: 1000, step: 0.25, value: data.budget.daily_usd,
      onchange: (e) => save({ daily_budget_usd: Number(e.target.value) }) });
    const grading = h("select", { onchange: (e) => save({ grader: e.target.value }) },
      h("option", { value: "claude", selected: data.grader !== "self" }, t("settings.grading.model")),
      h("option", { value: "self", selected: data.grader === "self" }, t("settings.grading.self")));
    fill(main,
      h("h1", {}, t("settings.title")),
      h("p", { class: "lead" }, t("settings.lead")),
      cur ? h("p", { class: cur.available ? "ok" : "bad" },
        t("settings.current", { label: cur.label }) + (cur.available ? "" : " · " + t("settings.why." + cur.why_code))) : null,
      data.providers.map(providerCard),
      h("div", { class: "row" },
        h("button", { class: "primary", disabled: !changed || !picked.provider,
          onclick: () => save({ provider: picked.provider, model: picked.model }) }, t("settings.save")),
        changed ? h("span", { class: "meta" }, t("settings.unsaved")) : null),
      h("section", { class: "card" },
        h("label", { class: "label" }, t("settings.effort")), effort,
        p && p.metered ? [h("label", { class: "label" }, t("settings.budget")), budget,
          h("p", { class: "meta" }, t("settings.spent", { spent: money(data.budget.spent_usd), daily: money(data.budget.daily_usd) }))] : null,
        h("label", { class: "label" }, t("settings.grading")), grading),
      cur && cur.provider ? h("section", { class: "card" }, h("h2", {}, t("settings.trust.title")),
        h("p", { class: "meta" }, t("settings.trust.lead")), trustBlock("grader"), trustBlock("teach")) : null,
      h("p", { class: "meta" }, t(data.saved_to_file ? "settings.keys" : "settings.keys.temp")));
  }

  paint();
  if (data.test && data.test.running) follow();
  return () => clearInterval(poll);
}
