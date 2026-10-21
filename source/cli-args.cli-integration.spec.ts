import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'ava';

const cliPath = fileURLToPath(new URL('./cli.tsx', import.meta.url));

function runCli(args: string[]) {
	return spawnSync(process.execPath, ['--import=tsx', cliPath, ...args], {
		encoding: 'utf8',
		timeout: 15_000,
		env: {
			...process.env,
			NODE_DISABLE_COMPILE_CACHE: '1',
			TSX_DISABLE_CACHE: '1',
		},
	});
}

test('unknown top-level flags and commands fail before the app starts', t => {
	const cases = [
		{
			args: ['--mdoe', 'plan', 'run', 'do a task'],
			error: 'Did you mean "--mode"?',
		},
		{
			args: ['--bogusflag', 'run', 'do a task'],
			error: 'Unknown option "--bogusflag".',
		},
		{
			args: ['reveiw', 'main'],
			error: 'Did you mean "review"?',
		},
		{
			args: ['conifg', 'list'],
			error: 'Did you mean "config"?',
		},
		{args: ['fix the tests'], error: 'Unknown command "fix the tests".'},
	];

	for (const {args, error} of cases) {
		const result = runCli(args);
		t.is(result.status, 1, result.stderr);
		t.true(result.stderr.includes(error), result.stderr);
		t.is(result.stdout, '');
	}
});
