// The helpers the Lab's code space hands to the learner's code as `lab`: vectors and matrices as plain arrays, a few
// statistics, a seeded generator, and the Lab's own models. Pure.
import * as models from "./models.js";

export const linspace = (a, b, n = 50) => (n <= 1 ? [a] : Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1)));
export const range = (n, start = 0, step = 1) => Array.from({ length: Math.max(0, Math.ceil(n)) }, (_, i) => start + i * step);
export const zeros = (n, m) => (m === undefined ? new Array(n).fill(0) : Array.from({ length: n }, () => new Array(m).fill(0)));
export const ones = (n) => new Array(n).fill(1);
export const identity = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
export const add = (a, b) => a.map((v, i) => (Array.isArray(v) ? add(v, b[i]) : v + (Array.isArray(b) ? b[i] : b)));
export const sub = (a, b) => a.map((v, i) => (Array.isArray(v) ? sub(v, b[i]) : v - (Array.isArray(b) ? b[i] : b)));
export const scale = (a, k) => a.map((v) => (Array.isArray(v) ? scale(v, k) : v * k));
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const norm = (a) => Math.sqrt(dot(a, a));
export const sum = (a) => a.reduce((s, v) => s + v, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : NaN);
export const std = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1));
};
export const transpose = (A) => (A.length ? A[0].map((_, j) => A.map((row) => row[j])) : []);
export function matmul(A, B) {
  const vec = !Array.isArray(B[0]);
  const Bm = vec ? B.map((v) => [v]) : B;
  if (A[0].length !== Bm.length) throw new Error(`matmul: ${A.length}×${A[0].length} times ${Bm.length}×${Bm[0].length}`);
  const out = A.map((row) => Bm[0].map((_, j) => row.reduce((s, v, k) => s + v * Bm[k][j], 0)));
  return vec ? out.map((r) => r[0]) : out;
}
export const rng = (seed = 1) => models.rng(seed);
export const randn = (r) => models.gaussian(r);

export const lab = Object.freeze({ linspace, range, zeros, ones, identity, add, sub, scale, dot, norm, sum, mean, std,
  transpose, matmul, rng, randn, models: Object.freeze({ ...models }) });
