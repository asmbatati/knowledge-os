// In an Obsidian tab: the Knowledge OS plugin frames the site at /?embed=1 (the vault's Knowledge OS Plugin Plan
// 2026-10, P3). There a note can be opened in Obsidian itself: the page posts one message to Obsidian's window, and only
// to Obsidian's origin; the plugin checks that the message came from this site's frame before it opens anything.

export const OBSIDIAN_ORIGIN = "app://obsidian.md";

export function embedded(loc = globalThis.location, win = globalThis) {
  try {
    return win.parent !== win && new URLSearchParams(loc.search).has("embed");
  } catch (e) {
    return false;
  }
}

export function openNoteMessage(name) {
  return { type: "knowledge-os:open-note", name: String(name || "").slice(0, 300) };
}

export function openInObsidian(name, win = globalThis) {
  win.parent.postMessage(openNoteMessage(name), OBSIDIAN_ORIGIN);
}
