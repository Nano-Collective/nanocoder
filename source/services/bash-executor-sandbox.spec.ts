import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {platform} from 'node:process';
import test, {type ExecutionContext} from 'ava';
import {getAppConfig} from '@/config/index';
import {BashExecutor} from './bash-executor.js';
import {findBwrap} from './bash-sandbox.js';
import {getSessionCwd, resetSessionCwd, setProjectRoot, setSessionCwd} from './session-cwd.js';

console.log('\nbash-executor-sandbox.spec.ts');

const executors: BashExecutor[] = [];

function createExecutor(): BashExecutor {
	const executor = new BashExecutor();
	executors.push(executor);
	return executor;
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

// An exited process can stay a zombie briefly until it is reaped.
async function isGoneWithin(pid: number, ms: number): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (isAlive(pid) && Date.now() < deadline) {
		await new Promise(resolve => setTimeout(resolve, 20));
	}
	return !isAlive(pid);
}

test.afterEach(() => {
	for (const executor of executors) {
		for (const id of executor.getActiveExecutionIds()) {
			executor.cancel(id);
		}
		executor.removeAllListeners();
	}
	executors.length = 0;
	resetSessionCwd();
});

test.serial('sandbox off keeps the unix spawn on sh', async t => {
	if (platform === 'win32') {
		t.pass();
		return;
	}
	const previous = getAppConfig().sandbox;
	getAppConfig().sandbox = false;
	try {
		const executor = createExecutor();
		const result = await executor.execute('echo unsandboxed').promise;
		t.is(result.exitCode, 0);
		t.true(result.fullOutput.includes('unsandboxed'));
		t.is(result.error, null);
	} finally {
		getAppConfig().sandbox = previous;
	}
});

test.serial('unsandboxed commands keep empty positional args', async t => {
	if (platform === 'win32') {
		t.pass();
		return;
	}
	const previous = getAppConfig().sandbox;
	getAppConfig().sandbox = false;
	try {
		const executor = createExecutor();
		const result = await executor.execute('echo count=$# one="${1-}"').promise;
		t.is(result.exitCode, 0);
		t.is(result.fullOutput.trim(), 'count=0 one=');
	} finally {
		getAppConfig().sandbox = previous;
	}
});

test.serial('sandbox on windows returns an error', async t => {
	if (platform !== 'win32') {
		t.pass();
		return;
	}
	const previous = getAppConfig().sandbox;
	getAppConfig().sandbox = true;
	try {
		const result = await createExecutor().execute('echo hi').promise;
		t.truthy(result.error);
		t.regex(result.error ?? '', /not supported on Windows/i);
	} finally {
		getAppConfig().sandbox = previous;
	}
});

test.serial('sandbox on linux without bwrap on PATH does not fall through', async t => {
	if (platform !== 'linux') {
		t.pass();
		return;
	}
	const previous = getAppConfig().sandbox;
	const prevPath = process.env.PATH;
	getAppConfig().sandbox = true;
	process.env.PATH = '';
	try {
		const result = await createExecutor().execute('echo hi').promise;
		t.truthy(result.error);
		t.regex(result.error ?? '', /bubblewrap/i);
		t.is(result.fullOutput, '');
	} finally {
		getAppConfig().sandbox = previous;
		if (prevPath === undefined) delete process.env.PATH;
		else process.env.PATH = prevPath;
	}
});

async function assertJail(t: ExecutionContext, label: string) {
	const previous = getAppConfig().sandbox;
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'nc-jail-')));
	const probe = join(homedir(), `.nanocoder-sandbox-probe-${Date.now()}`);
	getAppConfig().sandbox = true;
	setProjectRoot(base);
	setSessionCwd(base);
	try {
		const executor = createExecutor();
		const inside = await executor.execute('echo ok > inside.txt').promise;
		t.is(inside.exitCode, 0, `${label} inside: ${inside.stderr || inside.error || ''}`);
		t.is(readFileSync(join(base, 'inside.txt'), 'utf8').trim(), 'ok');

		const tmpWrite = await executor.execute(
			'echo tmpok > "$TMPDIR/probe" && cat "$TMPDIR/probe"',
		).promise;
		t.is(tmpWrite.exitCode, 0, `${label} tmp: ${tmpWrite.stderr || tmpWrite.error || ''}`);
		t.true(tmpWrite.fullOutput.includes('tmpok'));

		const mk = await executor.execute('mktemp').promise;
		t.is(mk.exitCode, 0, `${label} mktemp: ${mk.stderr || mk.error || ''}`);

		// Linux jails /tmp as tmpfs, so the host cannot see the file; cat it inside.
		const hard = await executor.execute(
			'echo hard > /tmp/nc-sbx-probe && cat /tmp/nc-sbx-probe',
		).promise;
		t.is(hard.exitCode, 0, `${label} /tmp: ${hard.stderr || hard.error || ''}`);
		t.true(hard.fullOutput.includes('hard'));

		const outside = await executor.execute(`echo no > '${probe}'`).promise;
		t.false(existsSync(probe), 'sandbox must not write into $HOME');
		t.true(
			outside.exitCode !== 0 || Boolean(outside.stderr) || Boolean(outside.error),
		);

		const nested = join(base, 'nested');
		mkdirSync(nested);
		await executor.execute('cd nested').promise;
		t.is(getSessionCwd(), nested);
	} finally {
		getAppConfig().sandbox = previous;
		try {
			if (existsSync(probe)) rmSync(probe);
		} catch {
			// best-effort cleanup
		}
		rmSync(base, {recursive: true, force: true});
	}
}

test.serial('sandbox on macOS writes inside the project and TMPDIR, blocks home', async t => {
	if (platform !== 'darwin') {
		t.pass();
		return;
	}
	await assertJail(t, 'darwin');
});

test.serial('sandbox on linux with bwrap writes inside the project and TMPDIR, blocks home', async t => {
	if (platform !== 'linux' || !findBwrap()) {
		t.pass();
		return;
	}
	await assertJail(t, 'linux');
});

test.serial(
	'cancel preserves sandbox jail directory until child process group exits and cleans up afterwards',
	async t => {
		if (platform === 'win32' || (platform === 'linux' && !findBwrap())) {
			t.pass();
			return;
		}

		const previousSandbox = getAppConfig().sandbox;
		const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), 'nc-test-jail-')));
		getAppConfig().sandbox = true;
		setProjectRoot(tmpDir);
		setSessionCwd(tmpDir);

		try {
			const executor = createExecutor();
			// Launch node in background (& wait) so the wrapper shell does not execve
			// directly into node. When SIGTERM is sent to the group, sh exits immediately
			// while the descendant traps SIGTERM, delays 300ms, and writes to $TMPDIR.
			const cmd =
				'node -e \'const fs = require("fs"); const path = require("path"); process.on("SIGTERM", () => { setTimeout(() => { try { fs.writeFileSync(path.join(process.env.TMPDIR || "/tmp", "sigterm.txt"), "done"); } catch {} process.exit(0); }, 300); }); console.log("READY:" + process.pid); setInterval(() => {}, 1000);\' & wait';
			const {executionId, promise} = executor.execute(cmd);

			let nodePid = 0;
			for (let tick = 0; tick < 30 && !nodePid; tick++) {
				await new Promise(resolve => setTimeout(resolve, 100));
				const state = executor.getState(executionId);
				nodePid = Number(state?.fullOutput.match(/READY:(\d+)/)?.[1] ?? 0);
			}
			t.truthy(nodePid, 'Should have captured the background node PID');

			const jailTmp = executor.getJailTmp(executionId);
			t.truthy(jailTmp, 'jailTmp must be defined when sandbox is enabled');

			const cancelled = executor.cancel(executionId);
			t.true(cancelled);

			t.true(
				existsSync(jailTmp!),
				'jailTmp must still exist while background descendant is handling SIGTERM',
			);

			let settled = false;
			void promise.then(() => {
				settled = true;
			});

			// The shell has exited on SIGTERM, but node is still in its 300ms delay.
			await new Promise(resolve => setTimeout(resolve, 150));
			t.false(settled, 'the cancel is not reported while a descendant still runs');
			t.true(
				existsSync(jailTmp!),
				'jailTmp must not be removed prematurely when wrapper shell exits before descendants',
			);

			// Reported once the background node process has written and exited.
			const result = await promise;
			t.true(result.isComplete);
			t.true(await isGoneWithin(nodePid, 500), 'the background node process must be gone');
			t.false(
				existsSync(jailTmp!),
				'jailTmp must be cleaned up after process group terminates',
			);
		} finally {
			getAppConfig().sandbox = previousSandbox;
			resetSessionCwd();
			try {
				rmSync(tmpDir, {recursive: true, force: true});
			} catch {
				// best-effort cleanup
			}
		}
	},
);

// #1833: on Linux, bwrap's --new-session puts the command in a process group
// of its own, which signalling bwrap's group never reached.
test.serial('stopAll stops a job a sandboxed command left behind', async t => {
	if (platform === 'win32' || (platform === 'linux' && !findBwrap())) {
		t.pass();
		return;
	}

	const previousSandbox = getAppConfig().sandbox;
	const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), 'nc-test-jail-')));
	getAppConfig().sandbox = true;
	setProjectRoot(tmpDir);
	setSessionCwd(tmpDir);
	let jobPid = 0;

	try {
		const executor = createExecutor();
		const finished = await executor.execute(
			"node -e 'process.on(\"SIGTERM\", () => {}); setInterval(() => {}, 1000)' > /dev/null 2>&1 & echo PID:$!",
		).promise;
		jobPid = Number(finished.fullOutput.match(/PID:(\d+)/)?.[1] ?? 0);
		t.is(finished.exitCode, 0);
		t.truthy(jobPid, 'Should have captured the background job PID');
		t.true(isAlive(jobPid), 'the job should still be running');

		await executor.stopAll();

		t.true(await isGoneWithin(jobPid, 500), 'the job must be gone once stopAll resolves');
	} finally {
		if (jobPid && isAlive(jobPid)) process.kill(jobPid, 'SIGKILL');
		getAppConfig().sandbox = previousSandbox;
		resetSessionCwd();
		try {
			rmSync(tmpDir, {recursive: true, force: true});
		} catch {
			// best-effort cleanup
		}
	}
});
