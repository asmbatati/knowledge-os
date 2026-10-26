// Fig 3, the half-turns of PD control on SO(3): "With a scalar gain every half-turn is an equilibrium of PD control on
// SO(3); three distinct stiffnesses leave three unstable ones, the fewest any smooth potential on SO(3) allows".
//
// Concept: the geometric PD law τ = −k_p sk(GR)^∨ − K_d ω rests wherever sk(GR) vanishes. With a scalar gain that is
// the goal and every half-turn; with three distinct stiffnesses only the goal and the three half-turns about G's axes.
// Object: a brass ball on a pivot in an oil cup carries three pins, its body axes. Each pin is tied to an eye on its own
// post by a zero-length spring, so the springs store Σ k_i(1 − cos φ_i), which is k_p Ψ: the springs' stiffnesses are
// the co-stiffness G, and the oil is K_d. The posts stand where the pins point at home, a cube's corner up. A pin
// carries as many bands as its post's collar has grooves, and each post's dial shows its spring's stiffness.
//
// Parts (about 70): round base on three feet with a groove ring and three rim screws; the pedestal: flange with four
// screws, column, collar and the oil cup with its seam and the oil's edge; the lit ball; three posts, each a flange with
// two screws, a column, a collar with one to three grooves, an eye with its boss dot, and a knurled stiffness dial with
// a pointer and hub ring; three pins, each a rod with a highlight, one to three bands and a knob; three coil springs
// with an end dot at each eyelet.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import { iso, depthOf, pathOf, lineOnTop } from "../kit/iso-kit.mjs";
import { sphereOf } from "../kit/lathe.mjs";
import { kitScript } from "../scripts/inline-kit.mjs";
import { writeStill } from "../scripts/still.mjs";
import { NOTE, GAINS, STARTS, quatOf, rotOf, errorOf, psiOf, angleOf, rateOf, stepOf, release } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--dark") ? "dark" : "light";

const WIDTH = 600;
const HEIGHT = 420;
const H = 64;
const C = [0, 0, H];
const BALL = 9;
const RHO = 54;
const EYE = 62;
const KNOB = 2.7;
const ROD = 1.25;
const BAND = 1.9;
const EYE_R = 2.3;
const COIL_R = 2.5;
const TURNS = 24;
const BASE_R = 68;
const BASE_H = 9;
const FOOT_H = 4;
const COL_R = 3.6;
const COLLAR_R = 4.8;

// Home: a cube's corner up, the three axes 120° apart at 35.26° above the floor, at floor angles −30°, 90°, 210°.
const PHI = [-30, 90, 210].map((d) => (d * Math.PI) / 180);
const CE = Math.sqrt(2 / 3);
const SE = Math.sqrt(1 / 3);
const Q = [0, 1, 2].map((r) => PHI.map((phi) => [CE * Math.cos(phi), CE * Math.sin(phi), SE][r]));
const det = Q[0][0] * (Q[1][1] * Q[2][2] - Q[1][2] * Q[2][1]) - Q[0][1] * (Q[1][0] * Q[2][2] - Q[1][2] * Q[2][0]) + Q[0][2] * (Q[1][0] * Q[2][1] - Q[1][1] * Q[2][0]);
if (Math.abs(det - 1) > 1e-12) throw new Error(`home frame is not a rotation: det ${det}`);
const homeDir = (i) => [Q[0][i], Q[1][i], Q[2][i]];
const EYES = [0, 1, 2].map((i) => homeDir(i).map((v, j) => C[j] + EYE * v));
const R_COL = EYE * CE + EYE_R + COLLAR_R;
const POSTS = PHI.map((phi) => [R_COL * Math.cos(phi), R_COL * Math.sin(phi)]);
const COLLAR_Z = [95, 104];
const DIAL_Z = [104, 107.2];

const AZ = 45;
const EL = 30;
const right = [Math.sin((AZ * Math.PI) / 180), -Math.cos((AZ * Math.PI) / 180), 0];
const up = [-Math.cos((AZ * Math.PI) / 180) * Math.sin((EL * Math.PI) / 180), -Math.sin((AZ * Math.PI) / 180) * Math.sin((EL * Math.PI) / 180), Math.cos((EL * Math.PI) / 180)];
const sweep = [right, up].flatMap((v) => [1, -1].map((s) => v.map((x, j) => C[j] + s * (RHO + KNOB + 2) * x)));
const rim = Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2).flatMap((a) => [-BASE_H - FOOT_H, 0].map((z) => [BASE_R * Math.cos(a), BASE_R * Math.sin(a), z]));
const P = k.fitProjection([...rim, ...POSTS.map(([x, y]) => [x, y, DIAL_Z[1]]), ...sweep], WIDTH, HEIGHT, { pad: 22, azimuth: AZ, elevation: EL });
const PPU = P.scale * Math.sqrt(1.6);

const at = (point) => iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points, z = 0) => [...points].sort((a, b) => depthOf([a[0], a[1], z], P) - depthOf([b[0], b[1], z], P));
const polar = (r, a, z = 0) => [r * Math.cos(a), r * Math.sin(a), z];

function base() {
  const plan = { x: -BASE_R, y: -BASE_R, w: 2 * BASE_R, d: 2 * BASE_R, r: BASE_R };
  const out = [`<path class="iso-halo" d="${k.haloOf(plan, -BASE_H - FOOT_H, BASE_H, P)}"/>`];
  for (const [x, y] of byDepth(PHI.map((a) => polar(54, a)))) {
    out.push(S(k.cylinder(x, y, 7, -BASE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.cylinder(0, 0, BASE_R, -BASE_H, BASE_H, P, 96, 1.2), { tone: "mid", inner: L(k.sideArc(0, 0, BASE_R, -BASE_H + 3, P, 48), { tone: "faint" }) }));
  out.push(L(k.ring(0, 0, BASE_R - 2.5, 0, P, 96), { tone: "lo" }));
  const screws = PHI.map((a) => polar(BASE_R - 10, a + Math.PI / 3));
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.1, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map((p) => at(p)), { size: 0.5 }));
  out.push(selector());
  return out.join("");
}

// The springs' selector: equal springs (G = I) or springs of 1, 2 and 3 (G = diag(1, 2, 3)).
const SEL = polar(46, (15 * Math.PI) / 180);
const SEL_AT = { scalar: (-20 * Math.PI) / 180, weighted: (50 * Math.PI) / 180 };
const selectorPointer = (a) => lineOnTop([SEL[0] + 1.1 * Math.cos(a), SEL[1] + 1.1 * Math.sin(a)], [SEL[0] + 3.4 * Math.cos(a), SEL[1] + 3.4 * Math.sin(a)], 4.8, P);
function selector() {
  const [x, y] = SEL;
  const out = [S(k.cylinder(x, y, 8, 0, 0.8, P, 40), { tone: "lo", flat: true })];
  out.push(L(k.ring(x, y, 6, 0.8, P, 40), { tone: "lo" }));
  out.push(L(Object.values(SEL_AT).map((a) => lineOnTop([x + 6 * Math.cos(a), y + 6 * Math.sin(a)], [x + 7.6 * Math.cos(a), y + 7.6 * Math.sin(a)], 0.8, P)).join(""), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 4, 0.8, 4, P, 32), { tone: "mid", inner: L(k.knurl(x, y, 4, 0.8, 4.8, 24, P), { tone: "lo" }) }));
  out.push(L(k.ring(x, y, 1.1, 4.8, P, 12), { tone: "mid" }));
  out.push(`<path data-part="selector" class="iso-line" data-tone="hi" data-free="end" d="${selectorPointer(SEL_AT.scalar)}"/>`);
  const plate = { x: 22, y: 21, w: 15, d: 6.5, r: 0.8 };
  out.push(S(k.slabOf(plate, 0, 0.7, P, 3), { tone: "lo", crease: "none" }));
  out.push(D(k.corners(plate, 1.6).map(([px, py]) => at([px, py, 0.7])), { size: 0.35 }));
  out.push([2.1, 3.25, 4.4].map((dy, i) => L(lineOnTop([plate.x + 3, plate.y + dy], [plate.x + plate.w - 3 - i * 2.5, plate.y + dy], 0.7, P), { tone: "faint", free: true })).join(""));
  return out.join("");
}

function hub() {
  const out = [S(k.cylinder(0, 0, 10, 0, 1.8, P, 40, 0.4), { tone: "mid" })];
  out.push(D([0, 1, 2, 3].map((i) => at(polar(7.4, Math.PI / 4 + (i * Math.PI) / 2, 1.8))), { size: 0.45 }));
  out.push(S(k.cylinder(0, 0, 3, 1.8, 42.2, P, 24), { tone: "mid" }));
  out.push(S(k.cylinder(0, 0, 5, 44, 4, P, 28, 0.4), { tone: "mid" }));
  out.push(S(k.cylinder(0, 0, 11.5, 48, 11, P, 48, 0.6), { tone: "mid", inner: L(k.sideArc(0, 0, 11.5, 52, P, 32), { tone: "faint" }) }));
  out.push(L(k.ring(0, 0, 10, 59, P, 48), { tone: "lo" }));
  out.push(S(sphereOf(C, BALL, P), { tone: "hi", lit: true }));
  return out.join("");
}

// An eye: a ring in the upright plane through the post, facing the pivot.
function eyeRing(i) {
  const u = [Math.cos(PHI[i]), Math.sin(PHI[i]), 0];
  const points = Array.from({ length: 24 }, (_, s) => {
    const t = (s / 24) * Math.PI * 2;
    return at(EYES[i].map((v, j) => v + EYE_R * (Math.cos(t) * u[j] + Math.sin(t) * (j === 2 ? 1 : 0))));
  });
  const boss = EYES[i].map((v, j) => v + EYE_R * u[j]);
  return L(pathOf(points, true), { tone: "mid" }) + D([at(boss)], { size: 0.5, tone: "mid" });
}

const dialPointer = (cx, cy, z, turn) => {
  const angle = turn * Math.PI * 2;
  return lineOnTop([cx - Math.sin(angle) * 1.1, cy + Math.cos(angle) * 1.1], [cx + Math.sin(angle) * 3.6, cy - Math.cos(angle) * 3.6], z, P);
};
const turnOf = (g) => (g - 2) * 0.16;

function post(i) {
  const [x, y] = POSTS[i];
  const out = [S(k.cylinder(x, y, 7, 0, 1.8, P, 28, 0.4), { tone: "mid" })];
  out.push(D([PHI[i] + Math.PI / 2, PHI[i] - Math.PI / 2].map((a) => at([x + 5.3 * Math.cos(a), y + 5.3 * Math.sin(a), 1.8])), { size: 0.45 }));
  out.push(S(k.cylinder(x, y, COL_R, 1.8, COLLAR_Z[0] - 1.8, P, 24), { tone: "mid" }));
  const eyeBehind = depthOf(EYES[i], P) < depthOf([x, y, EYES[i][2]], P);
  if (eyeBehind) out.push(eyeRing(i));
  const grooves = Array.from({ length: i + 1 }, (_, g) => L(k.sideArc(x, y, COLLAR_R, COLLAR_Z[0] + 2 + g * 1.6, P, 20), { tone: "lo" })).join("");
  out.push(S(k.cylinder(x, y, COLLAR_R, COLLAR_Z[0], COLLAR_Z[1] - COLLAR_Z[0], P, 28, 0.5), { tone: "mid", inner: grooves }));
  out.push(S(k.cylinder(x, y, 4.2, DIAL_Z[0], DIAL_Z[1] - DIAL_Z[0], P, 32), { tone: "mid", inner: L(k.knurl(x, y, 4.2, DIAL_Z[0], DIAL_Z[1], 26, P), { tone: "lo" }) }));
  out.push(L(k.ring(x, y, 1.1, DIAL_Z[1], P, 12), { tone: "mid" }));
  out.push(`<path data-part="dial-${i}" class="iso-line" data-tone="hi" data-free="end" d="${dialPointer(x, y, DIAL_Z[1], turnOf(GAINS.scalar[i]))}"/>`);
  if (!eyeBehind) out.push(eyeRing(i));
  return out.join("");
}

// The moving parts, rebuilt from the attitude. These functions also run in the page.
function worldOf(Q, R, i) {
  const v = [R[0][i], R[1][i], R[2][i]];
  return [0, 1, 2].map((r) => Q[r][0] * v[0] + Q[r][1] * v[1] + Q[r][2] * v[2]);
}

function quad(a, b, half, P) {
  const p = iso(a, P), q = iso(b, P);
  const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
  const [nx, ny] = len < 1e-6 ? [1, 0] : [-dy / len, dx / len];
  return { p, q, nx, ny, d: pathOf([[p[0] + nx * half, p[1] + ny * half], [q[0] + nx * half, q[1] + ny * half], [q[0] - nx * half, q[1] - ny * half], [p[0] - nx * half, p[1] - ny * half]], true) };
}

function pinShape(C, d, P, G) {
  const along = (r) => C.map((c, j) => c + d[j] * r);
  const rod = quad(along(G.BALL * 0.82), along(G.RHO), G.ROD * G.PPU, P);
  const side = rod.nx + rod.ny < 0 ? 1 : -1;
  const s = G.ROD * G.PPU;
  const stripe = pathOf([[rod.p[0] + side * rod.nx * s * 0.2, rod.p[1] + side * rod.ny * s * 0.2], [rod.q[0] + side * rod.nx * s * 0.2, rod.q[1] + side * rod.ny * s * 0.2], [rod.q[0] + side * rod.nx * s * 0.65, rod.q[1] + side * rod.ny * s * 0.65], [rod.p[0] + side * rod.nx * s * 0.65, rod.p[1] + side * rod.ny * s * 0.65]], true);
  const bands = G.BANDS.map((r) => quad(along(r - 0.8), along(r + 0.8), G.BAND * G.PPU, P).d);
  const tip = iso(along(G.RHO), P), origin = iso([0, 0, 0], P);
  return { rod: rod.d, stripe, bands, knob: `translate(${(tip[0] - origin[0]).toFixed(2)} ${(tip[1] - origin[1]).toFixed(2)})`, depth: depthOf(along((G.BALL + G.RHO) / 2), P) };
}

function springShape(a, b, P, G) {
  const u = b.map((v, j) => v - a[j]);
  const length = Math.hypot(...u);
  const t = u.map((v) => v / (length || 1));
  const start = a.map((v, j) => v + t[j] * G.KNOB);
  const h = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let v1 = [t[1] * h[2] - t[2] * h[1], t[2] * h[0] - t[0] * h[2], t[0] * h[1] - t[1] * h[0]];
  const n1 = Math.hypot(...v1);
  v1 = v1.map((v) => v / n1);
  const v2 = [t[1] * v1[2] - t[2] * v1[1], t[2] * v1[0] - t[0] * v1[2], t[0] * v1[1] - t[1] * v1[0]];
  const count = Math.round(G.TURNS * 16);
  const span = Math.max(0, length - G.KNOB);
  const back = [], front = [];
  let run = [], near = null;
  for (let index = 0; index <= count; index++) {
    const share = index / count;
    const angle = share * G.TURNS * Math.PI * 2;
    const normal = v1.map((v, j) => Math.cos(angle) * v + Math.sin(angle) * v2[j]);
    const fade = Math.min(1, share * 6, (1 - share) * 6);
    const point = start.map((v, j) => v + t[j] * span * share + normal[j] * G.COIL_R * fade);
    const facing = depthOf(normal, P) > 0;
    const flat = iso(point, P);
    if (near === null) near = facing;
    if (facing !== near) {
      run.push(flat);
      (near ? front : back).push(pathOf(run));
      run = [flat];
      near = facing;
      continue;
    }
    run.push(flat);
  }
  if (run.length > 1) (near ? front : back).push(pathOf(run));
  return { back: back.join(""), front: front.join(""), ends: [iso(start, P), iso(b, P)], depth: depthOf(a.map((v, j) => (v + b[j]) / 2), P) };
}

const GEO = { BALL, RHO, ROD, BAND, KNOB, COIL_R, TURNS, PPU, BANDS: [], H };
const geoFor = (i) => ({ ...GEO, BANDS: [41, 44.5, 48].slice(0, i + 1) });
const wire = (g) => (0.95 * Math.pow(g, 0.25)).toFixed(2);
const knobSvg = S(sphereOf([0, 0, 0], KNOB, P, { steps: 32 }), { tone: "mid" });

const R0 = rotOf(release(STARTS[0]).q);
const pins = [0, 1, 2].map((i) => {
  const s = pinShape(C, worldOf(Q, R0, i), P, geoFor(i));
  const bands = s.bands.map((d, j) => `<path data-r="band-${j}" class="so3-rod" d="${d}"/>`).join("");
  return { depth: s.depth, svg: `<g data-part="pin-${i}"><path data-r="rod" class="so3-rod" d="${s.rod}"/><path data-r="stripe" class="so3-stripe" d="${s.stripe}"/>${bands}<g data-r="knob" transform="${s.knob}">${knobSvg}</g></g>` };
});
const springs = [0, 1, 2].map((i) => {
  const tip = worldOf(Q, R0, i).map((v, j) => C[j] + RHO * v);
  const s = springShape(tip, EYES[i], P, GEO);
  const w = wire(GAINS.scalar[i]);
  return { depth: s.depth, svg: `<g data-part="spring-${i}"><path data-r="back" class="iso-line" data-tone="lo" d="${s.back}" style="stroke-width:${w}"/><path data-r="front" class="iso-line" data-tone="mid" d="${s.front}" style="stroke-width:${w}"/><g class="iso-dots" data-tone="hi">${s.ends.map(([x, y]) => `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="0.6"/>`).join("")}</g></g>` };
});
const items = [
  { depth: depthOf(C, P), svg: `<g data-part="hub">${hub()}</g>` },
  ...[0, 1, 2].map((i) => ({ depth: depthOf([POSTS[i][0], POSTS[i][1], H], P), svg: `<g data-part="post-${i}">${post(i)}</g>` })),
  ...pins,
  ...springs,
].sort((a, b) => a.depth - b.depth);

const style = `<style>
.so3-rod{fill:var(--anatomy-face);stroke:var(--anatomy-hi);stroke-width:var(--anatomy-weight);stroke-linejoin:round}
.so3-stripe{fill:var(--anatomy-lit-top);stroke:none}
</style>`;

const FIG = {
  width: WIDTH,
  height: HEIGHT,
  label:
    "A ball on a pivot in an oil cup carries three pins, its body axes. Each pin is tied by a spring to an eye on its own post, where the pin points when the ball is home. With three equal springs the ball can rest on any half-turn; with springs of three different stiffnesses only on the half-turns about the three posts' axes.",
  body: [style, base(), `<g data-part="stage">${items.map((item) => item.svg).join("")}</g>`],
};
const svg = k.figureSvg(FIG);

const format = (R, w, g) => {
  const theta = (angleOf(R) * 180) / Math.PI;
  return `G = ${g[1] === 1 ? "I" : "diag(1,2,3)"} · θ ${theta.toFixed(1)}° · Ψ ${psiOf(R, g).toFixed(2)} · ω ${Math.hypot(...w).toFixed(2)} rad/s`;
};

const home = {};
for (const g of ["scalar", "weighted"]) home[g] = STARTS.map((s) => {
  let state = release(s);
  for (let t = 0; t < 12; t += 1e-3) {
    if (angleOf(rotOf(state.q)) < Math.PI / 180) return t;
    state = stepOf(state, GAINS[g], 1e-3, NOTE);
  }
  return Infinity;
});

const live = `
const NOTE = ${JSON.stringify(NOTE)}, GAINS = ${JSON.stringify(GAINS)}, STARTS = ${JSON.stringify(STARTS)};
${quatOf.toString()}
${rotOf.toString()}
${errorOf.toString()}
${psiOf.toString()}
${angleOf.toString()}
${rateOf.toString()}
${stepOf.toString()}
${release.toString()}
const P = ${JSON.stringify(P)}, Q = ${JSON.stringify(Q)}, C = ${JSON.stringify(C)}, EYES = ${JSON.stringify(EYES)}, POSTS = ${JSON.stringify(POSTS)};
const GEO = ${JSON.stringify(GEO)}, RHO = ${RHO}, DIAL_Z = ${JSON.stringify(DIAL_Z)}, SEL = ${JSON.stringify(SEL)}, SEL_AT = ${JSON.stringify(SEL_AT)};
const geoFor = (i) => ({ ...GEO, BANDS: [41, 44.5, 48].slice(0, i + 1) });
${worldOf.toString()}
${quad.toString()}
${pinShape.toString()}
${springShape.toString()}
const wire = ${wire.toString()};
const turnOf = ${turnOf.toString()};
const dialPointer = ${dialPointer.toString()};
const selectorPointer = ${selectorPointer.toString()};
const format = ${format.toString()};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const box = svg.querySelector('[data-part="stage"]');
const part = (name) => svg.querySelector('[data-part="' + name + '"]');
const pins = [0, 1, 2].map((i) => { const g = part("pin-" + i); return { g, rod: g.querySelector('[data-r="rod"]'), stripe: g.querySelector('[data-r="stripe"]'), bands: [...g.querySelectorAll('[data-r^="band"]')], knob: g.querySelector('[data-r="knob"]') }; });
const springs = [0, 1, 2].map((i) => { const g = part("spring-" + i); return { g, back: g.querySelector('[data-r="back"]'), front: g.querySelector('[data-r="front"]'), ends: [...g.querySelectorAll("circle")] }; });
const fixed = [{ g: part("hub"), depth: depthOf(C, P) }, ...[0, 1, 2].map((i) => ({ g: part("post-" + i), depth: depthOf([POSTS[i][0], POSTS[i][1], C[2]], P) }))];
const dials = [0, 1, 2].map((i) => part("dial-" + i));
const switcher = part("selector");
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
let gain = "scalar", chosen = 0, state = release(STARTS[0]), order = "";
let frame = 0, last = 0, clock = 0, step = 0, touring = true, visible = false, inside = false, idleTimer = 0;
const TOUR = [{ s: 0, g: "scalar", t: 5 }, { s: 0, g: "weighted", t: 9 }, { s: 1, g: "weighted", t: 5 }, { s: 4, g: "scalar", t: 4.5 }];
function draw() {
  const R = rotOf(state.q), g = GAINS[gain];
  const keyed = fixed.map((f) => ({ g: f.g, depth: f.depth }));
  for (let i = 0; i < 3; i++) {
    const d = worldOf(Q, R, i);
    const s = pinShape(C, d, P, geoFor(i));
    pins[i].rod.setAttribute("d", s.rod);
    pins[i].stripe.setAttribute("d", s.stripe);
    pins[i].bands.forEach((b, j) => b.setAttribute("d", s.bands[j]));
    pins[i].knob.setAttribute("transform", s.knob);
    keyed.push({ g: pins[i].g, depth: s.depth });
    const c = springShape(C.map((v, j) => v + RHO * d[j]), EYES[i], P, GEO);
    springs[i].back.setAttribute("d", c.back);
    springs[i].front.setAttribute("d", c.front);
    c.ends.forEach(([x, y], j) => { springs[i].ends[j].setAttribute("cx", x.toFixed(2)); springs[i].ends[j].setAttribute("cy", y.toFixed(2)); });
    keyed.push({ g: springs[i].g, depth: c.depth });
  }
  keyed.sort((a, b) => a.depth - b.depth);
  const next = keyed.map((x) => x.g.dataset.part).join(" ");
  if (next !== order) { keyed.forEach((x) => box.appendChild(x.g)); order = next; }
  const text = format(R, state.w, g);
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuetext", text + ", released from " + STARTS[chosen].name);
}
function dress() {
  const g = GAINS[gain];
  for (let i = 0; i < 3; i++) {
    const w = wire(g[i]);
    springs[i].back.style.strokeWidth = w;
    springs[i].front.style.strokeWidth = w;
    dials[i].setAttribute("d", dialPointer(POSTS[i][0], POSTS[i][1], DIAL_Z[1], turnOf(g[i])));
  }
  switcher.setAttribute("d", selectorPointer(SEL_AT[gain]));
  stage.setAttribute("aria-valuenow", String(chosen));
}
function choose(index, g) {
  chosen = index; gain = g; state = release(STARTS[index]); dress();
  if (still.matches) { for (let t = 0; t < 30; t += 1 / 120) state = stepOf(state, GAINS[gain], 1 / 120, NOTE); draw(); return; }
  run();
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (touring) {
    clock += dt;
    if (clock > TOUR[step].t) { clock = 0; step = (step + 1) % TOUR.length; choose(TOUR[step].s, TOUR[step].g); }
  }
  const n = Math.max(1, Math.ceil(dt * 240));
  for (let i = 0; i < n; i++) state = stepOf(state, GAINS[gain], dt / n, NOTE);
  draw();
  frame = visible ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible && !still.matches) { last = 0; frame = requestAnimationFrame(tick); } };
const rest = () => { clearTimeout(idleTimer); if (inside) return; idleTimer = setTimeout(() => { if (still.matches) return; touring = true; clock = 0; step = 0; choose(TOUR[0].s, TOUR[0].g); }, 4000); };
const pick = (index, g) => { touring = false; rest(); choose(Math.min(STARTS.length - 1, Math.max(0, index)), g); };
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
if (still.matches) touring = false;
stage.addEventListener("pointerenter", (event) => { if (event.pointerType !== "touch") { inside = true; clearTimeout(idleTimer); } });
stage.addEventListener("pointerleave", () => { inside = false; rest(); });
stage.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") return;
  const rect = svg.getBoundingClientRect();
  const index = Math.min(STARTS.length - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width - 0.1) / 0.8 * STARTS.length)));
  if (touring || index !== chosen) pick(index, gain);
});
stage.addEventListener("click", () => pick(chosen, gain === "scalar" ? "weighted" : "scalar"));
stage.addEventListener("keydown", (event) => {
  let handled = true;
  if (event.key === "ArrowRight") pick(chosen + 1, gain);
  else if (event.key === "ArrowLeft") pick(chosen - 1, gain);
  else if (event.key === "ArrowUp" || event.key === "ArrowDown") pick(chosen, gain === "scalar" ? "weighted" : "scalar");
  else handled = false;
  if (handled) event.preventDefault();
});
dress();
draw();
`;

const CARD = { fig: "Fig 3", title: "Half-turns on SO(3)", readout: format(R0, [0, 0, 0], GAINS.scalar) };
const body = k.plateHtml({
  ...CARD,
  hint: "Hover: start · tap: equal or 1·2·3 springs",
  keys: [
    { mark: "lit", label: "The ball and its pins: the attitude R" },
    { mark: "raised", label: "Springs as stiff as g₁, g₂, g₃: the co-stiffness G" },
  ],
  caption:
    `A ball on a pivot carries three pins, its body axes; each is tied to an eye on its own post by a zero-length spring, so the springs store k_p Ψ with Ψ = ½ tr(G(I − R)) and the oil in the cup is K_d (J = diag(1, 2, 3), k_p = 4, K_d = 3I). ` +
    `With three equal springs, G = I, every half-turn is a rest point: released on a half-turn about (1, 2, 2)/3 the ball stays at 180°. With springs of 1, 2 and 3 only the half-turns about the three posts' axes are left, two saddles and a maximum at Ψ = 3, 4 and 5, all unstable; the same start comes within 1° of home in ${home.weighted[0].toFixed(1)} s. ` +
    `From 90° about axis 3 with G = I it takes ${home.scalar[4].toFixed(2)} s. Three is the fewest rest points any smooth potential on SO(3) can leave besides the goal, so no continuous law brings every attitude home.`,
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Half-turns on SO(3): left and right arrows choose where the ball is released, up and down switch between equal springs and springs of stiffness 1, 2 and 3" aria-valuemin="0" aria-valuemax="${STARTS.length - 1}" aria-valuenow="0">${svg}</div>`,
});

const name = theme === "light" ? "so3-half-turns.html" : "so3-half-turns-dark.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "Half-turns on SO(3)", theme, body, script: kitScript() + live }));
console.log("wrote", name);
if (theme === "light") writeStill(HERE, "so3-half-turns", FIG, CARD);
