/* The plugin as Obsidian loads it: bundled, with the `obsidian` module stubbed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import * as stub from './obsidian-stub.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(here + '.build', { recursive: true });
esbuild.buildSync({
	entryPoints: [here + '../src/main.ts'], bundle: true, format: 'cjs', target: 'es2021',
	external: ['obsidian'], outfile: here + '.build/main.cjs', logLevel: 'error',
});
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const load = mod._load;
mod._load = function (request: string, ...rest: unknown[]): unknown {
	return request === 'obsidian' ? stub : load.call(this, request, ...rest);
};
const require = createRequire(import.meta.url);
(globalThis as unknown as { window: unknown }).window = {
	setInterval: () => 0, setTimeout: (cb: () => void) => setTimeout(cb, 0), clearTimeout, crypto: globalThis.crypto,
};

interface Settings { siteUrl: string; learnFolder: string; practiceNote: string; readZones: string; migrated: boolean; keyOpenai: string }
interface Loaded extends stub.Plugin {
	onload(): Promise<void>;
	onunload(): void;
	settings: Settings;
	ensureServer(): Promise<string>;
	refresh(): Promise<void>;
}
const PluginClass = (require('./.build/main.cjs') as { default: new (app: unknown, m: unknown) => Loaded }).default;

function makeApp(files: Record<string, string>, opts: { active?: stub.TFile; secrets?: Record<string, string> } = {}) {
	const fm: Record<string, unknown> = { read_count: 1, read_on: '2026-10-01' };
	const app = {
		vault: {
			configDir: '.obsidian',
			adapter: {
				exists: async (p: string) => p in files,
				read: async (p: string) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]!; },
			},
			on: () => ({}),
			getAbstractFileByPath: () => null,
		},
		workspace: { onLayoutReady: () => {}, getActiveFile: () => opts.active ?? null, getLeavesOfType: () => [] },
		secretStorage: { getSecret: (id: string) => opts.secrets?.[id] ?? null },
		fileManager: { processFrontMatter: async (_f: unknown, fn: (fm: Record<string, unknown>) => void) => fn(fm) },
		metadataCache: { getFirstLinkpathDest: () => null },
	};
	return { app, fm };
}

const learningRoad = { '.obsidian/plugins/vault-exam/manifest.json': '{"id":"vault-exam"}' };

test('the plugin loads and registers its commands, view, settings and status bar', async () => {
	const { app } = makeApp({});
	const p = new PluginClass(app, { id: 'knowledge-os' });
	await p.onload();
	assert.deepEqual(p.commands.map((c) => c.id).sort(), [
		'check-note', 'choose-model', 'explore-note', 'mark-read', 'open', 'open-study', 'place-note', 'start-site', 'stop-site', 'teach-note',
	]);
	assert.deepEqual(p.views, ['knowledge-os']);
	assert.equal(p.tabs.length, 1);
	assert.equal(p.bars.length, 1);
	assert.ok(p.domEvents.some(([, type]) => type === 'beforeunload'), 'the site stops before a reload');
	assert.equal(p.settings.siteUrl, 'http://127.0.0.1:4190');
	assert.equal(p.settings.readZones, '', 'no Learning Road, no zones: mark as read works anywhere');
	assert.equal(p.settings.migrated, true);
	p.onunload();
});

test('Learning Road\'s settings come across once, with its read zones', async () => {
	const { app } = makeApp({
		...learningRoad,
		'.obsidian/plugins/vault-exam/data.json': JSON.stringify({ siteUrl: 'http://127.0.0.1:4999', learnFolder: 'learn', practiceNote: 'Road.md' }),
	});
	const p = new PluginClass(app, { id: 'knowledge-os' });
	await p.onload();
	assert.equal(p.settings.siteUrl, 'http://127.0.0.1:4999');
	assert.equal(p.settings.learnFolder, 'learn');
	assert.equal(p.settings.practiceNote, 'Road.md');
	assert.equal(p.settings.readZones, 'Atlas/, Library/, Areas/Portfolio/My Research/');
	p.onunload();

	// A later load keeps what the user set since, even if Learning Road is still there
	const again = new PluginClass(app, { id: 'knowledge-os' });
	again.data = { ...(p.data as object), siteUrl: 'http://127.0.0.1:4190', readZones: '' };
	await again.onload();
	assert.equal(again.settings.siteUrl, 'http://127.0.0.1:4190');
	assert.equal(again.settings.readZones, '');
	again.onunload();
});

test('the status bar reads the day\'s road files', async () => {
	const pad = (n: number) => String(n).padStart(2, '0');
	const d = new Date();
	const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	const { app } = makeApp({
		[`x/reports/learning/road-plan-${day}.json`]: JSON.stringify({ due_total: 2, ready_total: 3, readings: [] }),
		[`x/reports/learning/road-verdicts-${day}.jsonl`]: '{"v":1}\n{"v":2}\n',
	});
	const p = new PluginClass(app, { id: 'knowledge-os' });
	await p.onload();
	await p.refresh();
	assert.equal(p.bars[0]!.text, '🧭 2 due · 3 ready · 0 to read · ✓ 2 today');
	assert.match(p.bars[0]!.label, /start the Knowledge OS/);
	p.onunload();
});

test('mark as read writes read_on and read_count, and only inside its zones', async () => {
	const inside = new stub.TFile('Atlas/Concepts/Kalman Filter.md');
	const { app, fm } = makeApp(learningRoad, { active: inside });
	const p = new PluginClass(app, { id: 'knowledge-os' });
	await p.onload();
	const cmd = p.commands.find((c) => c.id === 'mark-read')!;
	assert.equal(cmd.checkCallback!(true), true);
	cmd.checkCallback!(false);
	await new Promise((r) => setTimeout(r, 10));
	assert.match(String(fm.read_on), /^\d{4}-\d{2}-\d{2}$/);
	assert.equal(fm.read_count, 2);
	assert.ok(stub.notices.some((n) => n.includes('Read again: Kalman Filter (last 2026-10-01)')));
	p.onunload();

	const { app: app2 } = makeApp(learningRoad, { active: new stub.TFile('+/Clippings/post.md') });
	const q = new PluginClass(app2, { id: 'knowledge-os' });
	await q.onload();
	assert.equal(q.commands.find((c) => c.id === 'mark-read')!.checkCallback!(true), false);
	q.onunload();
});

test('without a site folder, starting says what to set; keys come from the keychain by reference', async () => {
	const { app } = makeApp({}, { secrets: { 'openai-key': 'sk-from-keychain' } });
	const p = new PluginClass(app, { id: 'knowledge-os' });
	p.data = { keyOpenai: 'openai-key' };
	await p.onload();
	await assert.rejects(p.ensureServer(), /Site folder/);
	const keys = (p as unknown as { keys(): Record<string, string> }).keys();
	assert.deepEqual(keys, { OPENAI_API_KEY: 'sk-from-keychain' });
	assert.equal(JSON.stringify(p.data).includes('sk-from-keychain'), false, 'the key itself is never saved');
	assert.equal(typeof (p as unknown as { restartServer: unknown }).restartServer, 'function');
	p.onunload();
});
