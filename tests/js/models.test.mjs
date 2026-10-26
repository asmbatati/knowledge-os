// The Lab's models, checked against what the theory says they must do.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bandit, classify2x2, eig2, gradientDescent, greedyPolicy, kalman1d, kalmanSteadyGain, largeNumbers, linearTrajectory, pid, rng,
  valueIteration,
} from "../../web/app/lab/models.js";

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test("a seeded generator repeats itself, and only itself", () => {
  const a = rng(7), b = rng(7), c = rng(8);
  const xs = [a(), a(), a()], ys = [b(), b(), b()];
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, [c(), c(), c()]);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test("gradient descent on a bowl: converges below 2/curvature, diverges above it", () => {
  const ok = gradientDescent({ a: 1, b: 10, lr: 0.05, start: [2, 1], steps: 300 });
  const last = ok.path.at(-1);
  assert.ok(Math.hypot(last[0], last[1]) < 1e-3);
  const bad = gradientDescent({ a: 1, b: 10, lr: 0.21, start: [2, 1], steps: 60 });
  assert.ok(Math.abs(bad.path.at(-1)[1]) > 1, "a step past 2/10 overshoots more each time");
  assert.equal(ok.path.length, 301);
});

test("the eigenvalues of A decide what xdot = Ax does", () => {
  assert.equal(classify2x2(-1, 0, 0, -2).kind, "stable node");
  assert.equal(classify2x2(1, 0, 0, 2).kind, "unstable node");
  assert.equal(classify2x2(1, 0, 0, -1).kind, "saddle");
  assert.equal(classify2x2(-0.5, 1, -1, -0.5).kind, "stable spiral");
  assert.equal(classify2x2(0.2, 1, -1, 0.2).kind, "unstable spiral");
  assert.equal(classify2x2(0, 1, -1, 0).kind, "center");
  const ev = eig2(0, 1, -1, 0);
  near(ev[0].re, 0, 1e-12);
  near(Math.abs(ev[0].im), 1, 1e-12);
  const orbit = linearTrajectory(0, 1, -1, 0, [1, 0], 0.01, Math.round((2 * Math.PI) / 0.01));
  const end = orbit.at(-1);
  near(Math.hypot(end[0], end[1]), 1, 1e-6);
});

test("PID on a first-order plant: P alone leaves an error, I removes it", () => {
  const p = pid({ kp: 4, ki: 0, kd: 0, plantGain: 1, tau: 1, dt: 0.01, t: 20 });
  near(p.metrics.steadyError, 1 / (1 + 4), 1e-3);
  const pi = pid({ kp: 4, ki: 3, kd: 0, plantGain: 1, tau: 1, dt: 0.01, t: 20 });
  near(pi.metrics.steadyError, 0, 1e-3);
  assert.ok(pi.metrics.overshoot >= 0);
  assert.equal(p.t.length, p.y.length);
});

test("the Kalman gain settles where the Riccati equation says", () => {
  const run = kalman1d({ q: 0.01, r: 1, steps: 300, seed: 3 });
  near(run.gain.at(-1), kalmanSteadyGain(0.01, 1), 1e-9);
  const err = (xs) => xs.reduce((s, v, i) => s + (v - run.truth[i]) ** 2, 0) / xs.length;
  assert.ok(err(run.estimate) < err(run.measured), "the filter is closer to the truth than the measurements");
});

test("value iteration on a corridor: one step from the goal is worth 1, two steps 0.9", () => {
  const grid = ["S.G"];
  const v = valueIteration({ grid, gamma: 0.9, tol: 1e-12 });
  near(v.V[0][1], 1, 1e-9);
  near(v.V[0][0], 0.9, 1e-9);
  assert.equal(v.policy[0][0], "right");
  assert.equal(v.policy[0][1], "right");
  assert.ok(v.sweeps.length > 1 && v.converged);
});

test("epsilon-greedy finds the best arm, and pure exploration does not keep to it", () => {
  const greedy = bandit({ means: [0.1, 0.5, 0.9], eps: 0.1, steps: 3000, seed: 5 });
  assert.ok(greedy.optimalShare.at(-1) > 0.8);
  const random = bandit({ means: [0.1, 0.5, 0.9], eps: 1, steps: 3000, seed: 5 });
  near(random.optimalShare.at(-1), 1 / 3, 0.05);
});

test("the running mean of a die settles at 3.5", () => {
  const run = largeNumbers({ sides: 6, n: 20000, seed: 11 });
  near(run.mean.at(-1), 3.5, 0.05);
  assert.equal(run.expected, 3.5);
});

test("the greedy policy of any sweep's values, as the view draws it", () => {
  const params = { grid: ["S.G"], gamma: 0.9 };
  const v = valueIteration({ ...params, tol: 1e-12 });
  assert.deepEqual(greedyPolicy(params, v.V), v.policy, "on the final values it is the policy");
  const first = greedyPolicy(params, v.sweeps[0]);
  assert.equal(first[0][1], "right", "before any sweep, the step into the goal already pays");
  assert.equal(first[0][2], null, "the goal has no move");
});
