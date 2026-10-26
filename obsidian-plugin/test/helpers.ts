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
