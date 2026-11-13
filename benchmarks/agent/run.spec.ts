import {spawn} from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'ava';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../..',
);

for (const [signal, exitCode] of [
	['SIGINT', 130],
	['SIGTERM', 143],
	['SIGHUP', 129],
] as const) {
	test.serial(`runner cleans its workspace on ${signal}`, async t => {
		const tempRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), 'agent-eval-runner-signal-'),
		);
		const startedPath = path.join(tempRoot, 'started');
		const cliPath = path.join(tempRoot, 'stub-cli.js');
		await fs.writeFile(
			cliPath,
			`import {writeFileSync} from 'node:fs';
writeFileSync(process.env.AGENT_EVAL_RUN_MARKER, process.cwd());
setInterval(() => {}, 1000);
`,
		);

		const runner = spawn(
			process.execPath,
			[
				'--import=tsx',
				path.join(repoRoot, 'benchmarks/agent/run.ts'),
				'--cli',
				cliPath,
				'--fixture',
				'single-file-edit',
				'--runs',
				'1',
				'--out',
				path.join(tempRoot, 'results.json'),
			],
			{
				cwd: repoRoot,
				env: {
					PATH: process.env.PATH,
					HOME: tempRoot,
					TMPDIR: os.tmpdir(),
					NODE_ENV: 'test',
					AGENT_EVAL_RUN_MARKER: startedPath,
				},
				stdio: ['ignore', 'ignore', 'pipe'],
			},
		);
		let stderr = '';
		runner.stderr?.setEncoding('utf8').on('data', chunk => {
			stderr += chunk;
		});
		const exited = new Promise<{
			code: number | null;
			signal: NodeJS.Signals | null;
		}>((resolve, reject) => {
			runner.once('error', reject);
			runner.once('exit', (code, signal) => resolve({code, signal}));
		});

		let workspace: string | undefined;
		try {
			const deadline = Date.now() + 10_000;
			while (!workspace && Date.now() < deadline) {
				try {
					workspace = await fs.readFile(startedPath, 'utf8');
				} catch {
					if (runner.exitCode !== null) {
						throw new Error(
							`runner exited before the stub CLI started (${runner.exitCode}): ${stderr}`,
						);
					}
					await new Promise(resolve => setTimeout(resolve, 20));
				}
			}
			t.truthy(workspace, 'the stub CLI started');
			runner.kill(signal);
			const result = await exited;

			t.is(result.code, exitCode, stderr);
			t.truthy(workspace);
			if (workspace) {
				await t.throwsAsync(() => fs.stat(workspace), {code: 'ENOENT'});
			}
		} finally {
			if (runner.exitCode === null) {
				runner.kill('SIGKILL');
				await exited;
			}
			if (workspace) {
				await fs.rm(workspace, {recursive: true, force: true});
			}
			await fs.rm(tempRoot, {recursive: true, force: true});
		}
	});
}
