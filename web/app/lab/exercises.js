// The Lab's exercises: write one function, run its tests, see which pass. Each names the concepts it practises. The
// reference solutions are kept with the tests, never here. A run goes to the site's own ledger, never to the road:
// strict mastery is taken on the road, with its own questions.

const sorted = (pairs) => pairs.map((p) => p.slice()).sort((x, y) => y[0] - x[0] || y[1] - x[1]);
const closePairs = (got, want, tol) => Array.isArray(got) && got.length === want.length &&
  sorted(got).every((p, i) => Array.isArray(p) && p.length === 2 &&
    Math.abs(p[0] - sorted(want)[i][0]) <= tol && Math.abs(p[1] - sorted(want)[i][1]) <= tol);

export const EXERCISES = [
  {
    id: "softmax",
    title: "Softmax",
    concepts: ["Softmax"],
    fname: "softmax",
    statement: "Turn a list of scores into probabilities: each one is exp(score) over the sum of them all. Subtract the " +
      "largest score first, so that exp never overflows: the answer does not change, because the factor cancels.",
    starter: "function softmax(xs) {\n  // scores in, probabilities out: positive, summing to 1\n  return xs;\n}",
    tests: [
      { name: "three scores", args: [[1, 2, 3]], expect: [0.09003057317038046, 0.24472847105479764, 0.6652409557748219], tol: 1e-6 },
      { name: "large scores do not overflow", args: [[1000, 1001]], expect: [0.2689414213699951, 0.7310585786300049], tol: 1e-6 },
      { name: "one score is certain", args: [[0]], expect: [1], tol: 1e-9 },
      { name: "they sum to one", args: [[0.5, -2, 3, 7]],
        check: (out) => Array.isArray(out) && out.every((p) => p > 0) && Math.abs(out.reduce((a, b) => a + b, 0) - 1) < 1e-9 },
    ],
  },
  {
    id: "discounted-return",
    title: "The discounted return",
    concepts: ["Markov Decision Process", "Discounting by γ is the same, on average, as a 1 − γ chance each step that the episode stops, so it can price delay but not a danger that depends on where you are"],
    fname: "discountedReturn",
    statement: "The return from the first step of an episode: r0 + γ r1 + γ² r2 + … Working backwards, G = r + γ G, " +
      "needs no powers at all.",
    starter: "function discountedReturn(rewards, gamma) {\n  // G0 = r0 + gamma r1 + gamma^2 r2 + ...\n  return 0;\n}",
    tests: [
      { name: "three rewards of 1", args: [[1, 1, 1], 0.9], expect: 2.71, tol: 1e-9 },
      { name: "no rewards", args: [[], 0.5], expect: 0, tol: 1e-12 },
      { name: "a late reward, discounted twice", args: [[0, 0, 10], 0.5], expect: 2.5, tol: 1e-9 },
      { name: "one reward is itself", args: [[5], 0.99], expect: 5, tol: 1e-12 },
    ],
  },
  {
    id: "bellman-sweep",
    title: "One sweep of value iteration",
    concepts: ["Value iteration is policy iteration with evaluation cut to a single sweep", "Markov Decision Process"],
    fname: "bellmanSweep",
    statement: "Given values V, return the values after one sweep: for each state s, the best over its actions a of " +
      "R[s][a] + γ Σ p · V[s'], where P[s][a] lists the outcomes as [p, s'].",
    starter: "function bellmanSweep(V, P, R, gamma) {\n  // V'[s] = max over a of R[s][a] + gamma * sum of p * V[s2]\n  return V.slice();\n}",
    tests: [
      { name: "from zero", args: [[0, 0], [[[[1, 0]], [[1, 1]]], [[[1, 1]]]], [[0, 1], [2]], 0.9], expect: [1, 2], tol: 1e-9 },
      { name: "a second sweep", args: [[1, 2], [[[[1, 0]], [[1, 1]]], [[[1, 1]]]], [[0, 1], [2]], 0.9], expect: [2.8, 3.8], tol: 1e-9 },
      { name: "a chance outcome", args: [[2, 4], [[[[0.5, 0], [0.5, 1]]], [[[1, 1]]]], [[0], [0]], 0.9], expect: [2.7, 3.6], tol: 1e-9 },
    ],
  },
  {
    id: "kalman-update",
    title: "A Kalman update",
    concepts: ["Kalman Filter"],
    fname: "kalmanUpdate",
    statement: "Fold one measurement z, of variance R, into an estimate x of variance P: the gain K = P / (P + R) says " +
      "how far to move toward z, and the variance shrinks by (1 − K). Return [x, P] after the update.",
    starter: "function kalmanUpdate(x, P, z, R) {\n  // K = P / (P + R); x moves K of the way to z; P shrinks by (1 - K)\n  return [x, P];\n}",
    tests: [
      { name: "equal trust, halfway", args: [0, 1, 2, 1], expect: [1, 0.5], tol: 1e-9 },
      { name: "equal trust again", args: [5, 4, 7, 4], expect: [6, 2], tol: 1e-9 },
      { name: "a good measurement pulls hard", args: [1, 9, 11, 1], expect: [10, 0.9], tol: 1e-9 },
      { name: "a certain estimate ignores it", args: [3, 0, 10, 1], expect: [3, 0], tol: 1e-9 },
    ],
  },
  {
    id: "numerical-gradient",
    title: "A gradient by central differences",
    concepts: ["Gradient", "Derivative", "Gradient descent (GD)"],
    fname: "numericalGradient",
    statement: "Estimate the gradient of f at the point x, one coordinate at a time: (f(x + h e_i) − f(x − h e_i)) / 2h. " +
      "Copy x before you change it: the caller's array must stay as it was.",
    starter: "function numericalGradient(f, x, h = 1e-5) {\n  // one central difference per coordinate\n  return x.map(() => 0);\n}",
    tests: [
      { name: "a parabola and a line", args: [(v) => v[0] ** 2 + 3 * v[1], [1, 2]], expect: [2, 3], tol: 1e-4 },
      { name: "a sine at zero", args: [(v) => Math.sin(v[0]), [0]], expect: [1], tol: 1e-6 },
      { name: "a product", args: [(v) => v[0] * v[1], [2, 5]], expect: [5, 2], tol: 1e-4 },
      { name: "the point is left alone",
        args: [(v) => v[0] + v[1], [1, 1]], check: (out, args) => args[1][0] === 1 && args[1][1] === 1 && Array.isArray(out) &&
          Math.abs(out[0] - 1) < 1e-6 && Math.abs(out[1] - 1) < 1e-6 },
    ],
  },
  {
    id: "eig2",
    title: "The eigenvalues of a 2×2 matrix",
    concepts: ["Eigenvalues and eigenvectors", "Eigenvalues of A decide the stability of xdot = Ax"],
    fname: "eig2",
    statement: "For A = [[a, b], [c, d]], the eigenvalues are tr/2 ± √(tr²/4 − det). When the root is of a negative " +
      "number they are complex. Return them as two pairs [re, im], in any order.",
    starter: "function eig2(a, b, c, d) {\n  // trace, determinant, and the root of tr^2/4 - det\n  return [[0, 0], [0, 0]];\n}",
    tests: [
      { name: "a diagonal matrix", args: [2, 0, 0, 3], check: (out) => closePairs(out, [[3, 0], [2, 0]], 1e-9) },
      { name: "a rotation", args: [0, 1, -1, 0], check: (out) => closePairs(out, [[0, 1], [0, -1]], 1e-9) },
      { name: "a symmetric matrix", args: [1, 2, 2, 1], check: (out) => closePairs(out, [[3, 0], [-1, 0]], 1e-9) },
      { name: "a repeated eigenvalue", args: [-1, 0, 0, -1], check: (out) => closePairs(out, [[-1, 0], [-1, 0]], 1e-9) },
    ],
  },
];

export const exercise = (id) => EXERCISES.find((e) => e.id === id) || null;
