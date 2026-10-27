/* Test doubles: a scripted HTTP transport. */
import type { Http, HttpRequest, HttpResponse } from '../src/api.ts';

export function response(status: number, body: unknown): HttpResponse {
	return { status, text: typeof body === 'string' ? body : JSON.stringify(body) };
}

export type Route = (req: HttpRequest, url: URL) => HttpResponse | Promise<HttpResponse> | undefined;

/** An Http that answers from routes and records every request. */
export function scripted(routes: Route[]): Http & { calls: HttpRequest[] } {
	const calls: HttpRequest[] = [];
	const http = (async (req: HttpRequest) => {
		calls.push(req);
		const url = new URL(req.url);
		for (const r of routes) {
			const res = await r(req, url);
			if (res) return res;
		}
		return response(404, { error: 'not found' });
	}) as Http & { calls: HttpRequest[] };
	http.calls = calls;
	return http;
}

export const noSleep = async (): Promise<void> => {};

/** Just enough of Obsidian's HTMLElement helpers (createEl, createDiv, createSpan, empty) to draw a block in Node. */
export class FakeEl {
	tag: string;
	cls: string[];
	text: string;
	attr: Record<string, string>;
	children: FakeEl[] = [];
	listeners: Record<string, (ev: unknown) => unknown> = {};
	constructor(tag: string, o: { cls?: string | string[]; text?: string; attr?: Record<string, string> } = {}) {
		this.tag = tag;
		this.cls = Array.isArray(o.cls) ? [...o.cls] : o.cls ? o.cls.split(' ') : [];
		this.text = o.text ?? '';
		this.attr = { ...(o.attr ?? {}) };
	}
	private add(tag: string, o?: { cls?: string | string[]; text?: string; attr?: Record<string, string> }): FakeEl {
		const c = new FakeEl(tag, o);
		this.children.push(c);
		return c;
	}
	createEl(tag: string, o?: { cls?: string | string[]; text?: string; attr?: Record<string, string> }): FakeEl { return this.add(tag, o); }
	createDiv(o?: { cls?: string | string[]; text?: string }): FakeEl { return this.add('div', o); }
	createSpan(o?: { cls?: string | string[]; text?: string }): FakeEl { return this.add('span', o); }
	empty(): void { this.children = []; this.text = ''; }
	setText(t: string): void { this.text = t; }
	addClass(c: string): void { this.cls.push(c); }
	setAttr(k: string, v: string): void { this.attr[k] = v; }
	addEventListener(type: string, fn: (ev: unknown) => unknown): void { this.listeners[type] = fn; }
	click(): unknown { return this.listeners.click?.({ preventDefault() {} }); }
	all(): FakeEl[] { return [this, ...this.children.flatMap((c) => c.all())]; }
	find(pred: (e: FakeEl) => boolean): FakeEl[] { return this.all().filter(pred); }
	/** Every text in the tree, in order, one space apart. */
	allText(): string { return this.all().map((e) => e.text).filter(Boolean).join(' '); }
}
