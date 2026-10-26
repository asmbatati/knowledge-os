// The coach's page (the vault's Study Coach Plan 2026-10): where a session stands in its agenda, which key answers a
// question, and every word of the study page and the front door in both languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkpoint, keyOf } from "../../web/app/coach/plan.js";

const AG = { warmup: 8, new: 17, reflect: 5 };

test("a session's minute falls in its agenda's phase", () => {
  assert.equal(checkpoint(0, AG).phase, "warmup");
  assert.equal(checkpoint(7.4, AG).phase, "warmup");
  assert.equal(checkpoint(8, AG).phase, "new");
  assert.equal(checkpoint(24.6, AG).phase, "new");
  assert.equal(checkpoint(25.2, AG).phase, "reflect");
  assert.equal(checkpoint(31, AG).phase, "over");
  assert.equal(checkpoint(3, { warmup: 0, new: 25, reflect: 5 }).phase, "new");
  assert.equal(checkpoint(10.4, AG).minute, 10);
});

test("one key answers: A to D, 1 to 4 (Arabic digits too), and 0 or ? for blanking", () => {
  for (const [k, v] of [["a", "A"], ["B", "B"], ["1", "A"], ["4", "D"], ["٢", "B"], ["0", "blank"], ["?", "blank"]]) {
    assert.equal(keyOf(k), v, k);
  }
  for (const k of ["e", "5", "Enter", "", null]) assert.equal(keyOf(k), null, String(k));
});

test("every word of the study page and the front door has both languages", () => {
  const src = (p) => readFileSync(new URL(`../../web/app/${p}`, import.meta.url), "utf8");
  const [enPart, arPart] = src("i18n.js").split("const AR = {");
  const keysOf = (part) => new Set([...part.matchAll(/"([^"\n]+)":\s*"/g)].map((m) => m[1]));
  const EN = keysOf(enPart), AR = keysOf(arPart);
  const used = (f) => [...src(f).matchAll(/\bt\("([a-z0-9.\-_]+)"/gi)].map((m) => m[1]);
  const keys = new Set([...used("pages/study.js"), ...used("pages/today.js")]);
  assert.ok(keys.size > 30, "the scan finds the keys");
  const built = ["warmup", "new", "reflect", "over"].map((p) => "study.phase." + p)
    .concat(["no_note", "empty_note"].map((x) => "study.empty." + x))
    .concat(["quiet", "no_cli", "settings", "unreachable"].map((x) => "study.why." + x))
    .concat(["memorize", "lookup", "solid", "shaky"].map((x) => "study." + x));
  for (const k of [...keys, ...built]) {
    if (k.endsWith(".")) continue;
    assert.ok(EN.has(k), `English lacks ${k}`);
    assert.ok(AR.has(k), `Arabic lacks ${k}`);
  }
});
