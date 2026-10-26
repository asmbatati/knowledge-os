// Geometric PD control on SO(3) as a rotor held by three springs: the numbers every part of the figure reads.
// A ball on a pivot carries three pins, its body axes; pin i is tied by a zero-length spring to an eye on its post at
// home direction e_i. The springs store Σ k_i ρρ'(1 − R_ii) + const, which is k_p Ψ with Ψ = ½ tr(G(I − R)) when
// k_i ρρ' = k_p g_i / 2: the springs' stiffnesses are the co-stiffness G. Oil in the pivot's cup is K_d = k_d I. The
// vault's note "With a scalar gain every half-turn is an equilibrium of PD control on SO(3) …" gives J = diag(1, 2, 3),
// k_p = 4, K_d = 3I and its worked example's table, which the selftest checks.

export const NOTE = { J: [1, 2, 3], kp: 4, kd: 3 };
export const GAINS = { scalar: [1, 1, 1], weighted: [1, 2, 3] };
const s3 = 1 / 3;
export const STARTS = [
  { n: [s3, 2 * s3, 2 * s3], angle: Math.PI, name: "a half-turn about (1, 2, 2)/3" },
  { n: [0, 0, 1], angle: Math.PI, name: "the half-turn about axis 3" },
  { n: [0, 1, 0], angle: Math.PI, name: "the half-turn about axis 2" },
  { n: [1, 0, 0], angle: Math.PI, name: "the half-turn about axis 1" },
  { n: [0, 0, 1], angle: Math.PI / 2, name: "90° about axis 3" },
];

export function quatOf(n, angle) {
  const s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), n[0] * s, n[1] * s, n[2] * s];
}

export function rotOf(q) {
  const [w, x, y, z] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

// e = sk(G R)^∨ with sk(A) = ½(A − Aᵀ): the gradient of Ψ in body coordinates.
export function errorOf(R, g) {
  return [
    0.5 * (g[2] * R[2][1] - g[1] * R[1][2]),
    0.5 * (g[0] * R[0][2] - g[2] * R[2][0]),
    0.5 * (g[1] * R[1][0] - g[0] * R[0][1]),
  ];
}

export function psiOf(R, g) {
  return 0.5 * (g[0] * (1 - R[0][0]) + g[1] * (1 - R[1][1]) + g[2] * (1 - R[2][2]));
}

export function angleOf(R) {
  return Math.acos(Math.min(1, Math.max(-1, (R[0][0] + R[1][1] + R[2][2] - 1) / 2)));
}

// The closed loop: J ω̇ = Jω × ω − k_p e − k_d ω, q̇ = ½ q ⊗ (0, ω), ω in body coordinates.
export function rateOf(q, w, g, note) {
  const R = rotOf(q);
  const e = errorOf(R, g);
  const J = note.J;
  const h = [J[0] * w[0], J[1] * w[1], J[2] * w[2]];
  const gyro = [h[1] * w[2] - h[2] * w[1], h[2] * w[0] - h[0] * w[2], h[0] * w[1] - h[1] * w[0]];
  const dw = [0, 1, 2].map((i) => (gyro[i] - note.kp * e[i] - note.kd * w[i]) / J[i]);
  const [qw, qx, qy, qz] = q;
  const dq = [
    0.5 * (-qx * w[0] - qy * w[1] - qz * w[2]),
    0.5 * (qw * w[0] + qy * w[2] - qz * w[1]),
    0.5 * (qw * w[1] + qz * w[0] - qx * w[2]),
    0.5 * (qw * w[2] + qx * w[1] - qy * w[0]),
  ];
  return { dq, dw };
}

export function stepOf(state, g, dt, note) {
  const add = (a, b, s) => a.map((v, i) => v + b[i] * s);
  const k1 = rateOf(state.q, state.w, g, note);
  const k2 = rateOf(add(state.q, k1.dq, dt / 2), add(state.w, k1.dw, dt / 2), g, note);
  const k3 = rateOf(add(state.q, k2.dq, dt / 2), add(state.w, k2.dw, dt / 2), g, note);
  const k4 = rateOf(add(state.q, k3.dq, dt), add(state.w, k3.dw, dt), g, note);
  const q = state.q.map((v, i) => v + (dt / 6) * (k1.dq[i] + 2 * k2.dq[i] + 2 * k3.dq[i] + k4.dq[i]));
  const w = state.w.map((v, i) => v + (dt / 6) * (k1.dw[i] + 2 * k2.dw[i] + 2 * k3.dw[i] + k4.dw[i]));
  const norm = Math.hypot(...q);
  return { q: q.map((v) => v / norm), w };
}

export function release(start) {
  return { q: quatOf(start.n, start.angle), w: [0, 0, 0] };
}

// Seconds until the rotor is within `degrees` of home, or Infinity within `limit` seconds.
export function timeTo(start, g, degrees = 1, limit = 60, dt = 1e-3) {
  let state = release(start);
  for (let t = 0; t <= limit; t += dt) {
    if ((angleOf(rotOf(state.q)) * 180) / Math.PI < degrees) return t;
    state = stepOf(state, g, dt, NOTE);
  }
  return Infinity;
}

function selftest() {
  const near = (a, b, tol, what) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: ${a} is not ${b}`); };
  const S = GAINS.scalar, W = GAINS.weighted;
  // The note's table: scalar gain, released at rest about z, time to 1°.
  [[90, 2.33], [179, 8.1], [179.9, 11.13]].forEach(([deg, secs]) =>
    near(timeTo({ n: [0, 0, 1], angle: (deg * Math.PI) / 180 }, S), secs, 0.006, `scalar, ${deg}° about z, time to 1°`));
  // Every half-turn is a rest point of the scalar law.
  let worst = 0;
  for (let i = 0; i < 1000; i++) {
    const v = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    const n = v.map((x) => x / Math.hypot(...v));
    worst = Math.max(worst, Math.hypot(...errorOf(rotOf(quatOf(n, Math.PI)), S)));
  }
  near(worst, 0, 1e-14, "|e| at 1,000 half-turns, scalar gain");
  // Weighted: the three half-turns about the axes are rest points at Ψ = g_j + g_k; any other is not.
  [[2, 3], [1, 4], [0, 5]].forEach(([axis, psi]) => {
    const n = [0, 0, 0]; n[axis] = 1;
    const R = rotOf(quatOf(n, Math.PI));
    near(psiOf(R, W), psi, 1e-12, `Ψ at the half-turn about e${axis + 1}`);
    near(Math.hypot(...errorOf(R, W)), 0, 1e-14, `e at the half-turn about e${axis + 1}`);
  });
  const generic = rotOf(release(STARTS[0]).q);
  if (Math.hypot(...errorOf(generic, W)) < 0.1) throw new Error("the weighted law should push off a general half-turn");
  // Near the goal Ψ is a rotational spring of stiffness K = ½(tr G · I − G) = diag(2.5, 2, 1.5): about axis i, the
  // other two springs, ½(g_j + g_k). The note's table lists the same three values sorted.
  [2.5, 2, 1.5].forEach((K, i) => {
    const n = [0, 0, 0]; n[i] = 1;
    near((2 * psiOf(rotOf(quatOf(n, 1e-3)), W)) / 1e-6, K, 1e-5, `stiffness about e${i + 1}`);
  });
  // Released exactly on a general half-turn: the scalar law holds it, the weighted law brings it home.
  let held = release(STARTS[0]);
  for (let t = 0; t < 8; t += 1e-3) held = stepOf(held, S, 1e-3, NOTE);
  near((angleOf(rotOf(held.q)) * 180) / Math.PI, 180, 1e-6, "scalar, on a general half-turn, after 8 s");
  const home = timeTo(STARTS[0], W);
  if (!(home < 15)) throw new Error(`weighted, from a general half-turn: ${home} s to 1°`);
  // V̇ = −ωᵀ K_d ω along a trajectory from a spun, tilted start.
  const V = (s, g) => 0.5 * NOTE.J.reduce((sum, J, i) => sum + J * s.w[i] * s.w[i], 0) + NOTE.kp * psiOf(rotOf(s.q), g);
  let s = { q: quatOf([0.6, 0, 0.8], 2.5), w: [0.7, -0.4, 0.3] };
  for (let i = 0; i < 6; i++) {
    for (let t = 0; t < 0.5; t += 1e-3) s = stepOf(s, W, 1e-3, NOTE);
    const h = 1e-4, a = stepOf(s, W, h, NOTE), b = stepOf(s, W, -h, NOTE);
    near((V(a, W) - V(b, W)) / (2 * h), -NOTE.kd * Math.hypot(...s.w) ** 2, 1e-6, "V̇ = −ωᵀK_dω");
  }
  // The drawn machine is the controller: the three springs' torque on the pins is −k_p e.
  for (let i = 0; i < 200; i++) {
    const v = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    const R = rotOf(quatOf(v.map((x) => x / Math.hypot(...v)), Math.random() * Math.PI));
    const tau = springTorque(R, W);
    const e = errorOf(R, W);
    tau.forEach((t, j) => near(t, -NOTE.kp * e[j], 1e-12, "the springs' torque is −k_p e"));
  }
  console.log(`model selftest passed: the note's 2.33, 8.10 and 11.13 s; Ψ 3, 4, 5 at the three half-turns; weighted home from (1, 2, 2)/3 in ${home.toFixed(2)} s`);
}

// Body-frame torque of zero-length springs k_i (k_i ρρ' = k_p g_i / 2) from pin tips ρ R e_i to eyes ρ' e_i.
export function springTorque(R, g, rho = 1, rhoEye = 1.2) {
  const tau = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const k = (NOTE.kp * g[i]) / (2 * rho * rhoEye);
    const tip = [R[0][i] * rho, R[1][i] * rho, R[2][i] * rho];
    const f = [0, 1, 2].map((j) => k * ((j === i ? rhoEye : 0) - tip[j]));
    const t = [tip[1] * f[2] - tip[2] * f[1], tip[2] * f[0] - tip[0] * f[2], tip[0] * f[1] - tip[1] * f[0]];
    for (let j = 0; j < 3; j++) tau[j] += R[0][j] * t[0] + R[1][j] * t[1] + R[2][j] * t[2];
  }
  return tau;
}

if (process.argv[1] && process.argv[1].endsWith("model.mjs") && process.argv.includes("--selftest")) selftest();
