// The forced vibration bench, as a pure model: the numbers every part of the figure reads.
// A crank of throw Y moves the far end of the spring by y = Y cos(θ), θ' = ω; the dashpot runs from the mass to the
// base. Then m x'' + c x' + k x = k Y cos(ωt): the force of the vault's Resonance Frequency note, with F0 = kY, so
// the static deflection F0/k is the throw itself and X/Y is the note's X/(F0/k).

export const RIG = { m: 2, k: 800, throw: 6, zetas: [0.1, 0.2, 0.3, 0.5], omega: [6, 34], travel: 38 };

export const omegaN = (rig = RIG) => Math.sqrt(rig.k / rig.m);
export const dampingOf = (zeta, rig = RIG) => 2 * zeta * Math.sqrt(rig.k * rig.m);

export function steady(omega, zeta, rig = RIG) {
  const q = omega / omegaN(rig);
  const ratio = 1 / Math.hypot(1 - q * q, 2 * zeta * q);
  const lag = Math.atan2(2 * zeta * q, 1 - q * q);
  return { q, ratio, lag, amplitude: ratio * rig.throw };
}

export function peakOf(zeta, rig = RIG) {
  if (zeta >= Math.SQRT1_2) return { omega: 0, ratio: 1 };
  return { omega: omegaN(rig) * Math.sqrt(1 - 2 * zeta * zeta), ratio: 1 / (2 * zeta * Math.sqrt(1 - zeta * zeta)) };
}

export function advance(state, dt, omega, zeta, rig = RIG, steps = 8) {
  const c = dampingOf(zeta, rig);
  let { x, v, theta } = state;
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    theta += omega * h;
    const y = rig.throw * Math.cos(theta);
    v += ((-c * v - rig.k * (x - y)) / rig.m) * h;
    x += v * h;
    if (Math.abs(x) > rig.travel) { x = Math.sign(x) * rig.travel; v = 0; }
  }
  return { x, v, theta: theta % (Math.PI * 2) };
}

function selftest() {
  const near = (a, b, tol, what) => { if (Math.abs(a - b) > tol) throw new Error(`${what}: ${a} is not ${b}`); };
  near(omegaN(), 20, 1e-12, "omega_n");
  near(dampingOf(0.1), 8, 1e-12, "c at zeta 0.1");
  const peak = peakOf(0.1);
  near(peak.omega, 19.799, 5e-4, "peak frequency (note: 19.8 rad/s)");
  near(Math.round(peak.ratio * 100) / 100, 5.03, 1e-9, "peak ratio (note: 5.03)");
  near(steady(peak.omega, 0.1).ratio, peak.ratio, 1e-9, "steady ratio at the peak");
  near(steady(20, 0.1).lag, Math.PI / 2, 1e-12, "lag at omega_n");
  near(steady(1e-6, 0.1).ratio, 1, 1e-9, "quasi-static ratio");
  let s = { x: 0, v: 0, theta: 0 }, top = 0;
  for (let t = 0; t < 12; t += 1 / 240) { s = advance(s, 1 / 240, peak.omega, 0.1); if (t > 9) top = Math.max(top, Math.abs(s.x)); }
  near(top / RIG.throw, peak.ratio, 0.03, "simulated amplitude at the peak");
  console.log("model selftest passed: omega_n 20, peak 19.80 rad/s at 5.03x the throw, simulation agrees");
}

if (process.argv[1] && process.argv[1].endsWith("model.mjs") && process.argv.includes("--selftest")) selftest();
