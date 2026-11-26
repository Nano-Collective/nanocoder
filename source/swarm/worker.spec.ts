import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type ExecutionContext} from 'ava';
import {runWorker, type WorkerEvent} from './worker';

function fakeCli(t: ExecutionContext, source: string) {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-worker-'));
	t.teardown(() => rmSync(dir, {recursive: true, force: true}));
	const cliPath = join(dir, 'cli.cjs');
	writeFileSync(cliPath, source);
	const events: WorkerEvent[] = [];
	return {
		dir,
		events,
		options: {
			cliPath,
			cliArgs: [],
			cwd: dir,
			logPath: join(dir, 'worker.log'),
			reportPath: join(dir, 'report.json'),
			signal: new AbortController().signal,
			onEvent: (event: WorkerEvent) => events.push(event),
		},
	};
}

test('reads telemetry and the report, with stdin already closed', async t => {
	const {options, events} = fakeCli(
		t,
		`process.stdin.resume();
		process.stdin.on('end', () => {
			process.stderr.write('{"type":"turn"}\\n{"type":"tool","tool":"read_file"}\\nplain log line\\n');
			process.stdout.write(JSON.stringify({kind: 'success', usage: {totalTokens: 42}}, null, 2));
		});
		if (process.stdin.readableEnded) process.exit(2);`,
	);

	t.deepEqual(await runWorker(options), {tokens: 42});
	t.deepEqual(events, [{type: 'turn'}, {type: 'tool', tool: 'read_file'}]);
	t.is(readFileSync(options.logPath, 'utf-8'), 'plain log line\n');
});

test('reports why a worker failed', async t => {
	const {options} = fakeCli(
		t,
		`process.stdout.write(JSON.stringify({kind: 'error', message: 'rate limited'}, null, 2));
		process.exitCode = 1;`,
	);

	await t.throwsAsync(runWorker(options), {message: /rate limited \(log: /});
});

test('treats output without a report as a failure', async t => {
	const {options} = fakeCli(t, `process.stdout.write('hello');`);

	await t.throwsAsync(runWorker(options), {message: /exit code 0/});
});

test('aborting kills the worker and the processes it started', async t => {
	if (process.platform === 'win32') {
		t.pass();
		return;
	}
	const {options, dir} = fakeCli(
		t,
		`const {spawn} = require('node:child_process');
		process.on('SIGTERM', () => {});
		const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], {stdio: 'ignore'});
		require('node:fs').writeFileSync('grandchild.pid', String(child.pid));
		process.stderr.write('{"type":"turn"}\\n');
		setInterval(() => {}, 1000);`,
	);
	const abort = new AbortController();

	await t.throwsAsync(
		runWorker({
			...options,
			signal: abort.signal,
			onEvent: () => abort.abort(),
		}),
		{name: 'AbortError'},
	);

	const pid = Number(readFileSync(join(dir, 'grandchild.pid'), 'utf-8'));
	await new Promise(resolve => setTimeout(resolve, 500));
	t.throws(() => process.kill(pid, 0), {message: /ESRCH/});
});
