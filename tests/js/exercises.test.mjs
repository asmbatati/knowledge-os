// The Lab's exercises: each is complete, its starter fails its tests, the reference solution passes them, and the
// runner reports a crash or a syntax error as a result, never as an exception.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXERCISES, exercise } from "../../web/app/lab/exercises.js";
import { runTests } from "../../web/app/lab/runtests.js";
import { SOLUTIONS } from "./solutions.mjs";

test("every exercise is complete", () => {
  assert.ok(EXERCISES.length >= 6);
  const ids = new Set();
  for (const ex of EXERCISES) {
    assert.match(ex.id, /^[a-z0-9][a-z0-9-]{0,39}$/, ex.id);
    assert.ok(!ids.has(ex.id), "one id once");
    ids.add(ex.id);
    assert.ok(ex.title && ex.fname && ex.starter.includes(ex.fname), ex.id);
    assert.ok(ex.tests.length >= 3, ex.id);
    assert.ok(Array.isArray(ex.concepts) && ex.concepts.length, ex.id);
    assert.ok(ex.statement && ex.statement.length > 40, ex.id);
  }
  assert.equal(exercise("softmax").fname, "softmax");
  assert.equal(exercise("nope"), null);
});

test("the starter does not pass and the reference solution does", () => {
  for (const ex of EXERCISES) {
    const start = runTests(ex.starter, ex);
    assert.ok(start.passed < start.total, `${ex.id}: the starter already passes`);
    const sol = SOLUTIONS[ex.id];
    assert.ok(sol, `${ex.id} has a reference solution`);
    const done = runTests(sol, ex);
    assert.equal(done.passed, done.total, `${ex.id}: ${JSON.stringify(done.results.filter((r) => !r.ok))}`);
  }
});

test("a crash in one test is that test's failure, and a syntax error says so", () => {
  const ex = exercise("softmax");
  const crash = runTests("function softmax(xs) { if (xs.length === 1) throw new Error('boom'); return xs; }", ex);
  assert.ok(crash.results.some((r) => !r.ok && /boom/.test(r.error)));
  const broken = runTests("function softmax(xs) { return ", ex);
  assert.equal(broken.passed, 0);
  assert.ok(broken.error && /syntax|unexpected|expected/i.test(broken.error));
  const missing = runTests("const x = 1;", ex);
  assert.match(missing.error, /softmax/);
});
