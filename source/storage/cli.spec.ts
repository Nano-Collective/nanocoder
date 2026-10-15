import test from 'ava';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {StorageReport} from './diagnostics.js';
import {parseStorageArgs, runStorageCli} from './cli.js';

const report: StorageReport = {
	version: 1,
	scannedAt: '2026-01-01T00:00:00.000Z',
	projectRoot: '/project',
	sections: Object.fromEntries(
		(['sessions', 'artifacts', 'timeline', 'checkpoints'] as const).map(name => [
			name,
			{scope: 'project', root: `/project/${name}`, count: 0, sizeBytes: 0, items: [], findings: []},
		]),
	) as StorageReport['sections'],
};

test('storage arguments only allow help or --format json', t => {
	t.deepEqual(parseStorageArgs([]), {mode: 'interactive'});
	t.deepEqual(parseStorageArgs(['--help']), {mode: 'help'});
	t.deepEqual(parseStorageArgs(['--format=json']), {mode: 'json'});
	t.deepEqual(parseStorageArgs(['--format', 'json']), {mode: 'json'});
	for (const args of [['--json'], ['--format', 'text'], ['--format'], ['--help', '--format', 'json'], ['clean'], ['--plain']]) {
		t.true('error' in parseStorageArgs(args));
	}
});

test('JSON dispatch emits exactly one document without requiring a TTY', async t => {
	let stdout = '';
	let scans = 0;
	const code = await runStorageCli(['--format', 'json'], {
		isTTY: false,
		collect: async () => { scans++; return report; },
		stdout: text => { stdout += text; },
	});
	t.is(code, 0);
	t.is(scans, 1);
	t.is(stdout, `${JSON.stringify(report)}\n`);
	t.deepEqual(JSON.parse(stdout), report);
});

test('non-TTY and invalid input fail before scanning; help succeeds without scanning', async t => {
	let scans = 0;
	let stderr = '';
	let stdout = '';
	const options = {
		isTTY: false,
		collect: async () => { scans++; return report; },
		stderr: (text: string) => { stderr += text; },
		stdout: (text: string) => { stdout += text; },
	};
	t.is(await runStorageCli([], options), 1);
	t.regex(stderr, /--format json/);
	t.is(await runStorageCli(['--format', 'text'], options), 1);
	t.is(await runStorageCli(['--help'], options), 0);
	t.regex(stdout, /Usage: nanocoder storage/);
	t.is(scans, 0);
});

test('scanner errors return nonzero and do not emit partial JSON', async t => {
	let stderr = '';
	let stdout = '';
	const code = await runStorageCli(['--format=json'], {
		collect: async () => { throw new Error('permission denied'); },
		stderr: text => { stderr += text; },
		stdout: text => { stdout += text; },
	});
	t.is(code, 1);
	t.is(stdout, '');
	t.regex(stderr, /permission denied/);
});

test('CLI entry dispatches storage help and rejects non-TTY without chat startup', t => {
	const entry = fileURLToPath(new URL('../cli.tsx', import.meta.url));
	const help = spawnSync(process.execPath, ['--import', 'tsx', entry, 'storage', '--help'], {encoding: 'utf8'});
	t.is(help.status, 0);
	t.regex(help.stdout, /Usage: nanocoder storage/);
	t.is(help.stderr, '');
	const interactive = spawnSync(process.execPath, ['--import', 'tsx', entry, 'storage'], {encoding: 'utf8'});
	t.is(interactive.status, 1);
	t.regex(interactive.stderr, /--format json/);
	t.is(interactive.stdout, '');
});

test('real JSON CLI scans empty stores without creating them', t => {
	const root = mkdtempSync(join(tmpdir(), 'nanocoder-storage-cli-'));
	t.teardown(() => rmSync(root, {recursive: true, force: true}));
	const dataDir = join(root, 'data');
	const configDir = join(root, 'config');
	const entry = fileURLToPath(new URL('../cli.tsx', import.meta.url));
	const run = spawnSync(
		process.execPath,
		[
			'--import',
			fileURLToPath(import.meta.resolve('tsx')),
			entry,
			'storage',
			'--format',
			'json',
		],
		{
			encoding: 'utf8',
			cwd: root,
			env: {
				...process.env,
				NANOCODER_DATA_DIR: dataDir,
				NANOCODER_CONFIG_DIR: configDir,
				TSX_TSCONFIG_PATH: fileURLToPath(
					new URL('../../tsconfig.json', import.meta.url),
				),
			},
		},
	);
	t.is(run.status, 0, run.stderr);
	t.is(run.stderr, '');
	const report = JSON.parse(run.stdout) as StorageReport;
	t.is(report.projectRoot, realpathSync(root));
	t.is(report.sections.sessions.scope, 'global');
	t.is(report.sections.artifacts.scope, 'global');
	t.is(report.sections.timeline.scope, 'project');
	t.is(report.sections.checkpoints.scope, 'project');
	t.is(report.sections.artifacts.count, 0);
	t.false(existsSync(dataDir));
	t.false(existsSync(configDir));
	t.false(existsSync(join(root, '.nanocoder')));
});
