import test from 'ava';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	buildFallbackCandidates,
	cliExecutableNames,
	discoverCliPath,
	findFirstExisting,
	nodeExistsAlongside,
	pickWindowsExecutable,
	planCliSpawn,
	resolveShimScript,
} from './cli-path-discovery';

/** Run `fn` with `process.platform` stubbed, restoring it afterwards. */
function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
	const original = process.platform;
	Object.defineProperty(process, 'platform', {
		value: platform,
		configurable: true,
	});
	try {
		return fn();
	} finally {
		Object.defineProperty(process, 'platform', {
			value: original,
			configurable: true,
		});
	}
}

// ---------------------------------------------------------------------------
// buildFallbackCandidates
// ---------------------------------------------------------------------------

test('buildFallbackCandidates includes NVM paths sorted newest-first', (t) => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-cand-'));
	const nvmDir = path.join(tempDir, '.nvm');
	const nodeDir = path.join(nvmDir, 'versions', 'node');
	fs.mkdirSync(path.join(nodeDir, 'v18.0.0'), { recursive: true });
	fs.mkdirSync(path.join(nodeDir, 'v20.0.0'), { recursive: true });
	fs.mkdirSync(path.join(nodeDir, 'v22.5.0'), { recursive: true });

	const origNvmDir = process.env.NVM_DIR;
	try {
		process.env.NVM_DIR = nvmDir;
		const candidates = buildFallbackCandidates(tempDir);
		// Filter only the NVM entries (they contain the nvmDir path)
		const nvmEntries = candidates.filter((c) => c.includes(path.join(nvmDir, 'versions', 'node')));
		t.true(nvmEntries.length >= 3, 'Should have at least 3 NVM candidates');
		// v22 should appear before v20 before v18 (newest-first)
		const v22idx = nvmEntries.findIndex((c) => c.includes('v22.5.0'));
		const v20idx = nvmEntries.findIndex((c) => c.includes('v20.0.0'));
		const v18idx = nvmEntries.findIndex((c) => c.includes('v18.0.0'));
		t.true(v22idx < v20idx && v20idx < v18idx, 'NVM versions should be sorted newest-first');
	} finally {
		if (origNvmDir !== undefined) process.env.NVM_DIR = origNvmDir;
		else delete process.env.NVM_DIR;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test('buildFallbackCandidates includes pnpm Linux path', (t) => {
	const origPnpmHome = process.env.PNPM_HOME;
	try {
		delete process.env.PNPM_HOME;
		const candidates = buildFallbackCandidates('/home/testuser');
		const hasPnpm =
			candidates.some((c) => c.includes('.local/share/pnpm')) ||
			candidates.some((c) => c.includes('Library/pnpm')); // macOS
		t.true(hasPnpm, 'Should include a pnpm global bin candidate');
	} finally {
		if (origPnpmHome !== undefined) process.env.PNPM_HOME = origPnpmHome;
	}
});

test('buildFallbackCandidates uses PNPM_HOME when set', (t) => {
	const origPnpmHome = process.env.PNPM_HOME;
	try {
		process.env.PNPM_HOME = '/custom/pnpm/bin';
		const candidates = buildFallbackCandidates('/home/testuser');
		t.true(
			candidates.some((c) => c.startsWith('/custom/pnpm/bin')),
			'Should use PNPM_HOME when set',
		);
	} finally {
		if (origPnpmHome !== undefined) process.env.PNPM_HOME = origPnpmHome;
		else delete process.env.PNPM_HOME;
	}
});

test('buildFallbackCandidates includes bun path', (t) => {
	const candidates = buildFallbackCandidates('/home/testuser');
	t.true(
		candidates.some((c) => c.includes('.bun/bin')),
		'Should include ~/.bun/bin',
	);
});

// ---------------------------------------------------------------------------
// findFirstExisting
// ---------------------------------------------------------------------------

test('findFirstExisting returns first path that exists on disk', (t) => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-fe-'));
	const existing = path.join(tempDir, 'nanocoder');
	fs.writeFileSync(existing, '');
	try {
		const result = findFirstExisting([
			path.join(tempDir, 'does-not-exist'),
			existing,
			path.join(tempDir, 'also-missing'),
		]);
		t.is(result, existing);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test('findFirstExisting returns null when nothing exists', (t) => {
	const result = findFirstExisting(['/unlikely/path/a', '/unlikely/path/b']);
	t.is(result, null);
});

// ---------------------------------------------------------------------------
// nodeExistsAlongside
// ---------------------------------------------------------------------------

test('nodeExistsAlongside returns true when node co-exists', (t) => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-nea-'));
	const fakeCli = path.join(tempDir, 'nanocoder');
	const fakeNode = path.join(tempDir, process.platform === 'win32' ? 'node.exe' : 'node');
	fs.writeFileSync(fakeCli, '');
	fs.writeFileSync(fakeNode, '');
	try {
		t.true(nodeExistsAlongside(fakeCli));
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test('nodeExistsAlongside returns false when node is absent', (t) => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-nea2-'));
	const fakeCli = path.join(tempDir, 'nanocoder');
	fs.writeFileSync(fakeCli, '');
	try {
		t.false(nodeExistsAlongside(fakeCli));
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// discoverCliPath – integration: fallback to NVM directory
// ---------------------------------------------------------------------------

test.serial(
	'discoverCliPath finds CLI via NVM fallback when which fails',
	async (t) => {
		// Create a real temporary NVM directory structure
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-disc-'));
		const nvmDir = path.join(tempDir, '.nvm');
		const binDir = path.join(nvmDir, 'versions', 'node', 'v99.99.9', 'bin');
		const fakeCli = path.join(binDir, 'nanocoder');

		fs.mkdirSync(binDir, { recursive: true });
		fs.writeFileSync(fakeCli, '#!/usr/bin/env node\n');
		fs.chmodSync(fakeCli, 0o755);

		const origNvmDir = process.env.NVM_DIR;
		const origHome = process.env.HOME;
		const origPath = process.env.PATH;
		const origShell = process.env.SHELL;

		try {
			process.env.NVM_DIR = nvmDir;
			// Force HOME to our tempDir so only our fake NVM dir is checked
			process.env.HOME = tempDir;
			// Clear PATH so `which nanocoder` definitely fails
			process.env.PATH = '';
			process.env.SHELL = '/bin/false';

			const result = await discoverCliPath({ PATH: '' });
			t.is(result, fakeCli, 'Should find nanocoder in the simulated NVM directory');
		} finally {
			if (origNvmDir !== undefined) process.env.NVM_DIR = origNvmDir;
			else delete process.env.NVM_DIR;
			if (origHome !== undefined) process.env.HOME = origHome;
			else delete process.env.HOME;
			if (origPath !== undefined) process.env.PATH = origPath;
			else delete process.env.PATH;
			if (origShell !== undefined) process.env.SHELL = origShell;
			else delete process.env.SHELL;
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	},
);

// ---------------------------------------------------------------------------
// cliExecutableNames — Windows .cmd
// ---------------------------------------------------------------------------

test('cliExecutableNames returns nanocoder.cmd first on win32', (t) => {
	const origPlatform = process.platform;
	// Temporarily stub process.platform
	Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
	try {
		const names = cliExecutableNames();
		t.is(names[0], 'nanocoder.cmd', 'nanocoder.cmd should be first on Windows');
		t.true(names.includes('nanocoder'), 'nanocoder (no ext) should also be present');
	} finally {
		Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
	}
});

test('cliExecutableNames returns only nanocoder on unix', (t) => {
	const origPlatform = process.platform;
	Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
	try {
		const names = cliExecutableNames();
		t.deepEqual(names, ['nanocoder']);
	} finally {
		Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
	}
});

test('buildFallbackCandidates includes nanocoder.cmd entries on win32', (t) => {
	const origPlatform = process.platform;
	Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
	try {
		const candidates = buildFallbackCandidates('C:\\Users\\test');
		t.true(
			candidates.some((c) => c.endsWith('nanocoder.cmd')),
			'Should have at least one nanocoder.cmd candidate on Windows',
		);
	} finally {
		Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
	}
});

// ---------------------------------------------------------------------------
// pickWindowsExecutable
// ---------------------------------------------------------------------------

test('pickWindowsExecutable prefers the .cmd over the extensionless shim', (t) => {
	// This is the order `where.exe nanocoder` actually reports for an npm
	// global install: the unexecutable POSIX shim comes first.
	const picked = pickWindowsExecutable([
		'C:\\Users\\test\\AppData\\Roaming\\npm\\nanocoder',
		'C:\\Users\\test\\AppData\\Roaming\\npm\\nanocoder.cmd',
		'C:\\Users\\test\\AppData\\Roaming\\npm\\nanocoder.ps1',
	]);
	t.is(picked, 'C:\\Users\\test\\AppData\\Roaming\\npm\\nanocoder.cmd');
});

test('pickWindowsExecutable prefers .exe over .cmd', (t) => {
	const picked = pickWindowsExecutable([
		'C:\\bin\\nanocoder.cmd',
		'C:\\bin\\nanocoder.exe',
	]);
	t.is(picked, 'C:\\bin\\nanocoder.exe');
});

test('pickWindowsExecutable falls back to an extensionless match', (t) => {
	t.is(pickWindowsExecutable(['C:\\bin\\nanocoder']), 'C:\\bin\\nanocoder');
});

test('pickWindowsExecutable strips the CR from where.exe output', (t) => {
	const picked = pickWindowsExecutable([
		'C:\\bin\\nanocoder\r',
		'C:\\bin\\nanocoder.cmd\r',
	]);
	t.is(picked, 'C:\\bin\\nanocoder.cmd');
});

test('pickWindowsExecutable returns null for no usable lines', (t) => {
	t.is(pickWindowsExecutable([]), null);
	t.is(pickWindowsExecutable(['', '   ']), null);
});

// ---------------------------------------------------------------------------
// resolveShimScript
// ---------------------------------------------------------------------------

/** Build a temp dir holding a shim plus the entrypoint it points at. */
function makeShimFixture(
	shimName: string,
	shimBody: (relativeScript: string) => string,
	options: {createScript?: boolean} = {},
) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-shim-'));
	const scriptDir = path.join(
		dir,
		'node_modules',
		'@nanocollective',
		'nanocoder',
		'dist',
	);
	const script = path.join(scriptDir, 'cli.js');
	if (options.createScript !== false) {
		fs.mkdirSync(scriptDir, {recursive: true});
		fs.writeFileSync(script, '#!/usr/bin/env node\n');
	}
	const shim = path.join(dir, shimName);
	fs.writeFileSync(
		shim,
		shimBody('node_modules\\@nanocollective\\nanocoder\\dist\\cli.js'),
	);
	return {dir, shim, script};
}

test('resolveShimScript resolves the entrypoint from an npm .cmd shim', (t) => {
	const {dir, shim, script} = makeShimFixture(
		'nanocoder.cmd',
		(rel) => [
			'@ECHO off',
			'GOTO start',
			':find_dp0',
			'SET dp0=%~dp0',
			'EXIT /b',
			':start',
			'SETLOCAL',
			'CALL :find_dp0',
			'IF EXIST "%dp0%\\node.exe" (',
			'  SET "_prog=%dp0%\\node.exe"',
			') ELSE (',
			'  SET "_prog=node"',
			'  SET PATHEXT=%PATHEXT:;.JS;=;%',
			')',
			`endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${rel}" %*`,
		].join('\r\n'),
	);
	try {
		t.is(resolveShimScript(shim), script);
	} finally {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test('resolveShimScript resolves the entrypoint from a POSIX shim', (t) => {
	const {dir, shim, script} = makeShimFixture('nanocoder', (rel) => {
		const posix = rel.split('\\').join('/');
		return [
			'#!/bin/sh',
			'basedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")',
			'if [ -x "$basedir/node" ]; then',
			`  exec "$basedir/node"  "$basedir/${posix}" "$@"`,
			'else',
			`  exec node  "$basedir/${posix}" "$@"`,
			'fi',
		].join('\n');
	});
	try {
		t.is(resolveShimScript(shim), script);
	} finally {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test('resolveShimScript returns null when the entrypoint is missing', (t) => {
	const {dir, shim} = makeShimFixture(
		'nanocoder.cmd',
		(rel) => `"%_prog%"  "%dp0%\\${rel}" %*`,
		{createScript: false},
	);
	try {
		t.is(resolveShimScript(shim), null);
	} finally {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test('resolveShimScript returns null for a real script, not a shim', (t) => {
	// This is what npm leaves on unix: a symlink straight to dist/cli.js, whose
	// contents carry no shim marker, so direct spawn stays the right call.
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-noshim-'));
	const binary = path.join(dir, 'nanocoder');
	fs.writeFileSync(binary, '#!/usr/bin/env node\nconsole.log("hi");\n');
	try {
		t.is(resolveShimScript(binary), null);
	} finally {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test('resolveShimScript passes through an existing .js path', (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-js-'));
	const script = path.join(dir, 'cli.js');
	fs.writeFileSync(script, '');
	try {
		t.is(resolveShimScript(script), script);
		t.is(resolveShimScript(path.join(dir, 'missing.js')), null);
	} finally {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test('resolveShimScript returns null for a nonexistent path', (t) => {
	t.is(resolveShimScript('/unlikely/path/nanocoder.cmd'), null);
});

// ---------------------------------------------------------------------------
// planCliSpawn
// ---------------------------------------------------------------------------

test('planCliSpawn handles the local-development node <script> form', (t) => {
	t.deepEqual(planCliSpawn('node /repo/dist/cli.js', ['--acp']), {
		command: 'node',
		args: ['/repo/dist/cli.js', '--acp'],
		shell: false,
	});
});

test('planCliSpawn spawns a unix binary directly', (t) => {
	const plan = withPlatform('darwin', () =>
		planCliSpawn('/usr/local/bin/nanocoder', ['--acp']),
	);
	t.deepEqual(plan, {
		command: '/usr/local/bin/nanocoder',
		args: ['--acp'],
		shell: false,
	});
});

test('planCliSpawn runs a resolvable Windows shim through node', (t) => {
	const {dir, shim, script} = makeShimFixture(
		'nanocoder.cmd',
		(rel) => `"%_prog%"  "%dp0%\\${rel}" %*`,
	);
	try {
		const plan = withPlatform('win32', () => planCliSpawn(shim, ['--acp']));
		t.deepEqual(plan, {
			command: 'node',
			args: [script, '--acp'],
			shell: false,
		});
	} finally {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test('planCliSpawn shells out for an unresolvable .cmd, quoting the path', (t) => {
	const plan = withPlatform('win32', () =>
		planCliSpawn('C:\\Users\\First Last\\npm\\nanocoder.cmd', ['--acp']),
	);
	t.deepEqual(plan, {
		command: '"C:\\Users\\First Last\\npm\\nanocoder.cmd"',
		args: ['--acp'],
		shell: true,
	});
});

test('planCliSpawn refuses to shell-spawn a path containing a quote', (t) => {
	t.throws(
		() =>
			withPlatform('win32', () =>
				planCliSpawn('C:\\evil"&calc&".cmd', ['--acp']),
			),
		{message: /double quote/},
	);
});

test('planCliSpawn leaves a unix pnpm shim alone', (t) => {
	// The shim would resolve, but unix has always spawned it directly and its
	// shebang works, so nothing should change there.
	const {dir, shim} = makeShimFixture('nanocoder', (rel) => {
		const posix = rel.split('\\').join('/');
		return `#!/bin/sh\nexec node  "$basedir/${posix}" "$@"\n`;
	});
	try {
		const plan = withPlatform('linux', () => planCliSpawn(shim, ['--acp']));
		t.deepEqual(plan, {command: shim, args: ['--acp'], shell: false});
	} finally {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test('resolveShimScript refuses a target outside the shim directory', (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-escape-'));
	const outside = path.join(dir, 'outside.js');
	const binDir = path.join(dir, 'bin');
	fs.mkdirSync(binDir);
	fs.writeFileSync(outside, '');
	const shim = path.join(binDir, 'nanocoder.cmd');
	fs.writeFileSync(shim, '"%_prog%"  "%dp0%\\..\\outside.js" %*');
	try {
		t.is(resolveShimScript(shim), null);
	} finally {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});
