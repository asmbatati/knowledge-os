// Fig 1, a forced vibration bench: Resonance Frequency's worked example as a machine.
//
// Concept: driven at ω, a damped mass-spring swings hardest just below its natural frequency, X/(F0/k) peaking at
// 1/(2ζ√(1−ζ²)) at ωn√(1−2ζ²) and lagging the drive by 90° at ωn. Object: a motor turns an eccentric inside a yoke,
// so the yoke and the far end of the spring move exactly Y cos θ; a 2 kg mass rides two rails on an 800 N/m spring,
// with an oil dashpot to the base. With the damper to the base the drive is the force kY cos ωt, so the 6 mm throw
// is F0/k and the swing of the mass against the throw of the yoke is the note's ratio, seen.
//
// Parts (about 70): base plate, four feet with flanges, groove, four corner screws with rings, ruler strip with ticks,
// its zero mark and two screws; two rails with screws and four end stops; motor flange, body with cooling ribs and two
// seams, cap ring and shaft hub; eccentric disc, its hub and index line; yoke frame of four bars on four shoes and
// posts, yoke rod and spring seat; the spring; the mass: carriage, four bushings, weight block with a groove, four cap
// screws and one engraved label, a pointer fin with its hairline, and the damper rod; the dashpot: two saddle feet,
// gland, body with two seams, fill plug, valve knob with knurl and index, end screws; the controller: box, tachometer
// dial with ticks and needle, speed knob with knurl and pointer, power switch, corner screws, and the motor cable.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import { kitScript } from "../scripts/inline-kit.mjs";
import { writeStill } from "../scripts/still.mjs";
import { RIG, omegaN, dampingOf, steady, peakOf, advance } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--dark") ? "dark" : "light";

const WIDTH = 600;
const HEIGHT = 340;

const PLATE = { x: -190, y: -42, w: 372, d: 102, r: 8 };
const PLATE_H = 12;
const FOOT_H = 5;
const RAIL_Y = [-22.5, 17.5];
const RAIL_X = [-178, 76];

const CX = -150;
const ECC_R = 12;
const BAR_Z = 27;
const BAR_H = 6;
const SEAT_X = 40;
const SPRING_Z = 27;
const SPRING_R = 8;

const MASS_LEFT = -16;
const MASS_RIGHT = 32;
const POINTER_X = 10;
const ROD_TIP = 127;
const DAMP_AXIS = 20;
const BODY = { x: 84, y: -13, w: 84, d: 26, r: 6 };
const KNOB = [150, 0];
const RULER = { x: -50, y: 38, w: 116, d: 7, r: 1 };

const TACHO = [-160, 43];
const TACHO_R = 9;
const TACHO_TOP = 19;
const TACHO_SPAN = (270 * Math.PI) / 180;
const TACHO_FROM = (-135 * Math.PI) / 180;
const TACHO_MAX = 40;
const SPEED = [-134, 43];

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [CX, 0, 44], [MASS_LEFT, 0, 42], [KNOB[0], 0, 40], [PLATE.x + PLATE.w, 0, 36]],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: 60 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const move = (plan, dx, dy = 0) => ({ ...plan, x: plan.x + dx, y: plan.y + dy });

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
  const ticks = k.topTicks(RULER.x + 4, RULER.x + RULER.w - 4, 2, 5, RULER.y + 0.8, 0.6, [1.8, 3.4], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(L(k.lineOnTop([POINTER_X, RULER.y + 0.8], [POINTER_X, RULER.y + 5], 0.6, P), { tone: "hi" }));
  out.push(D([at([RULER.x + 2, RULER.y + 3.5, 0.6]), at([RULER.x + RULER.w - 2, RULER.y + 3.5, 0.6])], { size: 0.45 }));
  return out.join("");
}

function rails() {
  const out = [];
  for (const y of RAIL_Y) {
    out.push(S(k.slabOf({ x: RAIL_X[0], y, w: RAIL_X[1] - RAIL_X[0], d: 5, r: 1 }, 0, 3, P, 3, 0.4), { tone: "mid" }));
    out.push(D([RAIL_X[0] + 8, -96, -40, RAIL_X[1] - 8].map((x) => at([x, y + 2.5, 3])), { size: 0.4 }));
  }
  return out.join("");
}

function stop(x) {
  return S(k.slabOf({ x, y: -25, w: 5, d: 50, r: 1.2 }, 0, 7, P, 3, 0.5), { tone: "mid" }) + D([at([x + 2.5, -20, 7]), at([x + 2.5, 20, 7])], { size: 0.45 });
}

function motor() {
  const out = [];
  out.push(S(k.cylinder(CX, 0, 13, 0, 2, P, 40), { tone: "lo" }));
  const ribs = L(k.knurl(CX, 0, 11, 6, 18, 40, P, 0.3), { tone: "lo" });
  const seams = L(k.sideArc(CX, 0, 11, 6, P, 32) + k.sideArc(CX, 0, 11, 18, P, 32), { tone: "faint" });
  out.push(S(k.cylinder(CX, 0, 11, 2, 20, P, 48), { tone: "mid", inner: ribs + seams }));
  out.push(S(k.cylinder(CX, 0, 12, 22, 2, P, 48, 0.5), { tone: "mid" }));
  out.push(S(k.cylinder(CX, 0, 3.4, 24, 3, P, 20), { tone: "mid" }));
  out.push(D(byDepth([[CX - 8.6, -8.6], [CX + 8.6, -8.6], [CX - 8.6, 8.6], [CX + 8.6, 8.6]]).map(([x, y]) => at([x, y, 24])), { size: 0.4 }));
  return out.join("");
}

const BACK_BAR = { x: CX - 16, y: -23, w: 32, d: 4, r: 1 };
const FRONT_BAR = { x: CX - 16, y: 19, w: 32, d: 4, r: 1 };
const LEFT_BAR = { x: CX - 16, y: -19, w: 4, d: 38, r: 0.6 };
const RIGHT_BAR = { x: CX + 12, y: -19, w: 4, d: 38, r: 0.6 };

function shoe(x, y) {
  const out = [];
  out.push(S(k.slabOf({ x: x - 4, y: y - 3.5, w: 8, d: 7, r: 1 }, 3, 4, P, 2, 0.3), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 1.8, 7, BAR_Z - 7, P, 16), { tone: "mid", crease: "none" }));
  return out.join("");
}

function yokeBack() {
  const out = [];
  for (const x of [CX - 14, CX + 14]) out.push(shoe(x, -20));
  out.push(S(k.slabOf(BACK_BAR, BAR_Z, BAR_H, P, 2, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf(LEFT_BAR, BAR_Z, BAR_H, P, 2, 0.4), { tone: "mid" }));
  return out.join("");
}

function yokeFront() {
  const out = [];
  out.push(S(k.slabOf(RIGHT_BAR, BAR_Z, BAR_H, P, 2, 0.4), { tone: "mid" }));
  for (const x of [CX - 14, CX + 14]) out.push(shoe(x, 20));
  out.push(S(k.slabOf(FRONT_BAR, BAR_Z, BAR_H, P, 2, 0.4), { tone: "mid" }));
  out.push(D([at([CX - 14, 21, BAR_Z + BAR_H]), at([CX + 14, 21, BAR_Z + BAR_H]), at([CX - 14, -21, BAR_Z + BAR_H]), at([CX + 14, -21, BAR_Z + BAR_H])], { size: 0.45 }));
  out.push(S(k.slabOf({ x: CX + 16, y: -2, w: SEAT_X - 16, d: 4, r: 1.5 }, SPRING_Z - 2, 4, P, 3), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x: CX + SEAT_X, y: -11, w: 3, d: 22, r: 1 }, SPRING_Z - 10, 20, P, 3, 0.4), { tone: "mid" }));
  out.push(D([at([CX + SEAT_X + 1.5, -7, SPRING_Z + 10]), at([CX + SEAT_X + 1.5, 7, SPRING_Z + 10])], { size: 0.4 }));
  out.push(L(k.sideRing([CX + SEAT_X + 3, 0, SPRING_Z], SPRING_R, "x", P, 32), { tone: "lo" }));
  return out.join("");
}

// The eccentric is rebuilt every frame: its centre turns on a circle of radius Y about the shaft.
function eccentric(theta) {
  const cx = CX + RIG.throw * Math.cos(theta);
  const cy = RIG.throw * Math.sin(theta);
  const top = BAR_Z + BAR_H;
  return (
    S(k.cylinder(cx, cy, ECC_R, BAR_Z, BAR_H, P, 56, 0.5), { tone: "hi" }) +
    L(k.lineOnTop([CX, 0], [cx + ((cx - CX) * ECC_R) / RIG.throw, cy + (cy * ECC_R) / RIG.throw], top, P), { tone: "lo" }) +
    S(k.cylinder(CX, 0, 3, top, 2, P, 20), { tone: "mid" }) +
    D([at([CX, 0, top + 2])], { size: 0.5, tone: "hi" })
  );
}

function spring(from, to) {
  return k.coil(from, to, [0, SPRING_Z], SPRING_R, 10, "x", P);
}

function mass() {
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: -18, y: -22, w: 52, d: 44, r: 3 }, 3, 0.1, P)}" style="filter:blur(4px)"/>`];
  const bushings = [[-18, -23], [22, -23], [-18, 16], [22, 16]];
  for (const [x, y] of byDepth(bushings)) out.push(S(k.slabOf({ x, y, w: 12, d: 7, r: 1 }, 3, 6, P, 2, 0.3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -20, y: -24, w: 56, d: 48, r: 3 }, 6, 4, P, 5, 0.6), { tone: "mid" }));
  out.push(D([-14, -2, 10, 22, 30].map((x) => at([x, 21.4, 10])), { size: 0.4, tone: "lo" }));
  const block = { x: MASS_LEFT, y: -18, w: MASS_RIGHT - MASS_LEFT, d: 36, r: 3 };
  out.push(S(k.slabOf(block, 10, 30, P, 5, 0.8), { tone: "hi", crease: "lo", lit: true, inner: L(k.sideSeam(block, 16, P, 5), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(block, 4), 40, P, 4), { tone: "faint" }));
  out.push(D(k.corners(block, 7).map(([x, y]) => at([x, y, 40])), { size: 0.5, tone: "mid" }));
  out.push(k.faceTextSvg(k.topMatrix([(MASS_LEFT + MASS_RIGHT) / 2, 2], 40, P, "x"), "2 kg", { size: 4, tone: "lo", anchor: "middle" }));
  out.push(S(k.slabOf({ x: MASS_RIGHT, y: -2, w: ROD_TIP - MASS_RIGHT, d: 4, r: 1.8 }, DAMP_AXIS - 2, 4, P, 3), { tone: "hi", crease: "none" }));
  out.push(S(k.slabOf({ x: POINTER_X - 2, y: 24, w: 4, d: 17, r: 0.8 }, 6, 2, P, 2), { tone: "mid" }));
  out.push(L(k.lineOnTop([POINTER_X, 24], [POINTER_X, 41], 8, P), { tone: "hi" }));
  return out.join("");
}

function dashpot() {
  const out = [];
  for (const x of [92, 152]) out.push(S(k.slabOf({ x, y: -16, w: 8, d: 32, r: 1.2 }, 0, 8, P, 3, 0.4), { tone: "lo" }));
  out.push(S(k.slabOf({ x: 80, y: -6, w: 4, d: 12, r: 1.5 }, DAMP_AXIS - 6, 12, P, 3, 0.4), { tone: "mid" }));
  out.push(L(k.sideRing([80, 0, DAMP_AXIS], 2.4, "x", P, 20), { tone: "faint" }));
  const seams = L(k.sideSeam(BODY, 12, P, 6) + k.sideSeam(BODY, 28, P, 6), { tone: "faint" });
  out.push(S(k.slabOf(BODY, 7, 26, P, 6, 1), { tone: "mid", inner: seams }));
  out.push(L(k.planOutline(k.insetPlan(BODY, 4), 33, P, 6), { tone: "faint" }));
  out.push(D([[BODY.x + 6, -8], [BODY.x + 6, 8], [BODY.x + BODY.w - 6, -8], [BODY.x + BODY.w - 6, 8]].map(([x, y]) => at([x, y, 33])), { size: 0.45 }));
  out.push(S(k.cylinder(100, 0, 3, 33, 2, P, 20), { tone: "mid" }));
  out.push(L(k.ring(100, 0, 1.4, 35, P, 12), { tone: "lo" }));
  out.push(S(k.cylinder(KNOB[0], KNOB[1], 4.6, 33, 5, P, 32), { tone: "mid", inner: L(k.knurl(KNOB[0], KNOB[1], 4.6, 33, 38, 30, P), { tone: "lo" }) }));
  return out.join("");
}

const knobPointer = (zeta) => {
  const turn = (RIG.zetas.indexOf(zeta) / (RIG.zetas.length - 1)) * 0.6 - 0.3;
  const angle = turn * Math.PI * 2;
  return k.lineOnTop([KNOB[0] - Math.sin(angle) * 1.4, KNOB[1] + Math.cos(angle) * 1.4], [KNOB[0] + Math.sin(angle) * 4, KNOB[1] - Math.cos(angle) * 4], 38, P);
};

function controller() {
  const box = { x: -178, y: 30, w: 62, d: 26, r: 3 };
  const out = [S(k.slabOf(box, 0, 16, P, 4, 0.8), { tone: "mid", inner: L(k.sideSeam(box, 4, P, 4), { tone: "faint" }) })];
  out.push(D(k.corners(box, 4).map(([x, y]) => at([x, y, 16])), { size: 0.45 }));
  const [tx, ty] = TACHO;
  out.push(S(k.cylinder(tx, ty, TACHO_R, 16, 3, P, 48, 0.5), { tone: "hi", crease: "lo" }));
  out.push(L(k.ring(tx, ty, TACHO_R - 1.4, TACHO_TOP, P, 48), { tone: "lo" }));
  const ticks = k.radialTicks(tx, ty, TACHO_R - 2, 40, 5, TACHO_TOP, [0.9, 2], P, TACHO_FROM, TACHO_SPAN);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(L(k.ring(tx, ty, 1, TACHO_TOP, P, 12), { tone: "mid" }));
  const [sx, sy] = SPEED;
  out.push(S(k.cylinder(sx, sy, 5, 16, 4, P, 32), { tone: "mid", inner: L(k.knurl(sx, sy, 5, 16, 20, 30, P), { tone: "lo" }) }));
  out.push(S(k.slabOf({ x: -124, y: 34, w: 5, d: 8, r: 1 }, 16, 2, P, 2), { tone: "lo" }));
  out.push(S(k.slabOf({ x: -123, y: 35.5, w: 3, d: 3, r: 0.8 }, 18, 2, P, 2), { tone: "hi" }));
  return out.join("");
}

const tachoNeedle = (omega) => {
  const angle = TACHO_FROM + (Math.min(omega, TACHO_MAX) / TACHO_MAX) * TACHO_SPAN;
  const [x, y] = TACHO;
  return k.lineOnTop([x - Math.sin(angle) * 1.6, y + Math.cos(angle) * 1.6], [x + Math.sin(angle) * (TACHO_R - 2.6), y - Math.cos(angle) * (TACHO_R - 2.6)], TACHO_TOP + 0.2, P);
};
const speedPointer = (omega) => {
  const angle = TACHO_FROM + ((omega - RIG.omega[0]) / (RIG.omega[1] - RIG.omega[0])) * TACHO_SPAN;
  const [x, y] = SPEED;
  return k.lineOnTop([x, y], [x + Math.sin(angle) * 4.2, y - Math.cos(angle) * 4.2], 20, P);
};

const cable = () => k.wireSvg(at([-150, 33, 16]), at([-150, 11, 13]), { via: [at([-150, 27, 19]), at([-150, 19, 17])], tone: "lo", size: 1.1 });

const START_OMEGA = 16;
const START_ZETA = 0.1;
const startCoil = spring(CX + SEAT_X + 3 + RIG.throw, MASS_LEFT);

const FIG = {
  width: WIDTH,
  height: HEIGHT,
  label:
    "A forced vibration bench. A motor turns an eccentric inside a yoke, which moves the far end of a coil spring back and forth 6 mm each way. A 2 kg mass rides on two rails at the other end of the spring, with an oil dashpot behind it, a pointer over a ruler and a tachometer on the controller. As the motor speed nears 20 rad/s, the mass swings several times farther than the yoke moves.",
  body: [
    plate(),
    ruler(),
    rails(),
    stop(RAIL_X[0] - 5),
    motor(),
    `<g data-part="yoke-back" transform="${k.translateAlong(P, [RIG.throw, 0, 0])}">${yokeBack()}</g>`,
    `<g data-part="eccentric">${eccentric(0)}</g>`,
    `<g data-part="yoke-front" transform="${k.translateAlong(P, [RIG.throw, 0, 0])}">${yokeFront()}</g>`,
    `<path data-part="coil-back" class="iso-line" data-tone="lo" d="${startCoil.back}"/>`,
    `<path data-part="coil-front" class="iso-line" data-tone="mid" d="${startCoil.front}"/>`,
    `<g data-part="mass">${mass()}</g>`,
    stop(RAIL_X[1]),
    dashpot(),
    `<path data-part="knob" class="iso-line" data-tone="hi" d="${knobPointer(START_ZETA)}"/>`,
    controller(),
    cable(),
    `<path data-part="needle" class="iso-line" data-tone="hi" data-free="start" d="${tachoNeedle(START_OMEGA)}" style="stroke-width:0.8"/>`,
    `<path data-part="speed" class="iso-line" data-tone="hi" d="${speedPointer(START_OMEGA)}"/>`,
  ],
};
const svg = k.figureSvg(FIG);

const format = (omega, zeta) => {
  const s = steady(omega, zeta);
  return `ω ${omega.toFixed(1)} rad/s · ζ ${zeta} · X ${s.ratio.toFixed(2)} Y · lag ${Math.round((s.lag * 180) / Math.PI)}°`;
};

const live = `
const RIG = ${JSON.stringify(RIG)};
const omegaN = ${omegaN.toString()};
const dampingOf = ${dampingOf.toString()};
${steady.toString()}
${advance.toString()}
const P = ${JSON.stringify(P)};
const CX = ${CX}, ECC_R = ${ECC_R}, BAR_Z = ${BAR_Z}, BAR_H = ${BAR_H}, SEAT_X = ${SEAT_X}, SPRING_Z = ${SPRING_Z}, SPRING_R = ${SPRING_R}, MASS_LEFT = ${MASS_LEFT};
const KNOB = ${JSON.stringify(KNOB)}, TACHO = ${JSON.stringify(TACHO)}, SPEED = ${JSON.stringify(SPEED)};
const TACHO_R = ${TACHO_R}, TACHO_TOP = ${TACHO_TOP}, TACHO_SPAN = ${TACHO_SPAN}, TACHO_FROM = ${TACHO_FROM}, TACHO_MAX = ${TACHO_MAX};
const S = (paths, style) => solidSvg(paths, style), L = (d, style) => lineSvg(d, style), D = (points, style) => dotsSvg(points, style);
const at = (point) => iso(point, P);
const k = { cylinder, lineOnTop };
${eccentric.toString()}
const knobPointer = ${knobPointer.toString()};
const tachoNeedle = ${tachoNeedle.toString()};
const speedPointer = ${speedPointer.toString()};
const format = ${format.toString()};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const part = (name) => svg.querySelector('[data-part="' + name + '"]');
const yokeBack = part("yoke-back"), yokeFront = part("yoke-front"), ecc = part("eccentric"), coilBack = part("coil-back"), coilFront = part("coil-front");
const massEl = part("mass"), knob = part("knob"), needle = part("needle"), speed = part("speed");
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
let sim = { x: 0, v: 0, theta: 0 }, omega = ${START_OMEGA}, target = omega, zeta = ${START_ZETA};
let frame = 0, last = 0, clock = 0, touring = true, visible = false, inside = false, idleTimer = 0, shownOmega = -1, shownZeta = -1;
const tourAt = (t) => 20 + 9 * Math.sin((2 * Math.PI * t) / 32 - Math.PI / 2);
function draw() {
  const yoke = RIG.throw * Math.cos(sim.theta);
  const shift = translateAlong(P, [yoke, 0, 0]);
  yokeBack.setAttribute("transform", shift);
  yokeFront.setAttribute("transform", shift);
  ecc.innerHTML = eccentric(sim.theta);
  const c = coil(CX + SEAT_X + 3 + yoke, MASS_LEFT + sim.x, [0, SPRING_Z], SPRING_R, 10, "x", P);
  coilBack.setAttribute("d", c.back);
  coilFront.setAttribute("d", c.front);
  massEl.setAttribute("transform", translateAlong(P, [sim.x, 0, 0]));
  if (Math.abs(omega - shownOmega) > 0.02) {
    needle.setAttribute("d", tachoNeedle(omega));
    speed.setAttribute("d", speedPointer(omega));
    shownOmega = omega;
  }
  if (zeta !== shownZeta) { knob.setAttribute("d", knobPointer(zeta)); shownZeta = zeta; }
  const text = format(omega, zeta);
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", omega.toFixed(1));
  stage.setAttribute("aria-valuetext", text);
}
function pose() {
  const s = steady(omega, zeta);
  sim = { x: s.amplitude * Math.cos(s.lag), v: 0, theta: 0 };
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (touring) { clock += dt; target = tourAt(clock); }
  omega += (target - omega) * (1 - Math.exp(-dt / 0.9));
  if (still.matches) { omega = target; pose(); } else sim = advance(sim, dt, omega, zeta, RIG, 8);
  draw();
  frame = visible && !still.matches ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const rest = () => { clearTimeout(idleTimer); if (inside) return; idleTimer = setTimeout(() => { touring = !still.matches; clock = Math.asin(clamp((omega - 20) / 9, -1, 1)) * 32 / (2 * Math.PI) + 8; run(); }, 4000); };
const steer = (next) => { touring = false; target = clamp(next, RIG.omega[0], RIG.omega[1]); rest(); run(); if (still.matches) { omega = target; pose(); draw(); } };
const damp = (step) => { const i = RIG.zetas.indexOf(zeta); zeta = RIG.zetas[(i + step + RIG.zetas.length) % RIG.zetas.length]; rest(); run(); if (still.matches) { pose(); draw(); } };
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
if (still.matches) { touring = false; pose(); }
stage.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") return;
  const box = svg.getBoundingClientRect();
  steer(RIG.omega[0] + clamp((event.clientX - box.left) / box.width, 0, 1) * (RIG.omega[1] - RIG.omega[0]));
});
stage.addEventListener("pointerenter", (event) => { if (event.pointerType !== "touch") { inside = true; clearTimeout(idleTimer); } });
stage.addEventListener("pointerleave", () => { inside = false; rest(); });
stage.addEventListener("click", () => damp(1));
stage.addEventListener("keydown", (event) => {
  let handled = true;
  if (event.key === "ArrowRight") steer(target + 1);
  else if (event.key === "ArrowLeft") steer(target - 1);
  else if (event.key === "ArrowUp") damp(1);
  else if (event.key === "ArrowDown") damp(-1);
  else if (event.key === "Home") steer(RIG.omega[0]);
  else if (event.key === "End") steer(RIG.omega[1]);
  else handled = false;
  if (handled) event.preventDefault();
});
draw();
`;

const peak = peakOf(START_ZETA);
const CARD = { fig: "Fig 1", title: "Forced vibration bench", readout: format(START_OMEGA, START_ZETA) };
const body = k.plateHtml({
  ...CARD,
  hint: "Hover: speed · tap: damping",
  keys: [
    { mark: "lit", label: "The 2 kg mass: its swing X" },
    { mark: "raised", label: "The eccentric: it moves the spring's far end Y = 6 mm each way" },
  ],
  caption:
    `A 2 kg mass on an 800 N/m spring, so ωn = ${omegaN().toFixed(0)} rad/s, with an oil dashpot to the base. The eccentric moves the spring's far end Y = ${RIG.throw} mm each way, which drives the mass with kY = ${(RIG.k * RIG.throw / 1000).toFixed(1)} N, so Y is the static deflection F0/k. ` +
    `At ζ = ${START_ZETA} (c = ${dampingOf(START_ZETA)} N·s/m) the swing peaks at ${peak.ratio.toFixed(2)} Y near ${peak.omega.toFixed(1)} rad/s, just below ωn, lagging the drive by about 90°; well below, the mass follows the yoke; well above, it barely moves and swings against it. More damping lowers and widens the peak.`,
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Forced vibration bench: left and right arrows set the motor speed, up and down the damping" aria-valuemin="${RIG.omega[0]}" aria-valuemax="${RIG.omega[1]}" aria-valuenow="${START_OMEGA}">${svg}</div>`,
});

const name = theme === "light" ? "shake-table.html" : "shake-table-dark.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "Forced vibration bench", theme, body, script: kitScript() + live }));
console.log("wrote", name);
if (theme === "light") writeStill(HERE, "shake-table", FIG, CARD);
