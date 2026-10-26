// Small DOM helpers and the calls to the server. Every POST carries the session token from the page's meta tag.

import { otherHref } from "./lang.js";

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;            // only for HTML the server sanitized
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const TOKEN = document.querySelector('meta[name="los-token"]')?.content || "";

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error) || `HTTP ${status}`);
    this.status = status;
    this.body = body || {};
  }
}

async function call(method, path, body) {
  const opts = { method, headers: {} };
  if (method === "POST") {
    opts.headers["Content-Type"] = "application/json";
    opts.headers["X-LOS-Token"] = TOKEN;
    opts.body = JSON.stringify(body || {});
  }
  const r = await fetch(path, opts);
  let data = null;
  try { data = await r.json(); } catch (e) { data = null; }
  if (!r.ok) throw new ApiError(r.status, data);
  return data;
}

export const api = {
  get: (path) => call("GET", path),
  post: (path, body) => call("POST", path, body),
};

export function toast(msg, ms = 3500) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

export const conceptHref = (name) => "#/concept/" + encodeURIComponent(name);

// The line above a note of a pair (CLAUDE.md §7): why it is shown in English on an Arabic page (or in Arabic on an
// English one), and a link to the other note of the pair when there is one. `view` is what the server sends.
export function langBar(view, kind, base, showing, t) {
  if (!view) return null;
  const otherLang = view.lang === "ar" ? "en" : "ar";
  const parts = [];
  if (view.missing) parts.push(h("span", {}, t("lang.missing." + view.missing)));
  if (view.other) parts.push(h("a", { href: otherHref(kind, base, otherLang, showing) }, t("lang.read." + otherLang)));
  return parts.length ? h("p", { class: "lang-bar" }, parts) : null;
}

export function statusBadge(status, t) {
  return h("span", { class: `badge s-${status}` }, t(`status.${status}`));
}

export function fmtDate(iso, lang) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  try {
    return d.toLocaleDateString(lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB",
      { day: "numeric", month: "short", year: "numeric" });
  } catch (e) { return iso; }
}

export function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || "null");
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { return null; }
  return value;
}

// Go to a page; when it is the page already open, render it again.
export function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}

// Replace an element's children, skipping the empty ones (replaceChildren would print "null").
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  return el;
}
