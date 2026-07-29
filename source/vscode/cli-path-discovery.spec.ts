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
} from './cli-path-discovery';

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
