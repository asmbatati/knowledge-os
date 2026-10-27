import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, KnowledgeClient, noteToOpen, pageUrl, routes } from '../src/api.ts';
import { response, scripted } from './helpers.ts';

const models = { providers: [], current: null, grader: 'claude', effort: '', budget: { daily_usd: 1, spent_usd: 0 }, trust: {}, plugin: true };

test('reads go out plain; the model is saved only with the plugin secret', async () => {
	const http = scripted([
		(req, url) => (url.pathname === '/api/health' ? response(200, { ok: true }) : undefined),
		(req, url) => (url.pathname === '/api/models' ? response(200, models) : undefined),
		(req, url) => (url.pathname === '/api/models/save' ? response(200, models) : undefined),
	]);
	const c = new KnowledgeClient('http://127.0.0.1:4190/', http);
	assert.equal(c.base, 'http://127.0.0.1:4190');
	assert.equal(c.origin, 'http://127.0.0.1:4190');
	assert.equal(await c.health(), true);
	assert.deepEqual(await c.models(), models);
	assert.throws(() => c.saveModel({ provider: 'ollama' }), (e: unknown) => e instanceof ApiError && e.status === 403);
	c.pluginToken = 'secret-1';
	await c.saveModel({ provider: 'ollama', model: 'llama3' });
	const save = http.calls.at(-1)!;
	assert.equal(save.method, 'POST');
	assert.equal(save.headers?.['X-LOS-Plugin'], 'secret-1');
	assert.deepEqual(JSON.parse(save.body!), { provider: 'ollama', model: 'llama3' });
	assert.equal(http.calls.filter((r) => r.headers).length, 1);
});

test('errors carry the site\'s own message, and a dead site says where it was looked for', async () => {
	const c = new KnowledgeClient('http://127.0.0.1:4190', scripted([() => response(400, { error: 'unknown provider: x' })]));
	await assert.rejects(c.check('x'), /unknown provider: x/);
	const dead = new KnowledgeClient('http://127.0.0.1:4190', async () => { throw new Error('ECONNREFUSED'); });
	assert.equal(await dead.health(), false);
	await assert.rejects(dead.today(), (e: unknown) => e instanceof ApiError && e.status === 0 && /127\.0\.0\.1:4190/.test(e.message));
});

test('standing asks for each name once, in one read, and none for no names', async () => {
	const answer = { standing: { 'Kalman Filter': { note: 'Kalman Filter', state: 'ready', stands: false, layer: 4, to_stand: 1, of: 9 } } };
	const http = scripted([(req, url) => (url.pathname === '/api/standing' ? response(200, answer) : undefined)]);
	const c = new KnowledgeClient('http://127.0.0.1:4190', http);
	assert.deepEqual(await c.standing(['Kalman Filter', 'A & B', 'Kalman Filter']), answer.standing);
	const url = new URL(http.calls[0]!.url);
	assert.deepEqual(url.searchParams.getAll('name'), ['Kalman Filter', 'A & B']);
	assert.equal(http.calls[0]!.method ?? 'GET', 'GET');
	assert.deepEqual(await c.standing([]), {});
	assert.equal(http.calls.length, 1, 'no names, no request');
	const old = new KnowledgeClient('http://127.0.0.1:4190', scripted([]));
	await assert.rejects(old.standing(['x']), (e: unknown) => e instanceof ApiError && e.status === 404);
});

test('pages are framed for a tab and plain for the browser', () => {
	assert.equal(pageUrl('http://127.0.0.1:4190/', 'today', true), 'http://127.0.0.1:4190/?embed=1#/today');
	assert.equal(pageUrl('http://127.0.0.1:4190', '#/settings', false), 'http://127.0.0.1:4190/#/settings');
	assert.equal(routes.check('Kalman Filter'), 'check?concept=Kalman%20Filter');
	assert.equal(routes.teach('مرشح كالمان'), `teach/${encodeURIComponent('مرشح كالمان')}`);
	assert.equal(routes.place('A/B'), 'place/A%2FB');
});

test('a note is opened only for the site\'s own frame', () => {
	const frame = {};
	const ok = { origin: 'http://127.0.0.1:4190', source: frame, data: { type: 'knowledge-os:open-note', name: ' Kalman Filter ' } };
	assert.equal(noteToOpen(ok, frame, 'http://127.0.0.1:4190'), 'Kalman Filter');
	assert.equal(noteToOpen({ ...ok, source: {} }, frame, 'http://127.0.0.1:4190'), null);
	assert.equal(noteToOpen({ ...ok, origin: 'http://evil.example' }, frame, 'http://127.0.0.1:4190'), null);
	assert.equal(noteToOpen(ok, null, 'http://127.0.0.1:4190'), null);
	assert.equal(noteToOpen({ ...ok, data: { type: 'other', name: 'x' } }, frame, 'http://127.0.0.1:4190'), null);
	assert.equal(noteToOpen({ ...ok, data: { type: 'knowledge-os:open-note', name: 3 } }, frame, 'http://127.0.0.1:4190'), null);
	assert.equal(noteToOpen({ ...ok, data: { type: 'knowledge-os:open-note', name: 'a\nb' } }, frame, 'http://127.0.0.1:4190'), null);
	assert.equal(noteToOpen({ ...ok, data: { type: 'knowledge-os:open-note', name: 'x'.repeat(301) } }, frame, 'http://127.0.0.1:4190'), null);
	assert.equal(noteToOpen({ ...ok, data: null }, frame, 'http://127.0.0.1:4190'), null);
});
