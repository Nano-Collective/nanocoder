import test from 'ava';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {MAX_AGENTS_MD_FILE_CHARS} from '@/constants';
import {
	createSessionCwdScope,
	resetSessionCwd,
	runInSessionCwdScope,
	setProjectRoot,
	setSessionCwd,
} from '@/services/session-cwd';
import {
	appendAgentsMd,
	getDiscoveredAgentsMdPaths,
	noteAgentsMdAccess,
	noteAgentsMdAccessForTool,
	resetAgentsMdTracker,
} from './agents-md.js';

console.log('\nagents-md.spec.ts');

const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;

function makeTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `nc-${prefix}-`));
}

function write(filePath: string, content: string): void {
	mkdirSync(dirname(filePath), {recursive: true});
	writeFileSync(filePath, content);
}

test.beforeEach(() => {
	resetSessionCwd();
	resetAgentsMdTracker();
});

test.afterEach(() => {
	resetSessionCwd();
	resetAgentsMdTracker();
	if (originalConfigDir === undefined) {
		delete process.env.NANOCODER_CONFIG_DIR;
	} else {
		process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
	}
});

test('appendAgentsMd - user-level file comes before the project root', t => {
	const root = makeTempDir('agents-root');
	const configDir = makeTempDir('agents-config');
	try {
		write(join(configDir, 'AGENTS.md'), 'USER LEVEL RULES');
		write(join(root, 'AGENTS.md'), 'PROJECT ROOT RULES');
		process.env.NANOCODER_CONFIG_DIR = configDir;
		setProjectRoot(root);

		const result = appendAgentsMd('BASE PROMPT', {includeNested: false});

		t.true(result.startsWith('BASE PROMPT\n\nAdditional Context...'));
		t.true(result.includes('USER LEVEL RULES'));
		t.true(result.includes('PROJECT ROOT RULES'));
		t.true(
			result.indexOf('USER LEVEL RULES') < result.indexOf('PROJECT ROOT RULES'),
		);
	} finally {
		rmSync(root, {recursive: true, force: true});
		rmSync(configDir, {recursive: true, force: true});
	}
});

test('appendAgentsMd - base prompt excludes nested files', t => {
	const root = makeTempDir('agents-base');
	const configDir = makeTempDir('agents-config');
	try {
		write(join(root, 'AGENTS.md'), 'ROOT RULES');
		write(join(root, 'packages', 'api', 'AGENTS.md'), 'API RULES');
		process.env.NANOCODER_CONFIG_DIR = configDir;
		setProjectRoot(root);
		setSessionCwd(root);
		noteAgentsMdAccess('packages/api/src/handler.ts');

		const result = appendAgentsMd('BASE PROMPT', {includeNested: false});

		t.true(result.includes('ROOT RULES'));
		t.false(result.includes('API RULES'));
	} finally {
		rmSync(root, {recursive: true, force: true});
		rmSync(configDir, {recursive: true, force: true});
	}
});

test('appendAgentsMd - nested files are ordered shallow to deep', t => {
	const root = makeTempDir('agents-nested');
	const configDir = makeTempDir('agents-config');
	try {
		write(join(root, 'AGENTS.md'), 'ROOT RULES');
		write(join(root, 'packages', 'AGENTS.md'), 'PACKAGES RULES');
		write(join(root, 'packages', 'api', 'AGENTS.md'), 'API RULES');
		process.env.NANOCODER_CONFIG_DIR = configDir;
		setProjectRoot(root);
		setSessionCwd(root);

		noteAgentsMdAccess('packages/api/src/handler.ts');
		const result = appendAgentsMd('BASE PROMPT');

		t.true(result.includes('ROOT RULES'));
		t.true(result.includes('PACKAGES RULES'));
		t.true(result.includes('API RULES'));
		t.true(result.indexOf('ROOT RULES') < result.indexOf('PACKAGES RULES'));
		t.true(result.indexOf('PACKAGES RULES') < result.indexOf('API RULES'));
	} finally {
		rmSync(root, {recursive: true, force: true});
		rmSync(configDir, {recursive: true, force: true});
	}
});

test('appendAgentsMd - does not add rules for untouched sibling packages', t => {
	const root = makeTempDir('agents-untouched');
	const configDir = makeTempDir('agents-config');
	try {
		write(join(root, 'AGENTS.md'), 'ROOT RULES');
		write(join(root, 'packages', 'api', 'AGENTS.md'), 'API RULES');
		write(join(root, 'packages', 'web', 'AGENTS.md'), 'WEB RULES');
		process.env.NANOCODER_CONFIG_DIR = configDir;
		setProjectRoot(root);
		setSessionCwd(root);

		noteAgentsMdAccess('packages/api/src/handler.ts');
		const result = appendAgentsMd('BASE PROMPT');

		t.true(result.includes('API RULES'));
		t.false(result.includes('WEB RULES'));
	} finally {
		rmSync(root, {recursive: true, force: true});
		rmSync(configDir, {recursive: true, force: true});
	}
});

test('appendAgentsMd - ignores AGENTS.md outside the project root', t => {
	const parent = makeTempDir('agents-outside');
	const root = join(parent, 'project');
	const configDir = makeTempDir('agents-config');
	try {
		write(join(parent, 'AGENTS.md'), 'OUTSIDE RULES');
		write(join(root, 'AGENTS.md'), 'ROOT RULES');
		process.env.NANOCODER_CONFIG_DIR = configDir;
		setProjectRoot(root);
		setSessionCwd(root);

		noteAgentsMdAccess('../sibling/file.ts');
		const result = appendAgentsMd('BASE PROMPT');

		t.true(result.includes('ROOT RULES'));
		t.false(result.includes('OUTSIDE RULES'));
	} finally {
		rmSync(parent, {recursive: true, force: true});
		rmSync(configDir, {recursive: true, force: true});
	}
});

test('appendAgentsMd - truncates a file over the per-file cap with a visible note', t => {
	const root = makeTempDir('agents-large');
	const configDir = makeTempDir('agents-config');
	try {
		const content = 'a'.repeat(MAX_AGENTS_MD_FILE_CHARS + 100);
		write(join(root, 'AGENTS.md'), content);
		process.env.NANOCODER_CONFIG_DIR = configDir;
		setProjectRoot(root);

		const result = appendAgentsMd('BASE PROMPT', {includeNested: false});

		t.true(result.includes('[AGENTS.md truncated:'));
		t.true(
			result.includes(
				`100 of ${content.length} characters omitted`,
			),
		);
		t.true(result.includes('a'.repeat(MAX_AGENTS_MD_FILE_CHARS)));
	} finally {
		rmSync(root, {recursive: true, force: true});
		rmSync(configDir, {recursive: true, force: true});
	}
});

test('appendAgentsMd - does not duplicate a shared config/project file', t => {
	const root = makeTempDir('agents-dedupe');
	try {
		write(join(root, 'AGENTS.md'), 'ONLY ONCE');
		process.env.NANOCODER_CONFIG_DIR = root;
		setProjectRoot(root);

		const result = appendAgentsMd('BASE PROMPT', {includeNested: false});

		t.is(result.split('ONLY ONCE').length - 1, 1);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('appendAgentsMd - repeated calls are idempotent', t => {
	const root = makeTempDir('agents-idempotent');
	const configDir = makeTempDir('agents-config');
	try {
		write(join(root, 'AGENTS.md'), 'ROOT RULES');
		write(join(root, 'packages', 'api', 'AGENTS.md'), 'API RULES');
		process.env.NANOCODER_CONFIG_DIR = configDir;
		setProjectRoot(root);
		setSessionCwd(root);
		noteAgentsMdAccess('packages/api/src/handler.ts');

		const once = appendAgentsMd('BASE PROMPT');
		const twice = appendAgentsMd(once);

		t.is(twice, once);
		t.is(twice.split('API RULES').length - 1, 1);
		t.is(twice.split('Additional Context...').length - 1, 1);
	} finally {
		rmSync(root, {recursive: true, force: true});
		rmSync(configDir, {recursive: true, force: true});
	}
});

test('noteAgentsMdAccess - treats a directory target as the directory itself', t => {
	const root = makeTempDir('agents-directory');
	try {
		const apiDir = join(root, 'packages', 'api');
		mkdirSync(apiDir, {recursive: true});
		write(join(apiDir, 'AGENTS.md'), 'API RULES');
		setProjectRoot(root);
		setSessionCwd(root);

		noteAgentsMdAccess(apiDir);

		t.deepEqual(getDiscoveredAgentsMdPaths(), [join(apiDir, 'AGENTS.md')]);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('noteAgentsMdAccessForTool - only tracks path-bearing file tools', t => {
	const root = makeTempDir('agents-tools');
	try {
		write(join(root, 'packages', 'api', 'AGENTS.md'), 'API RULES');
		write(join(root, 'packages', 'web', 'AGENTS.md'), 'WEB RULES');
		setProjectRoot(root);
		setSessionCwd(root);

		noteAgentsMdAccessForTool('git_status', {path: 'packages/api'});
		t.deepEqual(getDiscoveredAgentsMdPaths(), []);

		noteAgentsMdAccessForTool('file_op', {
			operation: 'move',
			path: 'packages/api/file.ts',
			destination: 'packages/web/file.ts',
		});

		t.deepEqual(
			getDiscoveredAgentsMdPaths().sort(),
			[
				join(root, 'packages', 'api', 'AGENTS.md'),
				join(root, 'packages', 'web', 'AGENTS.md'),
			].sort(),
		);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('noteAgentsMdAccessForTool - ignores non-string path arguments', t => {
	const root = makeTempDir('agents-bad-args');
	try {
		write(join(root, 'packages', 'api', 'AGENTS.md'), 'API RULES');
		setProjectRoot(root);
		setSessionCwd(root);

		noteAgentsMdAccessForTool('read_file', {path: 42});
		noteAgentsMdAccessForTool('read_file', {path: '   '});

		t.deepEqual(getDiscoveredAgentsMdPaths(), []);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('resetAgentsMdTracker - clears discovered nested files', t => {
	const root = makeTempDir('agents-reset');
	const configDir = makeTempDir('agents-config');
	try {
		write(join(root, 'AGENTS.md'), 'ROOT RULES');
		write(join(root, 'packages', 'api', 'AGENTS.md'), 'API RULES');
		process.env.NANOCODER_CONFIG_DIR = configDir;
		setProjectRoot(root);
		setSessionCwd(root);
		noteAgentsMdAccess('packages/api/src/handler.ts');

		resetAgentsMdTracker();
		const result = appendAgentsMd('BASE PROMPT');

		t.false(result.includes('API RULES'));
		t.true(result.includes('ROOT RULES'));
	} finally {
		rmSync(root, {recursive: true, force: true});
		rmSync(configDir, {recursive: true, force: true});
	}
});

test('nested AGENTS.md discovery is isolated per session cwd scope', t => {
	const rootA = makeTempDir('agents-scope-a');
	const rootB = makeTempDir('agents-scope-b');
	try {
		write(join(rootA, 'packages', 'api', 'AGENTS.md'), 'A RULES');
		write(join(rootB, 'packages', 'api', 'AGENTS.md'), 'B RULES');

		const scopeA = createSessionCwdScope(rootA);
		const scopeB = createSessionCwdScope(rootB);

		runInSessionCwdScope(scopeA, () =>
			noteAgentsMdAccess('packages/api/src/handler.ts'),
		);
		runInSessionCwdScope(scopeB, () => {
			t.deepEqual(getDiscoveredAgentsMdPaths(), []);
		});
		runInSessionCwdScope(scopeA, () => {
			t.deepEqual(getDiscoveredAgentsMdPaths(), [
				join(rootA, 'packages', 'api', 'AGENTS.md'),
			]);
		});
	} finally {
		rmSync(rootA, {recursive: true, force: true});
		rmSync(rootB, {recursive: true, force: true});
	}
});
