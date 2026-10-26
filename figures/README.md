# Figures

Machines whose working is the idea, made with the [Anatomy](https://github.com/wheresryan22/anatomy) skill's kit
(MIT; `kit/LICENSE`), for the Lab's **Figures** tab and the concept pages that name them. The plan is the vault's
`x/SYSTEM/Anatomy Figures Plan 2026-10.md` (decisions D1 and D2, 21 Oct 2026).

```
node figures/<id>/model.mjs --selftest     # the figure's numbers against its note
node figures/<id>/build.mjs                # writes figures/<id>/<id>.html (light) and <id>.svg, its still drawing
node figures/<id>/build.mjs --dark         # writes figures/<id>/<id>-dark.html
```

- **One folder per figure**: `build.mjs` (the drawing and its live script), `model.mjs` (a pure model whose numbers
  are the note's: the readout, the motion and the caption all come from it). The built pages and any `shots/` are
  not in git (`.gitignore`): build them after a checkout.
- **Shared**: `kit/` (the skill's `iso-kit.mjs`, `audit.mjs`, `lathe.mjs`, `tube.mjs`, `gl.mjs`, as of its commit
  `1482e846`) and `scripts/inline-kit.mjs`, laid out as in the skill so a build imports `../kit/...`.
- **Served** by `los/app.py` at `/figures/<id>/<page>.html` only, with `FIGURE_CSP`: inline script, `sandbox
  allow-scripts` (an opaque origin, so it reaches nothing of the site's), and only the site may frame it
  (`X-Frame-Options: SAMEORIGIN`). Any other path under `/figures/` is a 404.
- **Listed** in `web/app/lab/registry.js` (`FIGURES`, each with the concepts it explains, the first being the note
  whose numbers it uses), with its words in `web/app/i18n.js` (`lab.f.<id>`, `lab.f.<id>.d`, both languages).
- **Checked** with the skill's own scripts before it is listed: `node ~/.claude/skills/anatomy/scripts/lines.mjs
  <page>` (line ends 0) and `capture.mjs` in both themes, at phone width and under reduced motion. A figure with pipes,
  cables or round parts that pass near each other also records every part's shape as it draws (`kit/audit.mjs`'s
  `recorder`) and ends its build with `--audit`, run to zero (the plan's §4 r7, 22 Oct 2026). The first three have none
  and are not retrofitted: on a half-turn the SO(3) springs pass through the pivot by design.
- **A still drawing**, `<id>.svg` (`scripts/still.mjs`, the plan's D4): the drawing at rest on a light card of its own
  with the card's number, title and readout, written by the light build, not in git either.
- **Never a verdict**: a figure records nothing anywhere.

| Figure | Note whose numbers it uses | Concepts it explains |
|---|---|---|
| `shake-table`, a forced vibration bench | Resonance Frequency (2 kg, 800 N/m, ζ 0.1: 5.03× at 19.8 rad/s) | Resonance Frequency, Harmonic forced response of a damped system, Natural Frequency of a Mass–Spring System, Damping ratio, Mass–spring–damper system |
| `kalman-gain`, a spring balance (a colleague's note) | The Kalman gain trades trust between the model and the measurement, worked example 2 (2.00 m, P⁻ 0.0025; 2.30 m, R 0.0225: K 0.1, 2.03 m, P⁺ 0.00225) | that note, Kalman Filter, Combining two sensors weights them by their variance, Weighted mean, Bayesian estimation |
| `so3-half-turns`, a ball on a pivot held by three zero-length springs | With a scalar gain every half-turn is an equilibrium of PD control on SO(3) … (J = diag(1, 2, 3), k_p = 4, K_d = 3I: 2.33, 8.10 and 11.13 s to 1°; Ψ 3, 4 and 5 at the three half-turns) | that note, One half the trace of I minus R is positive definite on the rotations …, Geometric control on SE(3) |

A figure is shown in the Lab's Figures tab and, above the note, on the page of every concept it explains
(`figuresFor` and `figureSrc` in `web/app/lab/registry.js`), in the coach's lesson on that concept with its first chunk,
and on a road check's first screen, never among its questions (`web/app/lab/figure-card.js`).

## In Obsidian

A note shows a figure live with a ` ```figure ` block (`id: <id>`), drawn by the owner's Engineering 3D Viewer in a
sandboxed frame from the pages in its *Figures folder* setting. For the phone too, the pages are copied into the vault:

```
node figures/scripts/to-vault.mjs            # what it would copy
node figures/scripts/to-vault.mjs --apply    # builds each figure, copies its two pages to x/ASSETS/Figures/<id>/
                                             # and its still to Atlas/Concepts/attachments/<id>.svg
```

The vault's git ignores `x/ASSETS/` and every `attachments/` folder. Run it again after a figure changes. A file in the
attachments folder is replaced only when it is that figure's still (`data-figure="<id>"`). For Obsidian without the
plugin, a copy of the vault and a note printed to PDF, the note carries the still in a folded callout right after the
block:

```
> [!example]- Still drawing
> ![[<id>.svg]]
```

The site leaves a note's ` ```figure ` block out of its own rendering, since it shows the figure above the note, and
the still callout with it (`STILL_RE` in `los/render.py`).
