// Focus: the 24/6 timer, large, with the tiny first step. Stopping early is allowed and said to be fine; what is left
// open is written down for next time, so stopping costs nothing.

import { h, toast } from "../ui.js";

export async function render(main, params, ctx) {
  const { t, timer } = ctx;
  const clock = h("div", { class: "clock", "aria-live": "off" });
  const phase = h("p", { class: "phase" });
  const ring = h("div", { class: "ring" }, clock, phase);
  const loops = h("textarea", { rows: 2, dir: "auto", placeholder: t("focus.loops") });
  const buttons = h("div", { class: "row center" });
  const energy = timer.session()?.energy || "";

  const paint = (s) => {
    clock.textContent = timer.mmss(s.remaining);
    phase.textContent = s.phase === "idle" ? t("focus.idle") : t("focus." + s.phase) + (s.paused ? " ⏸" : "");
    ring.className = `ring p-${s.phase}${s.paused ? " paused" : ""}`;
    ring.style.setProperty("--done", s.phase === "idle" ? "0" : String(1 - s.remaining / s.full));
    const b = [];
    if (s.phase === "idle") {
      b.push(h("button", { class: "primary big", onclick: () => timer.startFocus(energy) }, t("focus.start")));
    } else {
      b.push(s.paused
        ? h("button", { class: "primary", onclick: () => timer.resume() }, t("focus.resume"))
        : h("button", { class: "ghost", onclick: () => timer.pause() }, t("focus.pause")));
      b.push(h("button", { class: "ghost", onclick: async () => { await timer.stop(loops.value); loops.value = ""; } },
        t("focus.stop")));
      if (s.phase === "focus") {
        b.push(h("button", { class: "ghost soft", onclick: async () => {
          await timer.stop(loops.value || t("focus.enough"));
          loops.value = "";
          toast(t("focus.saved"));
        } }, t("focus.enough")));
      }
    }
    if (buttons.dataset.phase !== s.phase + s.paused) {
      buttons.replaceChildren(...b);
      buttons.dataset.phase = s.phase + s.paused;
    }
  };

  main.replaceChildren(h("section", { class: "card focus-card" }, ring, buttons,
    h("p", { class: "tiny-step" }, t("focus.tiny")),
    h("div", { class: "row center" }, h("a", { class: "button ghost", href: "#/check" }, t("focus.goto"))),
    h("label", { class: "label" }, t("focus.loops")), loops));
  return timer.onChange(paint);
}
