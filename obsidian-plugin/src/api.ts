/* A client for the Knowledge OS server. The transport is injected, so it runs in Node tests too. */

export interface HttpRequest {
	url: string;
	method?: string;
	body?: string;
	contentType?: string;
	headers?: Record<string, string>;
}

export interface HttpResponse {
	status: number;
	text: string;
}

export type Http = (req: HttpRequest) => Promise<HttpResponse>;

export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export interface ModelInfo {
	id: string;
	label: string;
	notes: string;
	input_price: number | null;
	output_price: number | null;
}

export interface ProviderInfo {
	id: string;
	label: string;
	kind: string;
	tier: string;
	metered: boolean;
	ready: boolean;
	why_code: string;
	setup_hint: string;
	notes: string;
	key_env: string;
	models: ModelInfo[];
}

export interface CurrentModel {
	provider: string;
	model: string;
	label: string;
	tier: string;
	available: boolean;
	why_code: string;
}

export interface TrustStatus {
	counts?: boolean;
	passed?: boolean;
	stale?: boolean;
	never?: boolean;
	agreed?: number;
	total?: number;
	date?: string;
}

export interface Models {
	providers: ProviderInfo[];
	current: CurrentModel | null;
	grader: string;
	effort: string;
	budget: { daily_usd: number; spent_usd: number };
	trust: { grader?: TrustStatus; teach?: TrustStatus };
	plugin: boolean;
}

export interface ModelChoice {
	provider?: string;
	model?: string;
	effort?: string;
	daily_budget_usd?: number;
	grader?: string;
}

export class KnowledgeClient {
	readonly base: string;
	private http: Http;
	pluginToken: string;

	constructor(baseUrl: string, http: Http, pluginToken = '') {
		this.base = baseUrl.replace(/\/+$/, '');
		this.http = http;
		this.pluginToken = pluginToken;
	}

	get origin(): string {
		return new URL(this.base).origin;
	}

	private async call<T>(path: string, init: Omit<HttpRequest, 'url'> = {}): Promise<T> {
		let res: HttpResponse;
		try {
			res = await this.http({ url: this.base + path, ...init });
		} catch (e) {
			throw new ApiError(0, `The Knowledge OS is not answering at ${this.base}: ${(e as Error).message}`);
		}
		let body: unknown = null;
		try {
			body = JSON.parse(res.text);
		} catch {
			body = null;
		}
		if (res.status >= 400) {
			const msg = body && typeof body === 'object' && 'error' in body ? String(body.error) : `HTTP ${res.status}`;
			throw new ApiError(res.status, msg);
		}
		return body as T;
	}

	async health(): Promise<boolean> {
		try {
			const r = await this.http({ url: this.base + '/api/health' });
			return r.status === 200;
		} catch {
			return false;
		}
	}

	today = () => this.call<Record<string, unknown>>('/api/today');
	models = () => this.call<Models>('/api/models');
	check = (provider: string) => this.call<{ ready: boolean; version: string | null; message: string }>(
		`/api/models/check?provider=${encodeURIComponent(provider)}`);

	/** A write: allowed only with the secret of a server this plugin started (LOS_PLUGIN_TOKEN). */
	saveModel(choice: ModelChoice): Promise<Models> {
		if (!this.pluginToken) throw new ApiError(403, 'This site was not started by the plugin: change the model on its Settings page.');
		return this.call<Models>('/api/models/save', {
			method: 'POST', body: JSON.stringify(choice), contentType: 'application/json',
			headers: { 'X-LOS-Plugin': this.pluginToken },
		});
	}
}

/** The site's page for a route, framed for an Obsidian tab or plain for the browser. */
export function pageUrl(base: string, route: string, embed: boolean): string {
	const r = route.replace(/^#?\/?/, '');
	return `${base.replace(/\/+$/, '')}/${embed ? '?embed=1' : ''}#/${r}`;
}

/** Routes for the commands that act on the open note. */
export const routes = {
	today: () => 'today',
	study: () => 'study',
	settings: () => 'settings',
	check: (name: string) => `check?concept=${encodeURIComponent(name)}`,
	teach: (name: string) => `teach/${encodeURIComponent(name)}`,
	explore: (name: string) => `note/${encodeURIComponent(name)}`,
	place: (name: string) => `place/${encodeURIComponent(name)}`,
	concept: (name: string) => `concept/${encodeURIComponent(name)}`,
};

/**
 * A message from the framed site asking Obsidian to open a note: honoured only when it comes from this site's own frame,
 * from the site's origin, and names a note in a plain string.
 */
export function noteToOpen(ev: { origin: string; source: unknown; data: unknown }, frame: unknown, siteOrigin: string): string | null {
	if (!frame || ev.source !== frame || ev.origin !== siteOrigin) return null;
	const d = ev.data as { type?: unknown; name?: unknown } | null;
	if (!d || d.type !== 'knowledge-os:open-note' || typeof d.name !== 'string') return null;
	const name = d.name.trim();
	return name && name.length <= 300 && !/[\r\n]/.test(name) ? name : null;
}
