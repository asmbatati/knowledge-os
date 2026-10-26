// The Lab: a place to implement, examine, test and see. Models move with their sliders; formulas typeset and plot;
// code runs in a sealed worker (JavaScript) or, when the settings allow, in Python on this machine; exercises run their
// tests. Nothing here is a road verdict: an exercise's result goes to the site's own ledger (x/reports/learning/los).

import { api, h, fill, toast, store, conceptHref } from "../ui.js";
import { FIGURES, MODELS, figure as figureOf, figureSrc, model } from "../lab/registry.js";
import { EXERCISES, exercise } from "../lab/exercises.js";
import * as M from "../lab/models.js";
import * as P from "../lab/plot.js";
import { compile, freeVars, parse } from "../lab/expr.js";

const TABS = ["models", "figures", "formulas", "code", "exercises"];
const fmt = P.fmt;

// ------------------------------------------------------------------ small pieces
function slider({ label, min, max, step, value, log = false, show = fmt, onInput }) {
  const out = h("output", {}, show(log ? 10 ** value : value));
  const input = h("input", { type: "range", min, max, step, value, "aria-label": label });
  input.addEventListener("input", () => {
    const v = Number(input.value);
    out.textContent = show(log ? 10 ** v : v);
    onInput(log ? 10 ** v : v);
  });
  const el = h("div", { class: "ctl" }, h("label", {}, h("span", {}, label), out), input);
  el.set = (v) => { input.value = log ? Math.log10(v) : v; out.textContent = show(v); };
  return el;
}

function readout(label, value) {
  return h("div", { class: "readout" }, h("b", {}, value), h("span", {}, label));
}

function figure(title, ...kids) {
  return h("div", { class: "figure" }, title ? h("h4", {}, title) : null, ...kids);
}

// redraw at most once a frame while a slider moves
function throttled(fn) {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn(); });
  };
}

function conceptChips(names, t) {
  return h("div", { class: "chips" }, names.map((n) => h("a", { class: "chip-link", href: conceptHref(n), dir: "auto" }, n)),
    names.length ? null : h("span", { class: "muted" }, t("concept.none")));
}

// ------------------------------------------------------------------ the models
const VIEWS = {
  gd(t) {
    const st = { surface: "bowl", lr: 0.05, a: 1, b: 10, x0: 2.5, y0: 2, steps: 60 };
    const plots = h("div"), reads = h("div", { class: "readouts" });
    const draw = throttled(() => {
      const rose = st.surface === "rosenbrock";
      const run = M.gradientDescent({ surface: st.surface, a: st.a, b: st.b, lr: st.lr, start: [st.x0, st.y0], steps: st.steps });
      const range = rose ? { x: [-2, 2], y: [-1, 3] } : { x: [-3, 3], y: [-3, 3] };
      const last = run.path.at(-1), fEnd = run.values.at(-1);
      const limit = rose ? null : 2 / Math.max(st.a, st.b);
      fill(plots, figure(t("lab.gd.surface"), P.heatMap({ f: run.f, xRange: range.x, yRange: range.y, path: run.path })),
        figure(t("lab.gd.loss"), P.lineChart({ series: [{ y: run.values.map((v) => (Number.isFinite(v) ? Math.log10(v + 1e-12) : NaN)), label: "log₁₀ f" }],
          height: 200, xLabel: t("lab.step") })));
      fill(reads, readout(t("lab.gd.final"), fmt(fEnd)), readout(t("lab.gd.point"), `(${fmt(last[0])}, ${fmt(last[1])})`),
        limit !== null ? readout(t("lab.gd.limit"), fmt(limit)) : null,
        readout(t("lab.verdict"), !Number.isFinite(fEnd) || fEnd > run.values[0] ? t("lab.diverges") : t("lab.converges")));
    });
    const controls = h("div", { class: "card controls" },
      h("div", { class: "ctl" }, h("label", {}, t("lab.gd.surfacekind")),
        h("select", { onchange: (e) => {
          st.surface = e.target.value;
          if (st.surface === "rosenbrock") { st.lr = 0.0015; st.x0 = -1.5; st.y0 = 2; st.steps = 400; } else { st.lr = 0.05; st.x0 = 2.5; st.y0 = 2; st.steps = 60; }
          lr.set(st.lr); x0.set(st.x0); y0.set(st.y0); steps.set(st.steps); draw();
        } }, h("option", { value: "bowl" }, t("lab.gd.bowl")), h("option", { value: "rosenbrock" }, "Rosenbrock"))),
      slider({ label: "η (learning rate)", min: 0.0005, max: 0.3, step: 0.0005, value: st.lr, onInput: (v) => { st.lr = v; draw(); } }),
      slider({ label: "a", min: 0.2, max: 5, step: 0.1, value: st.a, onInput: (v) => { st.a = v; draw(); } }),
      slider({ label: "b", min: 1, max: 20, step: 0.5, value: st.b, onInput: (v) => { st.b = v; draw(); } }),
      slider({ label: "x₀", min: -3, max: 3, step: 0.1, value: st.x0, onInput: (v) => { st.x0 = v; draw(); } }),
      slider({ label: "y₀", min: -3, max: 3, step: 0.1, value: st.y0, onInput: (v) => { st.y0 = v; draw(); } }),
      slider({ label: t("lab.steps"), min: 5, max: 600, step: 1, value: st.steps, onInput: (v) => { st.steps = v; draw(); } }),
      h("p", { class: "hint" }, t("lab.gd.hint")), reads);
    const [, lr, , , x0, y0, steps] = controls.children;
    draw();
    return [controls, plots];
  },

  linear(t) {
    const st = { a: -0.5, b: 1, c: -1, d: -0.5 };
    const plots = h("div"), reads = h("div", { class: "readouts" });
    const ctl = {};
    const draw = throttled(() => {
      const info = M.classify2x2(st.a, st.b, st.c, st.d);
      const starts = Array.from({ length: 8 }, (_, i) => [2.6 * Math.cos((i * Math.PI) / 4 + 0.3), 2.6 * Math.sin((i * Math.PI) / 4 + 0.3)]);
      const trajectories = starts.map((x0) => M.linearTrajectory(st.a, st.b, st.c, st.d, x0, 0.02, 600));
      fill(plots, figure(t("lab.linear.portrait"), P.vectorField({ field: (x, y) => [st.a * x + st.b * y, st.c * x + st.d * y], trajectories })));
      const ev = (e) => (Math.abs(e.im) < 1e-12 ? fmt(e.re) : `${fmt(e.re)} ${e.im < 0 ? "−" : "+"} ${fmt(Math.abs(e.im))}i`);
      fill(reads, readout("λ₁", ev(info.eig[0])), readout("λ₂", ev(info.eig[1])), readout(t("lab.linear.trace"), fmt(info.trace)),
        readout(t("lab.linear.det"), fmt(info.det)), h("div", { class: "readout" }, h("span", { class: "kindtag" }, t("lab.kind." + info.kind)),
          h("span", {}, info.stable ? t("lab.linear.stable") : t("lab.linear.notstable"))));
    });
    const presets = { "stable node": [-1, 0, 0, -2], saddle: [1, 0, 0, -1], "stable spiral": [-0.5, 1, -1, -0.5], center: [0, 1, -1, 0],
      "unstable spiral": [0.2, 1, -1, 0.2] };
    const controls = h("div", { class: "card controls" },
      h("div", { class: "presets" }, Object.entries(presets).map(([k, v]) => h("button", { class: "small", type: "button", onclick: () => {
        [st.a, st.b, st.c, st.d] = v;
        ["a", "b", "c", "d"].forEach((x) => ctl[x].set(st[x]));
        draw();
      } }, t("lab.kind." + k)))),
      ...["a", "b", "c", "d"].map((x) => (ctl[x] = slider({ label: x, min: -3, max: 3, step: 0.05, value: st[x], onInput: (v) => { st[x] = v; draw(); } }))),
      h("p", { class: "hint" }, t("lab.linear.hint")), reads);
    draw();
    return [controls, plots];
  },

  pid(t) {
    const st = { kp: 2, ki: 1, kd: 0.2, tau: 1, time: 10 };
    const plots = h("div"), reads = h("div", { class: "readouts" });
    const draw = throttled(() => {
      const run = M.pid({ kp: st.kp, ki: st.ki, kd: st.kd, tau: st.tau, dt: 0.01, t: st.time });
      const every = (a) => a.filter((_, i) => i % 5 === 0);
      fill(plots, figure(t("lab.pid.response"), P.lineChart({ series: [{ x: every(run.t), y: every(run.y), label: "y(t)" }],
        hlines: [{ y: 1, label: t("lab.pid.setpoint") }], xLabel: "t (s)", height: 260 })),
      figure(t("lab.pid.effort"), P.lineChart({ series: [{ x: every(run.t), y: every(run.u), label: "u(t)", color: "var(--ready)" }], xLabel: "t (s)", height: 180 })));
      const m = run.metrics;
      fill(reads, readout(t("lab.pid.overshoot"), `${fmt(100 * m.overshoot)}%`), readout(t("lab.pid.settling"), `${fmt(m.settling)} s`),
        readout(t("lab.pid.rise"), m.rise === null ? "—" : `${fmt(m.rise)} s`), readout(t("lab.pid.error"), fmt(m.steadyError)));
    });
    const controls = h("div", { class: "card controls" },
      slider({ label: "Kp", min: 0, max: 20, step: 0.1, value: st.kp, onInput: (v) => { st.kp = v; draw(); } }),
      slider({ label: "Ki", min: 0, max: 10, step: 0.05, value: st.ki, onInput: (v) => { st.ki = v; draw(); } }),
      slider({ label: "Kd", min: 0, max: 5, step: 0.02, value: st.kd, onInput: (v) => { st.kd = v; draw(); } }),
      slider({ label: "τ (s)", min: 0.2, max: 5, step: 0.1, value: st.tau, onInput: (v) => { st.tau = v; draw(); } }),
      slider({ label: t("lab.pid.window"), min: 3, max: 40, step: 1, value: st.time, onInput: (v) => { st.time = v; draw(); } }),
      h("p", { class: "hint" }, t("lab.pid.hint")), reads);
    draw();
    return [controls, plots];
  },

  kalman(t) {
    const st = { q: 0.01, r: 1, steps: 150, seed: 7 };
    const plots = h("div"), reads = h("div", { class: "readouts" });
    const draw = throttled(() => {
      const run = M.kalman1d({ q: st.q, r: st.r, steps: st.steps, seed: st.seed });
      const kinf = M.kalmanSteadyGain(st.q, st.r);
      const rmse = (xs) => Math.sqrt(xs.reduce((s, v, i) => s + (v - run.truth[i]) ** 2, 0) / xs.length);
      fill(plots, figure(t("lab.kalman.track"), P.lineChart({ series: [
        { y: run.measured, label: t("lab.kalman.measured"), points: true, color: "var(--muted)" },
        { y: run.truth, label: t("lab.kalman.truth"), color: "var(--ink)", width: 1.6 },
        { y: run.estimate, label: t("lab.kalman.estimate") }], xLabel: t("lab.step"), height: 280 })),
      figure(t("lab.kalman.gain"), P.lineChart({ series: [{ y: run.gain, label: "K" }], hlines: [{ y: kinf, label: "K∞" }],
        xLabel: t("lab.step"), height: 180, yRange: [0, Math.max(...run.gain) * 1.1] })));
      fill(reads, readout("K∞", fmt(kinf)), readout(t("lab.kalman.rmse.z"), fmt(rmse(run.measured))),
        readout(t("lab.kalman.rmse.x"), fmt(rmse(run.estimate))));
    });
    const controls = h("div", { class: "card controls" },
      slider({ label: "q (process)", min: -4, max: 0, step: 0.05, value: Math.log10(st.q), log: true, onInput: (v) => { st.q = v; draw(); } }),
      slider({ label: "r (measurement)", min: -2, max: 1, step: 0.05, value: Math.log10(st.r), log: true, onInput: (v) => { st.r = v; draw(); } }),
      slider({ label: t("lab.steps"), min: 20, max: 500, step: 10, value: st.steps, onInput: (v) => { st.steps = v; draw(); } }),
      slider({ label: t("lab.seed"), min: 1, max: 99, step: 1, value: st.seed, show: String, onInput: (v) => { st.seed = v; draw(); } }),
      h("p", { class: "hint" }, t("lab.kalman.hint")), reads);
    draw();
    return [controls, plots];
  },

  vi(t) {
    const WORLDS = {
      rn: { grid: ["...G", ".#.P", "S..."], gamma: 0.99, slip: 0.2, stepReward: -0.04 },
      corridor: { grid: ["S....G"], gamma: 0.9, slip: 0, stepReward: 0 },
      cliff: { grid: ["......", "......", "SPPPPG"], gamma: 0.95, slip: 0.1, stepReward: -0.01 },
    };
    const st = { world: "rn", ...WORLDS.rn, sweep: 0 };
    const view = h("div"), reads = h("div", { class: "readouts" });
    let run = null, timer = null;
    const ARROWS = { up: "↑", right: "→", down: "↓", left: "←" };
    const solve = () => {
      run = M.valueIteration({ grid: st.grid, gamma: st.gamma, slip: st.slip, stepReward: st.stepReward, tol: 1e-6 });
      sweep.querySelector("input").max = run.sweeps.length - 1;
      st.sweep = Math.min(st.sweep, run.sweeps.length - 1);
    };
    const draw = () => {
      const V = run.sweeps[st.sweep];
      const pol = M.greedyPolicy({ grid: st.grid, gamma: st.gamma, slip: st.slip, stepReward: st.stepReward }, V);
      const cols = run.cols;
      const flat = V.flat().filter(Number.isFinite);
      const hi = Math.max(1e-9, ...flat.map(Math.abs));
      const grid = h("div", { class: "gridworld", style: `grid-template-columns:repeat(${cols}, minmax(0, 76px))` });
      for (let i = 0; i < run.rows; i++) {
        for (let j = 0; j < cols; j++) {
          const c = run.cell(i, j);
          if (c === "#") { grid.append(h("div", { class: "gc wall" })); continue; }
          const v = V[i][j];
          const colour = v >= 0 ? "var(--mastered)" : "var(--wrong)";
          const pct = Math.round(70 * Math.abs(v) / hi);
          grid.append(h("div", { class: `gc${c === "G" ? " goal" : c === "P" ? " pit" : ""}`,
            style: `background:color-mix(in srgb, ${colour} ${pct}%, var(--surface-2))` },
          pol[i][j] ? h("span", { class: "arrow" }, ARROWS[pol[i][j]]) : null,
          c === "G" ? "+1" : c === "P" ? "−1" : fmt(v)));
        }
      }
      fill(view, figure(t("lab.vi.values", { k: st.sweep, n: run.sweeps.length - 1 }), grid));
      fill(reads, readout(t("lab.vi.sweeps"), String(run.sweeps.length - 1)), readout(t("lab.vi.converged"), run.converged ? "✓" : "…"));
    };
    const play = h("button", { type: "button", class: "small", onclick: () => {
      if (timer) { clearInterval(timer); timer = null; play.textContent = "▶ " + t("lab.play"); return; }
      st.sweep = 0;
      play.textContent = "⏸ " + t("lab.pause");
      timer = setInterval(() => {
        if (st.sweep >= run.sweeps.length - 1) { clearInterval(timer); timer = null; play.textContent = "▶ " + t("lab.play"); return; }
        st.sweep++;
        sweep.set(st.sweep);
        draw();
      }, 260);
    } }, "▶ " + t("lab.play"));
    const sweep = slider({ label: t("lab.vi.sweep"), min: 0, max: 1, step: 1, value: 0, show: String, onInput: (v) => { st.sweep = v; draw(); } });
    const again = throttled(() => { solve(); st.sweep = run.sweeps.length - 1; sweep.set(st.sweep); draw(); });
    const gamma = slider({ label: "γ", min: 0.5, max: 0.999, step: 0.001, value: st.gamma, onInput: (v) => { st.gamma = v; again(); } });
    const slip = slider({ label: t("lab.vi.slip"), min: 0, max: 0.5, step: 0.01, value: st.slip, onInput: (v) => { st.slip = v; again(); } });
    const step = slider({ label: t("lab.vi.step"), min: -0.3, max: 0, step: 0.005, value: st.stepReward, onInput: (v) => { st.stepReward = v; again(); } });
    const controls = h("div", { class: "card controls" },
      h("div", { class: "ctl" }, h("label", {}, t("lab.vi.world")), h("select", { onchange: (e) => {
        Object.assign(st, { world: e.target.value }, WORLDS[e.target.value]);
        gamma.set(st.gamma); slip.set(st.slip); step.set(st.stepReward);
        again();
      } }, Object.keys(WORLDS).map((k) => h("option", { value: k }, t("lab.vi.world." + k))))),
      gamma, slip, step, sweep, h("div", { class: "row" }, play), h("p", { class: "hint" }, t("lab.vi.hint")), reads);
    solve();
    st.sweep = run.sweeps.length - 1;
    sweep.set(st.sweep);
    draw();
    return [controls, view, () => timer && clearInterval(timer)];
  },

  bandit(t) {
    const ARMS = { three: [0.1, 0.5, 0.9], five: [0.2, -0.1, 0.6, 0.4, 0.9] };
    const st = { eps: 0.1, steps: 1500, seed: 3, arms: "three", compare: true };
    const plots = h("div"), reads = h("div", { class: "readouts" });
    const draw = throttled(() => {
      const means = ARMS[st.arms];
      const runs = [{ eps: st.eps, label: `ε = ${fmt(st.eps)}` }];
      if (st.compare) for (const e of [0, 0.01]) if (e !== st.eps) runs.push({ eps: e, label: `ε = ${e}` });
      const res = runs.map((r) => ({ ...r, out: M.bandit({ means, eps: r.eps, steps: st.steps, seed: st.seed }) }));
      fill(plots, figure(t("lab.bandit.reward"), P.lineChart({ series: res.map((r) => ({ y: r.out.avgReward, label: r.label })),
        hlines: [{ y: Math.max(...means), label: t("lab.bandit.best") }], xLabel: t("lab.step"), height: 240 })),
      figure(t("lab.bandit.optimal"), P.lineChart({ series: res.map((r) => ({ y: r.out.optimalShare.map((v) => 100 * v), label: r.label })),
        xLabel: t("lab.step"), yRange: [0, 100], height: 200 })));
      const mine = res[0].out;
      fill(reads, readout(t("lab.bandit.share"), `${fmt(100 * mine.optimalShare.at(-1))}%`), readout(t("lab.bandit.avg"), fmt(mine.avgReward.at(-1))),
        ...means.map((m, i) => readout(t("lab.bandit.arm", { i: i + 1, m: fmt(m) }), `${fmt(mine.estimates[i])} · ${mine.counts[i]}×`)));
    });
    const controls = h("div", { class: "card controls" },
      h("div", { class: "ctl" }, h("label", {}, t("lab.bandit.arms")), h("select", { onchange: (e) => { st.arms = e.target.value; draw(); } },
        h("option", { value: "three" }, "0.1 · 0.5 · 0.9"), h("option", { value: "five" }, "0.2 · −0.1 · 0.6 · 0.4 · 0.9"))),
      slider({ label: "ε", min: 0, max: 1, step: 0.01, value: st.eps, onInput: (v) => { st.eps = v; draw(); } }),
      slider({ label: t("lab.steps"), min: 100, max: 5000, step: 100, value: st.steps, onInput: (v) => { st.steps = v; draw(); } }),
      slider({ label: t("lab.seed"), min: 1, max: 99, step: 1, value: st.seed, show: String, onInput: (v) => { st.seed = v; draw(); } }),
      h("label", { class: "toggle" }, h("input", { type: "checkbox", checked: true, onchange: (e) => { st.compare = e.target.checked; draw(); } }),
        t("lab.bandit.compare")),
      h("p", { class: "hint" }, t("lab.bandit.hint")), reads);
    draw();
    return [controls, plots];
  },

  lln(t) {
    const st = { sides: 6, n: 2000, seed: 5 };
    const plots = h("div"), reads = h("div", { class: "readouts" });
    const draw = throttled(() => {
      const run = M.largeNumbers({ sides: st.sides, n: Math.round(st.n), seed: st.seed });
      const x = run.mean.map((_, i) => i + 1);
      const band = run.mean.map((_, i) => run.expected + Math.sqrt((st.sides ** 2 - 1) / 12) / Math.sqrt(i + 1));
      const below = band.map((v) => 2 * run.expected - v);
      fill(plots, figure(t("lab.lln.mean"), P.lineChart({ series: [{ x, y: run.mean, label: t("lab.lln.running") },
        { x, y: band, label: "± σ/√n", dashed: true, color: "var(--ready)" }, { x, y: below, dashed: true, color: "var(--ready)" }],
      hlines: [{ y: run.expected, label: "E[X]" }], xLabel: "n", height: 260, clip: [1, st.sides] })),
      figure(t("lab.lln.counts"), P.bars({ values: run.counts, expected: Math.round(st.n) / st.sides })));
      fill(reads, readout(t("lab.lln.final"), fmt(run.mean.at(-1))), readout("E[X]", fmt(run.expected)),
        readout(t("lab.lln.gap"), fmt(Math.abs(run.mean.at(-1) - run.expected))));
    });
    const controls = h("div", { class: "card controls" },
      slider({ label: t("lab.lln.sides"), min: 2, max: 20, step: 1, value: st.sides, show: String, onInput: (v) => { st.sides = v; draw(); } }),
      slider({ label: "n", min: 1, max: 4.3, step: 0.01, value: Math.log10(st.n), log: true, show: (v) => String(Math.round(v)),
        onInput: (v) => { st.n = v; draw(); } }),
      slider({ label: t("lab.seed"), min: 1, max: 99, step: 1, value: st.seed, show: String, onInput: (v) => { st.seed = v; draw(); } }),
      h("p", { class: "hint" }, t("lab.lln.hint")), reads);
    draw();
    return [controls, plots];
  },
};

function modelsTab(id, t, results) {
  if (!id || !model(id)) {
    return [h("p", { class: "muted" }, t("lab.models.intro")), h("div", { class: "gallery" }, MODELS.map((m) =>
      h("a", { class: "tile", href: `#/lab/models/${m.id}` }, h("span", { class: "icon" }, m.icon),
        h("h3", {}, t(`lab.m.${m.id}`)), h("p", {}, t(`lab.m.${m.id}.d`)))))];
  }
  const m = model(id);
  const [controls, plots, stop] = VIEWS[id](t);
  return [h("div", { class: "card hero" }, h("div", { class: "row wrap", style: "margin-top:0" }, h("span", { class: "icon" }, m.icon),
    h("h2", { style: "margin:0" }, t(`lab.m.${id}`))), h("p", {}, t(`lab.m.${id}.d`)), h("h4", {}, t("lab.shows")), conceptChips(m.concepts, t)),
  h("div", { class: "lab-grid" }, controls, plots), stop];
}

// ------------------------------------------------------------------ figures
// A figure is a standalone page (figures/<id>/build.mjs writes it), served from /figures/ with a policy of its own and
// shown in a sandboxed frame: its script runs and reaches nothing. The theme follows the system's, as typeset.js does.
function figuresTab(id, t) {
  if (!id || !figureOf(id)) {
    return [h("p", { class: "muted" }, t("lab.figures.intro")), h("div", { class: "gallery" }, FIGURES.map((f) =>
      h("a", { class: "tile", href: `#/lab/figures/${f.id}` }, h("span", { class: "icon" }, f.icon),
        h("h3", {}, t(`lab.f.${f.id}`)), h("p", {}, t(`lab.f.${f.id}.d`)))))];
  }
  const f = figureOf(id);
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  return [h("div", { class: "card hero" }, h("div", { class: "row wrap", style: "margin-top:0" }, h("span", { class: "icon" }, f.icon),
    h("h2", { style: "margin:0" }, t(`lab.f.${id}`))), h("p", {}, t(`lab.f.${id}.d`)), h("h4", {}, t("lab.shows")), conceptChips(f.concepts, t)),
  h("iframe", { class: "figure-frame", src: figureSrc(id, dark), sandbox: "allow-scripts",
    title: t(`lab.f.${id}`), loading: "lazy" })];
}

// ------------------------------------------------------------------ formulas
function formulasTab(t) {
  const texInput = h("textarea", { rows: 3, dir: "ltr", spellcheck: "false" },
    store("los.lab.tex") || "\\hat{x}_{k|k} = \\hat{x}_{k|k-1} + K_k\\,\\bigl(z_k - H\\,\\hat{x}_{k|k-1}\\bigr)");
  const preview = h("div", { class: "preview", dir: "ltr" });
  const showTex = () => {
    store("los.lab.tex", texInput.value);
    if (window.katex) {
      try { window.katex.render(texInput.value, preview, { throwOnError: false, displayMode: true }); } catch (e) { preview.textContent = e.message; }
    } else preview.textContent = texInput.value;
  };
  texInput.addEventListener("input", showTex);

  const fInput = h("textarea", { rows: 3, dir: "ltr", spellcheck: "false" }, store("los.lab.f") || "a * sin(b x) * exp(-c x)\nexp(-c x)");
  const xmin = h("input", { type: "number", value: 0, step: "any", style: "width:6rem" });
  const xmax = h("input", { type: "number", value: 12, step: "any", style: "width:6rem" });
  const sliders = h("div", { class: "controls" }), plot = h("div"), err = h("div", { class: "formula-error" });
  const params = store("los.lab.params") || { a: 1, b: 2, c: 0.3 };
  const drawPlot = throttled(() => {
    const lines = fInput.value.split(/\n/).map((x) => x.trim()).filter(Boolean).slice(0, 5);
    const lo = Number(xmin.value), hi = Number(xmax.value);
    const xs = Array.from({ length: 400 }, (_, i) => lo + ((hi - lo) * i) / 399);
    const series = [];
    const problems = [];
    for (const [i, src] of lines.entries()) {
      try {
        const f = compile(src);
        f({ ...params, x: lo });              // a name with no value is said here, not drawn as an empty line
        series.push({ x: xs, y: xs.map((x) => { try { return f({ ...params, x }); } catch (e) { return NaN; } }), label: `f${i + 1}` });
      } catch (e) { problems.push(`f${i + 1}: ${e.message}`); }
    }
    err.textContent = problems.join(" · ");
    fill(plot, series.length ? P.lineChart({ series, xLabel: "x", height: 320, clip: [-1e6, 1e6] }) : null);
  });
  const rebuild = () => {
    store("los.lab.f", fInput.value);
    const names = new Set();
    for (const src of fInput.value.split(/\n/)) {
      try { freeVars(parse(src)).forEach((n) => n !== "x" && names.add(n)); } catch (e) { /* shown by the plot */ }
    }
    fill(sliders, [...names].sort().map((n) => slider({ label: n, min: -5, max: 5, step: 0.01, value: params[n] ?? 1,
      onInput: (v) => { params[n] = v; store("los.lab.params", params); drawPlot(); } })));
    for (const n of names) if (params[n] === undefined) params[n] = 1;
    drawPlot();
  };
  fInput.addEventListener("input", rebuild);
  xmin.addEventListener("input", drawPlot);
  xmax.addEventListener("input", drawPlot);
  showTex();
  rebuild();
  return [
    h("section", { class: "card" }, h("h3", {}, t("lab.tex")), h("p", { class: "hint" }, t("lab.tex.hint")), texInput, h("div", { class: "label" }, t("lab.preview")), preview),
    h("section", { class: "card" }, h("h3", {}, t("lab.plotter")), h("p", { class: "hint" }, t("lab.plotter.hint")),
      h("div", { class: "lab-grid" }, h("div", {}, fInput, err, h("div", { class: "row wrap" }, h("span", { class: "meta" }, "x ∈"), xmin, xmax), sliders), plot)),
  ];
}

// ------------------------------------------------------------------ code
const EXAMPLES = {
  js: {
    sine: "// plot(x, y), print(...), table(rows), and lab.* (linspace, matmul, models …)\nconst x = lab.linspace(0, 4 * Math.PI, 200);\nplot(x, x.map(Math.sin), { label: \"sin x\", title: \"A sine\" });\nprint(\"max:\", Math.max(...x.map(Math.sin)));",
    walk: "// a random walk, and how far it wanders\nconst r = lab.rng(42);\nlet x = 0;\nconst path = [0];\nfor (let i = 0; i < 1000; i++) { x += lab.randn(r); path.push(x); }\nplot(path, { label: \"walk\" });\nprint(\"end:\", x.toFixed(2), \" expected spread ~\", Math.sqrt(1000).toFixed(1));",
    matrix: "// eigen-ish: power iteration on a 2x2\nconst A = [[2, 1], [1, 3]];\nlet v = [1, 0];\nfor (let i = 0; i < 30; i++) { const w = lab.matmul(A, v); v = lab.scale(w, 1 / lab.norm(w)); }\nconst lambda = lab.dot(v, lab.matmul(A, v));\ntable([{ lambda, v0: v[0], v1: v[1] }]);",
    pid: "// the Lab's own models are here too\nconst run = lab.models.pid({ kp: 3, ki: 2, kd: 0.1, t: 8 });\nplot(run.t, run.y, { label: \"y(t)\" });\nprint(run.metrics);",
  },
  py: {
    numpy: "import numpy as np\nimport matplotlib.pyplot as plt\n\nx = np.linspace(0, 10, 400)\nplt.plot(x, np.exp(-0.3 * x) * np.sin(2 * x))\nplt.title(\"A damped sine\")\nplt.show()\nprint(\"mean:\", np.mean(x))",
    plain: "from fractions import Fraction\n\n# the harmonic numbers, exactly\nh = Fraction(0)\nfor n in range(1, 11):\n    h += Fraction(1, n)\n    print(n, h)",
  },
};

function outputPane() {
  const out = h("div", { class: "output", "aria-live": "polite" });
  return {
    el: out,
    clear: () => out.replaceChildren(),
    line: (text, cls) => out.append(h("div", { class: cls || "" }, text)),
    node: (n) => out.append(n),
  };
}

function runWorker(message, timeoutMs, onMessage) {
  return new Promise((resolve) => {
    const w = new Worker("/app/lab/worker.js", { type: "module" });
    const stop = (why) => { clearTimeout(timer); w.terminate(); resolve(why); };
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    w.onmessage = (e) => {
      onMessage(e.data);
      if (["done", "error", "tests"].includes(e.data.kind)) stop("ok");
    };
    w.onerror = (e) => { onMessage({ kind: "error", text: e.message || "the worker failed" }); stop("error"); };
    runWorker.stop = () => stop("stopped");
    w.postMessage(message);
  });
}

function editor(key, initial) {
  const ta = h("textarea", { class: "editor", rows: 16, dir: "ltr", spellcheck: "false", autocapitalize: "off" });
  ta.value = store(key) ?? initial;
  ta.addEventListener("input", () => store(key, ta.value));
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b } = ta;
      ta.setRangeText("  ", a, b, "end");
      store(key, ta.value);
    }
  });
  return ta;
}

function codeTab(t, info) {
  let lang = store("los.lab.lang") || "js";
  if (lang === "py" && !info.python) lang = "js";
  const out = outputPane();
  const ed = editor(`los.lab.code.${lang}`, EXAMPLES[lang][Object.keys(EXAMPLES[lang])[0]]);
  const examples = h("select", { "aria-label": t("lab.code.examples") });
  const fillExamples = () => fill(examples, h("option", { value: "" }, t("lab.code.examples")),
    Object.keys(EXAMPLES[lang]).map((k) => h("option", { value: k }, t(`lab.ex.${k}`))));
  examples.addEventListener("change", () => { if (examples.value) { ed.value = EXAMPLES[lang][examples.value]; store(`los.lab.code.${lang}`, ed.value); } });
  const langSel = h("select", { "aria-label": t("lab.code.lang"), onchange: (e) => {
    lang = e.target.value;
    store("los.lab.lang", lang);
    ed.value = store(`los.lab.code.${lang}`) ?? EXAMPLES[lang][Object.keys(EXAMPLES[lang])[0]];
    fillExamples();
    note.textContent = lang === "py" ? t("lab.code.py") : t("lab.code.js");
  } }, h("option", { value: "js" }, "JavaScript"), h("option", { value: "py", disabled: info.python ? null : true }, info.python ? "Python" : t("lab.code.pyoff")));
  langSel.value = lang;
  fillExamples();
  const note = h("p", { class: "hint" }, lang === "py" ? t("lab.code.py") : t("lab.code.js"));
  const runBtn = h("button", { class: "primary", type: "button" }, "▶ ", t("lab.run"));
  const stopBtn = h("button", { type: "button", disabled: true, onclick: () => runWorker.stop && runWorker.stop() }, "■ ", t("lab.stop"));
  const run = async () => {
    out.clear();
    runBtn.disabled = true;
    const t0 = performance.now();
    if (lang === "py") {
      out.line(t("lab.code.running"), "note-line");
      try {
        const r = await api.post("/api/lab/python", { code: ed.value });
        out.clear();
        if (r.stdout) out.line(r.stdout);
        if (r.stderr) out.line(r.stderr, "err");
        for (const f of r.figures || []) out.node(h("img", { src: `data:image/png;base64,${f}`, alt: t("lab.figure") }));
        out.line(r.timed_out ? t("lab.code.timeout", { s: info.timeout_s }) : t("lab.code.exit", { code: r.exit, ms: r.ms }), "note-line");
        if (r.truncated) out.line(t("lab.code.truncated"), "note-line");
      } catch (e) { out.line(e.message, "err"); }
      runBtn.disabled = false;
      return;
    }
    stopBtn.disabled = false;
    let failed = false;
    const why = await runWorker({ kind: "run", code: ed.value }, info.timeout_s * 1000, (m) => {
      if (m.kind === "error") failed = true;
      if (m.kind === "print") out.line(m.text);
      else if (m.kind === "plot") {
        out.node(h("div", { class: "figure" }, m.spec.title ? h("h4", {}, m.spec.title) : null,
          P.lineChart({ series: m.spec.series.map((s) => ({ ...s, y: s.y.map((v) => (v === null ? NaN : v)), x: s.x && s.x.map((v) => (v === null ? NaN : v)) })),
            xLabel: m.spec.xLabel, yLabel: m.spec.yLabel, height: 260 })));
      } else if (m.kind === "table") {
        out.node(h("table", {}, m.rows.map((r, i) => h("tr", {}, r.map((c) => h(i === 0 && m.rows.length > 1 ? "th" : "td", {}, c))))));
      } else if (m.kind === "error") out.line(m.text, "err");
    });
    if (why === "timeout") out.line(t("lab.code.timeout", { s: info.timeout_s }), "note-line");
    else if (why === "stopped") out.line(t("lab.code.stopped"), "note-line");
    else if (!failed) out.line(t("lab.code.done", { ms: Math.round(performance.now() - t0) }), "note-line");
    runBtn.disabled = false;
    stopBtn.disabled = true;
  };
  runBtn.addEventListener("click", run);
  ed.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
  return [h("section", { class: "card" }, h("div", { class: "row wrap", style: "margin-top:0" }, langSel, examples, runBtn, stopBtn,
    h("span", { class: "hint" }, "Ctrl+Enter")), note, ed, h("div", { class: "label" }, t("lab.output")), out.el)];
}

// ------------------------------------------------------------------ exercises
function exercisesTab(id, t, info) {
  const results = info.results || {};
  if (!id || !exercise(id)) {
    return [h("p", { class: "muted" }, t("lab.exercises.intro")), h("div", { class: "gallery" }, EXERCISES.map((e) => {
      const r = results[e.id];
      return h("a", { class: "tile", href: `#/lab/exercises/${e.id}` }, h("span", { class: "icon" }, "🧪"),
        r ? h("span", { class: `score ${r.best === r.total ? "ok" : "meta"}` }, `${r.best}/${r.total}`) : null,
        h("h3", {}, e.title), h("p", {}, e.concepts.slice(0, 2).join(" · ")));
    }))];
  }
  const ex = exercise(id);
  const ed = editor(`los.lab.ex.${id}`, ex.starter);
  const list = h("ul", { class: "tests" });
  const status = h("p", { class: "meta" }, results[id] ? t("lab.best", { b: results[id].best, n: results[id].total }) : "");
  const runBtn = h("button", { class: "primary", type: "button" }, "▶ ", t("lab.runtests"));
  const run = async () => {
    runBtn.disabled = true;
    list.replaceChildren(h("li", { class: "muted" }, t("lab.code.running")));
    let res = null;
    const why = await runWorker({ kind: "test", id, code: ed.value }, info.timeout_s * 1000, (m) => {
      if (m.kind === "tests") res = m;
      if (m.kind === "error") res = { passed: 0, total: ex.tests.length, results: [], error: m.text };
    });
    if (why === "timeout") res = { passed: 0, total: ex.tests.length, results: [], error: t("lab.code.timeout", { s: info.timeout_s }) };
    fill(list, res.error ? h("li", { class: "fail" }, res.error) : null, res.results.map((r) => h("li", { class: r.ok ? "pass" : "fail" },
      h("strong", {}, r.ok ? "✓ " : "✗ ", r.name),
      r.error ? h("div", { class: "bad" }, h("code", {}, r.error)) : null,
      !r.ok && !r.error ? h("div", {}, h("span", { class: "meta" }, t("lab.got") + " "), h("code", {}, r.got),
        r.want !== undefined ? [h("span", { class: "meta" }, " · " + t("lab.want") + " "), h("code", {}, r.want)] : null) : null)));
    status.textContent = t("lab.result", { p: res.passed, n: res.total });
    if (res.passed === res.total) toast(t("lab.allpass"));
    try { await api.post("/api/lab/attempt", { exercise: id, passed: res.passed, total: res.total, lang: "js" }); } catch (e) { /* the ledger is a record, not the point */ }
    runBtn.disabled = false;
  };
  runBtn.addEventListener("click", run);
  ed.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
  const reset = h("button", { type: "button", onclick: () => { ed.value = ex.starter; store(`los.lab.ex.${id}`, ed.value); } }, t("lab.reset"));
  return [h("section", { class: "card hero" }, h("h2", {}, "🧪 ", ex.title), h("p", {}, ex.statement), h("h4", {}, t("lab.shows")),
    conceptChips(ex.concepts, t)),
  h("section", { class: "card" }, ed, h("div", { class: "row wrap" }, runBtn, reset, h("span", { class: "hint" }, "Ctrl+Enter"), status), list)];
}

// ------------------------------------------------------------------ the page
export async function render(main, params, ctx) {
  const { t } = ctx;
  const [tabArg, id] = String(params.arg || "models").split("/");
  const tab = TABS.includes(tabArg) ? tabArg : "models";
  let info = { python: false, timeout_s: 10, modules: {}, results: {} };
  try { info = await api.get("/api/lab"); } catch (e) { /* the Lab still works without its server parts */ }
  const tabs = h("div", { class: "lab-tabs" }, TABS.map((k) => h("a", { class: k === tab ? "active" : "", href: `#/lab/${k}` }, t(`lab.tab.${k}`))));
  let body = [], stop = null;
  if (tab === "models") {
    const parts = modelsTab(id, t, info.results);
    stop = typeof parts.at(-1) === "function" ? parts.pop() : null;
    body = parts;
  } else if (tab === "figures") body = figuresTab(id, t);
  else if (tab === "formulas") body = formulasTab(t);
  else if (tab === "code") body = codeTab(t, info);
  else body = exercisesTab(id, t, info);
  fill(main, h("div", { class: "page-head" }, h("h1", {}, "🔬 ", t("nav.lab")), tabs), ...body);
  return () => { if (stop) stop(); if (runWorker.stop) runWorker.stop(); };
}
