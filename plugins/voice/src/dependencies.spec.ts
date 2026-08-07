import test from 'ava';
import { checkDependenciesInstalled, installDependencies } from './dependencies.js';

test('checkDependenciesInstalled returns true when all commands succeed', async (t) => {
	const mockChecker = async () => true;
	const result = await checkDependenciesInstalled(mockChecker);
	t.true(result.installed);
	t.is(result.missing.length, 0);
	t.true(result.details.sox);
	t.true(result.details.whisper);
	t.true(result.details.piper);
});

test('checkDependenciesInstalled identifies missing dependencies correctly', async (t) => {
	const mockChecker = async (cmd: string) => {
		if (cmd.includes('sox') || cmd.includes('rec')) return true;
		return false;
	};
	const result = await checkDependenciesInstalled(mockChecker);
	t.false(result.installed);
	t.deepEqual(result.missing, ['whisper', 'piper']);
	t.true(result.details.sox);
	t.false(result.details.whisper);
	t.false(result.details.piper);
});

test('installDependencies executes runner and reports progress', async (t) => {
	const executed: string[] = [];
	const progressLogs: { step: string; percent: number }[] = [];

	await installDependencies({
		onProgress: (step, percent) => {
			progressLogs.push({ step, percent });
		},
		installRunner: async (cmd: string, args: string[]) => {
			executed.push(cmd + ' ' + args.join(' '));
		},
	});

	t.true(executed.length > 0);
	t.true(progressLogs.length > 0);
	t.is(progressLogs.at(-1)?.percent, 100);
});

test('installDependencies handles non-root sudo error gracefully on Linux', async (t) => {
	if (process.platform !== 'linux') {
		t.pass();
		return;
	}

	await t.throwsAsync(
		async () => {
			await installDependencies({
				installRunner: async (cmd: string) => {
					if (cmd === 'sudo') {
						throw new Error('sudo: a password is required');
					}
				},
			});
		},
		{ message: /root\/sudo permissions required/i },
	);
});

test('installDependencies fails gracefully on error', async (t) => {
	await t.throwsAsync(
		async () => {
			await installDependencies({
				installRunner: async () => {
					throw new Error('Command failed');
				},
			});
		},
		{ message: /installation failed/i },
	);
});
