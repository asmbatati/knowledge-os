/*
 * Starts the Knowledge OS when it is not running, and stops it when the plugin unloads, but only if the plugin started
 * it: a site started at logon or from a servers panel is used as it is and left alone. A started site gets three things
 * in its environment, none of them written anywhere: LOS_PARENT_PID (it exits by itself once Obsidian is gone),
 * LOS_PLUGIN_TOKEN (a fresh secret that lets this plugin save the model choice) and the API keys from Obsidian's keychain.
 * Process spawning is injected so this runs in Node tests.
 */

export interface ChildLike {
	pid?: number;
	exitCode: number | null;
	stdout?: { on(event: 'data', cb: (chunk: unknown) => void): unknown } | null;
	stderr?: { on(event: 'data', cb: (chunk: unknown) => void): unknown } | null;
	on(event: 'exit', cb: (code: number | null) => void): unknown;
	kill(): boolean;
}

export type SpawnFn = (cmd: string, args: string[], opts: { cwd: string; env: Record<string, string | undefined> }) => ChildLike;
export type RunFn = (cmd: string, args: string[], cwd: string) => { status: number | null; stdout: string; stderr: string };

export interface ServerSettings {
	siteUrl: string;
	siteDir: string;
	pythonPath: string;
	autoStart: boolean;
}

export interface ServerDeps {
	spawn: SpawnFn;
	run: RunFn;
	health: () => Promise<boolean>;
	exists: (path: string) => boolean;
	platform: string;
	env: Record<string, string | undefined>;
	vaultPath: string;
	keys: () => Record<string, string>;
	token: () => string;
	parentPid?: number;
	killTree?: (pid: number) => void;
	sleep?: (ms: number) => Promise<void>;
	/** More arguments for server.py (the tests start a demo site). */
	extraArgs?: string[];
}

export function localPort(url: string): number | null {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return null;
	}
	if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return null;
	return u.port ? Number(u.port) : 80;
}

/** Two addresses of the same site: the same origin. */
export function sameSite(a: string, b: string): boolean {
	try {
		return new URL(a).origin === new URL(b).origin;
	} catch {
		return false;
	}
}

export function joinPath(platform: string, ...parts: string[]): string {
	const sep = platform === 'win32' ? '\\' : '/';
	return parts.filter(Boolean).map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, ''))).join(sep);
}

/** The site's folder: the setting, else the copy an edition carries in the vault (x/apps/knowledge-os). */
export function findSite(s: ServerSettings, vaultPath: string, platform: string, exists: (p: string) => boolean): string | null {
	const candidates = [s.siteDir.trim(), vaultPath ? joinPath(platform, vaultPath, 'x', 'apps', 'knowledge-os') : ''];
	return candidates.find((d) => d && exists(joinPath(platform, d, 'server.py'))) ?? null;
}

export function findPython(s: ServerSettings, platform: string): string {
	return s.pythonPath.trim() || (platform === 'win32' ? 'python' : 'python3');
}

export class ServerManager {
	readonly log: string[] = [];
	private child: ChildLike | null = null;
	private secret = '';
	private served = '';
	private deps: ServerDeps;

	constructor(deps: ServerDeps) {
		this.deps = deps;
	}

	get ownsProcess(): boolean {
		return this.child !== null && this.child.exitCode === null;
	}

	/** The secret of the site this plugin started, or '' when it started none. */
	get pluginToken(): string {
		return this.ownsProcess ? this.secret : '';
	}

	/** The secret, only for the address the site was started on: never sent to another site. */
	tokenFor(url: string): string {
		return this.ownsProcess && sameSite(url, this.served) ? this.secret : '';
	}

	private push(text: string): void {
		for (const l of text.split(/\r?\n/)) if (l.trim()) this.log.push(l);
		if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
	}

	/** Make sure the site answers; start it if allowed. Resolves to what happened. */
	async ensure(s: ServerSettings, timeoutMs = 120_000): Promise<'running' | 'started'> {
		if (await this.deps.health()) return 'running';
		if (!s.autoStart) throw new Error(`The Knowledge OS is not running at ${s.siteUrl}. Start it, or turn on "Start the site automatically".`);
		const port = localPort(s.siteUrl);
		if (port === null) throw new Error(`Only a site on this machine can be started by the plugin; ${s.siteUrl} is not.`);
		const site = findSite(s, this.deps.vaultPath, this.deps.platform, this.deps.exists);
		if (!site) throw new Error('Set "Site folder" in the plugin settings to the folder of the Knowledge OS (the one that holds server.py).');
		if (!this.ownsProcess) this.start(s, site, port);
		const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => window.setTimeout(r, ms)));
		const t0 = Date.now();
		while (Date.now() - t0 < timeoutMs) {
			await sleep(700);
			if (await this.deps.health()) return 'started';
			if (this.child && this.child.exitCode !== null) {
				const tail = this.log.slice(-8).join('\n');
				this.child = null;
				throw new Error(`The Knowledge OS stopped while starting.${tail ? '\n' + tail : ''}`);
			}
		}
		throw new Error('The Knowledge OS did not start in time. See its log in the plugin settings.');
	}

	/** Can Python run the site? Its two packages beyond the standard library are Markdown and PyYAML. */
	pythonProblem(s: ServerSettings, site: string): string | null {
		const python = findPython(s, this.deps.platform);
		try {
			const r = this.deps.run(python, ['-c', 'import markdown, yaml'], site);
			if (r.status === 0) return null;
			return `Python cannot run the site: ${(r.stderr || r.stdout).trim().split('\n').pop() ?? ''}\nInstall what it needs: ${python} -m pip install markdown pyyaml`;
		} catch (e) {
			return `Python was not found (${python}): ${(e as Error).message}. Install Python 3.11 or later, or set "Python" in the plugin settings.`;
		}
	}

	private start(s: ServerSettings, site: string, port: number): void {
		const problem = this.pythonProblem(s, site);
		if (problem) throw new Error(problem);
		const python = findPython(s, this.deps.platform);
		const args = ['server.py', '--port', String(port)];
		if (this.deps.vaultPath) args.push('--vault', this.deps.vaultPath);
		args.push(...(this.deps.extraArgs ?? []));
		this.secret = this.deps.token();
		this.served = s.siteUrl;
		this.push(`$ ${python} ${args.join(' ')}`);
		const child = this.deps.spawn(python, args, {
			cwd: site,
			env: {
				...this.deps.env, ...this.deps.keys(), PYTHONUTF8: '1', PYTHONUNBUFFERED: '1',
				LOS_PLUGIN_TOKEN: this.secret,
				...(this.deps.parentPid ? { LOS_PARENT_PID: String(this.deps.parentPid) } : {}),
			},
		});
		child.stdout?.on('data', (c) => this.push(String(c)));
		child.stderr?.on('data', (c) => this.push(String(c)));
		child.on('exit', (code) => this.push(`the site stopped (${code ?? 'signal'})`));
		this.child = child;
	}

	/** Stop the site if this plugin started it. */
	stop(): void {
		const child = this.child;
		this.child = null;
		this.secret = '';
		this.served = '';
		if (!child || child.exitCode !== null) return;
		if (child.pid && this.deps.killTree) this.deps.killTree(child.pid);
		else child.kill();
	}
}
