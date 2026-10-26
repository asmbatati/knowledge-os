// Places the road's concepts for the map: a column per layer, and within each column an order chosen to cross fewer
// edges (barycentre sweeps, down then up, keeping the best order found). The same graph always gives the same picture.
// Pure: no DOM, so Node tests it.

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

// How many pairs of edges cross between neighbouring columns, for an order (layer -> names, top to bottom).
// An edge that skips a column is not counted: it is drawn as a curve around the columns between.
export function crossings(order, edges) {
  const where = new Map();
  const layers = [...order.keys()].sort((a, b) => a - b);
  layers.forEach((L, col) => order.get(L).forEach((n, i) => where.set(n, { col, i })));
  const byCol = new Map();
  for (const [a, b] of edges) {
    const p = where.get(a), q = where.get(b);
    if (!p || !q || q.col !== p.col + 1) continue;
    push(byCol, p.col, [p.i, q.i]);
  }
  let count = 0;
  for (const list of byCol.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const [u1, v1] = list[x], [u2, v2] = list[y];
        if ((u1 - u2) * (v1 - v2) < 0) count++;
      }
    }
  }
  return count;
}

const copy = (order) => new Map([...order].map(([L, list]) => [L, list.slice()]));

export function layoutGraph(nodes, edges, { colW = 230, rowH = 34, padX = 24, padY = 48, sweeps = 8 } = {}) {
  const names = new Set(nodes.map((n) => n.name));
  const layerOf = new Map(nodes.map((n) => [n.name, n.layer]));
  const layers = [...new Set(nodes.map((n) => n.layer))].sort((a, b) => a - b);
  const order = new Map(layers.map((L) => [L, nodes.filter((n) => n.layer === L).map((n) => n.name).sort(cmp)]));
  const preds = new Map(), succs = new Map();
  for (const [a, b] of edges) {
    if (!names.has(a) || !names.has(b)) continue;
    push(preds, b, a);
    push(succs, a, b);
  }
  const rank = new Map();
  const place = (list) => list.forEach((n, i) => rank.set(n, list.length > 1 ? i / (list.length - 1) : 0.5));
  for (const list of order.values()) place(list);
  const sweep = (seq, neighbours) => {
    for (const L of seq) {
      const list = order.get(L);
      const centre = new Map(list.map((n) => {
        const ns = neighbours.get(n) || [];
        return [n, ns.length ? ns.reduce((s, m) => s + rank.get(m), 0) / ns.length : rank.get(n)];
      }));
      list.sort((a, b) => centre.get(a) - centre.get(b) || cmp(a, b));
      place(list);
    }
  };
  let best = copy(order), bestCount = crossings(order, edges);
  for (let i = 0; i < sweeps && bestCount > 0; i++) {
    sweep(layers.slice(1), preds);
    sweep(layers.slice(0, -1).reverse(), succs);
    const c = crossings(order, edges);
    if (c < bestCount) {
      bestCount = c;
      best = copy(order);
    }
  }
  const tallest = Math.max(1, ...[...best.values()].map((l) => l.length));
  const pos = new Map();
  layers.forEach((L, col) => {
    const list = best.get(L);
    const top = padY + ((tallest - list.length) / 2) * rowH;
    list.forEach((n, i) => pos.set(n, { x: padX + col * colW, y: top + i * rowH, layer: layerOf.get(n), col, index: i }));
  });
  return {
    pos, order: best, layers, colW, rowH, crossings: bestCount,
    width: padX * 2 + Math.max(1, layers.length) * colW, height: padY + tallest * rowH + padY / 2,
  };
}
