// What a concept rests on and what it opens, all the way down and up the road, and what comes next: every concept not
// yet mastered, ordered by how many concepts still stand in its way. Pure.

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// what stands: granted axioms, provisional (placed), passed and mastered concepts (Learning System Improvement Plan
// 2026-10, decisions 1-3)
export const STANDING = new Set(["granted", "provisional", "passed", "mastered"]);

// edges are [prerequisite, concept]
export function indexEdges(edges) {
  const up = new Map(), down = new Map();
  for (const [a, b] of edges) {
    if (!up.has(b)) up.set(b, []);
    up.get(b).push(a);
    if (!down.has(a)) down.set(a, []);
    down.get(a).push(b);
  }
  return { up, down };
}

// Every concept reached from `name` going up (what it rests on) or down (what it opens), not counting itself.
export function closure(idx, name, dir) {
  const next = dir === "up" ? idx.up : idx.down;
  const seen = new Set();
  const stack = [...(next.get(name) || [])];
  while (stack.length) {
    const x = stack.pop();
    if (seen.has(x) || x === name) continue;
    seen.add(x);
    for (const y of next.get(x) || []) stack.push(y);
  }
  return seen;
}

export function comingNext(nodes, edges) {
  const idx = indexEdges(edges);
  const status = new Map(nodes.map((n) => [n.name, n.status]));
  const out = [];
  for (const n of nodes) {
    if (STANDING.has(n.status)) continue;
    const blockers = [...closure(idx, n.name, "up")].filter((m) => status.has(m) && !STANDING.has(status.get(m))).sort(cmp);
    out.push({ name: n.name, layer: n.layer, status: n.status, goal: !!n.goal, due: !!n.due, waiting: blockers.length,
      blockers });
  }
  out.sort((a, b) => a.waiting - b.waiting || a.layer - b.layer || cmp(a.name, b.name));
  return out;
}
