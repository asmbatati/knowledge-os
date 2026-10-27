/*
 * End to end against the real site: the plugin's ServerManager starts server.py from the site's folder on a demo vault
 * (--demo: a temporary copy, nothing of the learner's touched, the model choice never written to a file), and the
 * plugin's client reads it, saves a model with the plugin secret, and is refused without it.
 * Skipped when Python cannot import the site's two packages (markdown, pyyaml).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KnowledgeClient, pageUrl, type Http } from '../src/api.ts';
import { findPython, ServerManager } from '../src/server.ts';

const siteDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const settings = { siteUrl: 'http://127.0.0.1:18790', siteDir, pythonPath: process.env.KOS_PYTHON ?? '', autoStart: true };
const python = findPython(settings, process.platform);
const ready = spawnSync(python, ['-c', 'import markdown, yaml'], { cwd: siteDir }).status === 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 500)));

const http: Http = async (req) => {
	const res = await fetch(req.url, {
		method: req.method ?? 'GET',
		body: req.body,
		headers: { ...(req.contentType ? { 'Content-Type': req.contentType } : {}), ...(req.headers ?? {}) },
	});
	return { status: res.status, text: await res.text() };
};

test('the plugin starts the site, reads it, and saves a model only with its secret', { skip: !ready && 'Python lacks markdown or pyyaml', timeout: 120_000 }, async () => {
	const client = new KnowledgeClient(settings.siteUrl, http);
	const server = new ServerManager({
		spawn: (cmd, args, opts) => spawn(cmd, args, { cwd: opts.cwd, env: opts.env, windowsHide: true }),
		run: (cmd, args, cwd) => {
			const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
			if (r.error) throw r.error;
			return { status: r.status, stdout: r.stdout, stderr: r.stderr };
		},
		health: () => client.health(),
		exists: existsSync,
		platform: process.platform,
		env: { ...process.env },
		vaultPath: '',
		keys: () => ({}),
		token: () => 'e2e-plugin-secret-' + process.pid,
		parentPid: process.pid,
		extraArgs: ['--demo', '--grader', 'self'],
		sleep,
		killTree: (pid) => {
			if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)]);
			else process.kill(pid);
		},
	});
	try {
		assert.equal(await server.ensure(settings), 'started');
		assert.ok(server.ownsProcess);

		const today = await client.today();
		assert.equal(typeof today, 'object');

		// the standing the plugin's API gives other plugins, read from the road
		const standing = await client.standing(['Collection', 'counting', 'Stray idea', 'No such concept']);
		assert.deepEqual(Object.keys(standing).sort(), ['Collection', 'counting']);
		assert.equal(standing.Collection?.state, 'granted');
		assert.equal(standing.Collection?.stands, true);
		assert.equal(standing.counting?.note, 'Counting');
		assert.equal(standing.counting?.state, 'ready');

		const before = await client.models();
		assert.ok(before.providers.some((p) => p.id === 'claude-cli'));
		assert.ok(before.providers.some((p) => p.id === 'ollama'));
		assert.equal(before.plugin, true, 'the site knows a plugin started it');

		assert.throws(() => client.saveModel({ provider: 'ollama' }), /not started by the plugin/);
		client.pluginToken = 'not-the-secret';
		await assert.rejects(client.saveModel({ provider: 'ollama' }), /403|own page/);

		client.pluginToken = server.pluginToken;
		const after = await client.saveModel({ provider: 'ollama', model: 'llama3.2' });
		assert.equal(after.current?.provider, 'ollama');
		assert.equal(after.current?.model, 'llama3.2');

		// the page is framed for Obsidian, and for nothing else
		const page = await fetch(pageUrl(settings.siteUrl, 'today', true).split('#')[0]!);
		const csp = page.headers.get('content-security-policy') ?? '';
		assert.match(csp, /frame-ancestors 'self' app:\/\/obsidian\.md;/);
		assert.equal(page.headers.get('x-frame-options'), null);
		const api = await fetch(settings.siteUrl + '/api/health');
		assert.equal(api.headers.get('x-frame-options'), 'DENY');
	} finally {
		server.stop();
	}
	for (let i = 0; i < 20 && (await client.health()); i++) await sleep(250);
	assert.equal(await client.health(), false, 'the site stops with the plugin');
});
