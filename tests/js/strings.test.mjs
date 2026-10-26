// Every word the road map and the Lab put on the page exists in English and in Arabic, and the Lab's registry sends
// a concept's page to the models and exercises that show it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FIGURES, MODELS, figureSrc, figuresFor, labFor } from "../../web/app/lab/registry.js";
import { EXERCISES } from "../../web/app/lab/exercises.js";

const src = (p) => readFileSync(new URL(`../../web/app/${p}`, import.meta.url), "utf8");
const i18n = src("i18n.js");
const [enPart, arPart] = i18n.split("const AR = {");
const keysOf = (part) => new Set([...part.matchAll(/"([^"\n]+)":\s*"/g)].map((m) => m[1]));
const EN = keysOf(enPart), AR = keysOf(arPart);

test("no key is written twice in one language, where the later one would silently win", () => {
  for (const [name, part] of [["English", enPart], ["Arabic", arPart]]) {
    const seen = new Set(), twice = [];
    for (const m of part.matchAll(/"([^"\n]+)":\s*"/g)) (seen.has(m[1]) ? twice : seen).add(m[1]);
    assert.deepEqual([...new Set(twice)], [], `${name} defines these twice`);
  }
});

function usedKeys(file) {
  return [...src(file).matchAll(/\bt\("([a-z0-9.\- ]+)"/gi)].map((m) => m[1]);
}

test("every literal key on the road map, the Lab and the concept page has both languages", () => {
  const keys = new Set([...usedKeys("pages/map.js"), ...usedKeys("pages/lab.js"), ...usedKeys("pages/concept.js")]);
  assert.ok(keys.size > 40, "the scan finds the keys");
  for (const k of keys) {
    if (k.endsWith(".")) continue;                 // a prefix completed below
    assert.ok(EN.has(k), `English lacks ${k}`);
    assert.ok(AR.has(k), `Arabic lacks ${k}`);
  }
});

test("the keys the Lab builds from its parts have both languages too", () => {
  const built = [
    ...MODELS.flatMap((m) => [`lab.m.${m.id}`, `lab.m.${m.id}.d`]),
    ...FIGURES.flatMap((f) => [`lab.f.${f.id}`, `lab.f.${f.id}.d`]),
    ...["models", "figures", "formulas", "code", "exercises"].map((k) => `lab.tab.${k}`),
    "lab.figure.kind", "lab.figures.intro",
    ...["stable node", "unstable node", "saddle", "stable spiral", "unstable spiral", "center", "degenerate"].map((k) => `lab.kind.${k}`),
    ...["sine", "walk", "matrix", "pid", "numpy", "plain"].map((k) => `lab.ex.${k}`),
    ...["rn", "corridor", "cliff"].map((k) => `lab.vi.world.${k}`),
    "nav.lab",
  ];
  for (const k of built) {
    assert.ok(EN.has(k), `English lacks ${k}`);
    assert.ok(AR.has(k), `Arabic lacks ${k}`);
  }
});

test("a concept's page finds what the Lab holds about it, whatever the case", () => {
  assert.deepEqual(labFor("Kalman Filter").map((x) => `${x.kind}/${x.id}`),
    ["figures/kalman-gain", "models/kalman", "exercises/kalman-update"]);
  assert.deepEqual(labFor("softmax").map((x) => x.id), ["softmax"]);
  assert.deepEqual(labFor("A note the Lab knows nothing of"), []);
  for (const e of EXERCISES) assert.ok(labFor(e.concepts[0]).some((x) => x.id === e.id), e.id);
});

test("a concept a figure explains finds the figure first, and every figure names its page", () => {
  assert.deepEqual(labFor("Resonance Frequency").map((x) => `${x.kind}/${x.id}`)[0], "figures/shake-table");
  assert.ok(labFor("damping ratio").some((x) => x.kind === "figures" && x.id === "shake-table"));
  for (const f of FIGURES) {
    assert.match(f.id, /^[a-z0-9][a-z0-9-]{0,47}$/);
    assert.ok(f.concepts.length > 0, f.id);
    assert.ok(labFor(f.concepts[0]).some((x) => x.kind === "figures" && x.id === f.id), f.id);
  }
});

test("a concept's page embeds the figures that explain it, in the page's theme", () => {
  assert.deepEqual(figuresFor("The Kalman gain trades trust between the model and the measurement").map((f) => f.id), ["kalman-gain"]);
  assert.deepEqual(figuresFor("resonance frequency").map((f) => f.id), ["shake-table"]);
  assert.deepEqual(figuresFor("With a scalar gain every half-turn is an equilibrium of PD control on SO(3); three distinct stiffnesses leave three unstable ones, the fewest any smooth potential on SO(3) allows").map((f) => f.id), ["so3-half-turns"]);
  assert.deepEqual(figuresFor("geometric control on SE(3)").map((f) => f.id), ["so3-half-turns"]);
  assert.deepEqual(figuresFor("A note no figure explains"), []);
  assert.equal(figureSrc("kalman-gain", false), "/figures/kalman-gain/kalman-gain.html");
  assert.equal(figureSrc("kalman-gain", true), "/figures/kalman-gain/kalman-gain-dark.html");
  assert.match(src("pages/concept.js"), /figureCards\(/, "the concept page shows its figures");
  assert.match(src("lab/figure-card.js"), /figuresFor\(/, "the card asks the registry");
  assert.match(src("lab/figure-card.js"), /sandbox: "allow-scripts"/, "and frames each figure sandboxed");
});

test("a lesson shows the figure that explains its concept, and a road check only before its first question", () => {
  assert.match(src("pages/study.js"), /figureCards\(/, "the coach's lesson shows it");
  const check = src("pages/check.js");
  assert.match(check, /function lookFirst\(/, "the check opens on the figure");
  assert.ok(check.lastIndexOf("figureCards(") < check.indexOf("function runQuestions("), "never among the questions");
  assert.match(check, /nx\.kind === "check"/, "a check, not a review or placement, where it would be a hint");
  const keys = [...usedKeys("pages/check.js"), ...usedKeys("pages/study.js")].filter((k) => /figure|begin/.test(k));
  assert.ok(keys.length >= 2, "the scan finds the new words");
  for (const k of keys) {
    assert.ok(EN.has(k), `English lacks ${k}`);
    assert.ok(AR.has(k), `Arabic lacks ${k}`);
  }
});
