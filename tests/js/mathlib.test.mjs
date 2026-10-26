// The code space's helpers: plain arrays in, plain arrays out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { identity, linspace, matmul, mean, norm, std, transpose, lab } from "../../web/app/lab/mathlib.js";

test("vectors and matrices", () => {
  assert.deepEqual(linspace(0, 1, 5), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(matmul([[1, 2], [3, 4]], identity(2)), [[1, 2], [3, 4]]);
  assert.deepEqual(matmul([[1, 2], [3, 4]], [1, 1]), [3, 7], "a matrix times a vector is a vector");
  assert.deepEqual(transpose([[1, 2, 3]]), [[1], [2], [3]]);
  assert.equal(norm([3, 4]), 5);
  assert.throws(() => matmul([[1, 2]], [[1, 2]]), /1×2 times 1×2/);
});

test("statistics, and the models reachable from code", () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.ok(Math.abs(std([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138) < 1e-3);
  assert.equal(typeof lab.models.pid, "function");
  assert.ok(Object.isFrozen(lab), "the learner's code cannot change the helpers under the next run");
});
