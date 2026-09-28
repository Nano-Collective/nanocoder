import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {parseVerificationCommand, type ParsedCommand} from './command-parser.js';
import {resolveWindowsExecutable, runVerificationCommand} from './runner.js';

// node itself is the fixture runner. Real processes, real exit codes, real
// pipes — mocking child_process would prove nothing about timeouts, tree-kill,
// or the byte cap, which are the three things most likely to be wrong.
//
// Fixtures are script files rather than `node -e <source>`. That is closer to
// how a verification command is actually written (`node ./scripts/check.js`),
// and it keeps the *command* free of characters the metacharacter screen
// rejects — a `-e` payload full of parentheses tests the fixture, not the
// runner.
//
// It does *not* cover the `cmd.exe` quoting, despite appearances: every fixture
// here is `node.exe`, which resolves through the native-executable branch and is
// spawned with `shell: false`, so `cmd.exe` never sees the argv. The shell path
// is covered by the dedicated `.cmd` shim tests below.

let workdir: string;

/** Write a node script into the fixture workdir and return it. */
function script(name: string, source: string): string {
	const file = join(workdir, name);
	writeFileSync(file, source, 'utf8');
	return file;
}

/** `node <file>`, parsed through the public entry point. */
function node(file: string): ParsedCommand {
	const parsed = parseVerificationCommand([process.execPath, file]);
	if (!parsed.ok) throw new Error(`fixture command rejected: ${parsed.error}`);
	return parsed.value;
}

function run(
	command: ParsedCommand,
	overrides: Partial<Parameters<typeof runVerificationCommand>[0]> = {},
) {
	return runVerificationCommand({
		command,
		cwd: workdir,
		timeoutMs: 10_000,
		maxOutputBytes: 64_000,
		...overrides,
	});
}

test.before(() => {
	workdir = mkdtempSync(join(tmpdir(), 'nc-verify-runner-'));
});
test.after.always(() => {
	// A reaped tree can still be releasing its handles, so a single rmdir
	// attempt is not enough. Retries are the fix; swallowing the error would
	// hide a leak this file is specifically testing for.
	rmSync(workdir, {
		recursive: true,
		force: true,
		maxRetries: 20,
		retryDelay: 100,
	});
});

// ============================================================================
// Windows executable resolution
// ============================================================================

/** A fake filesystem, so the PATHEXT search is testable from any OS. */
function fakeFiles(...existing: string[]) {
	const set = new Set(existing.map(p => p.toLowerCase()));
	return (candidate: string) => set.has(candidate.toLowerCase());
}

/**
 * Windows matches paths case-insensitively, and real PATHEXT entries are
 * uppercase, so the returned path can differ in case from a lowercase
 * expectation without anything being wrong. Compare the way Windows does.
 */
function normalise(path: string | null): string | null {
	return path?.toLowerCase() ?? null;
}

test('resolveWindowsExecutable: a native .exe needs no shell', t => {
	const lookup = resolveWindowsExecutable(
		'node',
		{PATH: 'C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD'},
		fakeFiles('C:\\tools\\node.exe'),
	);
	t.is(normalise(lookup.path), 'c:\\tools\\node.exe');
	t.false(lookup.needsShell);
});

test('resolveWindowsExecutable: a .cmd shim needs a shell', t => {
	const lookup = resolveWindowsExecutable(
		'npm',
		{PATH: 'C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD'},
		fakeFiles('C:\\tools\\npm.cmd'),
	);
	t.is(normalise(lookup.path), 'c:\\tools\\npm.cmd');
	t.true(lookup.needsShell, 'a .cmd shim cannot be spawned directly');
});

test('resolveWindowsExecutable: honours PATHEXT order', t => {
	// Only .CMD is offered, and only that file exists, so the search has to
	// walk PATHEXT rather than assume .EXE.
	const lookup = resolveWindowsExecutable(
		'git',
		{PATH: 'C:\\tools', PATHEXT: '.CMD'},
		fakeFiles('C:\\tools\\git.cmd'),
	);
	t.is(normalise(lookup.path), 'c:\\tools\\git.cmd');
});

test('resolveWindowsExecutable: an already-extended name is not probed twice', t => {
	// `npm.cmd` must not also be looked for as `npm.cmd.cmd`.
	const lookup = resolveWindowsExecutable(
		'npm.cmd',
		{PATH: 'C:\\tools', PATHEXT: '.CMD'},
		fakeFiles('C:\\tools\\npm.cmd'),
	);
	t.is(normalise(lookup.path), 'c:\\tools\\npm.cmd');
});

test('resolveWindowsExecutable: a missing command resolves to null', t => {
	// The whole point: a typo must be caught here rather than surfacing as a
	// localised cmd.exe message that looks like a failing test suite.
	const lookup = resolveWindowsExecutable(
		'nc-not-a-real-binary-42',
		{PATH: 'C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD'},
		fakeFiles('C:\\tools\\node.exe'),
	);
	t.is(lookup.path, null);
});

test('resolveWindowsExecutable: an explicit path bypasses the PATH search', t => {
	const relative = resolveWindowsExecutable(
		'.\\gradlew.bat',
		{PATH: 'C:\\elsewhere', PATHEXT: '.BAT'},
		fakeFiles('C:\\repo\\gradlew.bat'),
	);
	t.is(relative.path, null, 'a relative path is not searched for');

	const absolute = resolveWindowsExecutable(
		'C:\\repo\\gradlew.bat',
		{PATH: 'C:\\elsewhere', PATHEXT: '.BAT'},
		fakeFiles('C:\\repo\\gradlew.bat'),
	);
	t.is(normalise(absolute.path), 'c:\\repo\\gradlew.bat');
	t.true(absolute.needsShell);
});

test('resolveWindowsExecutable: falls back to the Windows default PATHEXT', t => {
	const lookup = resolveWindowsExecutable(
		'cargo',
		{PATH: 'C:\\tools'},
		fakeFiles('C:\\tools\\cargo.exe'),
	);
	t.is(normalise(lookup.path), 'c:\\tools\\cargo.exe');
});

// ============================================================================
// The Windows launch decision
//
// Exercised through `runVerificationCommand` with an injected `platform`
// rather than by exporting the planner: the behaviour under test is the refusal
// to launch, and the refusal is the observable result.
// ============================================================================

test('an argv carrying shell intent is refused when the platform needs cmd.exe', async t => {
	// Built through the array form to bypass the parse-time screen. The array
	// form is the recommended one and POSIX needs no screen, so the last check
	// before the bytes reach a shell has to live here.
	//
	// The command is an explicitly-pathed `.cmd` fixture rather than `npm`:
	// `resolveWindowsExecutable` resolves against the real PATH, so `npm`
	// becomes a `.cmd` shim on Windows but resolves to nothing on Linux, and
	// the test would pass or fail by host.
	const shim = script('refuse.cmd', '@echo off\r\n');
	const parsed = parseVerificationCommand([shim, 'test', '&&', 'del']);
	t.true(parsed.ok, 'the array form is not screened at parse time');
	if (!parsed.ok) return;

	const result = await run(parsed.value, {platform: 'win32'});
	t.is(result.status, 'unavailable');
	t.regex(result.spawnError!, /cmd\.exe/);
});

test('the same argv is fine where no shell is involved', async t => {
	const parsed = parseVerificationCommand(['npm', 'test', '&&', 'del']);
	if (!parsed.ok) return;
	const planResult = await runVerificationCommand({
		command: parsed.value,
		cwd: workdir,
		timeoutMs: 1_000,
		maxOutputBytes: 4_000,
		platform: 'linux',
	});
	// `npm` is not resolvable in the fixture environment, so this asserts the
	// *metacharacter* was not the reason - the process was launched and the
	// shell never saw the `&&`.
	t.notRegex(planResult.spawnError ?? '', /cmd\.exe/);
});

// ============================================================================
// Exit statuses
// ============================================================================

test('runVerificationCommand: a clean exit is passed', async t => {
	const result = await run(node(script('pass.js', 'process.exitCode = 0;')));
	t.is(result.status, 'passed');
	t.is(result.exitCode, 0);
	t.is(result.signal, null);
});

test('runVerificationCommand: a non-zero exit is failed, not thrown', async t => {
	const result = await run(node(script('fail.js', 'process.exitCode = 3;')));
	t.is(result.status, 'failed');
	t.is(result.exitCode, 3);
});

test('runVerificationCommand: a missing binary is unavailable, not retried', async t => {
	const parsed = parseVerificationCommand('nc-definitely-not-a-real-binary-42');
	t.true(parsed.ok);
	if (!parsed.ok) return;
	const result = await run(parsed.value);
	t.is(result.status, 'unavailable');
	t.truthy(result.spawnError, 'the reason is the only clue for a typo');
});

// Regression: a file that exists and is named like an executable but is not
// loadable makes `spawn` throw *synchronously* (on Windows the bad-format
// errno is outside libuv's async allowlist). Unhandled it rejects the promise,
// and the rejection reaches `unhandledRejection` -> gracefulShutdown(1), so a
// bad verification command in the config killed the whole session.
test('runVerificationCommand: a present-but-unloadable binary resolves as unavailable', async t => {
	const bogus = join(workdir, 'not-really.exe');
	writeFileSync(bogus, 'this is a text file, not a PE image\n', 'utf8');

	const result = await run({
		command: bogus,
		args: [],
		display: 'not-really.exe',
	});

	t.is(result.status, 'unavailable');
	t.truthy(result.spawnError, 'the reason is the only clue');
});

// Regression: over-quoting argv. `cmd.exe` hands the inner quote pair to the
// shim as real characters, so a shim written the ordinary way
// (`if "%1"=="--watch"`) compared against `"--watch"`, took the other branch,
// and the configured command silently did something else.
test('runVerificationCommand: a .cmd shim receives its arguments unquoted', async t => {
	if (process.platform !== 'win32') {
		t.pass('cmd.exe is Windows-only');
		return;
	}
	const out = join(workdir, 'arg1.txt');
	const shim = join(workdir, 'shim.cmd');
	writeFileSync(
		shim,
		`@echo off\r\necho [%1] > "${out}"\r\n`,
		'utf8',
	);

	const result = await run({
		command: shim,
		args: ['--watch'],
		display: 'shim.cmd --watch',
	});

	t.is(result.status, 'passed');
	t.is(readFileSync(out, 'utf8').trim(), '[--watch]');
});

// Regression: under-quoting argv. With `shell: true` the `cmd.exe /s` flag
// strips the first and last quote of the string after `/c`, and Node's own
// per-argument quoting sits inside that range — so a program path containing a
// space was left unbalanced and the command never ran at all.
test('runVerificationCommand: a .cmd shim in a path with a space still runs', async t => {
	if (process.platform !== 'win32') {
		t.pass('cmd.exe is Windows-only');
		return;
	}
	const nested = join(workdir, 'dir with space');
	mkdirSync(nested, {recursive: true});
	const out = join(nested, 'sp.txt');
	const shim = join(nested, 'spacey.cmd');
	writeFileSync(
		shim,
		`@echo off\r\necho [%~nx0] [%1] > "${out}"\r\n`,
		'utf8',
	);

	const result = await run({
		command: shim,
		args: ['--out my file.txt'],
		display: 'spacey.cmd --out my file.txt',
	});

	t.is(result.status, 'passed');
	// A single argument containing a space is conventionally quoted, exactly as
	// it would be in a console; the point is that it arrives as one argument.
	t.is(readFileSync(out, 'utf8').trim(), '[spacey.cmd] ["--out my file.txt"]');
});

test('runVerificationCommand: runs in the requested cwd', async t => {
	// A verification command that runs in the wrong directory reports failures
	// for the wrong reasons, so cwd is part of the contract.
	const nested = join(workdir, 'nested-project');
	mkdirSync(nested, {recursive: true});
	const marker = join(nested, 'marker.txt');
	writeFileSync(marker, 'here', 'utf8');

	const result = await run(
		node(
			script(
				'cwd.js',
				// A command that only succeeds from the directory holding the
				// file, so a wrong cwd shows up as a failure rather than a
				// coincidental pass.
				"process.exitCode = require('fs').existsSync('marker.txt') ? 0 : 9;",
			),
		),
		{cwd: nested},
	);
	t.is(result.status, 'passed', result.output);
});

test('runVerificationCommand: a wrong cwd surfaces as a real failure', async t => {
	// The guard on the test above: same command, parent directory, must fail.
	const result = await run(
		node(
			script(
				'cwd-probe.js',
				"process.exitCode = require('fs').existsSync('marker.txt') ? 0 : 9;",
			),
		),
	);
	t.is(result.status, 'failed');
	t.is(result.exitCode, 9);
});

// ============================================================================
// Output capture
// ============================================================================

test('runVerificationCommand: merges stdout and stderr', async t => {
	const result = await run(
		node(
			script(
				'both-streams.js',
				'process.stdout.write("from stdout");\n' +
					'process.stderr.write("from stderr");',
			),
		),
	);
	t.regex(result.output, /from stdout/);
	t.regex(result.output, /from stderr/);
});

test('runVerificationCommand: strips ANSI', async t => {
	const result = await run(
		node(
			script(
				'ansi.js',
				// Literal escape byte, not a \u escape in a JS string literal —
				// matches what a test runner actually writes to a pipe.
				'process.stdout.write("\\u001b[31mFAIL\\u001b[0m a.test.ts");',
			),
		),
	);
	t.false(result.output.includes(''), 'no raw escape bytes');
	t.regex(result.output, /FAIL a\.test\.ts/);
});

test('runVerificationCommand: caps output at the configured byte budget', async t => {
	const result = await run(
		node(script('noisy.js', 'process.stdout.write("x".repeat(500_000));')),
		{maxOutputBytes: 2_000},
	);
	t.true(result.truncated);
	t.true(
		Buffer.byteLength(result.output) <= 2_000,
		`got ${Buffer.byteLength(result.output)} bytes`,
	);
});

test('runVerificationCommand: does not buffer unbounded output', async t => {
	// The cap is enforced while streaming, not after concatenation, so a
	// runaway suite cannot exhaust memory before the cut is applied. This only
	// proves the observable half of that, but it is the half that regresses.
	const result = await run(
		node(
			script(
				'very-noisy.js',
				'for (let i = 0; i < 20_000; i++) process.stdout.write("y".repeat(1000));',
			),
		),
		{maxOutputBytes: 1_000},
	);
	t.true(result.truncated);
	t.true(Buffer.byteLength(result.output) <= 1_000);
});

test('runVerificationCommand: preserves output produced before a timeout', async t => {
	// The failure this guards: reporting "timed out" with an empty body throws
	// away the only information the model has to work with.
	const result = await run(
		node(
			script(
				'talk-then-hang.js',
				'process.stdout.write("partial progress before the hang");\n' +
					'setTimeout(() => {}, 60_000);',
			),
		),
		{timeoutMs: 500},
	);
	t.is(result.status, 'timeout');
	t.regex(result.output, /partial progress before the hang/);
});

// ============================================================================
// Timeout
// ============================================================================

test('runVerificationCommand: a hanging command times out', async t => {
	const result = await run(
		node(script('hang.js', 'setTimeout(() => {}, 60_000);')),
		{timeoutMs: 400},
	);
	t.is(result.status, 'timeout');
	t.true(result.durationMs < 10_000, 'must settle near the timeout, not hang');
});

test('runVerificationCommand: a timeout of 0 disables the limit', async t => {
	const result = await run(
		node(script('quick.js', 'process.exitCode = 0;')),
		{timeoutMs: 0},
	);
	t.is(result.status, 'passed');
});

// ============================================================================
// Abort
// ============================================================================

test('runVerificationCommand: an already-aborted signal never spawns', async t => {
	const controller = new AbortController();
	controller.abort();
	const marker = join(workdir, 'aborted-marker.txt');
	const result = await run(
		node(
			script(
				'write-marker.js',
				`require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');`,
			),
		),
		{signal: controller.signal},
	);
	t.is(result.status, 'aborted');
	await new Promise(resolve => setTimeout(resolve, 300));
	t.false(existsSync(marker), 'nothing may run once aborted');
});

test('runVerificationCommand: aborting mid-run settles as aborted', async t => {
	const controller = new AbortController();
	const promise = run(
		node(script('hang-2.js', 'setTimeout(() => {}, 60_000);')),
		{signal: controller.signal, timeoutMs: 30_000},
	);
	setTimeout(() => controller.abort(), 150);
	const result = await promise;
	t.is(result.status, 'aborted');
});

// ============================================================================
// Tree kill
// ============================================================================

test.serial(
	'runVerificationCommand: a timeout reaps the whole process tree',
	async t => {
		// The failure this guards: killing only the direct child leaves the
		// test-runner workers alive, still writing into the repo. POSIX reaping
		// is asserted directly; Windows has no group signal, so only the
		// settle is portable (mirrors custom-tools/handler.spec.ts).
		const canary = join(workdir, 'tree-canary.txt');
		rmSync(canary, {force: true});

		// Parent spawns a grandchild that writes the canary well after the
		// parent would have been killed on its own.
		const grandchild = script(
			'grandchild.js',
			"setTimeout(() => require('fs').writeFileSync(" +
				`${JSON.stringify(canary)}, 'leaked'), 1_500);`,
		);
		const pidFile = join(workdir, 'grandchild.pid');
		const parent = script(
			'parent.js',
			'const {spawn} = require("child_process");\n' +
				`const child = spawn(process.execPath, [${JSON.stringify(grandchild)}], {stdio: 'ignore'});\n` +
				`require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));\n` +
				'setTimeout(() => {}, 60_000);',
		);

		const result = await run(node(parent), {timeoutMs: 500});
		t.is(result.status, 'timeout');

		let grandchildPid: number | undefined;
		for (let i = 0; i < 40 && grandchildPid === undefined; i++) {
			if (existsSync(pidFile)) {
				const match = readFileSync(pidFile, 'utf8').match(/\d+/);
				if (match) grandchildPid = Number(match[0]);
			}
			if (grandchildPid === undefined) {
				await new Promise(resolve => setTimeout(resolve, 25));
			}
		}
		t.truthy(grandchildPid, 'the grandchild must have reported its pid');

		// Long enough for the canary write to have happened if it were going to.
		await new Promise(resolve => setTimeout(resolve, 2_000));
		t.false(
			existsSync(canary),
			'a reaped tree must not keep running and writing to disk',
		);

		if (process.platform === 'win32') return;
		t.throws(
			() => process.kill(grandchildPid!, 0),
			undefined,
			'the process-group signal must reach the grandchild',
		);
	},
);
