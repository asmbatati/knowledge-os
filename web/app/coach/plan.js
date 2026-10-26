// The coach's pure helpers (the vault's Study Coach Plan 2026-10): where a session stands in its agenda, and which key
// answers a question. Tested in Node (tests/js/coach.test.mjs).

// The phase a session's minute falls in: warm-up, new, reflect, or over once the agenda's minutes are spent.
export function checkpoint(elapsedMin, agenda) {
  const w = agenda.warmup || 0, n = agenda.new || 0, r = agenda.reflect || 0;
  const minute = Math.max(0, Math.floor(elapsedMin));
  const phase = elapsedMin < w ? "warmup" : elapsedMin < w + n ? "new" : elapsedMin < w + n + r ? "reflect" : "over";
  return { phase, minute, total: w + n + r };
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

// One key answers: A to D or 1 to 4 (Arabic-Indic digits too, as an Arabic keyboard types them), 0 or ? for "I'm
// blanking, show me". Anything else is no answer.
export function keyOf(key) {
  let k = String(key ?? "");
  if (k.length !== 1) return null;
  const i = AR_DIGITS.indexOf(k);
  if (i >= 0) k = String(i);
  if (/^[a-d]$/i.test(k)) return k.toUpperCase();
  if (/^[1-4]$/.test(k)) return "ABCD"[Number(k) - 1];
  if (k === "0" || k === "?" || k === "؟") return "blank";
  return null;
}
