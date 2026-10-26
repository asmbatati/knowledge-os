// The Lab's worker: it runs the learner's code with a few helpers, and an exercise's tests. It is served with a policy
// of its own (los/app.py, WORKER_CSP): it may evaluate code, and it can reach nothing — no network, no other worker,
// no page. The page starts a fresh worker for every run and stops it at the time limit.
import { exercise } from "./exercises.js";
import { runTests, show } from "./runtests.js";
import { lab } from "./mathlib.js";

const post = (m) => self.postMessage(m);
const MAX_POINTS = 20000, MAX_SERIES = 12, MAX_ROWS = 200;

function numbers(a) {
  return Array.isArray(a) ? a.slice(0, MAX_POINTS).map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null)) : [];
}

function plotSpec(args) {
  let spec;
  if (args.length === 1 && args[0] && !Array.isArray(args[0]) && typeof args[0] === "object") spec = args[0];
  else if (args.length >= 2 && Array.isArray(args[1])) spec = { series: [{ x: args[0], y: args[1], ...(args[2] || {}) }], title: args[2]?.title };
  else spec = { series: [{ y: args[0], ...(args[1] || {}) }], title: args[1]?.title };
  const series = (spec.series || [spec]).slice(0, MAX_SERIES).map((d) => ({
    x: d.x ? numbers(d.x) : undefined, y: numbers(d.y), label: d.label ? String(d.label).slice(0, 40) : undefined,
    points: !!d.points, dashed: !!d.dashed,
  }));
  return { series, title: spec.title ? String(spec.title).slice(0, 80) : "", xLabel: spec.xLabel ? String(spec.xLabel) : "",
    yLabel: spec.yLabel ? String(spec.yLabel) : "" };
}

function tableRows(rows) {
  if (!Array.isArray(rows)) return [[show(rows)]];
  const list = rows.slice(0, MAX_ROWS);
  if (list.length && list[0] && typeof list[0] === "object" && !Array.isArray(list[0])) {
    const keys = Object.keys(list[0]).slice(0, 12);
    return [keys, ...list.map((r) => keys.map((k) => show(r[k])))];
  }
  return list.map((r) => (Array.isArray(r) ? r.slice(0, 12).map((v) => (typeof v === "string" ? v : show(v))) : [show(r)]));
}

// the line of the learner's code an error came from, when the engine says
function lineOf(err) {
  const m = /<anonymous>:(\d+):(\d+)/.exec((err && err.stack) || "");
  return m ? ` (line ${Math.max(1, Number(m[1]) - 3)})` : "";
}

self.onmessage = (e) => {
  const m = e.data || {};
  const t0 = performance.now();
  if (m.kind === "test") {
    const ex = exercise(m.id);
    if (!ex) {
      post({ kind: "error", text: "no such exercise" });
      return;
    }
    post({ kind: "tests", ...runTests(m.code, ex), ms: performance.now() - t0 });
    return;
  }
  if (m.kind === "run") {
    const print = (...args) => post({ kind: "print", text: args.map((a) => (typeof a === "string" ? a : show(a))).join(" ") });
    const plot = (...args) => post({ kind: "plot", spec: plotSpec(args) });
    const table = (rows) => post({ kind: "table", rows: tableRows(rows) });
    try {
      const fn = new Function("print", "plot", "table", "lab", `"use strict";\n${m.code}`);
      const out = fn(print, plot, table, lab);
      if (out !== undefined) print(out);
      post({ kind: "done", ms: performance.now() - t0 });
    } catch (err) {
      post({ kind: "error", text: `${(err && err.name) || "Error"}: ${(err && err.message) || err}${lineOf(err)}` });
    }
  }
};
