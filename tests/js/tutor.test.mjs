// The course tutor's page: a pasted syllabus becomes sessions and exams, days are counted either way, and every word
// the courses page and the Today card put on the page exists in English and in Arabic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSyllabus, relDays, toIso } from "../../web/app/tutor/syllabus.js";

test("a pasted syllabus becomes sessions, each with its date, title and topics, and its exams", () => {
  const s = parseSyllabus([
    "2027-01-12  Introduction: rigid bodies, frames",
    "12/01/2027 - Rotations: rotation matrix; Euler angles",
    "Kinematics",
    "",
    "# a comment the learner left",
    "Midterm 2027-02-20",
    "Final exam: 10/05/2027",
  ].join("\n"));
  assert.deepEqual(s.sessions.map((x) => [x.n, x.date, x.title, x.topics]), [
    [1, "2027-01-12", "Introduction", ["rigid bodies", "frames"]],
    [2, "2027-01-12", "Rotations", ["rotation matrix", "Euler angles"]],
    [3, "", "Kinematics", []],
  ]);
  assert.deepEqual(s.exams, [{ title: "Midterm", date: "2027-02-20" }, { title: "Final exam", date: "2027-05-10" }]);
});

test("an Arabic syllabus has its exams too", () => {
  const s = parseSyllabus("2027-01-12 مقدمة: الأجسام الجاسئة، الأطر\nاختبار منتصف الفصل 2027-02-20\nالامتحان النهائي: 10/05/2027");
  assert.deepEqual(s.sessions.map((x) => [x.title, x.topics]), [["مقدمة", ["الأجسام الجاسئة", "الأطر"]]]);
  assert.deepEqual(s.exams, [{ title: "اختبار منتصف الفصل", date: "2027-02-20" }, { title: "الامتحان النهائي", date: "2027-05-10" }]);
});

test("a day that does not exist is no date, and the line stays a session", () => {
  const s = parseSyllabus("31/02/2027 Limits\n2027-13-01 Series");
  assert.deepEqual(s.sessions.map((x) => [x.date, x.title]), [["", "31/02/2027 Limits"], ["", "2027-13-01 Series"]]);
});

test("dates in either form become ISO days", () => {
  assert.equal(toIso("2027-01-05"), "2027-01-05");
  assert.equal(toIso("5/1/2027"), "2027-01-05");
  assert.equal(toIso("29/02/2027"), "");
  assert.equal(toIso("tomorrow"), "");
});

test("a day count takes the form its number needs", async () => {
  const { whenWord } = await import("../../web/app/tutor/words.js");
  const t = (k, v = {}) => `${k}${v.n !== undefined ? "=" + v.n : ""}`;
  assert.deepEqual([0, 1, -1, 2, 5, 10, 11, 30, -2, -7, -12].map((d) => whenWord(d, t)), [
    "course.when.today", "course.when.tomorrow", "course.when.yesterday", "course.when.in.2=2", "course.when.in.few=5",
    "course.when.in.few=10", "course.when.in.many=11", "course.when.in.many=30", "course.when.ago.2=2",
    "course.when.ago.few=7", "course.when.ago.many=12"]);
});

test("days between two days, either way", () => {
  assert.equal(relDays("2027-01-09", "2027-01-10"), 1);
  assert.equal(relDays("2027-01-12", "2027-01-10"), -2);
  assert.equal(relDays("2027-03-27", "2027-03-29"), 2, "a clock change does not shorten a day");
});

const src = (p) => readFileSync(new URL(`../../web/app/${p}`, import.meta.url), "utf8");
const i18n = src("i18n.js");
const [enPart, arPart] = i18n.split("const AR = {");
const keysOf = (part) => new Set([...part.matchAll(/"([^"\n]+)":\s*"/g)].map((m) => m[1]));
const EN = keysOf(enPart), AR = keysOf(arPart);

test("every word of the courses page and the Today card has both languages", () => {
  const used = [...src("pages/courses.js").matchAll(/\bt\("([a-z0-9.\- ]+)"/gi), ...src("tutor/words.js").matchAll(/\bt\("([a-z0-9.\- ]+)"/gi),
    ...src("pages/today.js").matchAll(/\bt\("(course[a-z0-9.\-]*)"/gi)]
    .map((m) => m[1]).filter((k) => !k.endsWith("."));
  assert.ok(new Set(used).size > 40, "the scan finds the keys");
  const built = ["prep", "today", "review", "upcoming", "past", "undated"].map((k) => `course.st.${k}`)
    .concat(["prep", "today", "review", "upcoming", "exam", "dates", "done"].map((k) => `course.next.${k}`))
    .concat(["prepped", "attended", "reviewed"].map((k) => `course.mark.${k}`))
    .concat(["to-read", "stuck", "ready", "locked", "due", "off", "mastered"].map((k) => `course.cat.${k}`))
    .concat(["quiet", "no_cli", "unreachable", "settings"].map((k) => `course.why.${k}`))
    .concat(["prepped", "attended", "reviewed"].map((k) => `course.do.${k}`))
    .concat(["before", "after", "ask"].map((k) => `course.tab.${k}`))
    .concat(["in", "ago"].flatMap((w) => ["2", "few", "many"].map((f) => `course.when.${w}.${f}`)))
    .concat(["nav.courses", "status.off", "course.today"]);
  for (const k of [...used, ...built]) {
    assert.ok(EN.has(k), `English lacks ${k}`);
    assert.ok(AR.has(k), `Arabic lacks ${k}`);
  }
});
