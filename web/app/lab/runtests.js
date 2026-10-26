// Runs an exercise's tests against the learner's code. It is called inside the Lab's worker, which may evaluate code and
// reach nothing (its own content security policy), and which the page stops at the time limit. A crash in one test is
// that test's failure; code that does not compile, or names no function, is a result too, never an exception.

const copy = (v) => (Array.isArray(v) ? v.map(copy)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) : v);

export function same(got, want, tol = 1e-9) {
  if (typeof want === "number") return typeof got === "number" && (got === want || Math.abs(got - want) <= tol);
  if (Array.isArray(want)) return Array.isArray(got) && got.length === want.length && want.every((w, i) => same(got[i], w, tol));
  return Object.is(got, want);
}

export function show(v) {
  let s;
  try {
    s = JSON.stringify(v, (_, x) => (typeof x === "number" && !Number.isInteger(x) ? Number(x.toPrecision(6)) : x));
  } catch (e) {
    s = String(v);
  }
  if (s === undefined) s = String(v);
  return s.length > 200 ? s.slice(0, 199) + "…" : s;
}

export function runTests(code, ex) {
  const total = ex.tests.length;
  let fn;
  try {
    fn = new Function(`"use strict";\n${code}\n;return typeof ${ex.fname} === "function" ? ${ex.fname} : undefined;`)();
  } catch (e) {
    return { passed: 0, total, results: [], error: `${e.name}: ${e.message}` };
  }
  if (typeof fn !== "function") {
    return { passed: 0, total, results: [], error: `the code defines no function named ${ex.fname}` };
  }
  const results = ex.tests.map((t) => {
    const args = copy(t.args);
    try {
      const out = fn(...args);
      const ok = t.check ? !!t.check(out, args) : same(out, t.expect, t.tol ?? 1e-9);
      return { name: t.name, ok, got: show(out), want: t.expect !== undefined ? show(t.expect) : undefined };
    } catch (e) {
      return { name: t.name, ok: false, error: `${e && e.name ? e.name : "Error"}: ${e && e.message ? e.message : e}` };
    }
  });
  return { passed: results.filter((r) => r.ok).length, total, results, error: null };
}
