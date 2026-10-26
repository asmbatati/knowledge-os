// Every figure's pages into the vault, for Obsidian's ```figure block (Engineering 3D Viewer), on a phone too:
// <vault>/<folder>/<id>/<id>.html and <id>-dark.html, the layout the site serves. The pages are binaries in all but
// name; the vault's git ignores x/ASSETS/ already. Each figure's still drawing, <id>.svg (still.mjs), goes beside the
// notes it explains, into <vault>/<stills>/, for ![[<id>.svg]] (the vault's git ignores every attachments/ folder);
// a file of that name is replaced only when it is this figure's still (its data-figure). A dry run unless --apply; it
// builds each figure first, writes only inside those two folders, never deletes, and refuses the vault jobs' night
// (23:55–04:30).
//
//   node figures/scripts/to-vault.mjs [--vault <path>] [--folder x/ASSETS/Figures]
//                                     [--stills Atlas/Concepts/attachments] [--apply]

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIGURES = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (flag, fallback) => { const i = process.argv.indexOf(flag); return i < 0 ? fallback : process.argv[i + 1]; };
const apply = process.argv.includes("--apply");
const settings = join(FIGURES, "..", "knowledge-os.json");
const vault = arg("--vault", existsSync(settings) ? JSON.parse(readFileSync(settings, "utf8")).vault : "");
const folder = arg("--folder", "x/ASSETS/Figures");
const stills = arg("--stills", "Atlas/Concepts/attachments");

export function inNight(now = new Date()) {
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= 23 * 60 + 55 || m < 4 * 60 + 30;
}

/** May <file> be replaced by figure <id>'s still? Only when it is missing or is that figure's still already. */
export function stillReplaceable(file, id) {
  if (!existsSync(file)) return true;
  return readFileSync(file, "utf8").slice(0, 4096).includes(`data-figure="${id}"`);
}

function main() {
  if (!vault || !existsSync(join(vault, ".obsidian"))) throw new Error(`no vault at ${vault || "(none set)"}: pass --vault`);
  for (const f of [folder, stills])
    if (/(^|[\\/])\.\.([\\/]|$)/.test(f) || /^[a-z]:|^[\\/]/i.test(f)) throw new Error(`the folder must be a vault path: ${f}`);
  if (apply && inNight()) throw new Error("the vault's jobs run 23:55–04:30: try again after");
  const ids = readdirSync(FIGURES).filter((d) => existsSync(join(FIGURES, d, "build.mjs")));
  for (const id of ids) {
    if (apply) for (const theme of [[], ["--dark"]]) execFileSync(process.execPath, [join(FIGURES, id, "build.mjs"), ...theme], { stdio: "ignore" });
    for (const page of [`${id}.html`, `${id}-dark.html`]) {
      const from = join(FIGURES, id, page);
      const to = join(vault, folder, id, page);
      if (!existsSync(from)) { console.log(`skip ${id}/${page}: not built (run with --apply to build it)`); continue; }
      const kb = Math.round(statSync(from).size / 1024);
      if (!apply) { console.log(`would copy ${id}/${page} (${kb} KB) to ${folder}/${id}/`); continue; }
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      console.log(`copied ${id}/${page} (${kb} KB)`);
    }
    const still = join(FIGURES, id, `${id}.svg`);
    const stillTo = join(vault, stills, `${id}.svg`);
    if (!existsSync(still)) { console.log(`skip ${id}/${id}.svg: not built (run with --apply to build it)`); continue; }
    if (!stillReplaceable(stillTo, id)) { console.log(`skip ${id}.svg: ${stills}/${id}.svg is another file; left as it is`); continue; }
    const kb = Math.round(statSync(still).size / 1024);
    if (!apply) { console.log(`would copy ${id}/${id}.svg (${kb} KB) to ${stills}/`); continue; }
    mkdirSync(dirname(stillTo), { recursive: true });
    copyFileSync(still, stillTo);
    console.log(`copied ${id}/${id}.svg (${kb} KB) to ${stills}/`);
  }
  if (!apply) console.log("dry run: --apply builds and copies");
}

if (process.argv[1] && process.argv[1].endsWith("to-vault.mjs")) main();
