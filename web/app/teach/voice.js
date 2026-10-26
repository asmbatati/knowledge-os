// The Teach tab's pure helpers (tested in Node). The student's replies can be read aloud by the browser's own speech
// output, with a local voice only: a voice whose `localService` is false sends the text to its vendor, and the site
// sends nothing anywhere but to Claude (CLAUDE.md, rule 7). Speech input is left out for the same reason: the
// browsers' recognisers send the audio to their vendors.

export function pickVoice(voices, lang) {
  const want = lang === "ar" ? "ar" : "en";
  const local = (voices || []).filter((v) => v && v.localService === true &&
    String(v.lang || "").toLowerCase().startsWith(want));
  return local.find((v) => v.default) || local[0] || null;
}

export function minutesSince(startMs, nowMs) {
  return Math.max(0, Math.floor((nowMs - startMs) / 60000));
}

// What the reviewer found, as the page lists it: the sections that have something, in a fixed order.
export function reviewSections(review) {
  const r = review || {};
  return ["errors", "missing", "jargon"].filter((k) => Array.isArray(r[k]) && r[k].length).map((k) => ({ key: k, items: r[k] }));
}

// The confusions the note does not answer: these are the ones that went to the vault's gaps.
export function gapsOf(review) {
  return ((review || {}).confusions || []).filter((c) => c && c.note_answers === false).map((c) => c.text);
}
