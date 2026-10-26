// In an Obsidian tab (the vault's Knowledge OS Plugin Plan 2026-10, P3): the page knows it is framed with ?embed=1, and
// asks Obsidian to open a note with one message, sent to Obsidian's origin only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { embedded, openInObsidian, openNoteMessage, OBSIDIAN_ORIGIN } from "../../web/app/embed.js";

test("embedded only when framed and asked to be", () => {
  const top = {}; top.parent = top;
  const framed = { parent: {} };
  assert.equal(embedded({ search: "?embed=1" }, framed), true);
  assert.equal(embedded({ search: "" }, framed), false);
  assert.equal(embedded({ search: "?embed=1" }, top), false);
});

test("the message names the note and goes to Obsidian's origin only", () => {
  const sent = [];
  const win = { parent: { postMessage: (msg, origin) => sent.push([msg, origin]) } };
  openInObsidian("Kalman Filter", win);
  assert.deepEqual(sent, [[{ type: "knowledge-os:open-note", name: "Kalman Filter" }, "app://obsidian.md"]]);
  assert.equal(OBSIDIAN_ORIGIN, "app://obsidian.md");
  assert.equal(openNoteMessage("x".repeat(500)).name.length, 300);
});
