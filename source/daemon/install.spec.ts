import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	buildLaunchAgentPlist,
	buildSystemdUnit,
	installAutoStart,
	isAutoStartInstalled,
	launchAgentPath,
	projectHash,
	systemdUnitPath,
	uninstallAutoStart,
} from './install';

console.log(`\ninstall.spec.ts`);

async function withTempHome(
	fn: (home: string, projectRoot: string) => Promise<void>,
): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), 'nanocoder-install-'));
	const home = join(dir, 'home');
	const project = join(dir, 'project');
	try {
		await fn(home, project);
	} finally {
		await rm(dir, {recursive: true, force: true});
	}
}

test('projectHash is stable and short', t => {
	const h = projectHash('/path/to/project');
	t.is(h, projectHash('/path/to/project'));
	t.is(h.length, 10);
	t.not(h, projectHash('/path/to/other'));
});

test('buildLaunchAgentPlist contains required keys', t => {
	const plist = buildLaunchAgentPlist('/some/project', 'abcd1234ef', 'nanocoder');
	t.regex(plist, /<key>Label<\/key>\s*<string>com\.nanocoder\.daemon\.abcd1234ef<\/string>/);
	t.regex(plist, /<key>WorkingDirectory<\/key>\s*<string>\/some\/project<\/string>/);
	t.regex(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
	t.regex(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
});

test('buildSystemdUnit contains required keys', t => {
	const unit = buildSystemdUnit('/some/project', 'abcd1234ef', 'nanocoder');
	t.regex(unit, /Description=nanocoder daemon for \/some\/project/);
	t.regex(unit, /WorkingDirectory=\/some\/project/);
	t.regex(unit, /ExecStart=nanocoder daemon start/);
	t.regex(unit, /Restart=on-failure/);
});

test.serial('installAutoStart on darwin writes plist at expected path', async t => {
	await withTempHome(async (home, project) => {
		const result = await installAutoStart({
			projectRoot: project,
			platform: 'darwin',
			home,
			loadService: false,
		});
		t.is(result.platform, 'darwin');
		const expected = launchAgentPath(home, projectHash(project));
		t.is(result.written, expected);
		const contents = await readFile(expected, 'utf-8');
		t.regex(contents, /com\.nanocoder\.daemon/);
		t.true(await isAutoStartInstalled({projectRoot: project, platform: 'darwin', home}));
	});
});

test.serial('installAutoStart on linux writes service at expected path', async t => {
	await withTempHome(async (home, project) => {
		const result = await installAutoStart({
			projectRoot: project,
			platform: 'linux',
			home,
			loadService: false,
		});
		const expected = systemdUnitPath(home, projectHash(project));
		t.is(result.written, expected);
		const contents = await readFile(expected, 'utf-8');
		t.regex(contents, /\[Service\]/);
	});
});

test.serial('install is idempotent: running twice keeps a single file', async t => {
	await withTempHome(async (home, project) => {
		await installAutoStart({
			projectRoot: project,
			platform: 'darwin',
			home,
			loadService: false,
		});
		await installAutoStart({
			projectRoot: project,
			platform: 'darwin',
			home,
			loadService: false,
		});
		t.true(await isAutoStartInstalled({projectRoot: project, platform: 'darwin', home}));
	});
});

test.serial('uninstall removes the file (idempotent if missing)', async t => {
	await withTempHome(async (home, project) => {
		await installAutoStart({
			projectRoot: project,
			platform: 'darwin',
			home,
			loadService: false,
		});
		await uninstallAutoStart({
			projectRoot: project,
			platform: 'darwin',
			home,
			loadService: false,
		});
		t.false(await isAutoStartInstalled({projectRoot: project, platform: 'darwin', home}));

		// idempotent
		await uninstallAutoStart({
			projectRoot: project,
			platform: 'darwin',
			home,
			loadService: false,
		});
		t.false(await isAutoStartInstalled({projectRoot: project, platform: 'darwin', home}));
	});
});

test('unsupported platform reports manual fallback', async t => {
	const result = await installAutoStart({
		projectRoot: '/whatever',
		platform: 'unsupported',
		home: '/tmp/nowhere',
		loadService: false,
	});
	t.is(result.platform, 'unsupported');
	t.regex(result.message, /not supported/i);
});
