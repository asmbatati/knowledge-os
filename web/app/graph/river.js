// The river's geometry: where a year falls, which years to mark, and which row a label takes so that none overlap.
// Pure functions, tested in Node (tests/js/river.test.mjs). A year is negative for BC and has no zero (as in the vault's
// `introduced` field, CLAUDE.md §8.6).

// The log scale puts the present at the right and lets the past recede: a century near now is wide, a century in
// antiquity narrow. `now` is the year at the right edge.
export function makeScale({ min, max, width, mode = "log", now = new Date().getFullYear() }) {
  const right = Math.max(max, now);
  const left = Math.min(min, right - 1);
  if (mode === "linear") {
    const span = right - left || 1;
    const x = (y) => ((y - left) / span) * width;
    return { x, left, right, mode };
  }
  const bp = (y) => right + 1 - y;                       // years before the right edge, at least 1
  const tmax = Math.log(bp(left));
  const x = (y) => width * (1 - Math.log(Math.max(1, bp(y))) / tmax);
  return { x, left, right, mode };
}

const NICE = [-3000, -2000, -1000, -500, -300, -100, 1, 200, 500, 800, 1000, 1200, 1400, 1500, 1600, 1700, 1750, 1800,
  1850, 1900, 1925, 1950, 1970, 1980, 1990, 2000, 2010, 2020];

// The years to mark on the axis: the nice ones in range, none closer than `minGap` pixels to the last kept.
export function ticks(scale, minGap = 48) {
  const out = [];
  let last = -Infinity;
  for (const y of NICE) {
    if (y < scale.left || y > scale.right) continue;
    const x = scale.x(y);
    if (x - last >= minGap) { out.push({ year: y, x }); last = x; }
  }
  return out;
}

export function yearText(y) {
  return y < 0 ? `${-y} BC` : String(y);
}

// Rough width of a label in pixels; the page measures nothing before it draws.
export function labelWidth(label, px = 6.4, max = 220) {
  return Math.min(max, 12 + px * String(label || "").length);
}

// Give each item a row inside its lane: the first row whose last label ends before this one starts.
// items: [{ lane, x0, x1 }]; returns { rows: Map(item -> row), height: Map(lane -> rows used) }.
export function packRows(items, gap = 6) {
  const rows = new Map();
  const ends = new Map();                                 // lane -> [last x1 per row]
  const sorted = [...items].sort((a, b) => a.x0 - b.x0);
  for (const it of sorted) {
    const lane = ends.get(it.lane) || [];
    let r = lane.findIndex((end) => end + gap <= it.x0);
    if (r < 0) { r = lane.length; lane.push(it.x1); } else lane[r] = it.x1;
    ends.set(it.lane, lane);
    rows.set(it, r);
  }
  const height = new Map([...ends].map(([k, v]) => [k, v.length]));
  return { rows, height };
}
