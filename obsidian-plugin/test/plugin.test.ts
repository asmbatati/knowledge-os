/* The plugin as Obsidian loads it: bundled, with the `obsidian` module stubbed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import * as stub from './obsidian-stub.ts';
import { FakeEl } from './helpers.ts';

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
	server: { ownsProcess: boolean };
}
const PluginClass = (require('./.build/main.cjs') as { default: new (app: unknown, m: unknown) => Loaded }).default;

function makeApp(files: Record<string, string>, opts: {
	active?: stub.TFile; secrets?: Record<string, string>; frontmatter?: Record<string, Record<string, unknown>>;
} = {}) {
	const fm: Record<string, unknown> = { read_count: 1, read_on: '2026-10-01' };
	const links: [string, string][] = [];
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
		workspace: {
			onLayoutReady: () => {}, getActiveFile: () => opts.active ?? null, getLeavesOfType: () => [],
			openLinkText: async (name: string, from: string) => { links.push([name, from]); },
		},
		secretStorage: { getSecret: (id: string) => opts.secrets?.[id] ?? null },
		fileManager: { processFrontMatter: async (_f: unknown, fn: (fm: Record<string, unknown>) => void) => fn(fm) },
		metadataCache: {
			getFirstLinkpathDest: () => null,
			getCache: (path: string) => (opts.frontmatter?.[path] ? { frontmatter: opts.frontmatter[path] } : null),
			on: () => ({}),
		},
	};
	return { app, fm, links };
}

/** The site's answer to /api/standing on the demo vault, for the names it holds. */
const DEMO_STANDING: Record<string, unknown> = {
	collection: { note: 'Collection', state: 'granted', stands: true, layer: 0, to_stand: 0, of: 1 },
	counting: { note: 'Counting', state: 'ready', stands: false, layer: 1, to_stand: 1, of: 2 },
	'natural number': { note: 'Natural number', state: 'locked', stands: false, layer: 2, to_stand: 2, of: 3 },
};
function answerStanding(requests: string[] = []) {
	stub.setRequestUrl(async (req) => {
		requests.push(req.url);
		const url = new URL(req.url);
		if (url.pathname !== '/api/standing') return { status: 404, text: '{"error":"no such page"}' };
		const out: Record<string, unknown> = {};
		for (const n of url.searchParams.getAll('name')) if (DEMO_STANDING[n.toLowerCase()]) out[n] = DEMO_STANDING[n.toLowerCase()];
		return { status: 200, text: JSON.stringify({ standing: out }) };
	});
	return requests;
}
const settle = () => new Promise((r) => setTimeout(r, 20));

interface Api {
	version: number;
	status(names: unknown): Promise<Record<string, unknown>>;
	open(action: string, concept: string): void;
}
interface Block extends stub.MarkdownRenderChild { draw(): Promise<void> }

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
	assert.deepEqual(Object.keys(p.processors), ['knowledge-os'], 'the progress block');
	assert.equal((p as unknown as { api: Api }).api.version, 1, 'the API other plugins call');
	p.onunload();
});

test('the API gives the site\'s standing, never starts the site, and opens by action', async () => {
	const { app } = makeApp({});
	const p = new PluginClass(app, { id: 'knowledge-os' });
	await p.onload();
	const api = (p as unknown as { api: Api }).api;
	const requests = answerStanding();
	const got = await api.status(['Collection', 'counting', 'Nope', 7, ' ']);
	assert.deepEqual(got, { Collection: DEMO_STANDING.collection, counting: DEMO_STANDING.counting });
	assert.deepEqual(new URL(requests[0]!).searchParams.getAll('name'), ['Collection', 'counting', 'Nope']);
	assert.deepEqual(await api.status('Collection'), {}, 'not a list: nothing asked');
	assert.equal(requests.length, 1);

	stub.setRequestUrl(null);
	await assert.rejects(api.status(['Collection']), /not answering/);
	assert.equal(p.server.ownsProcess, false, 'a read never starts the site');

	const opened: string[] = [];
	(p as unknown as { openRoute: (r: string) => void }).openRoute = (r) => opened.push(r);
	api.open('check', 'Counting things');
	api.open('teach', 'Counting');
	api.open('place', 'Natural number');
	api.open('explore', 'Stray idea');
	api.open('delete', 'Counting');
	api.open('check', '  ');
	assert.deepEqual(opened, ['check?concept=Counting%20things', 'teach/Counting', 'place/Natural%20number', 'note/Stray%20idea']);
	p.onunload();
});

test('the progress block draws what a chapter assumes and teaches, with its standing and buttons', async () => {
	const path = 'Chapters/Counting in Practice - Chapter.md';
	const { app, links } = makeApp({}, {
		frontmatter: { [path]: { teaches: ['[[Natural number]]'], prerequisites: ['[[Collection]]', '[[Counting]]', '[[Stray idea]]'] } },
	});
	const p = new PluginClass(app, { id: 'knowledge-os' });
	await p.onload();
	answerStanding();
	const el = new FakeEl('div');
	const children: Block[] = [];
	await p.processors['knowledge-os']!('progress\nteaches: teaches\nassumes: prerequisites\n', el,
		{ sourcePath: path, addChild: (c: Block) => { children.push(c); c.load(); } });
	await settle();
	const text = el.allText();
	assert.match(text, /What it assumes 1 of 3 stand/);
	assert.match(text, /Collection Granted Counting Ready to check Check Teach me Stray idea Not on the road Explore/);
	assert.match(text, /What it teaches 0 of 1 stand Natural number Locked 2 of 3 still to stand Teach me Place me/);

	const opened: string[] = [];
	(p as unknown as { openRoute: (r: string) => void }).openRoute = (r) => opened.push(r);
	el.find((e) => e.tag === 'button' && e.text === 'Check')[0]!.click();
	el.find((e) => e.tag === 'button' && e.text === 'Place me')[0]!.click();
	assert.deepEqual(opened, ['check?concept=Counting', 'place/Natural%20number']);
	el.find((e) => e.tag === 'a' && e.text === 'Collection')[0]!.click();
	assert.deepEqual(links, [['Collection', path]]);

	// the site goes away: the block says so and offers to start it, and the road's refresh redraws it
	stub.setRequestUrl(null);
	await p.refresh();
	await settle();
	assert.match(el.allText(), /The Knowledge OS is not running/);
	assert.ok(el.find((e) => e.tag === 'button' && e.text === 'Start the site').length === 1);

	// a site older than the plugin
	stub.setRequestUrl(async () => ({ status: 404, text: '{"error":"no such page"}' }));
	await children[0]!.draw();
	assert.match(el.allText(), /older than this plugin/);

	children[0]!.unload();
	assert.equal((p as unknown as { blocks: Set<unknown> }).blocks.size, 0);
	stub.setRequestUrl(null);
	p.onunload();
});

test('a block that is not progress says what it draws, and asks the site nothing', async () => {
	const { app } = makeApp({}, { frontmatter: { 'a.md': {} } });
	const p = new PluginClass(app, { id: 'knowledge-os' });
	await p.onload();
	const requests = answerStanding();
	const el = new FakeEl('div');
	await p.processors['knowledge-os']!('road\n', el, { sourcePath: 'a.md', addChild: (c: Block) => c.load() });
	await settle();
	assert.match(el.allText(), /draws `progress`/);
	const empty = new FakeEl('div');
	await p.processors['knowledge-os']!('progress', empty, { sourcePath: 'a.md', addChild: (c: Block) => c.load() });
	await settle();
	assert.match(empty.allText(), /names no concepts in prerequisites.*names no concepts in teaches/);
	assert.equal(requests.length, 0);
	stub.setRequestUrl(null);
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
