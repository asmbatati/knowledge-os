// The Kalman update as a balance of two springs: the numbers every part of the figure reads.
// A carriage on a rail hangs between two springs of equal rest length. The model's spring, of stiffness 1/P⁻, is
// relaxed when the carriage stands at the prediction x̂⁻; the sensor's, of stiffness 1/R, when it stands at the
// reading y. The carriage settles where the forces cancel, (x̂⁻/P⁻ + y/R)/(1/P⁻ + 1/R) = x̂⁻ + K(y − x̂⁻) with
// K = P⁻/(P⁻ + R), and the two springs together are as stiff as 1/P⁺: the vault's note "The Kalman gain trades trust
// between the model and the measurement", worked example 2, is the default pose.

export const NOTE = { prior: 2.0, Pminus: 0.0025, reading: 2.3, R: 0.0225 };
export const RS = [NOTE.Pminus / 9, NOTE.Pminus, 9 * NOTE.Pminus, 99 * NOTE.Pminus];
export const READING = [2.06, 2.34];

export function update(prior, Pminus, y, R) {
  const K = Pminus / (Pminus + R);
  return { K, x: prior + K * (y - prior), Pplus: (1 - K) * Pminus };
}

export function balance(prior, kModel, y, kSensor) {
  return { x: (kModel * prior + kSensor * y) / (kModel + kSensor), stiffness: kModel + kSensor };
}

export function steadyGain(Q, R) {
  const p = (Q + Math.sqrt(Q * Q + 4 * Q * R)) / 2;
  return { p, K: p / (p + R) };
}

function selftest() {
  const near = (a, b, tol, what) => { if (Math.abs(a - b) > tol) throw new Error(`${what}: ${a} is not ${b}`); };
  const u = update(NOTE.prior, NOTE.Pminus, NOTE.reading, NOTE.R);
  near(u.K, 0.1, 1e-12, "K (note: 0.100000)");
  near(u.x, 2.03, 1e-12, "x+ (note: 2.030000)");
  near(u.Pplus, 0.00225, 1e-12, "P+ (note: 0.00225000)");
  for (let i = 0; i < 200; i++) {
    const prior = 1 + Math.random(), y = 1 + Math.random(), P = 1e-4 + Math.random(), R = 1e-4 + Math.random();
    const a = update(prior, P, y, R), b = balance(prior, 1 / P, y, 1 / R);
    near(b.x, a.x, 1e-9, "the springs settle at the Kalman update");
    near(1 / b.stiffness, a.Pplus, 1e-9, "the springs together are as stiff as 1/P+");
  }
  RS.forEach((R, i) => near(update(0, NOTE.Pminus, 1, R).K, [0.9, 0.5, 0.1, 0.01][i], 1e-12, `K at preset ${i}`));
  const s = steadyGain(0.01, 1);
  near(s.p, 0.10512492, 5e-9, "steady P- (note: 0.10512492)");
  near(s.K, 0.09512492, 5e-9, "steady K (note: 0.09512492)");
  near(steadyGain(1, 1).K, 0.618034, 5e-7, "Q = R gives the golden ratio conjugate (note: 0.618034)");
  console.log("model selftest passed: the note's K 0.1, x+ 2.03 m, P+ 0.00225; the springs settle at the update");
}

if (process.argv[1] && process.argv[1].endsWith("model.mjs") && process.argv.includes("--selftest")) selftest();
