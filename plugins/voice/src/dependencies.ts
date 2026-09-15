import cp from 'node:child_process';
import crypto from 'node:crypto';
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import https from 'node:https';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { platform } from 'node:process';

export interface DependencyCheckResult {
	installed: boolean;
	missing: ('sox' | 'whisper' | 'piper')[];
	details: {
		sox: boolean;
		whisper: boolean;
		piper: boolean;
	};
}

export type DownloadFunction = (
	url: string,
	destPath: string,
	expectedSha256?: string,
) => Promise<void>;

export type ExecFunction = (command: string, args: string[]) => Promise<void>;

export interface InstallDependenciesOptions {
	onProgress?: (step: string, percent: number) => void;
	execRunner?: ExecFunction;
	downloadFn?: DownloadFunction;
	/** @deprecated Use execRunner / downloadFn instead */
	installRunner?: ExecFunction;
}

export type CommandChecker = (cmd: string, args?: string[]) => Promise<boolean>;

export const ASSET_CHECKSUMS: Record<string, string> = {
	'piper_macos_aarch64.tar.gz': '6b1eb03b3735946cb35216e063e7eebcc33a6bbf5dd96ec0217959bf1cdcb0cc',
	'piper_macos_x64.tar.gz': 'ced85c0a3df13945b1e623b878a48fdc2854d5c485b4b67f62857cf551deaf8b',
	'piper_linux_x86_64.tar.gz': 'a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992',
	'piper_linux_aarch64.tar.gz': 'fea0fd2d87c54dbc7078d0f878289f404bd4d6eea6e7444a77835d1537ab88eb',
	'piper_windows_amd64.zip': 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea',
	'en_US-lessac-medium.onnx': '5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f',
	'en_US-lessac-medium.onnx.json': 'efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0',
	'ggml-base.en.bin': 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
	'whisper-bin-x64.zip': 'b1514ebc099765e39fa37eb780b92a140a94c86bb0b3b3d98226b38825979732',
	'whisper-source-v1.8.2.tar.gz': 'bcee25589bb8052d9e155369f6759a05729a2022d2a8085c1aa4345108523077',
};

async function defaultCheckCommand(cmd: string, args: string[] = ['--version']): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const proc = cp.spawn(cmd, args, { stdio: 'ignore' });
			proc.on('close', (code) => resolve(code === 0));
			proc.on('error', () => resolve(false));
		} catch {
			resolve(false);
		}
	});
}

export function getConfigDir(): string {
	if (process.env.NANOCODER_CONFIG_DIR) {
		return process.env.NANOCODER_CONFIG_DIR;
	}
	let baseConfigPath: string;
	switch (process.platform) {
		case 'win32':
			baseConfigPath =
				process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
			break;
		case 'darwin':
			baseConfigPath = join(homedir(), 'Library', 'Preferences');
			break;
		default:
			baseConfigPath =
				process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
	}
	return join(baseConfigPath, 'nanocoder');
}

export function getVoiceBinDir(): string {
	return join(getConfigDir(), 'voice-bin');
}

/**
 * Checks whether sox, whisper-cli/whisper.cpp, and piper are available on the system or in voice-bin.
 */
export async function checkDependenciesInstalled(
	customCheck?: CommandChecker,
): Promise<DependencyCheckResult> {
	const check = customCheck || defaultCheckCommand;
	const binDir = getVoiceBinDir();

	const recCmd = process.env.REC_CMD || (platform === 'win32' ? 'sox' : 'rec');
	const whisperCmd = process.env.WHISPER_CMD || 'whisper-cli';
	const piperCmd = process.env.PIPER_CMD || 'piper';

	const winExt = platform === 'win32' ? '.exe' : '';

	const checkBinary = async (cmd: string, defaultArgs: string[]): Promise<boolean> => {
		const okSystem = await check(cmd, defaultArgs);
		if (okSystem) return true;

		const localBin = join(binDir, `${cmd}${winExt}`);
		if (existsSync(localBin)) {
			return check(localBin, defaultArgs);
		}

		if (cmd === 'whisper-cli') {
			const fallback1 = join(binDir, `whisper-cpp${winExt}`);
			const fallback2 = join(binDir, `whisper${winExt}`);
			if (existsSync(fallback1) && (await check(fallback1, defaultArgs))) return true;
			if (existsSync(fallback2) && (await check(fallback2, defaultArgs))) return true;
		}

		return false;
	};

	const [soxOk, whisperOk, piperOk] = await Promise.all([
		checkBinary(recCmd, platform === 'win32' ? ['--version'] : ['--help']),
		checkBinary(whisperCmd, ['--help']),
		checkBinary(piperCmd, ['--help']),
	]);

	const missing: ('sox' | 'whisper' | 'piper')[] = [];
	if (!soxOk) missing.push('sox');
	if (!whisperOk) missing.push('whisper');
	if (!piperOk) missing.push('piper');

	return {
		installed: missing.length === 0,
		missing,
		details: {
			sox: soxOk,
			whisper: whisperOk,
			piper: piperOk,
		},
	};
}

async function defaultExec(command: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = cp.spawn(command, args, { stdio: 'inherit' });
		proc.on('close', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`Command ${command} ${args.join(' ')} failed with exit code ${code}`));
		});
		proc.on('error', (err) => {
			reject(new Error(`Failed to execute ${command}: ${err.message}`));
		});
	});
}

export function defaultDownloadFile(
	url: string,
	destPath: string,
	expectedSha256?: string,
	maxRedirects = 5,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (maxRedirects <= 0) {
			return reject(new Error(`Too many redirects downloading ${url}`));
		}

		// Enforce HTTPS-only to prevent protocol downgrade attacks
		if (!url.startsWith('https://')) {
			return reject(new Error(`Insecure download protocol rejected: ${url} (must be https://)`));
		}

		const request = https.get(
			url,
			{ headers: { 'User-Agent': 'nanocoder-voice-installer' } },
			(response) => {
				if (
					response.statusCode === 301 ||
					response.statusCode === 302 ||
					response.statusCode === 307 ||
					response.statusCode === 308
				) {
					const redirectUrl = response.headers.location;
					if (!redirectUrl) {
						return reject(new Error(`Redirect without location header downloading ${url}`));
					}
					// Verify redirect target is also HTTPS
					const resolvedRedirect = new URL(redirectUrl, url).toString();
					if (!resolvedRedirect.startsWith('https://')) {
						return reject(new Error(`Insecure redirect downgrade rejected: ${resolvedRedirect}`));
					}
					return defaultDownloadFile(resolvedRedirect, destPath, expectedSha256, maxRedirects - 1)
						.then(resolve)
						.catch(reject);
				}

				if (response.statusCode !== 200) {
					return reject(new Error(`HTTP ${response.statusCode} downloading ${url}`));
				}

				const file = createWriteStream(destPath);
				const hash = crypto.createHash('sha256');

				response.on('data', (chunk) => {
					hash.update(chunk);
				});

				response.pipe(file);
				file.on('finish', () => {
					file.close(() => {
						if (expectedSha256) {
							const computedSha256 = hash.digest('hex');
							if (computedSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
								try { unlinkSync(destPath); } catch {}
								return reject(
									new Error(
										`SHA256 checksum mismatch for ${url}:\nExpected: ${expectedSha256}\nReceived: ${computedSha256}`,
									),
								);
							}
						}
						resolve();
					});
				});
				file.on('error', (err) => {
					try { unlinkSync(destPath); } catch {}
					reject(err);
				});
			},
		);

		request.on('error', (err) => {
			try { unlinkSync(destPath); } catch {}
			reject(err);
		});
	});
}

/**
 * Installs missing voice dependencies based on the host OS.
 */
export async function installDependencies(
	options: InstallDependenciesOptions = {},
): Promise<void> {
	const { onProgress, execRunner, installRunner, downloadFn = defaultDownloadFile } = options;
	const run = execRunner || installRunner || defaultExec;

	onProgress?.('Detecting system package manager...', 10);
	const binDir = getVoiceBinDir();

	if (!existsSync(binDir)) {
		mkdirSync(binDir, { recursive: true });
	}

	if (platform === 'darwin') {
		onProgress?.('Installing sox and whisper-cpp via Homebrew...', 30);
		try {
			await run('brew', ['install', 'sox', 'whisper-cpp']);
			onProgress?.('Homebrew packages installed successfully.', 50);
		} catch (err) {
			throw new Error('macOS installation failed: ' + (err instanceof Error ? err.message : String(err)));
		}

		onProgress?.('Fetching piper TTS binary & voice model...', 70);
		const piperBin = join(binDir, 'piper');
		const piperModel = join(binDir, 'en_US-lessac-medium.onnx');
		const piperConfig = join(binDir, 'en_US-lessac-medium.onnx.json');

		const isArm64 = process.arch === 'arm64';
		const piperAsset = isArm64 ? 'piper_macos_aarch64.tar.gz' : 'piper_macos_x64.tar.gz';
		const piperUrl = `https://github.com/rhasspy/piper/releases/download/2023.11.14-2/${piperAsset}`;
		const piperChecksum = ASSET_CHECKSUMS[piperAsset];

		const modelUrl = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx';
		const configUrl = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json';

		try {
			if (!existsSync(piperBin)) {
				const tarPath = join(binDir, 'piper.tar.gz');
				await downloadFn(piperUrl, tarPath, piperChecksum);
				await run('tar', ['-xzf', tarPath, '-C', binDir, '--strip-components=1']);
				try { unlinkSync(tarPath); } catch {}
				if (existsSync(piperBin)) {
					chmodSync(piperBin, 0o755);
				}
			}

			if (!existsSync(piperModel)) {
				await downloadFn(modelUrl, piperModel, ASSET_CHECKSUMS['en_US-lessac-medium.onnx']);
			}
			if (!existsSync(piperConfig)) {
				await downloadFn(configUrl, piperConfig, ASSET_CHECKSUMS['en_US-lessac-medium.onnx.json']);
			}
		} catch (err) {
			throw new Error(`macOS binary/model download failed: ${err instanceof Error ? err.message : String(err)}`);
		}
		onProgress?.('macOS voice setup complete.', 95);
	} else if (platform === 'linux') {
		onProgress?.('Installing sox via apt...', 30);
		try {
			const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
			if (isRoot) {
				await run('apt-get', ['update']);
				await run('apt-get', ['install', '-y', 'sox']);
			} else {
				try {
					await run('sudo', ['-n', 'apt-get', 'update']);
					await run('sudo', ['-n', 'apt-get', 'install', '-y', 'sox']);
				} catch {
					throw new Error(
						'Failed to install sox via apt-get: root/sudo permissions required. Please run manually: sudo apt install sox',
					);
				}
			}
			onProgress?.('sox installed successfully.', 45);
		} catch (err) {
			throw new Error('Linux installation failed for sox: ' + (err instanceof Error ? err.message : String(err)));
		}

		onProgress?.('Fetching whisper.cpp binary & ggml model...', 65);
		const whisperBin = join(binDir, 'whisper-cli');
		const whisperModel = join(binDir, 'ggml-base.en.bin');

		try {
			const modelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';
			if (!existsSync(whisperModel)) {
				await downloadFn(modelUrl, whisperModel, ASSET_CHECKSUMS['ggml-base.en.bin']);
			}

			if (!existsSync(whisperBin)) {
				// Build whisper.cpp from verified release source tarball
				const sourceTarUrl = 'https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.8.2.tar.gz';
				const sourceTarPath = join(binDir, 'whisper-source.tar.gz');
				await downloadFn(sourceTarUrl, sourceTarPath, ASSET_CHECKSUMS['whisper-source-v1.8.2.tar.gz']);
				const srcDir = join(binDir, 'whisper.cpp-1.8.2');
				await run('tar', ['-xzf', sourceTarPath, '-C', binDir]);
				try { unlinkSync(sourceTarPath); } catch {}

				try {
					await run('cmake', ['-B', join(srcDir, 'build'), srcDir, '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_EXAMPLES=ON']);
					await run('cmake', ['--build', join(srcDir, 'build'), '--config', 'Release', '--target', 'whisper-cli']);
					const builtBin = join(srcDir, 'build', 'bin', 'whisper-cli');
					if (existsSync(builtBin)) {
						await run('cp', [builtBin, whisperBin]);
						chmodSync(whisperBin, 0o755);
					}
				} catch {
					// Fallback to make if cmake not available
					await run('make', ['-C', srcDir, 'whisper-cli']);
					const builtBin = join(srcDir, 'whisper-cli');
					if (existsSync(builtBin)) {
						await run('cp', [builtBin, whisperBin]);
						chmodSync(whisperBin, 0o755);
					}
				}
			}
		} catch (err) {
			throw new Error(`Failed to set up whisper.cpp binary or model: ${err instanceof Error ? err.message : String(err)}`);
		}

		onProgress?.('Fetching piper TTS binary & voice model...', 85);
		const piperBin = join(binDir, 'piper');
		const piperModel = join(binDir, 'en_US-lessac-medium.onnx');
		const piperConfig = join(binDir, 'en_US-lessac-medium.onnx.json');

		const isArm64 = process.arch === 'arm64';
		const piperAsset = isArm64 ? 'piper_linux_aarch64.tar.gz' : 'piper_linux_x86_64.tar.gz';
		const piperUrl = `https://github.com/rhasspy/piper/releases/download/2023.11.14-2/${piperAsset}`;
		const piperChecksum = ASSET_CHECKSUMS[piperAsset];

		const piperModelUrl = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx';
		const piperConfigUrl = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json';

		try {
			if (!existsSync(piperBin)) {
				const tarPath = join(binDir, 'piper.tar.gz');
				await downloadFn(piperUrl, tarPath, piperChecksum);
				await run('tar', ['-xzf', tarPath, '-C', binDir, '--strip-components=1']);
				try { unlinkSync(tarPath); } catch {}
				if (existsSync(piperBin)) {
					chmodSync(piperBin, 0o755);
				}
			}

			if (!existsSync(piperModel)) {
				await downloadFn(piperModelUrl, piperModel, ASSET_CHECKSUMS['en_US-lessac-medium.onnx']);
			}
			if (!existsSync(piperConfig)) {
				await downloadFn(piperConfigUrl, piperConfig, ASSET_CHECKSUMS['en_US-lessac-medium.onnx.json']);
			}
		} catch (err) {
			throw new Error(`Failed to download piper binary or model: ${err instanceof Error ? err.message : String(err)}`);
		}
		onProgress?.('Linux voice setup complete.', 95);
	} else if (platform === 'win32') {
		onProgress?.('Attempting Windows installation via winget...', 30);
		let wingetSuccess = false;
		try {
			await run('winget', ['install', '--id', 'Sox.Sox', '-e', '--accept-source-agreements', '--accept-package-agreements']);
			wingetSuccess = true;
			onProgress?.('sox installed via winget.', 50);
		} catch {
			onProgress?.('winget unavailable or failed. Setting up sox binary...', 40);
		}

		if (!wingetSuccess) {
			const soxBin = join(binDir, 'sox.exe');
			if (!existsSync(soxBin)) {
				onProgress?.('Note: sox.exe required on Windows. Please install sox via winget or add to PATH.', 45);
			}
		}

		onProgress?.('Fetching whisper.cpp & piper Windows binaries...', 70);
		const whisperBin = join(binDir, 'whisper-cli.exe');
		const whisperModel = join(binDir, 'ggml-base.en.bin');
		const piperBin = join(binDir, 'piper.exe');
		const piperModel = join(binDir, 'en_US-lessac-medium.onnx');
		const piperConfig = join(binDir, 'en_US-lessac-medium.onnx.json');

		try {
			const modelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';
			const piperModelUrl = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx';
			const piperConfigUrl = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json';

			if (!existsSync(whisperModel)) {
				await downloadFn(modelUrl, whisperModel, ASSET_CHECKSUMS['ggml-base.en.bin']);
			}
			if (!existsSync(piperModel)) {
				await downloadFn(piperModelUrl, piperModel, ASSET_CHECKSUMS['en_US-lessac-medium.onnx']);
			}
			if (!existsSync(piperConfig)) {
				await downloadFn(piperConfigUrl, piperConfig, ASSET_CHECKSUMS['en_US-lessac-medium.onnx.json']);
			}

			const whisperZipUrl = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip';
			const piperZipUrl = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';

			if (!existsSync(whisperBin)) {
				const zipPath = join(binDir, 'whisper.zip');
				await downloadFn(whisperZipUrl, zipPath, ASSET_CHECKSUMS['whisper-bin-x64.zip']);
				await run('powershell', ['-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${binDir}" -Force`]);
				try { unlinkSync(zipPath); } catch {}
			}

			if (!existsSync(piperBin)) {
				const zipPath = join(binDir, 'piper.zip');
				await downloadFn(piperZipUrl, zipPath, ASSET_CHECKSUMS['piper_windows_amd64.zip']);
				await run('powershell', ['-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${binDir}" -Force`]);
				try { unlinkSync(zipPath); } catch {}
			}
		} catch (err) {
			throw new Error(`Windows binary/model download failed: ${err instanceof Error ? err.message : String(err)}`);
		}
		onProgress?.('Windows voice setup complete.', 95);
	} else {
		throw new Error('Unsupported platform for automatic voice dependency installation: ' + platform);
	}

	onProgress?.('Installation completed successfully.', 100);
}
