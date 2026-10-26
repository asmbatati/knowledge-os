// The road map's graph: a place for every concept in its layer's column, fewer crossings, what each concept rests on
// and opens, and what comes next.
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutGraph, crossings } from "../../web/app/graph/layout.js";
import { closure, comingNext, indexEdges } from "../../web/app/graph/next.js";

const nodes = [
  { name: "A", layer: 0, status: "mastered" }, { name: "B", layer: 0, status: "mastered" },
  { name: "C", layer: 1, status: "ready" }, { name: "D", layer: 1, status: "ready" },
  { name: "E", layer: 2, status: "locked" }, { name: "F", layer: 2, status: "locked", goal: true },
  { name: "G", layer: 3, status: "locked" },
];
// [prerequisite, concept]: B opens C, A opens D, C opens E and F, D opens F, E and A open G (an edge across layers)
const edges = [["B", "C"], ["A", "D"], ["C", "E"], ["D", "F"], ["C", "F"], ["E", "G"], ["A", "G"]];

test("every concept has a place in its layer's column, and none overlap", () => {
  const L = layoutGraph(nodes, edges, { colW: 200, rowH: 40 });
  for (const n of nodes) assert.ok(L.pos.has(n.name), n.name);
  assert.equal(L.pos.get("A").x, L.pos.get("B").x, "one layer, one column");
  assert.equal(L.pos.get("C").x - L.pos.get("A").x, 200);
  const seen = new Set();
  for (const n of nodes) {
    const p = L.pos.get(n.name);
    const key = `${p.x},${p.y}`;
    assert.ok(!seen.has(key), "no two concepts in one place");
    seen.add(key);
  }
  assert.ok(L.width >= 3 * 200 && L.height > 0);
});

test("the order within each layer is chosen to cross fewer edges", () => {
  const L = layoutGraph(nodes, edges);
  assert.equal(crossings(L.order, edges), 0);
  const naive = new Map([[0, ["A", "B"]], [1, ["C", "D"]], [2, ["E", "F"]], [3, ["G"]]]);
  assert.ok(crossings(naive, edges) > 0, "the order the concepts came in crosses");
});

test("the layout is the same every time", () => {
  const a = layoutGraph(nodes, edges);
  const b = layoutGraph([...nodes].reverse(), [...edges].reverse());
  for (const n of nodes) assert.deepEqual(a.pos.get(n.name), b.pos.get(n.name));
});

test("what a concept rests on, and what it opens, all the way", () => {
  const idx = indexEdges(edges);
  assert.deepEqual([...closure(idx, "F", "up")].sort(), ["A", "B", "C", "D"]);
  assert.deepEqual([...closure(idx, "C", "down")].sort(), ["E", "F", "G"]);
  assert.deepEqual([...closure(idx, "A", "up")], []);
});

test("what comes next: ready first, then by how many concepts still stand in the way", () => {
  const next = comingNext(nodes, edges);
  assert.deepEqual(next.map((x) => [x.name, x.waiting]), [["C", 0], ["D", 0], ["E", 1], ["F", 2], ["G", 2]]);
  assert.deepEqual(next.find((x) => x.name === "F").blockers, ["C", "D"]);
  assert.ok(!next.some((x) => x.name === "A"), "what is mastered has come already");
});
