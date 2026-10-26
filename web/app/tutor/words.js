// The course tutor's words that two pages share (the courses page and the Today card): when a day falls, and what
// the next step is. They take the page's `t`.

// Arabic counts two days with the dual, three to ten with the plural, and eleven on with the singular in the
// accusative; English uses one form for all, under the same three keys.
const form = (n) => (n === 2 ? "2" : n >= 3 && n <= 10 ? "few" : "many");

export function whenWord(days, t) {
  if (days === 0) return t("course.when.today");
  if (days === 1) return t("course.when.tomorrow");
  if (days === -1) return t("course.when.yesterday");
  return days > 1 ? t(`course.when.in.${form(days)}`, { n: days }) : t(`course.when.ago.${form(-days)}`, { n: -days });
}

export function nextText(next, t) {
  const k = next && next.kind;
  if (k === "prep") return t("course.next.prep", { n: next.session, when: whenWord(next.days, t) });
  if (k === "today") return t("course.next.today", { n: next.session });
  if (k === "review") return t("course.next.review", { n: next.session });
  if (k === "upcoming") return t("course.next.upcoming", { n: next.session, when: whenWord(next.days, t) });
  if (k === "exam") return t("course.next.exam", { title: next.title || "", when: whenWord(next.days, t) });
  if (k === "dates") return t("course.next.dates");
  return t("course.next.done");
}

// Where the next step leads.
export function nextHref(id, next) {
  const base = "#/courses/" + encodeURIComponent(id);
  const k = next && next.kind;
  if (k === "prep" || k === "upcoming") return `${base}/s/${next.session}?tab=before`;
  if (k === "today") return `${base}/s/${next.session}?tab=before`;
  if (k === "review") return `${base}/s/${next.session}?tab=after`;
  if (k === "exam") return `${base}/e/${encodeURIComponent(next.exam)}`;
  if (k === "dates") return `${base}/edit`;
  return base;
}
