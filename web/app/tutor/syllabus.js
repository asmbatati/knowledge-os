// The course tutor's pure helpers: a pasted syllabus read into sessions and exams, and days counted between two days.
// One session per line: an optional date (2027-01-12, or 12/01/2027 day first), a title, and after a colon its topics,
// separated by commas or semicolons (Arabic ones too). A line that starts with Midterm, Final, Exam, Quiz, Test,
// اختبار or امتحان is an exam. A line starting with # is the learner's own comment.

const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const DMY = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
// \b knows only Latin letters, so the word's end is a space, a colon, a comma or the line's end.
const EXAM = /^(midterm|mid-term|final|exam|quiz|test|اختبار|امتحان|الاختبار|الامتحان)(?=[\s:،,.\-]|$)/i;

function real(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const pad = (n) => String(n).padStart(2, "0");

// A day in either form as ISO, or "" when it is not a real day.
export function toIso(text) {
  const s = String(text || "").trim();
  let m = s.match(ISO);
  if (m) return real(+m[1], +m[2], +m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : "";
  m = s.match(DMY);
  if (m) return real(+m[3], +m[2], +m[1]) ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : "";
  return "";
}

// The date a line carries, and the line without it; a date that is not a real day stays part of the line.
function takeDate(line) {
  const m = line.match(ISO) || line.match(DMY);
  if (!m) return { date: "", rest: line };
  const date = toIso(m[0]);
  if (!date) return { date: "", rest: line };
  return { date, rest: (line.slice(0, m.index) + " " + line.slice(m.index + m[0].length)).trim() };
}

const tidy = (s) => s.replace(/^[\s\-–—|:,.]+|[\s\-–—|:,.]+$/g, "").replace(/\s+/g, " ").trim();

export function parseSyllabus(text) {
  const sessions = [];
  const exams = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const { date, rest } = takeDate(line);
    const cleaned = tidy(rest);
    if (EXAM.test(cleaned)) {
      exams.push({ title: tidy(cleaned.split(":")[0]) || "Exam", date });
      continue;
    }
    const i = cleaned.indexOf(":");
    const title = tidy(i >= 0 ? cleaned.slice(0, i) : cleaned);
    const topics = i >= 0 ? cleaned.slice(i + 1).split(/[,;،؛]/).map(tidy).filter(Boolean) : [];
    if (!title) continue;
    sessions.push({ n: sessions.length + 1, title, date, topics });
  }
  return { sessions, exams };
}

// Days from one ISO day to another, counted on the calendar (a clock change does not shorten a day).
export function relDays(fromIso, toIso2) {
  const [a, b] = [fromIso, toIso2].map((s) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86400000);
}
