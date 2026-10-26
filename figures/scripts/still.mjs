// A figure as a still drawing (D4 of the vault's Anatomy Figures Plan, 22 Oct 2026): the drawing at rest on a light
// card of its own, with the card's number, title and readout in its corners, as one standalone SVG. Obsidian shows it
// with ![[<id>.svg]] where the ```figure block cannot run: a copy of the vault without Engineering 3D Viewer, a note
// exported to PDF, a phone that never got the pages. The card is light in both of Obsidian's themes, as a printed plate
// would be, since an image cannot tell which theme it sits in. The Knowledge OS shows the live figure and leaves the
// still out. Built with the light page (`node build.mjs`); figures/.gitignore keeps it out of git like the pages.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as k from "../kit/iso-kit.mjs";

const PAD_X = 24, PAD_TOP = 52, PAD_BOTTOM = 52;       // the plate's own padding
const INSET_X = 20, INSET_Y = 18, TEXT = 10.5;         // its corners' inset and size

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
.still-card{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1px}
.still-corner{font-family:var(--anatomy-mono);font-size:${TEXT}px;letter-spacing:.04em;fill:var(--anatomy-muted)}
.still-corner[data-corner="fig"],.still-corner[data-corner="readout"]{fill:var(--anatomy-text)}
.still-corner[data-corner="title"]{letter-spacing:.1em}
`;

/** The still drawing of a figure, as SVG text. `drawing` is what the build passes to k.figureSvg; `card` the plate's
 *  number (`fig`), title and readout at rest. */
export function stillSvg(id, drawing, { fig, title, readout }) {
  const W = drawing.width + 2 * PAD_X, H = drawing.height + PAD_TOP + PAD_BOTTOM;
  const corner = (name, x, y, anchor, text) =>
    `<text class="still-corner" data-corner="${name}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(text)}</text>`;
  const body = Array.isArray(drawing.body) ? drawing.body.join("") : drawing.body;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" class="iso" data-theme="light" data-figure="${esc(id)}" ` +
    `width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(drawing.label)}">` +
    `<title>${esc(`${fig} · ${title}`)}</title>` +
    `<style>${k.ISO_CSS}${CSS}</style>` +
    `<rect class="still-card" x=".5" y=".5" width="${W - 1}" height="${H - 1}"/>` +
    corner("fig", INSET_X, INSET_Y + TEXT, "start", fig) +
    corner("title", W - INSET_X, INSET_Y + TEXT, "end", title.toUpperCase()) +
    corner("readout", W - INSET_X, H - INSET_Y, "end", readout) +
    `<g class="iso-svg" transform="translate(${PAD_X} ${PAD_TOP})">${body}</g>` +
    `</svg>\n`
  );
}

/** Write <id>.svg beside the figure's pages. */
export function writeStill(dir, id, drawing, card) {
  const name = `${id}.svg`;
  writeFileSync(join(dir, name), stillSvg(id, drawing, card));
  console.log("wrote", name);
}
