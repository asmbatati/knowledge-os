// Every word Explore puts on the page exists in English and in Arabic, the literal keys and the ones it builds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p) => readFileSync(new URL(`../../web/app/${p}`, import.meta.url), "utf8");
const i18n = src("i18n.js");
const [enPart, arPart] = i18n.split("const AR = {");
const keysOf = (part) => new Set([...part.matchAll(/"([^"\n]+)":\s*"/g)].map((m) => m[1]));
const EN = keysOf(enPart), AR = keysOf(arPart);
const used = (file) => [...src(file).matchAll(/\bt\("([a-z0-9.\- _]+)"/gi)].map((m) => m[1]);

test("every literal key on Explore's pages has both languages", () => {
  const keys = new Set([...used("pages/explore.js"), ...used("pages/field.js"), ...used("pages/note.js")]);
  assert.ok(keys.size > 30, "the scan finds the keys");
  for (const k of keys) {
    if (k.endsWith(".")) continue;
    assert.ok(EN.has(k), `English lacks ${k}`);
    assert.ok(AR.has(k), `Arabic lacks ${k}`);
  }
});

test("the keys Explore builds from its parts have both languages", () => {
  const built = [
    ...["record", "river", "frontier"].map((v) => "f.view." + v),
    ...["scope", "map", "concepts", "history", "dated", "people", "tools", "literature", "debates", "questions", "gaps"].map((x) => "f.sec." + x),
    ...["present", "thin", "missing"].map((x) => "f.score." + x),
    ...["people", "ideas", "tools", "papers", "experiments", "debates", "institutions"].map((x) => "lane." + x),
    ...["timelines", "questions", "tools", "literature", "maps"].map((x) => "f.list." + x),
    ...["debates", "questions", "seeds", "undated", "people"].map((x) => "fr." + x),
    ...["introduced", "released", "period", "settled_in", "born", "died"].map((x) => "n.date." + x),
    ...["introduced_by", "responds_to", "refutes", "generalizes", "school", "parties", "settled_by", "timeline_of", "released_by", "superseded_by"].map((x) => "n.rel." + x),
    ...["responds_to", "refutes", "generalizes", "introduced_by", "school"].map((x) => "n.rev." + x),
  ];
  for (const k of built) {
    assert.ok(EN.has(k), `English lacks ${k}`);
    assert.ok(AR.has(k), `Arabic lacks ${k}`);
  }
});
