// The 24/6 focus timer (design §4, Biwer 2023: fixed breaks). Its state lives in this browser's storage, so a reload
// or a second tab keeps the same clock; the server gets one row when a focus period starts and one when it stops.

import { api, store } from "./ui.js";

const KEY = "los.timer";
let cfg = { focus: 24, brk: 6 };
const listeners = new Set();
let tick = null;

const load = () => store(KEY) || { phase: "idle" };
function save(s) { store(KEY, s); emit(); }

export function configure(c) {
  if (c && c.focus) cfg.focus = c.focus;
  if (c && c.break) cfg.brk = c.break;
}

export function state() {
  const s = load();
  const full = (s.phase === "break" ? cfg.brk : cfg.focus) * 60000;
  const remaining = s.phase === "idle" ? cfg.focus * 60000 : (s.paused ? s.remaining : Math.max(0, s.endsAt - Date.now()));
  return { ...s, remaining, full };
}

export function onChange(fn) { listeners.add(fn); fn(state()); return () => listeners.delete(fn); }
function emit() { const s = state(); listeners.forEach((fn) => fn(s)); }

export async function startFocus(energy = "", item = "") {
  const now = Date.now();
  save({ phase: "focus", endsAt: now + cfg.focus * 60000, paused: false, startedAt: now, energy, item });
  ensureTick();
  try { await api.post("/api/focus", { event: "start", energy, item }); } catch (e) { /* the clock still runs */ }
}

export function pause() {
  const s = state();
  if (s.phase === "idle" || s.paused) return;
  save({ ...load(), paused: true, remaining: s.remaining });
}

export function resume() {
  const s = load();
  if (!s.paused) return;
  save({ ...s, paused: false, endsAt: Date.now() + s.remaining });
  ensureTick();
}

export async function stop(loops = "") {
  const s = state();
  save({ phase: "idle" });
  if (s.phase === "focus") {
    const minutes = Math.round((cfg.focus * 60000 - s.remaining) / 60000);
    try { await api.post("/api/focus", { event: "stop", minutes, energy: s.energy, item: s.item, loops }); }
    catch (e) { /* nothing else to do */ }
  }
}

// A phase's end leaves a notice in the state (26 Oct 2026: a toast of nine seconds was missed mid-lesson, and once the
// break ended the chip was gone with no way to start again): "done" while the break runs, "break" once it is over. The
// header shows it until it is answered, in every tab, across a reload.
async function phaseEnd(s) {
  if (s.phase === "focus") {
    const now = Date.now();
    save({ phase: "break", endsAt: now + cfg.brk * 60000, paused: false, startedAt: now, energy: s.energy,
      item: s.item, notice: "done" });
    try { await api.post("/api/focus", { event: "stop", minutes: cfg.focus, energy: s.energy, item: s.item }); }
    catch (e) { /* recorded next time */ }
  } else if (s.phase === "break") {
    save({ phase: "idle", energy: s.energy, item: s.item, notice: "break" });
  }
}

/** Put the notice away; the clock runs on. */
export function dismiss() { save({ ...load(), notice: "" }); }

/** From the notices: the next focus at once, on the same item (the break skipped, or the break over). */
export function nextFocus() { const s = load(); return startFocus(s.energy || "", s.item || ""); }

export function lengths() { return { focus: cfg.focus, brk: cfg.brk }; }

function ensureTick() {
  if (tick) return;
  tick = setInterval(() => {
    const s = state();
    if (s.phase === "idle") { clearInterval(tick); tick = null; emit(); return; }
    if (!s.paused && s.remaining <= 0) phaseEnd(s);
    else emit();
  }, 1000);
}

export function boot() { if (load().phase !== "idle") ensureTick(); emit(); }

export function mmss(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

// The session's energy budget (design §4): low is up to three reviews, medium adds one concept, high two.
const SKEY = "los.session";
const localDay = () => new Date().toLocaleDateString("en-CA");   // YYYY-MM-DD, local time
const LIMITS = { low: { checks: 0, reviews: 3 }, medium: { checks: 1, reviews: 99 }, high: { checks: 2, reviews: 99 } };

export function session() {
  const s = store(SKEY);
  const today = localDay();
  return s && s.date === today ? s : null;
}

export function startSession(energy) {
  store(SKEY, { energy, date: localDay(), checks: 0, reviews: 0 });
}

export function countSession(kind) {
  const s = session();
  if (!s) return;
  if (kind === "check") s.checks += 1;
  if (kind === "review") s.reviews += 1;
  store(SKEY, s);
}

export function budgetSpent(nextKind) {
  const s = session();
  if (!s) return false;
  const lim = LIMITS[s.energy] || LIMITS.medium;
  if (nextKind === "check") return s.checks >= lim.checks;
  if (nextKind === "review") return s.reviews >= lim.reviews;
  return false;
}
