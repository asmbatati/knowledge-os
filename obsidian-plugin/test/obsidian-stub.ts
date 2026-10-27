/* Just enough of the `obsidian` module to load the bundled plugin in Node and see what it registers. */

export class TFile {
	path: string;
	name: string;
	basename: string;
	extension: string;
	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() ?? path;
		this.extension = this.name.includes('.') ? this.name.split('.').pop() ?? '' : '';
		this.basename = this.extension ? this.name.slice(0, -this.extension.length - 1) : this.name;
	}
}

export class FileSystemAdapter {
	getBasePath(): string { return ''; }
}

const chain = (): unknown => {
	const p: unknown = new Proxy(() => p, { get: (_t, k) => (k === 'then' ? undefined : () => p), apply: () => p });
	return p;
};

export interface StatusBar {
	text: string;
	label: string;
	classes: string[];
	setText(t: string): void;
	setAttr(k: string, v: string): void;
	addClass(c: string): void;
}

export class Plugin {
	app: unknown;
	manifest: unknown;
	commands: { id: string; name: string; callback?: () => unknown; checkCallback?: (checking: boolean) => boolean }[] = [];
	ribbons: string[] = [];
	tabs: unknown[] = [];
	views: string[] = [];
	events: unknown[] = [];
	domEvents: [unknown, string, (ev: unknown) => unknown][] = [];
	bars: StatusBar[] = [];
	processors: Record<string, (source: string, el: unknown, ctx: unknown) => unknown> = {};
	data: unknown = null;
	constructor(app: unknown, manifest: unknown) {
		this.app = app;
		this.manifest = manifest;
	}
	addCommand(c: Plugin['commands'][number]) { this.commands.push(c); return c; }
	addRibbonIcon(_icon: string, title: string) { this.ribbons.push(title); return chain(); }
	addSettingTab(t: unknown) { this.tabs.push(t); }
	registerView(type: string) { this.views.push(type); }
	addStatusBarItem(): StatusBar {
		const bar: StatusBar = {
			text: '', label: '', classes: [],
			setText(t) { bar.text = t; }, setAttr(_k, v) { bar.label = v; }, addClass(c) { bar.classes.push(c); },
		};
		this.bars.push(bar);
		return bar;
	}
	registerEvent(e: unknown) { this.events.push(e); }
	registerDomEvent(el: unknown, type: string, cb: (ev: unknown) => unknown) { this.domEvents.push([el, type, cb]); }
	registerInterval(id: number) { return id; }
	registerMarkdownCodeBlockProcessor(lang: string, fn: (source: string, el: unknown, ctx: unknown) => unknown) { this.processors[lang] = fn; }
	async loadData() { return this.data; }
	async saveData(d: unknown) { this.data = JSON.parse(JSON.stringify(d)); }
}

export class PluginSettingTab {
	containerEl = chain();
	app: unknown;
	plugin: unknown;
	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
	}
	update() {}
	hide() {}
}

export class ItemView {
	leaf: unknown;
	contentEl = chain();
	navigation = false;
	constructor(leaf: unknown) {
		this.leaf = leaf;
	}
	getState() { return {}; }
	async setState() {}
	addAction() {}
	registerDomEvent() {}
}

/** A rendered block's lifetime: load() runs onload, unload() runs onunload, as a section's addChild does. */
export class MarkdownRenderChild {
	containerEl: unknown;
	constructor(containerEl: unknown) {
		this.containerEl = containerEl;
	}
	load() { this.onload(); }
	unload() { this.onunload(); }
	onload() {}
	onunload() {}
	registerEvent() {}
	registerDomEvent() {}
}

export const notices: string[] = [];
export class Notice {
	constructor(msg: string) { notices.push(msg); }
}
export const Platform = { isDesktopApp: false, isWin: false, isMacOS: false };
export const normalizePath = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
/** No network in tests, unless a test answers for the site with setRequestUrl. */
type Answer = (req: { url: string; method?: string }) => Promise<{ status: number; text: string }>;
let answer: Answer | null = null;
export const setRequestUrl = (fn: Answer | null) => { answer = fn; };
export const requestUrl = async (req: { url: string; method?: string }) => {
	if (!answer) throw new Error('no network in tests');
	return answer(req);
};
