// What the Lab holds and which concepts each part shows, so a concept's page can send the learner to the model or
// exercise that makes it move. Concept names are the vault's own note names. Pure.
import { EXERCISES } from "./exercises.js";

export const MODELS = [
  { id: "gd", icon: "⛰", concepts: ["Gradient descent (GD)", "Gradient", "Gradient descent vs ADAM"] },
  { id: "linear", icon: "🌀", concepts: ["Eigenvalues of A decide the stability of xdot = Ax", "Eigenvalues and eigenvectors",
    "Stability", "Matrix exponential"] },
  { id: "pid", icon: "🎛", concepts: ["PID Control", "PID is three proportional controllers on three different quantities",
    "PID is what you use when you have no model"] },
  { id: "kalman", icon: "🛰", concepts: ["Kalman Filter"] },
  { id: "vi", icon: "🧭", concepts: ["Value iteration is policy iteration with evaluation cut to a single sweep",
    "Markov Decision Process", "Policy Iteration"] },
  { id: "bandit", icon: "🎰", concepts: ["Exploration and Exploitation",
    "Exploration is solved for bandits and abandoned for large MDPs, and everything in between is inspired by the solved case"] },
  { id: "lln", icon: "🎲", concepts: ["Law of Large Numbers and Central Limit Theorem", "Law of large numbers and modes of convergence",
    "Expected value"] },
];

export const model = (id) => MODELS.find((m) => m.id === id) || null;

// Figures: machines whose working is the idea, built by figures/<id>/build.mjs with the Anatomy skill's kit and shown
// in a sandboxed frame. Each one's numbers are those of the first concept it names.
export const FIGURES = [
  { id: "shake-table", icon: "🔩", concepts: ["Resonance Frequency", "Harmonic forced response of a damped system",
    "Natural Frequency of a Mass–Spring System", "Damping ratio", "Mass–spring–damper system"] },
  { id: "kalman-gain", icon: "⚖", concepts: ["The Kalman gain trades trust between the model and the measurement",
    "Kalman Filter", "Combining two sensors weights them by their variance", "Weighted mean", "Bayesian estimation"] },
  { id: "so3-half-turns", icon: "🧭", concepts: ["With a scalar gain every half-turn is an equilibrium of PD control on SO(3); three distinct stiffnesses leave three unstable ones, the fewest any smooth potential on SO(3) allows",
    "One half the trace of I minus R is positive definite on the rotations, yet every half-turn is a critical point too, so descending it reaches the identity from almost every attitude but not all",
    "Geometric control on SE(3)"] },
];

export const figure = (id) => FIGURES.find((f) => f.id === id) || null;

// The figures that explain one concept, for its page, and where each is served in a theme.
export function figuresFor(concept) {
  const name = String(concept || "").trim().toLowerCase();
  return FIGURES.filter((f) => f.concepts.some((c) => c.toLowerCase() === name));
}

export const figureSrc = (id, dark) => `/figures/${id}/${id}${dark ? "-dark" : ""}.html`;

// Everything in the Lab about one concept: figures first, then models, then exercises.
export function labFor(concept) {
  const name = String(concept || "").trim().toLowerCase();
  const has = (list) => list.some((c) => c.toLowerCase() === name);
  return [
    ...FIGURES.filter((f) => has(f.concepts)).map((f) => ({ kind: "figures", id: f.id })),
    ...MODELS.filter((m) => has(m.concepts)).map((m) => ({ kind: "models", id: m.id })),
    ...EXERCISES.filter((e) => has(e.concepts)).map((e) => ({ kind: "exercises", id: e.id, title: e.title })),
  ];
}
