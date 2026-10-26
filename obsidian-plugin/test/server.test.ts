import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPython, findSite, joinPath, localPort, ServerManager, type ChildLike, type ServerDeps } from '../src/server.ts';
import { noSleep } from './helpers.ts';

const settings = { siteUrl: 'http://127.0.0.1:4190', siteDir: 'C:\\site', pythonPath: '', autoStart: true };

class FakeChild implements ChildLike {
	pid = 4242;
	exitCode: number | null = null;
	killed = false;
	private outs: ((c: unknown) => void)[] = [];
	private exits: ((code: number | null) => void)[] = [];
	stdout = { on: (_e: 'data', cb: (c: unknown) => void) => this.outs.push(cb) };
	stderr = { on: (_e: 'data', cb: (c: unknown) => void) => this.outs.push(cb) };
	on(_e: 'exit', cb: (code: number | null) => void) { return this.exits.push(cb); }
	kill() { this.killed = true; return true; }
	say(text: string) { for (const cb of this.outs) cb(text); }
	exit(code: number) { this.exitCode = code; for (const cb of this.exits) cb(code); }
}

function deps(over: Partial<ServerDeps> & { up?: () => boolean } = {}) {
	const spawned: { cmd: string; args: string[]; cwd: string; env: Record<string, string | undefined> }[] = [];
	const child = new FakeChild();
	const killed: number[] = [];
	const d: ServerDeps = {
		spawn: (cmd, args, opts) => { spawned.push({ cmd, args, ...opts }); return child; },
		run: () => ({ status: 0, stdout: '', stderr: '' }),
		health: async () => (over.up ? over.up() : spawned.length > 0),
		exists: (p) => p === joinPath('win32', 'C:\\site', 'server.py'),
		platform: 'win32',
		env: { PATH: 'C:\\bin', ANTHROPIC_API_KEY: '' },
		vaultPath: 'G:\\Vault',
		keys: () => ({ OPENAI_API_KEY: 'sk-test' }),
		token: () => 'tok-123',
		parentPid: 99,
		killTree: (pid) => killed.push(pid),
		sleep: noSleep,
		...over,
	};
	return { d, spawned, child, killed };
}

test('a running site is used as it is, and never stopped', async () => {
	const { d, spawned, killed } = deps({ up: () => true });
	const m = new ServerManager(d);
	assert.equal(await m.ensure(settings), 'running');
	assert.equal(spawned.length, 0);
	assert.equal(m.pluginToken, '');
	m.stop();
	assert.deepEqual(killed, []);
});

test('a started site gets the keys, the plugin secret and the parent pid in its environment, nowhere else', async () => {
	const { d, spawned, killed } = deps();
	const m = new ServerManager(d);
	assert.equal(await m.ensure(settings), 'started');
	const s = spawned[0]!;
	assert.equal(s.cmd, 'python');
	assert.deepEqual(s.args, ['server.py', '--port', '4190', '--vault', 'G:\\Vault']);
	assert.equal(s.cwd, 'C:\\site');
	assert.equal(s.env.OPENAI_API_KEY, 'sk-test');
	assert.equal(s.env.LOS_PLUGIN_TOKEN, 'tok-123');
	assert.equal(s.env.LOS_PARENT_PID, '99');
	assert.equal(s.env.PYTHONUTF8, '1');
	assert.equal(s.env.PATH, 'C:\\bin');
	assert.equal(m.pluginToken, 'tok-123');
	assert.equal(m.tokenFor('http://127.0.0.1:4190/'), 'tok-123');
	assert.equal(m.tokenFor('http://127.0.0.1:4191'), '', 'the secret never goes to another site');
	assert.ok(m.ownsProcess);
	assert.ok(!s.args.join(' ').includes('sk-test'));
	m.stop();
	assert.deepEqual(killed, [4242]);
	assert.equal(m.pluginToken, '');
	assert.equal(m.tokenFor('http://127.0.0.1:4190'), '');
});

test('what stops a start is said in words', async () => {
	await assert.rejects(new ServerManager(deps({ up: () => false }).d).ensure({ ...settings, autoStart: false }), /not running at/);
	await assert.rejects(new ServerManager(deps({ up: () => false }).d).ensure({ ...settings, siteUrl: 'https://kos.example.com' }), /this machine/);
	await assert.rejects(new ServerManager(deps({ up: () => false, exists: () => false }).d).ensure(settings), /Site folder/);
	const noPkgs = deps({ up: () => false, run: () => ({ status: 1, stdout: '', stderr: 'ModuleNotFoundError: No module named \'yaml\'' }) });
	await assert.rejects(new ServerManager(noPkgs.d).ensure(settings), /pip install markdown pyyaml/);
	const noPython = deps({ up: () => false, run: () => { throw new Error('ENOENT'); } });
	await assert.rejects(new ServerManager(noPython.d).ensure(settings), /Python was not found/);
});

test('a site that dies while starting reports its last lines', async () => {
	const t = deps({ up: () => false });
	t.d.sleep = async () => {
		if (t.child.exitCode === null) {
			t.child.say('Traceback (most recent call last):\nOSError: [Errno 10048] address already in use\n');
			t.child.exit(1);
		}
	};
	const m = new ServerManager(t.d);
	await assert.rejects(m.ensure(settings), /stopped while starting[\s\S]*address already in use/);
	assert.ok(!m.ownsProcess);
	assert.ok(m.log.some((l) => l.includes('the site stopped (1)')));
});

test('a site that never answers times out', async () => {
	const t = deps({ up: () => false });
	await assert.rejects(new ServerManager(t.d).ensure(settings, 0), /did not start in time/);
});

test('the site folder, the port and Python are found', () => {
	assert.equal(localPort('http://127.0.0.1:4190'), 4190);
	assert.equal(localPort('http://localhost'), 80);
	assert.equal(localPort('http://192.168.1.4:4190'), null);
	assert.equal(localPort('not a url'), null);
	const exists = (p: string) => p === '/v/x/apps/knowledge-os/server.py';
	assert.equal(findSite({ ...settings, siteDir: '' }, '/v', 'linux', exists), '/v/x/apps/knowledge-os');
	assert.equal(findSite({ ...settings, siteDir: '/elsewhere' }, '/v', 'linux', exists), '/v/x/apps/knowledge-os');
	assert.equal(findSite({ ...settings, siteDir: '' }, '', 'linux', exists), null);
	assert.equal(joinPath('win32', 'C:\\a\\', 'b', 'c.py'), 'C:\\a\\b\\c.py');
	assert.equal(findPython({ ...settings, pythonPath: '' }, 'darwin'), 'python3');
	assert.equal(findPython({ ...settings, pythonPath: ' /opt/py ' }, 'win32'), '/opt/py');
});
