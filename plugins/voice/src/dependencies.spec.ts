import test from 'ava';
import {
	checkDependenciesInstalled,
	installDependencies,
	ASSET_CHECKSUMS,
	getVoiceBinDir,
	getConfigDir,
} from './dependencies.js';

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

test('getVoiceBinDir respects NANOCODER_CONFIG_DIR environment variable', (t) => {
	const original = process.env.NANOCODER_CONFIG_DIR;
	try {
		process.env.NANOCODER_CONFIG_DIR = '/custom/config/dir';
		t.is(getConfigDir(), '/custom/config/dir');
		t.true(getVoiceBinDir().startsWith('/custom/config/dir'));
	} finally {
		if (original !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = original;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
	}
});

test('ASSET_CHECKSUMS contains non-empty valid sha256 hashes for all required assets', (t) => {
	const requiredAssets = [
		'piper_macos_aarch64.tar.gz',
		'piper_macos_x64.tar.gz',
		'piper_linux_x86_64.tar.gz',
		'piper_linux_aarch64.tar.gz',
		'piper_windows_amd64.zip',
		'en_US-lessac-medium.onnx',
		'en_US-lessac-medium.onnx.json',
		'ggml-base.en.bin',
		'whisper-bin-x64.zip',
		'whisper-source-v1.8.2.tar.gz',
	];

	for (const asset of requiredAssets) {
		const hash = ASSET_CHECKSUMS[asset];
		t.truthy(hash, `Checksum must exist for ${asset}`);
		t.is(hash.length, 64, `Checksum for ${asset} must be a 64-char hex SHA256 string`);
		t.regex(hash, /^[a-f0-9]{64}$/i, `Checksum for ${asset} must be hex`);
	}
});

test('installDependencies exercises real URL construction and SHA256 verification', async (t) => {
	const downloaded: { url: string; destPath: string; expectedSha256?: string }[] = [];
	const executed: string[] = [];
	const progressLogs: { step: string; percent: number }[] = [];

	const mockDownloadFn = async (url: string, destPath: string, expectedSha256?: string) => {
		downloaded.push({ url, destPath, expectedSha256 });
	};

	const mockExecRunner = async (cmd: string, args: string[]) => {
		executed.push(`${cmd} ${args.join(' ')}`);
	};

	await installDependencies({
		onProgress: (step, percent) => {
			progressLogs.push({ step, percent });
		},
		downloadFn: mockDownloadFn,
		execRunner: mockExecRunner,
	});

	// Verify progress was logged and reached 100%
	t.true(progressLogs.length > 0);
	t.is(progressLogs.at(-1)?.percent, 100);

	// Verify downloads happened through real URL construction
	t.true(downloaded.length > 0, 'Downloads must be triggered with constructed URLs');
	for (const item of downloaded) {
		t.true(item.url.startsWith('https://'), `Downloaded URL must be HTTPS: ${item.url}`);
		t.truthy(item.expectedSha256, `Downloaded URL must have a pinned SHA256: ${item.url}`);
		t.is(item.expectedSha256?.length, 64);
	}
});

test('installDependencies handles non-root sudo error gracefully on Linux', async (t) => {
	if (process.platform !== 'linux') {
		t.pass();
		return;
	}

	await t.throwsAsync(
		async () => {
			await installDependencies({
				execRunner: async (cmd: string) => {
					if (cmd === 'sudo') {
						throw new Error('sudo: a password is required');
					}
				},
				downloadFn: async () => {},
			});
		},
		{ message: /root\/sudo permissions required/i },
	);
});

test('installDependencies fails gracefully on download failure', async (t) => {
	await t.throwsAsync(
		async () => {
			await installDependencies({
				execRunner: async () => {},
				downloadFn: async () => {
					throw new Error('SHA256 checksum mismatch');
				},
			});
		},
		{ message: /failed/i },
	);
});
