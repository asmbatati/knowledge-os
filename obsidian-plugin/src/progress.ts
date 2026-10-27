import { MarkdownRenderChild } from 'obsidian';
import { ApiError } from './api.ts';
import { listsFor, namesFor, parseBlock, summary, type Action, type Role, type Standing } from './block.ts';

/** What a progress block needs from the plugin: the site's standing, the note's frontmatter, links and the routes. */
export interface BlockHost {
	blocks: Set<ProgressBlock>;
	standing(names: string[]): Promise<Record<string, Standing>>;
	frontmatter(path: string): Record<string, unknown> | undefined;
	resolve(link: string, from: string): string | null;
	openLink(name: string, from: string): void;
	openFor(action: Action, concept: string): void;
	start(): Promise<unknown>;
}

const BUTTONS: Record<Action, string> = { check: 'Check', teach: 'Teach me', place: 'Place me', explore: 'Explore' };

/**
 * One drawn `knowledge-os` block (docs/plans/2026-10-27-paper-chapters.md, K4–K5): drawn again when the road's files
 * change or the note's frontmatter does (the plugin calls draw), never written anywhere, and never starting the site by
 * itself: a button does.
 */
export class ProgressBlock extends MarkdownRenderChild {
	readonly path: string;
	private host: BlockHost;
	private source: string;
	private el: HTMLElement;
	private drawn = 0;

	constructor(el: HTMLElement, host: BlockHost, source: string, path: string) {
		super(el);
		this.el = el;
		this.host = host;
		this.source = source;
		this.path = path;
	}

	onload(): void {
		this.host.blocks.add(this);
		void this.draw();
	}

	onunload(): void {
		this.host.blocks.delete(this);
	}

	async draw(): Promise<void> {
		const n = ++this.drawn;
		const spec = parseBlock(this.source);
		if ('error' in spec) {
			this.frame().createEl('p', { cls: 'kos-warn', text: spec.error });
			return;
		}
		const fm = this.host.frontmatter(this.path);
		const resolve = (link: string) => this.host.resolve(link, this.path);
		const names: Record<Role, string[]> = { assumes: namesFor(fm, spec.assumes, resolve), teaches: namesFor(fm, spec.teaches, resolve) };
		let standing: Record<string, Standing>;
		try {
			standing = await this.host.standing([...names.assumes, ...names.teaches]);
		} catch (e) {
			if (n === this.drawn) this.down(e);
			return;
		}
		if (n !== this.drawn) return; // a newer draw has started
		const box = this.frame();
		for (const list of listsFor(spec, names, standing)) {
			const sec = box.createDiv({ cls: 'kos-progress-list' });
			const head = sec.createDiv({ cls: 'kos-progress-title' });
			head.createSpan({ text: list.title });
			if (list.rows.length) head.createSpan({ cls: 'kos-progress-count', text: summary(list.rows) });
			if (!list.rows.length) {
				sec.createEl('p', { cls: 'kos-progress-empty', text: list.empty });
				continue;
			}
			const ul = sec.createEl('ul', { cls: 'kos-progress-rows' });
			for (const row of list.rows) {
				const li = ul.createEl('li', { cls: 'kos-progress-row', attr: { 'data-state': row.state ?? 'off' } });
				const a = li.createEl('a', { cls: 'internal-link', text: row.name, attr: { href: row.name, 'data-href': row.name } });
				a.addEventListener('click', (ev: MouseEvent) => {
					ev.preventDefault();
					this.host.openLink(row.name, this.path);
				});
				li.createSpan({ cls: `kos-state kos-state-${row.state ?? 'off'}`, text: row.label });
				if (row.detail) li.createSpan({ cls: 'kos-detail', text: row.detail });
				if (row.actions.length) {
					const acts = li.createSpan({ cls: 'kos-progress-actions' });
					for (const action of row.actions) {
						acts.createEl('button', { text: BUTTONS[action] }).addEventListener('click', () => this.host.openFor(action, row.name));
					}
				}
			}
		}
	}

	private frame(): HTMLElement {
		this.el.empty();
		const box = this.el.createDiv({ cls: 'kos-progress' });
		box.createDiv({ cls: 'kos-progress-head', text: 'Knowledge OS' });
		return box;
	}

	/** The site did not give the standing: say why, and offer what can be done. */
	private down(e: unknown): void {
		const box = this.frame();
		if (e instanceof ApiError && e.status === 404) {
			box.createEl('p', { cls: 'kos-warn', text: 'This Knowledge OS site is older than this plugin: it has no standing to give. Update the site to 0.9 or later.' });
			return;
		}
		if (e instanceof ApiError && e.status === 0) {
			box.createEl('p', { text: 'The Knowledge OS is not running, so the concepts of this note cannot show where you stand.' });
			const btn = box.createEl('button', { cls: 'mod-cta', text: 'Start the site' });
			btn.addEventListener('click', () => {
				btn.setText('Starting…');
				void this.host.start().then(() => this.draw(), (err: Error) => {
					btn.setText('Start the site');
					box.createEl('p', { cls: 'kos-warn', text: err.message });
				});
			});
			return;
		}
		box.createEl('p', { cls: 'kos-warn', text: `The Knowledge OS could not give the standing: ${(e as Error).message}` });
	}
}
