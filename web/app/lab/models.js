// The Lab's models: each a pure function from its settings to what it does, so the page draws it and Node checks it
// against what the theory says. Random ones take a seed, so a run can be repeated exactly.

// mulberry32: small, fast, and the same sequence for the same seed on every machine
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a standard normal draw (Box–Muller)
export function gaussian(r) {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

// ---------------------------------------------------------------- gradient descent
// f(x, y) = (a x² + b y²) / 2, a bowl with curvatures a and b; or Rosenbrock's valley.
export const SURFACES = {
  bowl: {
    f: (x, y, p) => (p.a * x * x + p.b * y * y) / 2,
    grad: (x, y, p) => [p.a * x, p.b * y],
  },
  rosenbrock: {
    f: (x, y) => (1 - x) ** 2 + 100 * (y - x * x) ** 2,
    grad: (x, y) => [-2 * (1 - x) - 400 * x * (y - x * x), 200 * (y - x * x)],
  },
};

export function gradientDescent({ surface = "bowl", a = 1, b = 10, lr = 0.05, start = [2, 1], steps = 100 }) {
  const s = SURFACES[surface] || SURFACES.bowl;
  const p = { a, b };
  let [x, y] = start;
  const path = [[x, y]], values = [s.f(x, y, p)];
  for (let i = 0; i < steps; i++) {
    const [gx, gy] = s.grad(x, y, p);
    x -= lr * gx;
    y -= lr * gy;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e12 || Math.abs(y) > 1e12) {
      path.push([x, y]);
      values.push(Infinity);
      break;
    }
    path.push([x, y]);
    values.push(s.f(x, y, p));
  }
  return { path, values, f: (u, v) => s.f(u, v, p) };
}

// ---------------------------------------------------------------- xdot = Ax
export function eig2(a, b, c, d) {
  const tr = a + d, det = a * d - b * c, disc = (tr * tr) / 4 - det;
  if (disc >= 0) {
    const r = Math.sqrt(disc);
    return [{ re: tr / 2 + r, im: 0 }, { re: tr / 2 - r, im: 0 }];
  }
  const w = Math.sqrt(-disc);
  return [{ re: tr / 2, im: w }, { re: tr / 2, im: -w }];
}

export function classify2x2(a, b, c, d) {
  const eps = 1e-12;
  const tr = a + d, det = a * d - b * c, disc = (tr * tr) / 4 - det;
  const eig = eig2(a, b, c, d);
  let kind;
  if (det < -eps) kind = "saddle";
  else if (Math.abs(det) <= eps) kind = "degenerate";
  else if (disc < -eps) kind = Math.abs(tr) <= eps ? "center" : tr < 0 ? "stable spiral" : "unstable spiral";
  else kind = tr < 0 ? "stable node" : "unstable node";
  return { kind, eig, trace: tr, det, stable: eig.every((e) => e.re < -eps) };
}

// a trajectory of xdot = Ax by fourth-order Runge–Kutta
export function linearTrajectory(a, b, c, d, x0, dt, steps) {
  const f = ([x, y]) => [a * x + b * y, c * x + d * y];
  const out = [x0.slice()];
  let s = x0.slice();
  for (let i = 0; i < steps; i++) {
    const k1 = f(s);
    const k2 = f([s[0] + (dt / 2) * k1[0], s[1] + (dt / 2) * k1[1]]);
    const k3 = f([s[0] + (dt / 2) * k2[0], s[1] + (dt / 2) * k2[1]]);
    const k4 = f([s[0] + dt * k3[0], s[1] + dt * k3[1]]);
    s = [s[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), s[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])];
    out.push(s);
    if (Math.hypot(s[0], s[1]) > 1e6) break;
  }
  return out;
}

// ---------------------------------------------------------------- PID
// A first-order plant, tau y' = -y + K u, under u = kp e + ki ∫e − kd y' (the derivative on the measurement, so a step
// in the setpoint gives no kick), stepped by Euler.
export function pid({ kp = 1, ki = 0, kd = 0, plantGain = 1, tau = 1, dt = 0.01, t = 10, setpoint = 1, uMax = Infinity }) {
  const n = Math.round(t / dt);
  const ts = [0], ys = [0], us = [0];
  let y = 0, integral = 0, prevY = 0;
  for (let i = 1; i <= n; i++) {
    const e = setpoint - y;
    integral += e * dt;
    const dy = (y - prevY) / dt;
    let u = kp * e + ki * integral - kd * dy;
    if (Number.isFinite(uMax)) u = Math.max(-uMax, Math.min(uMax, u));
    prevY = y;
    y += (dt / tau) * (-y + plantGain * u);
    ts.push(i * dt);
    ys.push(y);
    us.push(u);
  }
  const peak = Math.max(...ys);
  const band = 0.02 * Math.abs(setpoint);
  let settle = 0;
  for (let i = ys.length - 1; i >= 0; i--) if (Math.abs(ys[i] - setpoint) > band) { settle = ts[Math.min(i + 1, ts.length - 1)]; break; }
  const at = (frac) => ts[ys.findIndex((v) => v >= frac * setpoint)] ?? null;
  const r10 = at(0.1), r90 = at(0.9);
  return {
    t: ts, y: ys, u: us,
    metrics: {
      overshoot: Math.max(0, (peak - setpoint) / setpoint), settling: settle,
      rise: r10 !== null && r90 !== null ? r90 - r10 : null, steadyError: Math.abs(setpoint - ys.at(-1)),
    },
  };
}

// ---------------------------------------------------------------- Kalman
// A random walk seen through noise: x' = x + w, w ~ N(0, q); z = x + v, v ~ N(0, r).
export function kalman1d({ q = 0.01, r = 1, steps = 100, seed = 1, x0 = 0, p0 = 1 }) {
  const rand = rng(seed);
  let truth = x0, x = 0, P = p0;
  const out = { truth: [], measured: [], estimate: [], gain: [], variance: [] };
  for (let k = 0; k < steps; k++) {
    truth += Math.sqrt(q) * gaussian(rand);
    const z = truth + Math.sqrt(r) * gaussian(rand);
    P += q;                                   // predict
    const K = P / (P + r);                    // update
    x += K * (z - x);
    P *= 1 - K;
    out.truth.push(truth);
    out.measured.push(z);
    out.estimate.push(x);
    out.gain.push(K);
    out.variance.push(P);
  }
  return out;
}

// where the gain settles: the prior variance M solves M² − qM − qr = 0, and K = M / (M + r)
export function kalmanSteadyGain(q, r) {
  const M = (q + Math.sqrt(q * q + 4 * q * r)) / 2;
  return M / (M + r);
}

// ---------------------------------------------------------------- value iteration
// A grid of rows: S start, . empty, G goal (+1, ends), P pit (−1, ends), # wall. Moves are up, right, down, left; with
// `slip`, a move goes to either side instead, half of `slip` each. A move into a wall or off the grid stays put.
export const MOVES = { up: [-1, 0], right: [0, 1], down: [1, 0], left: [0, -1] };
const SIDES = { up: ["left", "right"], down: ["left", "right"], left: ["up", "down"], right: ["up", "down"] };

// the grid world's rules: its cells, which end an episode, and the value of a move under values V
function gridWorld({ grid, gamma = 0.9, slip = 0, stepReward = 0 }) {
  const rows = grid.length, cols = Math.max(...grid.map((r) => r.length));
  const cell = (i, j) => (i >= 0 && i < rows && j >= 0 && j < cols ? grid[i][j] || "#" : "#");
  const terminal = (i, j) => cell(i, j) === "G" || cell(i, j) === "P";
  const reward = (i, j) => (cell(i, j) === "G" ? 1 : cell(i, j) === "P" ? -1 : stepReward);
  const move = (i, j, m) => {
    const [di, dj] = MOVES[m];
    return cell(i + di, j + dj) === "#" ? [i, j] : [i + di, j + dj];
  };
  const outcomes = (i, j, m) => {
    const list = [[1 - slip, move(i, j, m)]];
    if (slip > 0) for (const s of SIDES[m]) list.push([slip / 2, move(i, j, s)]);
    return list;
  };
  const q = (V, i, j, m) => outcomes(i, j, m).reduce((s, [p, [a, b]]) => s + p * (reward(a, b) + gamma * V[a][b]), 0);
  return { rows, cols, cell, terminal, q };
}

// the move each cell would take if the values V were true; null where no move is made
export function greedyPolicy(params, V) {
  const { cell, terminal, q } = gridWorld(params);
  return V.map((r, i) => r.map((_, j) => {
    if (cell(i, j) === "#" || terminal(i, j)) return null;
    let best = null, bestQ = -Infinity;
    for (const m of Object.keys(MOVES)) {
      const v = q(V, i, j, m);
      if (v > bestQ + 1e-12) { bestQ = v; best = m; }
    }
    return best;
  }));
}

export function valueIteration({ grid, gamma = 0.9, slip = 0, stepReward = 0, tol = 1e-6, maxSweeps = 500 }) {
  const { rows, cols, cell, terminal, q } = gridWorld({ grid, gamma, slip, stepReward });
  let V = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const sweeps = [V.map((r) => r.slice())];
  let converged = false;
  for (let k = 0; k < maxSweeps; k++) {
    let delta = 0;
    const next = V.map((r) => r.slice());
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        if (cell(i, j) === "#" || terminal(i, j)) continue;
        const best = Math.max(...Object.keys(MOVES).map((m) => q(V, i, j, m)));
        delta = Math.max(delta, Math.abs(best - V[i][j]));
        next[i][j] = best;
      }
    }
    V = next;
    sweeps.push(V.map((r) => r.slice()));
    if (delta <= tol) {
      converged = true;
      break;
    }
  }
  const policy = greedyPolicy({ grid, gamma, slip, stepReward }, V);
  return { V, policy, sweeps, converged, rows, cols, cell };
}

// ---------------------------------------------------------------- bandits
// k arms with normal rewards around `means`; epsilon-greedy on sample averages, ties broken at random.
export function bandit({ means = [0.2, 0.5, 0.8], sd = 1, eps = 0.1, steps = 1000, seed = 1 }) {
  const rand = rng(seed);
  const k = means.length;
  const Q = new Array(k).fill(0), N = new Array(k).fill(0);
  const best = means.indexOf(Math.max(...means));
  let total = 0, optimal = 0;
  const avgReward = [], optimalShare = [];
  for (let t = 1; t <= steps; t++) {
    let a;
    if (rand() < eps) a = Math.floor(rand() * k);
    else {
      const top = Math.max(...Q);
      const ties = Q.map((v, i) => (v === top ? i : -1)).filter((i) => i >= 0);
      a = ties[Math.floor(rand() * ties.length)];
    }
    const r = means[a] + sd * gaussian(rand);
    N[a]++;
    Q[a] += (r - Q[a]) / N[a];
    total += r;
    if (a === best) optimal++;
    avgReward.push(total / t);
    optimalShare.push(optimal / t);
  }
  return { avgReward, optimalShare, estimates: Q, counts: N, best };
}

// ---------------------------------------------------------------- the law of large numbers
export function largeNumbers({ sides = 6, n = 1000, seed = 1 }) {
  const rand = rng(seed);
  let sum = 0;
  const mean = [];
  const counts = new Array(sides).fill(0);
  for (let i = 1; i <= n; i++) {
    const roll = 1 + Math.floor(rand() * sides);
    counts[roll - 1]++;
    sum += roll;
    mean.push(sum / i);
  }
  return { mean, counts, expected: (sides + 1) / 2 };
}
