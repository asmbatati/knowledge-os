// The formula plotter's parser: arithmetic as written on paper, a few functions and constants, and nothing else. It
// never calls eval, and a name it does not know is an error, never a property of some object.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, evaluate, freeVars, parse } from "../../web/app/lab/expr.js";

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

test("arithmetic in the usual order", () => {
  assert.equal(evaluate("1 + 2 * 3"), 7);
  assert.equal(evaluate("(1 + 2) * 3"), 9);
  assert.equal(evaluate("2 ^ 3 ^ 2"), 512, "a power of a power reads from the right");
  assert.equal(evaluate("-2 ^ 2"), -4, "the minus applies after the power");
  assert.equal(evaluate("2 * -3"), -6);
  assert.equal(evaluate("7 / 2 - 0.5"), 3);
  assert.equal(evaluate("1.5e2 + .5"), 150.5);
});

test("functions, constants and variables", () => {
  near(evaluate("sin(pi / 2)"), 1);
  near(evaluate("exp(ln(5))"), 5);
  near(evaluate("sqrt(16) + abs(-2) + max(1, 4, 2)"), 10);
  assert.equal(evaluate("a * x^2 + b", { a: 2, x: 3, b: 1 }), 19);
  assert.equal(evaluate("2x + 3(x - 1)", { x: 2 }), 7, "a number before a name or a bracket multiplies it");
  near(evaluate("atan2(1, 1)"), Math.PI / 4);
});

test("the free names of a formula become its sliders", () => {
  assert.deepEqual(freeVars(parse("a * x^2 + b * sin(x) + pi")), ["a", "b", "x"]);
  assert.deepEqual(freeVars(parse("exp(-t / tau)")), ["t"], "tau is a constant");
});

test("a compiled formula is a function of its variables", () => {
  const f = compile("k * x^2");
  assert.equal(f({ k: 3, x: 2 }), 12);
  assert.equal(f({ k: 1, x: -1 }), 1);
});

test("what is not a formula says where it went wrong", () => {
  assert.throws(() => parse("1 +"), /end/);
  assert.throws(() => parse("(1 + 2"), /\)/);
  assert.throws(() => parse("1 $ 2"), /position 2/);
  assert.throws(() => evaluate("foo(1)"), /foo/);
  assert.throws(() => evaluate("y + 1"), /y/, "a name with no value");
  assert.throws(() => evaluate("constructor"), /constructor/, "no object's property is ever a value");
  assert.throws(() => evaluate("__proto__ + 1"), /__proto__/);
  assert.throws(() => evaluate("toString(1)"), /toString/);
});
