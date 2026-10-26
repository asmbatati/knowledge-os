// In Arabic, a link to a note shows the note's Arabic name when it has one (the vault's bilingual pairs, CLAUDE.md §7),
// and only a link whose words are the note's own name is renamed; every word the language views add has both languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { targetOf, labelFor, relabelText, otherHref } from "../../web/app/lang.js";

const LABELS = { "kalman filter": "مرشح كالمان", "mechanics": "خارطة الميكانيكا" };

test("a link's target is the note it opens, on the road, in Explore or as a field", () => {
  assert.equal(targetOf("#/concept/Kalman%20Filter"), "Kalman Filter");
  assert.equal(targetOf("#/note/Mechanics"), "Mechanics");
  assert.equal(targetOf("#/field/Mechanics"), "Mechanics");
  assert.equal(targetOf("#/concept/Kalman%20Filter?show=en"), "Kalman Filter");
  assert.equal(targetOf("#/check?concept=Kalman%20Filter"), null);
  assert.equal(targetOf("#/map/Road%20to%20Physics"), null);
  assert.equal(targetOf(null), null);
});

test("the Arabic name is found whatever the case, and only for a note that has one", () => {
  assert.equal(labelFor("Kalman Filter", LABELS), "مرشح كالمان");
  assert.equal(labelFor("KALMAN FILTER", LABELS), "مرشح كالمان");
  assert.equal(labelFor("Collection", LABELS), null);
  assert.equal(labelFor("Kalman Filter", null), null);
});

test("only a link whose words are the note's name is renamed", () => {
  assert.equal(relabelText("#/concept/Kalman%20Filter", "Kalman Filter", LABELS), "مرشح كالمان");
  assert.equal(relabelText("#/concept/Kalman%20Filter", " Kalman Filter ", LABELS), "مرشح كالمان");
  assert.equal(relabelText("#/concept/Kalman%20Filter", "Open the note", LABELS), null);
  assert.equal(relabelText("#/concept/Collection", "Collection", LABELS), null);
  assert.equal(relabelText("#/check?concept=Kalman%20Filter", "Kalman Filter", LABELS), null);
});

test("the other note of a pair opens on the same page, and the page's own comes back without the switch", () => {
  assert.equal(otherHref("concept", "Kalman Filter", "en", false), "#/concept/Kalman%20Filter?show=en");
  assert.equal(otherHref("note", "Mechanics", "ar", false), "#/note/Mechanics?show=ar");
  assert.equal(otherHref("concept", "Kalman Filter", "ar", true), "#/concept/Kalman%20Filter");
});

test("every word the language views put on the page has both languages", () => {
  const i18n = readFileSync(new URL("../../web/app/i18n.js", import.meta.url), "utf8");
  const [enPart, arPart] = i18n.split("const AR = {");
  const keysOf = (part) => new Set([...part.matchAll(/"([^"\n]+)":\s*"/g)].map((m) => m[1]));
  const EN = keysOf(enPart), AR = keysOf(arPart);
  const keys = ["none", "claim", "question", "english-primary"].map((k) => "lang.missing." + k)
    .concat(["lang.read.en", "lang.read.ar", "check.lang"]);
  for (const k of keys) {
    assert.ok(EN.has(k), `English lacks ${k}`);
    assert.ok(AR.has(k), `Arabic lacks ${k}`);
  }
});
