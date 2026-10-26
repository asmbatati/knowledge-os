import { test } from "node:test";
import assert from "node:assert/strict";
import { pickVoice, minutesSince, reviewSections, gapsOf } from "../../web/app/teach/voice.js";

test("only a local voice reads the student aloud, in the page's language", () => {
  const voices = [
    { name: "Cloud EN", lang: "en-US", localService: false, default: true },
    { name: "Local EN", lang: "en-GB", localService: true },
    { name: "Local AR", lang: "ar-SA", localService: true, default: true },
  ];
  assert.equal(pickVoice(voices, "en").name, "Local EN");
  assert.equal(pickVoice(voices, "ar").name, "Local AR");
  assert.equal(pickVoice([{ name: "Cloud AR", lang: "ar-EG", localService: false }], "ar"), null);
  assert.equal(pickVoice(undefined, "en"), null);
});

test("minutes since the start never go negative", () => {
  assert.equal(minutesSince(0, 125000), 2);
  assert.equal(minutesSince(5000, 0), 0);
});

test("the review lists only the sections that found something", () => {
  const s = reviewSections({ errors: [], missing: ["an example"], jargon: ["geodesic", "metric"] });
  assert.deepEqual(s.map((x) => x.key), ["missing", "jargon"]);
  assert.deepEqual(reviewSections(null), []);
});

test("the gaps are the confusions the note does not answer", () => {
  assert.deepEqual(gapsOf({ confusions: [{ text: "a", note_answers: false }, { text: "b", note_answers: true }] }), ["a"]);
  assert.deepEqual(gapsOf({}), []);
});
