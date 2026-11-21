import test from 'ava';
import {mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {MAX_AGENTS_MD_FILE_CHARS} from '@/constants';
import {
	createSessionContext,
	runInSessionContext,
} from '@/services/session-context';
import {resetSessionCwd, setProjectRoot, setSessionCwd} from '@/services/session-cwd';
import {
	appendAgentsMd,
	getDiscoveredAgentsMdPaths,
	getNestedAgentsMdSection,
	noteAgentsMdAccess,
	noteAgentsMdAccessForTool,
	resetAgentsMdIgnoreCache,
	resetAgentsMdTracker,
} from './agents-md';

const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;

function makeTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `nc-agents-${prefix}-`));
}

function write(filePath: string, content: string): void {
	mkdirSync(dirname(filePath), {recursive: true});
	writeFileSync(filePath, content);
}

function cleanup(...dirs: string[]): void {
	for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
}

test.beforeEach(() => {
	resetSessionCwd();
	resetAgentsMdTracker();
	resetAgentsMdIgnoreCache();
	delete process.env.NANOCODER_CONFIG_DIR;
});

test.afterEach(() => {
	resetSessionCwd();
	resetAgentsMdTracker();
	resetAgentsMdIgnoreCache();
	if (originalConfigDir === undefined) {
		delete process.env.NANOCODER_CONFIG_DIR;
	} else {
		process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
	}
});

test('appendAgentsMd puts the config-dir file before the project root', t => {
	const root = makeTempDir('order-root');
	const configDir = makeTempDir('order-config');
	try {
		write(join(configDir, 'AGENTS.md'), 'USER LEVEL RULES');
		write(join(root, 'AGENTS.md'), 'PROJECT ROOT RULES');
		process.env.NANOCODER_CONFIG_DIR = configDir;
		setProjectRoot(root);

		const result = appendAgentsMd('BASE PROMPT');

		t.true(result.startsWith('BASE PROMPT\n\nAdditional Context...'));
		t.true(result.indexOf('USER LEVEL RULES') < result.indexOf('PROJECT ROOT RULES'));
	} finally {
		cleanup(root, configDir);
	}
});

test('appendAgentsMd keeps nested files out of the base prompt', t => {
	const root = makeTempDir('base');
	try {
		write(join(root, 'AGENTS.md'), 'ROOT RULES');
		write(join(root, 'packages', 'api', 'AGENTS.md'), 'API RULES');
		setProjectRoot(root);
		setSessionCwd(root);
		noteAgentsMdAccess('packages/api/src/handler.ts');

		const result = appendAgentsMd('BASE PROMPT');

		t.true(result.includes('ROOT RULES'));
		t.false(result.includes('API RULES'));
		// Discovery still happens; it just belongs in the per-request user
		// message, never in the cache-stable base system prompt.
		t.true(getNestedAgentsMdSection()?.includes('API RULES'));
	} finally {
		cleanup(root);
	}
});

test('getNestedAgentsMdSection carries only the nested layer', t => {
	const root = makeTempDir('nested-only');
	const configDir = makeTempDir('nested-config');
	try {
		write(join(configDir, 'AGENTS.md'), 'USER LEVEL RULES');
		write(join(root, 'AGENTS.md'), 'ROOT RULES');
		write(join(root, 'packages', 'api', 'AGENTS.md'), 'API RULES');
		process.env.NANOCODER_CONFIG_DIR = configDir;
		setProjectRoot(root);
		setSessionCwd(root);
		noteAgentsMdAccess('packages/api/src/handler.ts');

		const section = getNestedAgentsMdSection();

		t.truthy(section);
		t.true(section?.includes('API RULES'));
		t.false(section?.includes('USER LEVEL RULES'));
		t.false(section?.includes('ROOT RULES'));
	} finally {
		cleanup(root, configDir);
	}
});

test('nested files are ordered shallow to deep', t => {
	const root = makeTempDir('depth');
	try {
		write(join(root, 'packages', 'AGENTS.md'), 'PACKAGES RULES');
		write(join(root, 'packages', 'api', 'AGENTS.md'), 'API RULES');
		setProjectRoot(root);
		setSessionCwd(root);
		noteAgentsMdAccess('packages/api/src/handler.ts');

		const section = getNestedAgentsMdSection() ?? '';

		t.true(section.indexOf('PACKAGES RULES') < section.indexOf('API RULES'));
	} finally {
		cleanup(root);
	}
});

test('nested files are discovered only for touched subdirectories', t => {
	const root = makeTempDir('siblings');
	try {
		write(join(root, 'packages', 'api', 'AGENTS.md'), 'API RULES');
		write(join(root, 'packages', 'web', 'AGENTS.md'), 'WEB RULES');
		setProjectRoot(root);
		setSessionCwd(root);
		noteAgentsMdAccess('packages/api/src/handler.ts');

		const section = getNestedAgentsMdSection() ?? '';

		t.true(section.includes('API RULES'));
		t.false(section.includes('WEB RULES'));
	} finally {
		cleanup(root);
	}
});

test('discovery ignores AGENTS.md outside the project root', t => {
	const parent = makeTempDir('outside-parent');
	const root = join(parent, 'project');
	try {
		write(join(parent, 'AGENTS.md'), 'OUTSIDE RULES');
		write(join(root, 'AGENTS.md'), 'ROOT RULES');
		setProjectRoot(root);
		setSessionCwd(root);
		noteAgentsMdAccess('../sibling/file.ts');

		t.is(getNestedAgentsMdSection(), undefined);
		t.true(appendAgentsMd('BASE').includes('ROOT RULES'));
		t.false(appendAgentsMd('BASE').includes('OUTSIDE RULES'));
	} finally {
		cleanup(parent);
	}
});

test('a file over the cap is truncated with a visible note', t => {
	const root = makeTempDir('truncated');
	try {
		const content = 'a'.repeat(MAX_AGENTS_MD_FILE_CHARS + 100);
		write(join(root, 'AGENTS.md'), content);
		setProjectRoot(root);

		const result = appendAgentsMd('BASE PROMPT');

		t.true(result.includes('[AGENTS.md truncated:'));
		t.true(result.includes(`100 of ${content.length} characters omitted`));
		t.true(result.includes('a'.repeat(MAX_AGENTS_MD_FILE_CHARS)));
	} finally {
		cleanup(root);
	}
});

test('a config dir inside the project is not appended twice', t => {
	const root = makeTempDir('dedupe');
	try {
		write(join(root, 'AGENTS.md'), 'ONLY ONCE');
		process.env.NANOCODER_CONFIG_DIR = root;
		setProjectRoot(root);

		const result = appendAgentsMd('BASE PROMPT');

		t.is(result.split('ONLY ONCE').length - 1, 1);
	} finally {
		cleanup(root);
	}
});

test('appendAgentsMd is idempotent', t => {
	const root = makeTempDir('idempotent');
	try {
		write(join(root, 'AGENTS.md'), 'ROOT RULES');
		setProjectRoot(root);

		const once = appendAgentsMd('BASE PROMPT');
		const twice = appendAgentsMd(once);

		t.is(twice, once);
		t.is(twice.split('ROOT RULES').length - 1, 1);
	} finally {
		cleanup(root);
	}
});

test('a directory target discovers its own AGENTS.md', t => {
	const root = makeTempDir('directory');
	try {
		const apiDir = join(root, 'packages', 'api');
		write(join(apiDir, 'AGENTS.md'), 'API RULES');
		setProjectRoot(root);
		setSessionCwd(root);

		noteAgentsMdAccess(apiDir);

		t.deepEqual(getDiscoveredAgentsMdPaths(), [join(apiDir, 'AGENTS.md')]);
	} finally {
		cleanup(root);
	}
});

test('only path-bearing file tools record discovery', t => {
	const root = makeTempDir('tools');
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
		cleanup(root);
	}
});

test('non-string path arguments are ignored', t => {
	const root = makeTempDir('bad-args');
	try {
		write(join(root, 'packages', 'api', 'AGENTS.md'), 'API RULES');
		setProjectRoot(root);
		setSessionCwd(root);

		noteAgentsMdAccessForTool('read_file', {path: 42});
		noteAgentsMdAccessForTool('read_file', {path: '   '});

		t.deepEqual(getDiscoveredAgentsMdPaths(), []);
	} finally {
		cleanup(root);
	}
});

test('default ignored directories never contribute rules', t => {
	const root = makeTempDir('default-ignores');
	try {
		write(join(root, 'node_modules', 'pkg', 'AGENTS.md'), 'DEPENDENCY RULES');
		write(join(root, 'dist', 'AGENTS.md'), 'BUILD RULES');
		write(join(root, '.git', 'AGENTS.md'), 'VCS RULES');
		setProjectRoot(root);
		setSessionCwd(root);

		noteAgentsMdAccess('node_modules/pkg/index.js');
		noteAgentsMdAccess('dist/bundle.js');
		noteAgentsMdAccess('.git/hooks/pre-commit');

		t.deepEqual(getDiscoveredAgentsMdPaths(), []);
	} finally {
		cleanup(root);
	}
});

test('.gitignore and .nanocoderignore are honoured', t => {
	const root = makeTempDir('ignore-files');
	try {
		write(join(root, '.nanocoderignore'), 'packages/hidden\n');
		write(join(root, '.gitignore'), 'packages/generated\n');
		write(join(root, 'packages', 'hidden', 'AGENTS.md'), 'HIDDEN RULES');
		write(join(root, 'packages', 'generated', 'AGENTS.md'), 'GENERATED RULES');
		write(join(root, 'packages', 'visible', 'AGENTS.md'), 'VISIBLE RULES');
		setProjectRoot(root);
		setSessionCwd(root);

		noteAgentsMdAccess('packages/hidden/file.ts');
		noteAgentsMdAccess('packages/generated/file.ts');
		noteAgentsMdAccess('packages/visible/file.ts');

		t.deepEqual(getDiscoveredAgentsMdPaths(), [
			join(root, 'packages', 'visible', 'AGENTS.md'),
		]);
	} finally {
		cleanup(root);
	}
});

test('the per-root ignore cache picks up changes to ignore files', t => {
	const root = makeTempDir('ignore-cache');
	const ignoreFile = join(root, '.nanocoderignore');
	try {
		write(join(root, 'packages', 'hidden', 'AGENTS.md'), 'HIDDEN RULES');
		write(ignoreFile, 'packages/hidden\n');
		setProjectRoot(root);
		setSessionCwd(root);
		noteAgentsMdAccess('packages/hidden/file.ts');
		t.deepEqual(getDiscoveredAgentsMdPaths(), []);

		resetAgentsMdTracker();
		write(ignoreFile, '');
		utimesSync(ignoreFile, new Date(2_000_000), new Date(2_000_000));
		noteAgentsMdAccess('packages/hidden/file.ts');

		t.deepEqual(getDiscoveredAgentsMdPaths(), [
			join(root, 'packages', 'hidden', 'AGENTS.md'),
		]);
	} finally {
		cleanup(root);
	}
});

test('resetAgentsMdTracker clears discovered nested files only', t => {
	const root = makeTempDir('reset');
	try {
		write(join(root, 'AGENTS.md'), 'ROOT RULES');
		write(join(root, 'packages', 'api', 'AGENTS.md'), 'API RULES');
		setProjectRoot(root);
		setSessionCwd(root);
		noteAgentsMdAccess('packages/api/src/handler.ts');

		resetAgentsMdTracker();

		t.is(getNestedAgentsMdSection(), undefined);
		t.true(appendAgentsMd('BASE').includes('ROOT RULES'));
	} finally {
		cleanup(root);
	}
});

test('discovery is isolated per session context', t => {
	const rootA = makeTempDir('scope-a');
	const rootB = makeTempDir('scope-b');
	try {
		write(join(rootA, 'packages', 'api', 'AGENTS.md'), 'A RULES');
		write(join(rootB, 'packages', 'api', 'AGENTS.md'), 'B RULES');
		const contextA = createSessionContext(rootA);
		const contextB = createSessionContext(rootB);

		runInSessionContext(contextA, () => {
			setProjectRoot(rootA);
			setSessionCwd(rootA);
			noteAgentsMdAccess('packages/api/src/handler.ts');
		});

		runInSessionContext(contextB, () => {
			t.deepEqual(getDiscoveredAgentsMdPaths(), []);
			t.is(getNestedAgentsMdSection(), undefined);
		});
		runInSessionContext(contextA, () => {
			t.deepEqual(getDiscoveredAgentsMdPaths(), [
				join(rootA, 'packages', 'api', 'AGENTS.md'),
			]);
		});
	} finally {
		cleanup(rootA, rootB);
	}
});
