import { App, Notice, PluginSettingTab, type Setting, type SettingDefinitionItem } from 'obsidian';
import type KnowledgeOsPlugin from './main.ts';
import type { ModelChoice, Models, ProviderInfo } from './api.ts';

export interface KosSettings {
	siteUrl: string;
	siteDir: string;
	pythonPath: string;
	autoStart: boolean;
	display: 'tab' | 'browser';
	learnFolder: string;
	practiceNote: string;
	readZones: string;
	keyAnthropic: string;
	keyOpenai: string;
	keyGemini: string;
	keyOpenrouter: string;
	keyCustom: string;
	migrated: boolean;
}

export const DEFAULT_SETTINGS: KosSettings = {
	siteUrl: 'http://127.0.0.1:4190',
	siteDir: '',
	pythonPath: '',
	autoStart: true,
	display: 'tab',
	learnFolder: 'x/reports/learning',
	practiceNote: 'Areas/Education/Self-Study/Daily Practice.md',
	readZones: '',
	keyAnthropic: '',
	keyOpenai: '',
	keyGemini: '',
	keyOpenrouter: '',
	keyCustom: '',
	migrated: false,
};

/** Each secret setting names an entry in Obsidian's keychain; its value reaches only a site this plugin starts. */
export const KEY_SETTINGS: [keyof KosSettings, string, string][] = [
	['keyAnthropic', 'ANTHROPIC_API_KEY', 'Anthropic API key'],
	['keyOpenai', 'OPENAI_API_KEY', 'OpenAI API key'],
	['keyGemini', 'GEMINI_API_KEY', 'Google Gemini API key'],
	['keyOpenrouter', 'OPENROUTER_API_KEY', 'OpenRouter API key'],
	['keyCustom', 'CUSTOM_OPENAI_API_KEY', 'Custom server API key'],
];

const TIER: Record<string, string> = { subscription: 'your plan', paid: 'pay per use', 'free-tier': 'free tier', local: 'on this machine' };
const WHY: Record<string, string> = {
	no_cli: 'its command-line tool is not installed', no_key: 'no API key reaches the site',
	no_provider: 'none chosen', quiet: 'resting in the night jobs\' hours', budget: 'today\'s budget is spent',
	untrusted: 'not yet through its test',
};

export function providerLabel(p: ProviderInfo): string {
	return `${p.label} (${TIER[p.tier] ?? p.tier}${p.ready ? '' : ', not set up'})`;
}

const TRIMMED = new Set(['siteUrl', 'siteDir', 'pythonPath', 'learnFolder', 'practiceNote']);

export class KosSettingTab extends PluginSettingTab {
	private plugin: KnowledgeOsPlugin;
	private models: Models | null = null;
	private modelsError = '';
	private choice: ModelChoice = {};
	private tried = false;
	private connection = 'Not checked yet.';

	constructor(app: App, plugin: KnowledgeOsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getControlValue(key: string): unknown {
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		let v = value;
		if (typeof v === 'string' && TRIMMED.has(key)) v = v.trim();
		if (key === 'siteUrl' && !v) v = DEFAULT_SETTINGS.siteUrl;
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = v;
		if (key === 'siteUrl') {
			// A site this plugin started serves the old address: stop it, and the next connect starts or finds the new one.
			this.plugin.server.stop();
			this.plugin.resetClient();
		}
		await this.plugin.saveSettings();
		if (KEY_SETTINGS.some(([k]) => k === key) && this.plugin.server.ownsProcess) {
			// A key reaches the site only when it starts: restart the site this plugin started.
			try {
				await this.plugin.restartServer();
				new Notice('Knowledge OS: restarted the site with the new key.');
			} catch (e) {
				new Notice((e as Error).message, 10000);
			}
		}
	}

	hide(): void {
		this.tried = false;
		super.hide();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const loaded = () => this.models !== null;
		return [
			{
				type: 'group',
				heading: 'Site',
				items: [
					{ name: 'Address', desc: 'Where the Knowledge OS listens.', control: { type: 'text', key: 'siteUrl', placeholder: DEFAULT_SETTINGS.siteUrl } },
					{ name: 'Start the site automatically', desc: 'When it is not running, start it with the keys below. It stops when Obsidian closes; a site started another way is left alone.', control: { type: 'toggle', key: 'autoStart' } },
					{ name: 'Site folder', desc: 'The folder that holds server.py. Leave empty when the vault carries it in x/apps/knowledge-os.', control: { type: 'text', key: 'siteDir' } },
					{ name: 'Python', desc: 'Leave empty to use the one on your path. It needs Markdown and PyYAML.', control: { type: 'text', key: 'pythonPath', placeholder: 'Automatic' } },
					{ name: 'Connection', render: (s) => this.renderConnection(s) },
					{ name: 'Site log', searchable: false, visible: () => this.plugin.server.log.length > 0, render: (s) => this.renderLog(s) },
				],
			},
			{
				type: 'group',
				heading: 'Display',
				items: [
					{ name: 'Open the site in', desc: 'An Obsidian tab beside your notes, or your browser.', control: { type: 'dropdown', key: 'display', options: { tab: 'An Obsidian tab', browser: 'The browser' } } },
				],
			},
			{
				type: 'group',
				heading: 'Model',
				items: [
					{ name: 'Providers', visible: () => !loaded(), render: (s) => this.renderLoad(s) },
					{ name: 'Provider', aliases: ['subscription', 'API key', 'Claude', 'OpenAI', 'Ollama'], visible: loaded, render: (s) => this.renderProvider(s) },
					{ name: 'Model', visible: loaded, render: (s) => this.renderModel(s) },
					{ name: 'Reasoning effort', visible: loaded, render: (s) => this.renderEffort(s) },
					{ name: 'Daily budget for paid models', visible: loaded, render: (s) => this.renderBudget(s) },
					{ name: 'Tests before trust', visible: loaded, render: (s) => this.renderTrust(s) },
					{ name: 'Save model', searchable: false, visible: loaded, render: (s) => this.renderActions(s) },
				],
			},
			{
				type: 'group',
				heading: 'API keys',
				items: [
					{ name: 'Where keys go', searchable: false, desc: 'Each key is kept in Obsidian\'s keychain and handed only to a site this plugin starts, in its environment. It is never written to a file, the vault or the site\'s settings.' },
					...KEY_SETTINGS.map(([key, env, label]) => ({
						name: label, desc: `Read by the site as ${env}.`, control: { type: 'secret' as const, key },
					})),
				],
			},
			{
				type: 'group',
				heading: 'Road',
				items: [
					{ name: 'Road folder', desc: 'The day\'s road plan and the verdict ledgers, relative to the vault.', control: { type: 'text', key: 'learnFolder', placeholder: DEFAULT_SETTINGS.learnFolder } },
					{ name: 'Today\'s road note', desc: 'Opened when the site is not running.', control: { type: 'text', key: 'practiceNote', placeholder: DEFAULT_SETTINGS.practiceNote } },
					{ name: 'Where mark as read applies', desc: 'Folder prefixes, separated by commas; empty means every note.', control: { type: 'text', key: 'readZones', placeholder: 'Atlas/, Library/' } },
				],
			},
		];
	}

	// ---------------------------------------------------------------- site rows

	private renderConnection(setting: Setting): void {
		setting.setDesc(this.connection).addButton((b) => b.setButtonText('Connect').setCta().onClick(async () => {
			setting.setDesc('Connecting…');
			try {
				const how = await this.plugin.ensureServer();
				this.connection = how === 'started' ? 'Started the site, with your keys.' : 'The site is running (started outside Obsidian).';
				await this.load();
			} catch (e) {
				this.connection = (e as Error).message;
			}
			this.update();
		}));
	}

	private renderLog(setting: Setting): void {
		setting.setDesc('The last lines the site printed.');
		setting.descEl.createEl('pre', { text: this.plugin.server.log.slice(-60).join('\n'), cls: 'kos-log' });
	}

	// ---------------------------------------------------------------- model rows

	private async load(): Promise<void> {
		try {
			this.models = await this.plugin.client().models();
			this.choice = { provider: this.models.current?.provider ?? '', model: this.models.current?.model ?? '' };
			this.modelsError = '';
		} catch (e) {
			this.models = null;
			this.modelsError = (e as Error).message;
		}
	}

	private provider(): ProviderInfo | undefined {
		return this.models?.providers.find((p) => p.id === this.choice.provider);
	}

	private renderLoad(setting: Setting): void {
		if (!this.tried) {
			this.tried = true;
			void this.load().then(() => { if (this.models) this.update(); });
		}
		setting.setDesc(this.modelsError || 'Connect to the site to choose its model: a Claude or OpenAI subscription, an API key, or a model on this machine.')
			.addButton((b) => b.setButtonText('Load providers').onClick(async () => {
				await this.load();
				this.update();
			}));
	}

	private renderProvider(setting: Setting): void {
		const m = this.models;
		if (!m) return;
		const cur = m.current;
		setting.setDesc(cur ? `Now: ${cur.label}${cur.available ? '' : ' (' + (WHY[cur.why_code] ?? cur.why_code) + ')'}` : '');
		setting.addDropdown((d) => {
			d.addOption('', 'None: grade your answers yourself');
			for (const p of m.providers) d.addOption(p.id, providerLabel(p));
			d.setValue(this.choice.provider ?? '').onChange((v) => {
				this.choice = { ...this.choice, provider: v, model: m.providers.find((p) => p.id === v)?.models[0]?.id ?? '' };
				this.update();
			});
		});
		const p = this.provider();
		if (p && !p.ready) setting.descEl.createDiv({ cls: 'kos-warn', text: `${WHY[p.why_code] ?? p.why_code}. ${p.setup_hint}` });
		if (p?.notes) setting.descEl.createDiv({ cls: 'kos-note', text: p.notes });
	}

	private renderModel(setting: Setting): void {
		const p = this.provider();
		setting.addDropdown((d) => {
			for (const m of p?.models ?? []) d.addOption(m.id, m.label);
			if (this.choice.model && !p?.models.some((m) => m.id === this.choice.model)) d.addOption(this.choice.model, this.choice.model);
			d.setValue(this.choice.model ?? '').onChange((v) => {
				this.choice = { ...this.choice, model: v };
				this.update();
			});
		});
		const info = p?.models.find((m) => m.id === this.choice.model);
		const price = p?.metered && info?.input_price != null ? ` $${info.input_price} / $${info.output_price} per million tokens.` : '';
		if (info?.notes || price) setting.setDesc(`${info?.notes ?? ''}${price}`.trim());
	}

	private renderEffort(setting: Setting): void {
		setting.addDropdown((d) => {
			d.addOption('', 'The model\'s own').addOption('low', 'Low: faster').addOption('medium', 'Medium').addOption('high', 'High: best derivations');
			d.setValue(this.choice.effort ?? this.models?.effort ?? '').onChange((v) => { this.choice = { ...this.choice, effort: v }; });
		});
	}

	private renderBudget(setting: Setting): void {
		const m = this.models;
		if (!m) return;
		setting.setDesc(`Pay-per-use providers stop for the day past this. Spent today: $${m.budget.spent_usd.toFixed(2)}.`)
			.addText((t) => t.setValue(String(m.budget.daily_usd)).onChange((v) => {
				const n = Number(v);
				if (Number.isFinite(n) && n >= 0) this.choice = { ...this.choice, daily_budget_usd: n };
			}));
	}

	private renderTrust(setting: Setting): void {
		const t = this.models?.trust ?? {};
		if (!this.models?.current?.provider) {
			setting.setDesc('A model grades only after it passes the grader test, and plays the student only after the teaching test. Choose a model first.');
			return;
		}
		const line = (name: string, s: typeof t.grader) => !s ? `${name}: unknown` : s.counts ? `${name}: passed ${s.agreed ?? '?'} of ${s.total ?? '?'} (${s.date ?? ''})`
			: s.stale ? `${name}: passed on an older prompt, due again` : s.never ? `${name}: never run` : `${name}: not passed`;
		setting.setDesc(`A model grades only after it passes the grader test, and plays the student only after the teaching test. ${line('Grader', t.grader)}; ${line('Teaching', t.teach)}.`)
			.addButton((b) => b.setButtonText('Run the tests').onClick(() => this.plugin.openRoute('settings')));
	}

	private renderActions(setting: Setting): void {
		setting.setName('');
		const p = this.provider();
		if (p && (p.kind.endsWith('-cli') || p.tier === 'local')) {
			setting.addButton((b) => b.setButtonText('Check the tool').onClick(async () => {
				try {
					const r = await this.plugin.client().check(p.id);
					new Notice(`${p.label}: ${[r.version, r.ready ? 'ready' : (WHY[r.message] ?? r.message)].filter(Boolean).join(' · ')}`, 8000);
				} catch (e) {
					new Notice((e as Error).message, 8000);
				}
			}));
		}
		setting.addButton((b) => b.setButtonText('Save model').setCta().onClick(async () => {
			if (!this.plugin.client().pluginToken) {
				new Notice('This site was started outside Obsidian, so its settings page saves the model. Opening it.', 8000);
				this.plugin.openRoute('settings');
				return;
			}
			try {
				this.models = await this.plugin.client().saveModel(this.choice);
				new Notice(`The site now uses ${this.models.current?.label ?? this.choice.provider}.`);
				this.update();
			} catch (e) {
				new Notice((e as Error).message, 8000);
			}
		}));
	}
}
