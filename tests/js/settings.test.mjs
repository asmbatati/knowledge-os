// The Settings page (the vault's Knowledge OS Plugin Plan 2026-10): every word it puts on the page exists in English
// and in Arabic, including the keys it builds from a provider's tier, a reason code and a test's result.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p) => readFileSync(new URL(`../../web/app/${p}`, import.meta.url), "utf8");
const [enPart, arPart] = src("i18n.js").split("const AR = {");
const keysOf = (part) => new Set([...part.matchAll(/"([^"\n]+)":\s*"/g)].map((m) => m[1]));
const EN = keysOf(enPart), AR = keysOf(arPart);

test("every word of the Settings page has both languages", () => {
  const used = [...src("pages/settings.js").matchAll(/\bt\("([a-z0-9.\-_]+)"/gi)].map((m) => m[1]);
  const built = ["subscription", "paid", "free-tier", "local"].map((x) => "settings.tier." + x)
    .concat(["no_cli", "no_key", "no_provider", "quiet", "budget"].map((x) => "settings.why." + x))
    .concat(["ready", "no_cli", "not_signed_in"].map((x) => "settings.check." + x))
    .concat(["auto", "low", "medium", "high"].map((x) => "settings.effort." + x))
    .concat(["passed", "failed", "not_run", "error"].map((x) => "settings.trust.result." + x))
    .concat(["grader", "teach"].map((x) => "settings.trust." + x));
  assert.ok(used.length > 25, "the scan finds the keys");
  for (const k of [...used, ...built, "nav.settings", "grader.model"]) {
    if (k.endsWith(".")) continue;
    assert.ok(EN.has(k), `English lacks ${k}`);
    assert.ok(AR.has(k), `Arabic lacks ${k}`);
  }
});

test("the reasons a model rests are said wherever a reason is said", () => {
  const i18n = src("i18n.js");
  for (const prefix of ["why.", "study.why.", "teach.why.", "course.why."]) {
    assert.ok(i18n.includes(`["${prefix}", `), `the reasons are built for ${prefix}`);
  }
  for (const code of ["no_key", "budget", "untrusted", "no_provider"]) assert.ok(i18n.includes(`${code}:`), code);
});
