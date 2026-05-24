import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	buildLaunchAgentPlist,
	buildScheduledTaskXml,
	buildSystemdUnit,
	installAutoStart,
	isAutoStartInstalled,
	launchAgentPath,
	projectHash,
	readUnitOrPlist,
	scheduledTaskName,
	scheduledTaskXmlPath,
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

// ============================================================================
// Windows auto-start
// ============================================================================

test('buildScheduledTaskXml contains required pieces', t => {
	const xml = buildScheduledTaskXml(
		'C:\\path\\to\\project',
		'abcd1234ef',
		'nanocoder',
	);
	// Must declare the schema and a LogonTrigger
	t.regex(xml, /<\?xml version="1\.0" encoding="UTF-16"\?>/);
	t.regex(xml, /<LogonTrigger>/);
	// Must reference the project root for the Description + WorkingDirectory
	t.regex(xml, /C:\\path\\to\\project/);
	// Must drive `nanocoder daemon start`
	t.regex(xml, /<Command>nanocoder<\/Command>/);
	t.regex(xml, /<Arguments>daemon start<\/Arguments>/);
	// Restart-on-failure mirrors KeepAlive / Restart=on-failure
	t.regex(xml, /<RestartOnFailure>/);
});

test('buildScheduledTaskXml escapes ampersands and angle brackets', t => {
	const xml = buildScheduledTaskXml(
		'C:\\R&D\\<staging>\\proj',
		'abcd1234ef',
		'nanocoder',
	);
	t.regex(xml, /C:\\R&amp;D\\&lt;staging&gt;\\proj/);
	t.notRegex(xml, /<staging>/);
});

test('scheduledTaskName is unique per project hash', t => {
	t.is(scheduledTaskName('aaaaaaaaaa'), 'nanocoder-daemon-aaaaaaaaaa');
	t.not(scheduledTaskName('aaaaaaaaaa'), scheduledTaskName('bbbbbbbbbb'));
});

test.serial(
	'installAutoStart on win32 writes UTF-16 XML at expected path',
	async t => {
		await withTempHome(async (home, project) => {
			const result = await installAutoStart({
				projectRoot: project,
				platform: 'win32',
				home,
				loadService: false, // skip schtasks - we're not on Windows
			});
			t.is(result.platform, 'win32');
			const expected = scheduledTaskXmlPath(home, projectHash(project));
			t.is(result.written, expected);

			// readUnitOrPlist strips the BOM and returns clean XML.
			const xml = await readUnitOrPlist({
				projectRoot: project,
				platform: 'win32',
				home,
			});
			t.truthy(xml);
			t.regex(xml ?? '', /<LogonTrigger>/);
			t.regex(xml ?? '', /<Command>nanocoder<\/Command>/);

			t.true(
				await isAutoStartInstalled({
					projectRoot: project,
					platform: 'win32',
					home,
				}),
			);
		});
	},
);

test.serial(
	'win32 install is idempotent and uninstall removes the XML',
	async t => {
		await withTempHome(async (home, project) => {
			const opts = {
				projectRoot: project,
				platform: 'win32' as const,
				home,
				loadService: false,
			};
			await installAutoStart(opts);
			await installAutoStart(opts); // idempotent
			t.true(await isAutoStartInstalled(opts));

			await uninstallAutoStart(opts);
			t.false(await isAutoStartInstalled(opts));

			// idempotent on missing
			await uninstallAutoStart(opts);
			t.false(await isAutoStartInstalled(opts));
		});
	},
);
