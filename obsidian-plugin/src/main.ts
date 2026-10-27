import { FileSystemAdapter, normalizePath, Notice, Platform, Plugin, requestUrl, TFile } from 'obsidian';
import { KnowledgeClient, pageUrl, routes, type Http } from './api.ts';
import type { Action, Standing } from './block.ts';
import { ProgressBlock, type BlockHost } from './progress.ts';
import { countLines, localDay, parsePlan, readable, ROAD_FILE, statusText, type SiteToday } from './road.ts';
import { ServerManager, type RunFn, type SpawnFn } from './server.ts';
import { DEFAULT_SETTINGS, KEY_SETTINGS, KosSettingTab, type KosSettings } from './settings.ts';
import { KnowledgeView, VIEW_TYPE } from './view.ts';

/** Obsidian's requestUrl: no CORS, works against the local site from the app. */
const obsidianHttp: Http = async (req) => {
	const res = await requestUrl({
		url: req.url, method: req.method ?? 'GET', body: req.body, contentType: req.contentType, headers: req.headers, throw: false,
	});
	return { status: res.status, text: res.text };
};

const EVERY_MS = 5 * 60 * 1000;
const DEBOUNCE_MS = 2000;

/* Learning Road kept read_on to these folders (vault CLAUDE.md §8.3); this vault keeps them when the zones are unset. */
const LEARNING_ROAD_ZONES = 'Atlas/, Library/, Areas/Portfolio/My Research/';

/** The routes another plugin may open through the API, by action. */
const OPEN: Record<Action, (name: string) => string> = { check: routes.check, teach: routes.teach, place: routes.place, explore: routes.explore };
const MAX_NAMES = 200;

/**
 * What this plugin publishes for other plugins (docs/OBSIDIAN.md, *For other plugins*; paper2chapter uses it):
 * `app.plugins.plugins['knowledge-os'].api`. Version 1: status() reads each concept's standing from the site and never
 * starts it; open() shows the site's page for a concept, starting the site as every command does.
 */
export interface KnowledgeOsApi {
	version: 1;
	status(names: string[]): Promise<Record<string, Standing>>;
	open(action: Action, concept: string): void;
}

export default class KnowledgeOsPlugin extends Plugin implements BlockHost {
	settings: KosSettings = { ...DEFAULT_SETTINGS };
	server!: ServerManager;
	readonly blocks = new Set<ProgressBlock>();
	readonly api: KnowledgeOsApi = {
		version: 1,
		status: (names) => this.standing(names),
		open: (action, concept) => this.openFor(action, concept),
	};
	private apiClient: KnowledgeClient | null = null;
	private bar: HTMLElement | null = null;
	private pending: number | null = null;
	private siteUp = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.server = new ServerManager({
			spawn: desktopSpawn(),
			run: desktopRun(),
			health: () => this.client().health(),
			exists: desktopExists(),
			platform: Platform.isWin ? 'win32' : Platform.isMacOS ? 'darwin' : 'linux',
			env: desktopEnv(),
			vaultPath: this.vaultPath(),
			keys: () => this.keys(),
			token: newToken,
			parentPid: desktopPid(),
			killTree: desktopKillTree(),
		});
		this.registerView(VIEW_TYPE, (leaf) => new KnowledgeView(leaf, this));
		this.addSettingTab(new KosSettingTab(this.app, this));
		this.addRibbonIcon('compass', 'Open the Knowledge OS', () => this.openRoute('today'));

		this.addCommand({ id: 'open', name: 'Open today', callback: () => this.openRoute('today') });
		this.addCommand({ id: 'open-study', name: 'Study session', callback: () => this.openRoute(routes.study()) });
		this.addCommand({ id: 'choose-model', name: 'Choose the model', callback: () => this.openSettings() });
		this.noteCommand('check-note', 'Check this concept', routes.check);
		this.noteCommand('teach-note', 'Teach this note', routes.teach);
		this.noteCommand('explore-note', 'Explore this note', routes.explore);
		this.noteCommand('place-note', 'Place me toward this goal', routes.place);
		this.addCommand({
			id: 'mark-read',
			name: 'Mark this note as read',
			checkCallback: (checking) => {
				const f = this.app.workspace.getActiveFile();
				if (!f || f.extension !== 'md' || !readable(f.path, this.zones())) return false;
				if (!checking) void this.markRead(f);
				return true;
			},
		});
		this.addCommand({
			id: 'start-site',
			name: 'Start the site',
			callback: async () => {
				try {
					new Notice((await this.ensureServer()) === 'started' ? 'Knowledge OS: started.' : 'Knowledge OS: already running.');
				} catch (e) {
					new Notice((e as Error).message, 10000);
				}
			},
		});
		this.addCommand({
			id: 'stop-site',
			name: 'Stop the site',
			callback: () => {
				const owned = this.server.ownsProcess;
				this.server.stop();
				new Notice(owned ? 'Knowledge OS: stopped.' : 'Knowledge OS: this plugin did not start the site, so it left it running.');
			},
		});

		this.bar = this.addStatusBarItem();
		this.bar.addClass('mod-clickable');
		this.bar.setText('🧭 …');
		this.registerDomEvent(this.bar, 'click', () => this.openRoute('today'));
		// A window reload never runs a plugin's unload: stop the site this plugin started before the window goes.
		this.registerDomEvent(window, 'beforeunload', () => this.server.stop());
		this.registerMarkdownCodeBlockProcessor('knowledge-os', (source, el, ctx) => {
			ctx.addChild(new ProgressBlock(el, this, source, ctx.sourcePath));
		});
		this.registerEvent(this.app.vault.on('modify', (f) => this.onFile(f.path)));
		this.registerEvent(this.app.vault.on('create', (f) => this.onFile(f.path)));
		// a block reads its note's frontmatter: when that changes, the block is drawn again
		this.registerEvent(this.app.metadataCache.on('changed', (f) => this.redrawBlocks(f.path)));
		this.registerInterval(window.setInterval(() => void this.refresh(), EVERY_MS));
		this.app.workspace.onLayoutReady(() => {
			void this.refresh();
			if (this.settings.autoStart && this.settings.display === 'tab' && this.app.workspace.getLeavesOfType(VIEW_TYPE).length) {
				void this.ensureServer().catch(() => {});
			}
		});
	}

	onunload(): void {
		if (this.pending !== null) window.clearTimeout(this.pending);
		this.server?.stop();
	}

	// ------------------------------------------------------------------ settings

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<KosSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		if (!this.settings.migrated) {
			await this.importLearningRoad(saved === null);
			this.settings.migrated = true;
			await this.saveData(this.settings);
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		void this.refresh();
	}

	/** Once: take Learning Road's settings (the plugin this one replaces), and its read zones in a vault that used it. */
	private async importLearningRoad(fresh: boolean): Promise<void> {
		const dir = normalizePath(`${this.app.vault.configDir}/plugins/vault-exam`);
		const adapter = this.app.vault.adapter;
		try {
			if (!(await adapter.exists(`${dir}/manifest.json`))) return;
			if (fresh) this.settings.readZones = LEARNING_ROAD_ZONES;
			if (!(await adapter.exists(`${dir}/data.json`))) return;
			const old = JSON.parse(await adapter.read(`${dir}/data.json`)) as Partial<Record<'siteUrl' | 'learnFolder' | 'practiceNote', unknown>>;
			for (const k of ['siteUrl', 'learnFolder', 'practiceNote'] as const) {
				const v = old[k];
				if (typeof v === 'string' && v.trim() && (fresh || this.settings[k] === DEFAULT_SETTINGS[k])) this.settings[k] = v.trim();
			}
		} catch {
			/* A settings file that cannot be read is left behind; the defaults stand. */
		}
	}

	private zones(): string[] {
		return this.settings.readZones.split(',');
	}

	/** API keys from Obsidian's keychain, by the variable the site reads; only a site this plugin starts gets them. */
	private keys(): Record<string, string> {
		const out: Record<string, string> = {};
		for (const [key, env] of KEY_SETTINGS) {
			const id = this.settings[key];
			if (typeof id !== 'string' || !id) continue;
			const secret = this.app.secretStorage.getSecret(id);
			if (secret) out[env] = secret;
		}
		return out;
	}

	private vaultPath(): string {
		const a = this.app.vault.adapter;
		return a instanceof FileSystemAdapter ? a.getBasePath() : '';
	}

	// ------------------------------------------------------------------ the site

	client(): KnowledgeClient {
		this.apiClient ??= new KnowledgeClient(this.settings.siteUrl, obsidianHttp);
		this.apiClient.pluginToken = this.server?.tokenFor(this.settings.siteUrl) ?? '';
		return this.apiClient;
	}

	resetClient(): void {
		this.apiClient = null;
	}

	async ensureServer(): Promise<'running' | 'started'> {
		const how = await this.server.ensure(this.settings);
		this.siteUp = true;
		return how;
	}

	/** Stop the site this plugin started and start it again, so it reads the keys afresh. */
	async restartServer(): Promise<void> {
		this.server.stop();
		for (let i = 0; i < 20 && (await this.client().health()); i++) await new Promise((r) => window.setTimeout(r, 250));
		await this.ensureServer();
	}

	openSettings(): void {
		this.openRoute(routes.settings());
	}

	/** A route of the site, in a tab or the browser as the settings say. */
	openRoute(route: string): void {
		if (this.settings.display === 'browser') {
			this.openInBrowser(route);
			return;
		}
		void this.openTab(route);
	}

	openInBrowser(route: string): void {
		void this.ensureServer().then(
			() => window.open(pageUrl(this.settings.siteUrl, route, false)),
			async (e: Error) => {
				new Notice(`${e.message}\nHere is today's road note instead.`, 10000);
				await this.openPracticeNote();
			},
		);
	}

	private async openTab(route: string): Promise<void> {
		const ws = this.app.workspace;
		const leaf = ws.getLeavesOfType(VIEW_TYPE)[0] ?? ws.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { route } });
		await ws.revealLeaf(leaf);
	}

	private noteCommand(id: string, name: string, route: (note: string) => string): void {
		this.addCommand({
			id,
			name,
			checkCallback: (checking) => {
				const f = this.app.workspace.getActiveFile();
				if (!f || f.extension !== 'md') return false;
				if (!checking) this.openRoute(route(f.basename));
				return true;
			},
		});
	}

	// ------------------------------------------------------------------ for other plugins, and the progress block

	/** Each concept's standing on the road, from the site; a list of names only, at most 200, and never a start. */
	async standing(names: unknown): Promise<Record<string, Standing>> {
		if (!Array.isArray(names)) return {};
		const list = names.filter((n): n is string => typeof n === 'string').map((n) => n.trim())
			.filter((n) => n && n.length <= 300).slice(0, MAX_NAMES);
		return this.client().standing(list);
	}

	/** The site's page for a concept, by action: check, teach, place or explore. Anything else is ignored. */
	openFor(action: string, concept: string): void {
		const name = typeof concept === 'string' ? concept.trim() : '';
		const route = Object.prototype.hasOwnProperty.call(OPEN, action) && name ? OPEN[action as Action](name) : '';
		if (route) this.openRoute(route);
	}

	frontmatter(path: string): Record<string, unknown> | undefined {
		return this.app.metadataCache.getCache(path)?.frontmatter;
	}

	resolve(link: string, from: string): string | null {
		return this.app.metadataCache.getFirstLinkpathDest(link, from)?.basename ?? null;
	}

	openLink(name: string, from: string): void {
		void this.app.workspace.openLinkText(name, from, false);
	}

	start(): Promise<unknown> {
		return this.ensureServer();
	}

	/** Draw the progress blocks again: all of them, or those of one note. */
	private redrawBlocks(path?: string): void {
		for (const b of this.blocks) if (!path || b.path === path) void b.draw();
	}

	// ------------------------------------------------------------------ notes

	/** A note the framed site names: opened in a new tab beside it. */
	async openNote(name: string): Promise<void> {
		const f = this.app.metadataCache.getFirstLinkpathDest(name, '');
		if (!f) {
			new Notice(`No note named ${name} in this vault.`);
			return;
		}
		await this.app.workspace.getLeaf('tab').openFile(f);
	}

	async openPracticeNote(): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.practiceNote));
		if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f);
		else new Notice('Today\'s road note is not where the plugin settings say.');
	}

	/**
	 * The one frontmatter write this plugin makes, and only on your click: read_on (the day you finished reading) and
	 * read_count. The site writes nothing into notes; its verdicts go to its own ledgers.
	 */
	private async markRead(file: TFile): Promise<void> {
		let before = '';
		try {
			await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				before = typeof fm.read_on === 'string' ? fm.read_on : fm.read_on ? 'an earlier day' : '';
				fm.read_on = localDay();
				fm.read_count = (typeof fm.read_count === 'number' ? fm.read_count : 0) + 1;
			});
			new Notice(before ? `Read again: ${file.basename} (last ${before}).` : `Marked read: ${file.basename}.`, 5000);
		} catch (e) {
			new Notice(`Could not mark it read: ${(e as Error).message}`, 8000);
		}
	}

	// ------------------------------------------------------------------ the status bar

	private folder(): string {
		return normalizePath(this.settings.learnFolder || DEFAULT_SETTINGS.learnFolder);
	}

	/** Only the road's own files wake the bar, and a burst of them (a session's verdicts) wakes it once. */
	private onFile(path: string): void {
		if (!path.startsWith(this.folder() + '/') || !ROAD_FILE.test(path) || this.pending !== null) return;
		this.pending = window.setTimeout(() => {
			this.pending = null;
			void this.refresh();
		}, DEBOUNCE_MS);
	}

	private async readText(path: string): Promise<string | null> {
		try {
			return await this.app.vault.adapter.read(normalizePath(path));
		} catch {
			return null;
		}
	}

	async refresh(): Promise<void> {
		if (!this.bar) return;
		const day = localDay();
		const [plan, verdicts, site] = await Promise.all([
			this.readText(`${this.folder()}/road-plan-${day}.json`),
			this.readText(`${this.folder()}/road-verdicts-${day}.jsonl`),
			this.client().today().then((t) => t as SiteToday, () => null),
		]);
		this.siteUp = site !== null;
		this.redrawBlocks(); // the road moved, or the site came or went
		this.bar.setText(statusText(parsePlan(plan), countLines(verdicts), site));
		this.bar.setAttr('aria-label', this.siteUp
			? 'The Knowledge OS is running: click to open it'
			: this.settings.autoStart ? 'Click to start the Knowledge OS and open today' : 'The Knowledge OS is not running: click for today');
	}
}

function newToken(): string {
	const b = new Uint8Array(24);
	window.crypto.getRandomValues(b);
	return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/* Desktop-only pieces. Node's modules exist in Obsidian's desktop app; the plugin is marked desktop-only. */
type NodeRequire = (id: string) => unknown;
function nodeRequire(): NodeRequire | null {
	if (!Platform.isDesktopApp) return null;
	const w = window as unknown as { require?: NodeRequire };
	return typeof w.require === 'function' ? w.require : null;
}

function desktopSpawn(): SpawnFn {
	return (cmd, args, opts) => {
		const req = nodeRequire();
		if (!req) throw new Error('Starting the site needs the desktop app.');
		const cp = req('child_process') as { spawn: (c: string, a: string[], o: object) => ReturnType<SpawnFn> };
		return cp.spawn(cmd, args, { cwd: opts.cwd, env: opts.env, windowsHide: true });
	};
}

function desktopRun(): RunFn {
	return (cmd, args, cwd) => {
		const req = nodeRequire();
		if (!req) throw new Error('the desktop app is needed');
		const cp = req('child_process') as {
			spawnSync: (c: string, a: string[], o: object) => { status: number | null; stdout: string; stderr: string; error?: Error };
		};
		const r = cp.spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
		if (r.error) throw r.error;
		return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
	};
}

function desktopExists(): (p: string) => boolean {
	return (p) => {
		const req = nodeRequire();
		if (!req) return false;
		return (req('fs') as { existsSync: (p: string) => boolean }).existsSync(p);
	};
}

function desktopEnv(): Record<string, string | undefined> {
	const req = nodeRequire();
	return req ? { ...(req('process') as { env: Record<string, string | undefined> }).env } : {};
}

function desktopPid(): number | undefined {
	const req = nodeRequire();
	return req ? (req('process') as { pid: number }).pid : undefined;
}

function desktopKillTree(): (pid: number) => void {
	return (pid) => {
		const req = nodeRequire();
		if (!req) return;
		const cp = req('child_process') as { spawnSync: (c: string, a: string[], o: object) => unknown };
		const proc = req('process') as { platform: string; kill: (pid: number) => void };
		if (proc.platform === 'win32') cp.spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true });
		else proc.kill(pid);
	};
}
