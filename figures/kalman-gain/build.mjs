// Fig 2, the Kalman gain as a spring balance: "The Kalman gain trades trust between the model and the measurement".
//
// Concept: the update x̂⁺ = x̂⁻ + K(y − x̂⁻), K = P⁻/(P⁻ + R), is a weighted average whose weights are the inverse
// variances. Object: a carriage on a rail between two springs of equal rest length; the model's spring (stiffness
// 1/P⁻) is relaxed with the carriage at the prediction, the sensor's (stiffness 1/R) with it at the reading, so the
// carriage settles at the Kalman update and the pair is as stiff as 1/P⁺. A stiffer spring has a thicker wire
// (k ∝ d⁴ for the same coil), so the wire shows the trust. Riders on the ruler mark the prediction and the reading.
//
// Parts (about 55): base plate, four feet with flanges, groove, four corner screws with rings, ruler strip with
// ticks and two screws; two rails with screws and two end stops; the model's anchor block with a hook ring, screws and
// a stiffness dial with knurl and pointer, its arm, rod and rider; the left spring; the carriage: four bushings, plate,
// the lit estimate block with a groove, cap screws and two hook rings, its pointer fin and hairline; the right spring;
// the sensor's sled: four bushings, plate, anchor block with a hook ring, clamp knob and stiffness dial with knurl
// and pointer, its arm, rod and rider.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import { kitScript } from "../scripts/inline-kit.mjs";
import { writeStill } from "../scripts/still.mjs";
import { NOTE, RS, READING, update } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--dark") ? "dark" : "light";

const WIDTH = 600;
const HEIGHT = 340;
const SCALE = 600;
const MID = 2.15;
const X = (metres) => (metres - MID) * SCALE;

const PLATE = { x: -200, y: -40, w: 400, d: 104, r: 8 };
const PLATE_H = 12;
const FOOT_H = 5;
const RAIL_Y = [-22.5, 17.5];
const RAIL_X = [-190, 190];
const RULER = { x: -162, y: 43, w: 324, d: 10, r: 1 };

const HOOK_Z = 22;
const COIL_R = 7;
const TURNS = 8;
const HALF = 12;
const REST = 38;
const A_FACE = X(NOTE.prior) - HALF - REST;
const B_OFFSET = HALF + REST;
const ARM_Z = 8;
const FIN_Z = 11;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [A_FACE - 14, 0, 40], [X(READING[1]) + B_OFFSET + 14, 0, 40], [0, 0, 34]],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: 60 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 24))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  return out.join("");
}

function ruler() {
  const out = [S(k.slabOf(RULER, 0, 0.6, P, 3), { tone: "lo", crease: "none" })];
  const ticks = k.topTicks(RULER.x + 6, RULER.x + RULER.w - 6, 6, 5, RULER.y + 0.8, 0.6, [2, 3.8], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([RULER.x + 2.5, RULER.y + 5, 0.6]), at([RULER.x + RULER.w - 2.5, RULER.y + 5, 0.6])], { size: 0.45 }));
  return out.join("");
}

function rails() {
  const out = [];
  for (const y of RAIL_Y) {
    out.push(S(k.slabOf({ x: RAIL_X[0], y, w: RAIL_X[1] - RAIL_X[0], d: 5, r: 1 }, 0, 3, P, 3, 0.4), { tone: "mid" }));
    out.push(D([RAIL_X[0] + 8, -60, 60, RAIL_X[1] - 8].map((x) => at([x, y + 2.5, 3])), { size: 0.4 }));
  }
  for (const x of [RAIL_X[0] - 5, RAIL_X[1]]) {
    out.push(S(k.slabOf({ x, y: -25, w: 5, d: 50, r: 1.2 }, 0, 7, P, 3, 0.5), { tone: "mid" }));
    out.push(D([at([x + 2.5, -20, 7]), at([x + 2.5, 20, 7])], { size: 0.45 }));
  }
  return out.join("");
}

const dialPointer = (cx, cy, z, turn) => {
  const angle = turn * Math.PI * 2;
  return k.lineOnTop([cx - Math.sin(angle) * 1.2, cy + Math.cos(angle) * 1.2], [cx + Math.sin(angle) * 4, cy - Math.cos(angle) * 4], z, P);
};
const sensorTurn = (R) => (RS.indexOf(R) / (RS.length - 1)) * 0.6 - 0.3;

function anchorBlock(face, z0) {
  const block = { x: face - 14, y: -14, w: 14, d: 28, r: 2 };
  const out = [S(k.slabOf(block, z0, 34 - z0, P, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(block, z0 + 6, P, 3), { tone: "faint" }) })];
  out.push(L(k.sideRing([face, 0, HOOK_Z], 3, "x", P, 20), { tone: "lo" }));
  out.push(D([at([face, 0, HOOK_Z])], { size: 0.5, tone: "mid" }));
  out.push(D([at([block.x + 3, -11, 34]), at([block.x + 3, 11, 34])], { size: 0.45 }));
  return out.join("");
}

function dial(cx, cy, turn, extra = "") {
  return S(k.cylinder(cx, cy, 4.6, 34, 4, P, 32), { tone: "mid", inner: L(k.knurl(cx, cy, 4.6, 34, 38, 28, P), { tone: "lo" }) }) +
    L(k.ring(cx, cy, 1.2, 38, P, 12), { tone: "mid" }) + extra;
}

function modelAnchor() {
  return anchorBlock(A_FACE, 0) + dial(A_FACE - 7, 0, 0) + L(dialPointer(A_FACE - 7, 0, 38, 0), { tone: "hi" });
}

function modelRider() {
  const out = [];
  out.push(S(k.slabOf({ x: A_FACE - 9, y: 14, w: 4, d: 36, r: 1 }, ARM_Z, 2, P, 2), { tone: "mid" }));
  out.push(S(k.slabOf({ x: A_FACE - 9, y: 46, w: X(NOTE.prior) - 3 - (A_FACE - 9), d: 3, r: 1 }, ARM_Z, 2, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x: X(NOTE.prior) - 3, y: RULER.y, w: 6, d: RULER.d, r: 1 }, 0.6, ARM_Z + 2 - 0.6, P, 2, 0.3), { tone: "mid" }));
  out.push(L(k.lineOnTop([X(NOTE.prior), RULER.y], [X(NOTE.prior), RULER.y + RULER.d], ARM_Z + 2, P), { tone: "hi" }));
  return out.join("");
}

function carriage() {
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: -16, y: -22, w: 32, d: 44, r: 3 }, 3, 0.1, P)}" style="filter:blur(4px)"/>`];
  for (const [x, y] of byDepth([[-14, -23], [6, -23], [-14, 16], [6, 16]])) out.push(S(k.slabOf({ x, y, w: 8, d: 7, r: 1 }, 3, 6, P, 2, 0.3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -16, y: -24, w: 32, d: 48, r: 3 }, 6, 4, P, 4, 0.6), { tone: "mid" }));
  const block = { x: -HALF, y: -14, w: 2 * HALF, d: 28, r: 3 };
  out.push(S(k.slabOf(block, 10, 22, P, 4, 0.8), { tone: "hi", crease: "lo", lit: true }));
  out.push(L(k.planOutline(k.insetPlan(block, 3.5), 32, P, 4), { tone: "faint" }));
  out.push(D(k.corners(block, 6).map(([x, y]) => at([x, y, 32])), { size: 0.5, tone: "mid" }));
  out.push(L(k.sideRing([HALF, 0, HOOK_Z], 3, "x", P, 20), { tone: "lo" }));
  out.push(D([at([HALF, 0, HOOK_Z])], { size: 0.5, tone: "mid" }));
  return out.join("");
}

function fin() {
  return S(k.slabOf({ x: -2, y: 14, w: 4, d: 40, r: 0.8 }, FIN_Z, 2, P, 2), { tone: "mid" }) +
    L(k.lineOnTop([0, 14], [0, 54], FIN_Z + 2, P), { tone: "lit" });
}

// The sensor's sled is built at the reading of the note and moved with the reading.
const B0 = X(NOTE.reading) + B_OFFSET;
function sensorSled() {
  const out = [];
  for (const [x, y] of byDepth([[B0 - 2, -23], [B0 + 10, -23], [B0 - 2, 16], [B0 + 10, 16]])) out.push(S(k.slabOf({ x, y, w: 8, d: 7, r: 1 }, 3, 6, P, 2, 0.3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: B0 - 4, y: -24, w: 22, d: 48, r: 3 }, 6, 4, P, 4, 0.6), { tone: "mid" }));
  const block = { x: B0, y: -14, w: 14, d: 28, r: 2 };
  out.push(S(k.slabOf(block, 10, 24, P, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(block, 16, P, 3), { tone: "faint" }) }));
  out.push(L(k.sideRing([B0, 0, HOOK_Z], 3, "x", P, 20), { tone: "lo" }));
  out.push(D([at([B0, 0, HOOK_Z])], { size: 0.5, tone: "mid" }));
  out.push(S(k.cylinder(B0 + 7, -7, 3.6, 34, 5, P, 24), { tone: "mid", inner: L(k.knurl(B0 + 7, -7, 3.6, 34, 39, 22, P), { tone: "lo" }) }));
  out.push(dial(B0 + 7, 7, 0));
  return out.join("");
}

function sensorRider() {
  const out = [];
  out.push(S(k.slabOf({ x: B0 + 5, y: 14, w: 4, d: 36, r: 1 }, ARM_Z, 2, P, 2), { tone: "mid" }));
  out.push(S(k.slabOf({ x: X(NOTE.reading) + 3, y: 46, w: B0 + 5 - (X(NOTE.reading) + 3), d: 3, r: 1 }, ARM_Z, 2, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x: X(NOTE.reading) - 3, y: RULER.y, w: 6, d: RULER.d, r: 1 }, 0.6, ARM_Z + 2 - 0.6, P, 2, 0.3), { tone: "mid" }));
  out.push(L(k.lineOnTop([X(NOTE.reading), RULER.y], [X(NOTE.reading), RULER.y + RULER.d], ARM_Z + 2, P), { tone: "hi" }));
  return out.join("");
}

const width = (R) => (1.1 * Math.pow(NOTE.Pminus / R, 0.25)).toFixed(2);
const springs = (xc, b) => ({ left: k.coil(A_FACE, xc - HALF, [0, HOOK_Z], COIL_R, TURNS, "x", P), right: k.coil(xc + HALF, b, [0, HOOK_Z], COIL_R, TURNS, "x", P) });

const start = update(NOTE.prior, NOTE.Pminus, NOTE.reading, NOTE.R);
const XC0 = X(start.x);
const s0 = springs(XC0, B0);
const coilPath = (name, d, tone, w) => `<path data-part="${name}" class="iso-line" data-tone="${tone}" d="${d}" style="stroke-width:${w}"/>`;

const FIG = {
  width: WIDTH,
  height: HEIGHT,
  label:
    "A spring balance for the Kalman update. A carriage on two rails hangs between two springs: the model's spring, anchored on the left and relaxed when the carriage stands at the prediction, and the sensor's spring, on a sled on the right that moves with the reading. A rider on the ruler marks each. The carriage settles between them, nearer the stiffer spring, which is drawn with the thicker wire.",
  body: [
    plate(),
    ruler(),
    rails(),
    modelAnchor(),
    coilPath("left-back", s0.left.back, "lo", "1.10"),
    coilPath("left-front", s0.left.front, "mid", "1.10"),
    `<g data-part="carriage" transform="${k.translateAlong(P, [XC0, 0, 0])}">${carriage()}</g>`,
    coilPath("right-back", s0.right.back, "lo", width(NOTE.R)),
    coilPath("right-front", s0.right.front, "mid", width(NOTE.R)),
    `<g data-part="sled">${sensorSled()}</g>`,
    `<path data-part="sensor-dial" class="iso-line" data-tone="hi" d="${dialPointer(B0 + 7, 7, 38, sensorTurn(NOTE.R))}"/>`,
    modelRider(),
    `<g data-part="sled-rider">${sensorRider()}</g>`,
    `<g data-part="fin" transform="${k.translateAlong(P, [XC0, 0, 0])}">${fin()}</g>`,
  ],
};
const svg = k.figureSvg(FIG);

const format = (y, R) => {
  const u = update(NOTE.prior, NOTE.Pminus, y, R);
  return `y ${y.toFixed(3)} m · K ${u.K.toFixed(3)} · x⁺ ${u.x.toFixed(3)} m · P⁺ ${u.Pplus.toPrecision(3)}`;
};

const live = `
const NOTE = ${JSON.stringify(NOTE)}, RS = ${JSON.stringify(RS)}, READING = ${JSON.stringify(READING)};
${update.toString()}
const P = ${JSON.stringify(P)};
const SCALE = ${SCALE}, MID = ${MID}, A_FACE = ${A_FACE}, HALF = ${HALF}, B_OFFSET = ${B_OFFSET}, HOOK_Z = ${HOOK_Z}, COIL_R = ${COIL_R}, TURNS = ${TURNS}, B0 = ${B0};
const X = ${X.toString()};
const k = { coil, lineOnTop };
const springs = ${springs.toString()};
const width = ${width.toString()};
const dialPointer = ${dialPointer.toString()};
const sensorTurn = ${sensorTurn.toString()};
const format = ${format.toString()};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const part = (name) => svg.querySelector('[data-part="' + name + '"]');
const els = ["left-back", "left-front", "right-back", "right-front", "carriage", "fin", "sled", "sled-rider", "sensor-dial"].reduce((o, n) => (o[n] = part(n), o), {});
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
let y = NOTE.reading, R = NOTE.R, shown = { y: y, xc: X(update(NOTE.prior, NOTE.Pminus, y, R).x) };
let frame = 0, last = 0, clock = 0, touring = true, visible = false, inside = false, idleTimer = 0;
const TOUR = [2, 1, 0, 1, 2, 3];
function draw() {
  const b = X(shown.y) + B_OFFSET;
  const s = springs(shown.xc, b);
  els["left-back"].setAttribute("d", s.left.back);
  els["left-front"].setAttribute("d", s.left.front);
  els["right-back"].setAttribute("d", s.right.back);
  els["right-front"].setAttribute("d", s.right.front);
  const w = width(R);
  els["right-back"].style.strokeWidth = w;
  els["right-front"].style.strokeWidth = w;
  els.carriage.setAttribute("transform", translateAlong(P, [shown.xc, 0, 0]));
  els.fin.setAttribute("transform", translateAlong(P, [shown.xc, 0, 0]));
  const sled = translateAlong(P, [b - B0, 0, 0]);
  els.sled.setAttribute("transform", sled);
  els["sled-rider"].setAttribute("transform", sled);
  els["sensor-dial"].setAttribute("d", dialPointer(b + 7, 7, 38, sensorTurn(R)));
  els["sensor-dial"].removeAttribute("transform");
  const text = format(shown.y, R);
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", shown.y.toFixed(3));
  stage.setAttribute("aria-valuetext", text);
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (touring) { clock += dt; R = RS[TOUR[Math.floor(clock / 3.2) % TOUR.length]]; }
  const target = X(update(NOTE.prior, NOTE.Pminus, y, R).x);
  const ease = still.matches ? 1 : 1 - Math.exp(-dt / 0.3);
  shown.y += (y - shown.y) * ease;
  shown.xc += (target - shown.xc) * ease;
  if (Math.abs(y - shown.y) < 1e-5) shown.y = y;
  if (Math.abs(target - shown.xc) < 0.01) shown.xc = target;
  draw();
  const settled = !touring && shown.y === y && shown.xc === target;
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const rest = () => { clearTimeout(idleTimer); if (inside) return; idleTimer = setTimeout(() => { touring = !still.matches; clock = 0; run(); }, 4000); };
const steer = (next) => { touring = false; y = clamp(next, READING[0], READING[1]); rest(); run(); };
const noise = (step) => { touring = false; const i = RS.indexOf(R); R = RS[(i + step + RS.length) % RS.length]; rest(); run(); };
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
if (still.matches) touring = false;
stage.addEventListener("pointerenter", (event) => { if (event.pointerType !== "touch") { inside = true; clearTimeout(idleTimer); } });
stage.addEventListener("pointerleave", () => { inside = false; rest(); });
stage.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") return;
  const box = svg.getBoundingClientRect();
  steer(READING[0] + clamp(((event.clientX - box.left) / box.width - 0.2) / 0.6, 0, 1) * (READING[1] - READING[0]));
});
stage.addEventListener("click", () => noise(1));
stage.addEventListener("keydown", (event) => {
  let handled = true;
  if (event.key === "ArrowRight") steer(y + 0.01);
  else if (event.key === "ArrowLeft") steer(y - 0.01);
  else if (event.key === "ArrowUp") noise(-1);
  else if (event.key === "ArrowDown") noise(1);
  else handled = false;
  if (handled) event.preventDefault();
});
draw();
`;

const CARD = { fig: "Fig 2", title: "Kalman gain balance", readout: format(NOTE.reading, NOTE.R) };
const body = k.plateHtml({
  ...CARD,
  hint: "Hover: reading · tap: sensor noise",
  keys: [
    { mark: "lit", label: "The estimate x⁺: where the forces cancel" },
    { mark: "raised", label: "Springs as stiff as 1/P⁻ (model) and 1/R (sensor)" },
  ],
  caption:
    `The model predicts ${NOTE.prior.toFixed(2)} m with P⁻ = ${NOTE.Pminus}; the sensor reads ${NOTE.reading.toFixed(2)} m with R = ${NOTE.R}. Each spring is relaxed with the carriage at its own guess, so the carriage settles at their average weighted by stiffness, x⁻ + K(y − x⁻) with K = P⁻/(P⁻ + R) = ${start.K.toFixed(3)}: ${start.x.toFixed(3)} m. ` +
    `The two springs together are as stiff as 1/P⁺, P⁺ = (1 − K)P⁻ = ${start.Pplus.toPrecision(3)}. A quieter sensor has a stiffer spring and pulls the estimate toward the reading; a noisier one lets the model hold it.`,
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Kalman gain balance: left and right arrows move the reading, up and down change how noisy the sensor is" aria-valuemin="${READING[0]}" aria-valuemax="${READING[1]}" aria-valuenow="${NOTE.reading}">${svg}</div>`,
});

const name = theme === "light" ? "kalman-gain.html" : "kalman-gain-dark.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "Kalman gain balance", theme, body, script: kitScript() + live }));
console.log("wrote", name);
if (theme === "light") writeStill(HERE, "kalman-gain", FIG, CARD);
