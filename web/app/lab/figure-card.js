// A figure in its card: the machine live in a sandboxed frame, with its name and what it shows (figures/README.md).
// The concept page, the coach's lesson and the road check's first screen all show a figure through this one card.

import { h } from "../ui.js";
import { figureSrc, figuresFor } from "./registry.js";

export function figureCards(concept, t, { open = true } = {}) {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  return figuresFor(concept).map((f) => h("details", { class: "card figure-card", open },
    h("summary", {}, f.icon, " ", t("lab.figure.kind"), " · ", t(`lab.f.${f.id}`)),
    h("p", { class: "muted" }, t(`lab.f.${f.id}.d`)),
    h("iframe", { class: "figure-frame", src: figureSrc(f.id, dark), sandbox: "allow-scripts", title: t(`lab.f.${f.id}`), loading: "lazy" })));
}
