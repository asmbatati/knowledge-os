import { ItemView, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { noteToOpen, pageUrl } from './api.ts';
import type KnowledgeOsPlugin from './main.ts';

export const VIEW_TYPE = 'knowledge-os';

interface ViewState {
	route?: string;
}

/**
 * The site in an Obsidian tab: a frame on `?embed=1`, which hides the site's own header. The framed site may ask to open
 * a note (knowledge-os:open-note); the request is honoured only from this frame and the site's origin (noteToOpen).
 */
export class KnowledgeView extends ItemView {
	private plugin: KnowledgeOsPlugin;
	private route = 'today';
	private frame: HTMLIFrameElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: KnowledgeOsPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.navigation = true;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Knowledge OS';
	}

	getIcon(): string {
		return 'compass';
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), route: this.route };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = (state ?? {}) as ViewState;
		if (typeof s.route === 'string' && s.route) this.route = s.route;
		await super.setState(state, result);
		await this.show();
	}

	async onOpen(): Promise<void> {
		this.registerDomEvent(window, 'message', (ev: MessageEvent) => {
			const name = noteToOpen(ev, this.frame?.contentWindow ?? null, this.plugin.client().origin);
			if (name) void this.plugin.openNote(name);
		});
		this.addAction('refresh-cw', 'Reload', () => void this.show());
		this.addAction('external-link', 'Open in the browser', () => this.plugin.openInBrowser(this.route));
		await this.show();
	}

	async onClose(): Promise<void> {
		this.frame = null;
		this.contentEl.empty();
	}

	/** Show a route: the frame once the site answers, else what is wrong and a way to start it. */
	async show(route?: string): Promise<void> {
		if (route) this.route = route;
		const el = this.contentEl;
		el.empty();
		el.addClass('kos-view');
		const wait = el.createDiv({ cls: 'kos-wait', text: 'Connecting to the Knowledge OS…' });
		try {
			await this.plugin.ensureServer();
		} catch (e) {
			wait.remove();
			this.frame = null;
			const box = el.createDiv({ cls: 'kos-down' });
			box.createEl('h3', { text: 'The Knowledge OS is not running' });
			box.createEl('p', { cls: 'kos-warn', text: (e as Error).message });
			const row = box.createDiv({ cls: 'kos-buttons' });
			row.createEl('button', { cls: 'mod-cta', text: 'Try again' }).addEventListener('click', () => void this.show());
			row.createEl('button', { text: 'Plugin settings' }).addEventListener('click', () => this.plugin.openSettings());
			row.createEl('button', { text: 'Today\'s road note' }).addEventListener('click', () => void this.plugin.openPracticeNote());
			return;
		}
		wait.remove();
		this.frame = el.createEl('iframe', {
			cls: 'kos-frame',
			attr: { src: pageUrl(this.plugin.settings.siteUrl, this.route, true), title: 'Knowledge OS' },
		});
	}
}
