// Small SVG charts for the Lab, no library: lines and points on nice axes, a heat map with a path over it, a vector
// field with trajectories, and bars. Colours come from the page's own variables, so both themes follow.

const NS = "http://www.w3.org/2000/svg";
export const COLORS = ["var(--accent)", "var(--ready)", "var(--mastered)", "var(--to-read)", "var(--accent-2)",
  "var(--due)", "var(--muted)"];

export function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  kids.flat().forEach((k) => k !== null && k !== undefined && el.append(k instanceof Node ? k : document.createTextNode(String(k))));
  return el;
}

export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) { min -= 1; max += 1; }
  const span = max - min, raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => span / x <= count + 0.5) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

export const fmt = (v) => {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(1);
  return String(Number(v.toPrecision(4)));
};

function frame(width, height, pad, xd, yd, { xLabel, yLabel } = {}) {
  const [x0, x1] = xd, [y0, y1] = yd;
  const X = (v) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (width - pad.l - pad.r);
  const Y = (v) => height - pad.b - ((v - y0) / (y1 - y0 || 1)) * (height - pad.t - pad.b);
  const g = s("g");
  const grid = s("g", { class: "grid" }), axis = s("g", { class: "axis" });
  for (const t of niceTicks(x0, x1, 6)) {
    grid.append(s("line", { x1: X(t), x2: X(t), y1: pad.t, y2: height - pad.b }));
    axis.append(s("text", { x: X(t), y: height - pad.b + 15, "text-anchor": "middle" }, fmt(t)));
  }
  for (const t of niceTicks(y0, y1, 5)) {
    grid.append(s("line", { x1: pad.l, x2: width - pad.r, y1: Y(t), y2: Y(t) }));
    axis.append(s("text", { x: pad.l - 6, y: Y(t) + 4, "text-anchor": "end" }, fmt(t)));
  }
  axis.append(s("line", { x1: pad.l, x2: width - pad.r, y1: height - pad.b, y2: height - pad.b }));
  axis.append(s("line", { x1: pad.l, x2: pad.l, y1: pad.t, y2: height - pad.b }));
  if (xLabel) axis.append(s("text", { x: (pad.l + width - pad.r) / 2, y: height - 4, "text-anchor": "middle" }, xLabel));
  if (yLabel) axis.append(s("text", { x: 12, y: (pad.t + height - pad.b) / 2, "text-anchor": "middle",
    transform: `rotate(-90 12 ${(pad.t + height - pad.b) / 2})` }, yLabel));
  g.append(grid, axis);
  return { g, X, Y };
}

function extent(values, fallback = [0, 1]) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo === Infinity) return fallback;
  if (lo === hi) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.05;
  return [lo - pad, hi + pad];
}

// series: [{ x, y, label, color, dashed, points }]; hlines: [{ y, label, color }]
export function lineChart({ series, width = 640, height = 280, xLabel, yLabel, xRange, yRange, hlines = [], clip }) {
  const svg = s("svg", { class: "plot", viewBox: `0 0 ${width} ${height}`, role: "img" });
  const xs = series.flatMap((d) => d.x || d.y.map((_, i) => i));
  const ys = series.flatMap((d) => d.y).concat(hlines.map((l) => l.y));
  let yd = yRange || extent(ys);
  if (clip) yd = [Math.max(yd[0], clip[0]), Math.min(yd[1], clip[1])];
  const xd = xRange || extent(xs, [0, 1]).map((v, i) => (xs.length ? (i ? Math.max(...xs.filter(Number.isFinite)) : Math.min(...xs.filter(Number.isFinite))) : v));
  const pad = { l: 52, r: 16, t: 14, b: xLabel ? 40 : 28 };
  const { g, X, Y } = frame(width, height, pad, xd, yd, { xLabel, yLabel });
  svg.append(g);
  const id = `c${Math.random().toString(36).slice(2, 8)}`;
  svg.append(s("clipPath", { id }, s("rect", { x: pad.l, y: pad.t, width: width - pad.l - pad.r, height: height - pad.t - pad.b })));
  const body = s("g", { "clip-path": `url(#${id})` });
  for (const l of hlines) {
    body.append(s("line", { x1: pad.l, x2: width - pad.r, y1: Y(l.y), y2: Y(l.y),
      style: `stroke:${l.color || "var(--muted)"};stroke-dasharray:6 4;stroke-width:1.5` }));
  }
  series.forEach((d, i) => {
    const color = d.color || COLORS[i % COLORS.length];
    const xv = d.x || d.y.map((_, k) => k);
    if (d.points) {
      const gp = s("g", { style: `fill:${color};opacity:${d.opacity ?? 0.55}` });
      d.y.forEach((v, k) => Number.isFinite(v) && Number.isFinite(xv[k]) && gp.append(s("circle", { cx: X(xv[k]), cy: Y(v), r: d.r || 2 })));
      body.append(gp);
      return;
    }
    let path = "", pen = false;
    d.y.forEach((v, k) => {
      if (!Number.isFinite(v) || !Number.isFinite(xv[k])) { pen = false; return; }
      path += `${pen ? "L" : "M"}${X(xv[k]).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true;
    });
    body.append(s("path", { class: "series", d: path, style: `stroke:${color}${d.dashed ? ";stroke-dasharray:6 4" : ""}${d.width ? `;stroke-width:${d.width}` : ""}` }));
  });
  svg.append(body);
  const named = series.filter((d) => d.label).concat(hlines.filter((l) => l.label));
  if (named.length) {
    svg.append(s("rect", { x: width - pad.r - 136, y: pad.t + 2, width: 132, height: named.length * 16 + 6, rx: 6,
      style: "fill:var(--surface);opacity:.88" }));
  }
  named.forEach((d, i) => {
    const color = d.color || COLORS[series.indexOf(d) >= 0 ? series.indexOf(d) % COLORS.length : 6];
    const y = pad.t + 12 + i * 16;
    svg.append(s("rect", { x: width - pad.r - 128, y: y - 9, width: 12, height: 4, rx: 2, style: `fill:${color}` }),
      s("text", { class: "legend-text", x: width - pad.r - 110, y: y - 3 }, d.label));
  });
  return svg;
}

// A heat map of f(x, y) over a box, deeper where f is higher, pale at the bottom of the valley, with an optional path
// drawn over it. The cells meet edge to edge, so no seam shows between them.
export function heatMap({ f, xRange, yRange, path, width = 520, height = 420, n = 56, log = true }) {
  const svg = s("svg", { class: "plot square", viewBox: `0 0 ${width} ${height}`, role: "img" });
  const pad = { l: 44, r: 12, t: 10, b: 28 };
  const { g, X, Y } = frame(width, height, pad, xRange, yRange);
  const cells = s("g", { "shape-rendering": "crispEdges" });
  const vals = [];
  const dx = (xRange[1] - xRange[0]) / n, dy = (yRange[1] - yRange[0]) / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = f(xRange[0] + (i + 0.5) * dx, yRange[0] + (j + 0.5) * dy);
    vals.push(log ? Math.log1p(Math.max(0, v)) : v);
  }
  const [lo, hi] = [Math.min(...vals), Math.max(...vals)];
  let k = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const t = (vals[k++] - lo) / (hi - lo || 1);
    const x0 = X(xRange[0] + i * dx), x1 = X(xRange[0] + (i + 1) * dx);
    const y0 = Y(yRange[0] + (j + 1) * dy), y1 = Y(yRange[0] + j * dy);
    cells.append(s("rect", { x: x0.toFixed(2), y: y0.toFixed(2), width: (x1 - x0).toFixed(2), height: (y1 - y0).toFixed(2),
      style: `fill:color-mix(in srgb, var(--accent) ${(6 + 74 * t).toFixed(1)}%, var(--surface))` }));
  }
  svg.append(cells, g);
  if (path && path.length) {
    const inside = path.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const d = inside.map(([x, y], i) => `${i ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join("");
    svg.append(s("path", { d, style: "fill:none;stroke:var(--ink);stroke-width:2;opacity:.85" }));
    inside.slice(0, 200).forEach(([x, y], i) => svg.append(s("circle", { cx: X(x), cy: Y(y), r: i === 0 ? 5 : 2.4,
      style: `fill:${i === 0 ? "var(--ready)" : "var(--ink)"}` })));
    const last = inside.at(-1);
    if (last) svg.append(s("circle", { cx: X(last[0]), cy: Y(last[1]), r: 5, style: "fill:var(--mastered);stroke:var(--surface);stroke-width:2" }));
  }
  return svg;
}

// A vector field's arrows on a grid, and trajectories over it.
export function vectorField({ field, range = 3, trajectories = [], width = 480, height = 480, n = 17 }) {
  const svg = s("svg", { class: "plot square", viewBox: `0 0 ${width} ${height}`, role: "img" });
  const pad = { l: 36, r: 12, t: 10, b: 26 };
  const { g, X, Y } = frame(width, height, pad, [-range, range], [-range, range]);
  svg.append(g);
  const arrows = s("g", { style: "stroke:var(--muted);stroke-width:1.2;opacity:.7" });
  const step = (2 * range) / (n - 1), len = step * 0.42;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = -range + i * step, y = -range + j * step;
    const [u, v] = field(x, y);
    const m = Math.hypot(u, v);
    if (!m) continue;
    const ex = x + (u / m) * len, ey = y + (v / m) * len;
    arrows.append(s("line", { x1: X(x), y1: Y(y), x2: X(ex), y2: Y(ey) }));
    const ang = Math.atan2(Y(ey) - Y(y), X(ex) - X(x));
    const hx = X(ex), hy = Y(ey);
    arrows.append(s("path", { d: `M${hx},${hy}l${(-5 * Math.cos(ang - 0.45)).toFixed(1)},${(-5 * Math.sin(ang - 0.45)).toFixed(1)}M${hx},${hy}l${(-5 * Math.cos(ang + 0.45)).toFixed(1)},${(-5 * Math.sin(ang + 0.45)).toFixed(1)}`, style: "fill:none" }));
  }
  svg.append(arrows);
  const id = `v${Math.random().toString(36).slice(2, 8)}`;
  svg.append(s("clipPath", { id }, s("rect", { x: pad.l, y: pad.t, width: width - pad.l - pad.r, height: height - pad.t - pad.b })));
  const body = s("g", { "clip-path": `url(#${id})` });
  trajectories.forEach((tr, i) => {
    const d = tr.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
      .map(([x, y], k) => `${k ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join("");
    body.append(s("path", { d, class: "series", style: `stroke:${COLORS[i % 5]}` }));
    if (tr[0]) body.append(s("circle", { cx: X(tr[0][0]), cy: Y(tr[0][1]), r: 3.5, style: `fill:${COLORS[i % 5]}` }));
  });
  svg.append(body);
  return svg;
}

export function bars({ values, labels, expected, width = 520, height = 220 }) {
  const svg = s("svg", { class: "plot", viewBox: `0 0 ${width} ${height}`, role: "img" });
  const pad = { l: 44, r: 12, t: 10, b: 26 };
  const hi = Math.max(...values, expected ?? 0) * 1.1 || 1;
  const { g, Y } = frame(width, height, pad, [0, values.length], [0, hi]);
  svg.append(g);
  const w = (width - pad.l - pad.r) / values.length;
  values.forEach((v, i) => {
    svg.append(s("rect", { x: pad.l + i * w + w * 0.15, y: Y(v), width: w * 0.7, height: Y(0) - Y(v), rx: 4,
      style: "fill:var(--accent);opacity:.85" }));
    svg.append(s("text", { x: pad.l + i * w + w / 2, y: height - 8, "text-anchor": "middle" }, labels ? labels[i] : i + 1));
  });
  if (expected !== undefined) {
    svg.append(s("line", { x1: pad.l, x2: width - pad.r, y1: Y(expected), y2: Y(expected),
      style: "stroke:var(--ink);stroke-dasharray:6 4;stroke-width:1.5" }));
  }
  return svg;
}
