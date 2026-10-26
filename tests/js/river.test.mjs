// The river's geometry: the log scale keeps time's order and widens the recent past; ticks never crowd; labels in
// one lane never overlap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeScale, ticks, packRows, labelWidth, yearText } from "../../web/app/graph/river.js";

test("both scales keep time's order and span the width", () => {
  for (const mode of ["log", "linear"]) {
    const s = makeScale({ min: -440, max: 2020, width: 1000, mode, now: 2026 });
    const xs = [-440, 1, 1000, 1687, 1900, 2000, 2026].map(s.x);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], `${mode}: later is further right`);
    assert.ok(Math.abs(s.x(s.left)) < 1e-6, `${mode}: the left edge is 0`);
    assert.ok(Math.abs(s.x(2026) - 1000) < 2, `${mode}: now is at the right edge`);
  }
});

test("the log scale widens the recent past", () => {
  const s = makeScale({ min: -440, max: 2020, width: 1000, mode: "log", now: 2026 });
  const recent = s.x(2020) - s.x(1920), ancient = s.x(-300) - s.x(-400);
  assert.ok(recent > 5 * ancient, `a recent century (${recent.toFixed(0)}) is far wider than an ancient one (${ancient.toFixed(0)})`);
});

test("a field with one year still has a scale", () => {
  const s = makeScale({ min: 1687, max: 1687, width: 500, now: 2026 });
  assert.ok(Number.isFinite(s.x(1687)));
});

test("ticks are in range, in order, and never closer than the gap", () => {
  const s = makeScale({ min: -440, max: 2020, width: 900, mode: "log", now: 2026 });
  const tk = ticks(s, 48);
  assert.ok(tk.length >= 4);
  for (let i = 1; i < tk.length; i++) {
    assert.ok(tk[i].x - tk[i - 1].x >= 48);
    assert.ok(tk[i].year > tk[i - 1].year);
  }
  assert.equal(yearText(-440), "440 BC");
  assert.equal(yearText(1687), "1687");
});

test("labels in a lane never overlap, and lanes pack apart", () => {
  const items = [
    { lane: "ideas", x0: 0, x1: 100 }, { lane: "ideas", x0: 50, x1: 150 }, { lane: "ideas", x0: 120, x1: 200 },
    { lane: "ideas", x0: 210, x1: 300 }, { lane: "people", x0: 0, x1: 100 },
  ];
  const { rows, height } = packRows(items, 6);
  const byRow = new Map();
  for (const it of items) {
    const key = `${it.lane}:${rows.get(it)}`;
    for (const o of byRow.get(key) || []) assert.ok(it.x0 >= o.x1 + 6 || o.x0 >= it.x1 + 6, "no overlap in a row");
    byRow.set(key, [...(byRow.get(key) || []), it]);
  }
  assert.equal(height.get("ideas"), 2);
  assert.equal(height.get("people"), 1);
  assert.ok(labelWidth("x".repeat(500)) <= 220);
});
