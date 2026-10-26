// Reference solutions to the Lab's exercises, kept with the tests and never served: the page holds only the starters.
export const SOLUTIONS = {
  softmax: `function softmax(xs) {
  const m = Math.max(...xs);
  const ex = xs.map((x) => Math.exp(x - m));
  const s = ex.reduce((a, b) => a + b, 0);
  return ex.map((e) => e / s);
}`,
  "discounted-return": `function discountedReturn(rewards, gamma) {
  let g = 0;
  for (let i = rewards.length - 1; i >= 0; i--) g = rewards[i] + gamma * g;
  return g;
}`,
  "bellman-sweep": `function bellmanSweep(V, P, R, gamma) {
  return V.map((_, s) => Math.max(...P[s].map((outcomes, a) =>
    R[s][a] + gamma * outcomes.reduce((acc, [p, s2]) => acc + p * V[s2], 0))));
}`,
  "kalman-update": `function kalmanUpdate(x, P, z, R) {
  const K = P / (P + R);
  return [x + K * (z - x), (1 - K) * P];
}`,
  "numerical-gradient": `function numericalGradient(f, x, h = 1e-5) {
  return x.map((_, i) => {
    const up = x.slice(), down = x.slice();
    up[i] += h; down[i] -= h;
    return (f(up) - f(down)) / (2 * h);
  });
}`,
  eig2: `function eig2(a, b, c, d) {
  const tr = a + d, det = a * d - b * c, disc = tr * tr / 4 - det;
  if (disc >= 0) {
    const r = Math.sqrt(disc);
    return [[tr / 2 + r, 0], [tr / 2 - r, 0]];
  }
  const w = Math.sqrt(-disc);
  return [[tr / 2, w], [tr / 2, -w]];
}`,
};
