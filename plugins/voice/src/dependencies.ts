import cp from 'node:child_process';
import { platform } from 'node:process';
import { existsSync, mkdirSync, createWriteStream, unlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import http from 'node:http';
import https from 'node:https';

export interface DependencyCheckResult {
	installed: boolean;
	missing: ('sox' | 'whisper' | 'piper')[];
	details: {
		sox: boolean;
		whisper: boolean;
		piper: boolean;
	};
}

export interface InstallDependenciesOptions {
	onProgress?: (step: string, percent: number) => void;
	installRunner?: (command: string, args: string[]) => Promise<void>;
}

export type CommandChecker = (cmd: string, args?: string[]) => Promise<boolean>;

async function defaultCheckCommand(cmd: string, args: string[] = ['--version']): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const proc = cp.spawn(cmd, args, { stdio: 'ignore' });
			proc.on('close', (code) => resolve(code === 0 || code === null));
			proc.on('error', () => resolve(false));
		} catch {
			resolve(false);
		}
	});
}

export function getVoiceBinDir(): string {
	return join(homedir(), '.nanocoder', 'voice-bin');
}

/**
 * Checks whether sox, whisper-cli/whisper.cpp, and piper are available on the system or in ~/.nanocoder/voice-bin.
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

function downloadFile(url: string, destPath: string, maxRedirects = 5): Promise<void> {
	return new Promise((resolve, reject) => {
		if (maxRedirects <= 0) {
			return reject(new Error(`Too many redirects downloading ${url}`));
		}

		const client = url.startsWith('https') ? https : http;
		const request = client.get(
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
					return downloadFile(redirectUrl, destPath, maxRedirects - 1)
						.then(resolve)
						.catch(reject);
				}

				if (response.statusCode !== 200) {
					return reject(new Error(`HTTP ${response.statusCode} downloading ${url}`));
				}

				const file = createWriteStream(destPath);
				response.pipe(file);
				file.on('finish', () => {
					file.close(() => resolve());
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
	const { onProgress, installRunner } = options;
	const run = installRunner || defaultExec;

	onProgress?.('Detecting system package manager...', 10);
	const binDir = getVoiceBinDir();

	if (!existsSync(binDir)) {
		mkdirSync(binDir, { recursive: true });
	}

	if (platform === 'darwin') {
		onProgress?.('Installing sox, whisper-cpp, and piper via Homebrew...', 30);
		try {
			await run('brew', ['install', 'sox', 'whisper-cpp', 'piper']);
			onProgress?.('Homebrew packages installed successfully.', 90);
		} catch (err) {
			throw new Error('macOS installation failed: ' + (err instanceof Error ? err.message : String(err)));
		}
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

		onProgress?.('Fetching real whisper.cpp binary & ggml model...', 65);
		const whisperBin = join(binDir, 'whisper-cli');
		const whisperModel = join(binDir, 'ggml-base.en.bin');

		if (installRunner) {
			await run('download-whisper', ['linux']);
		} else {
			try {
				const whisperUrl = 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.4/whisper-cli-linux-x64';
				const modelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';

				if (!existsSync(whisperBin)) {
					await downloadFile(whisperUrl, whisperBin);
					chmodSync(whisperBin, 0o755);
				}
				if (!existsSync(whisperModel)) {
					await downloadFile(modelUrl, whisperModel);
				}
			} catch (err) {
				throw new Error(`Failed to download whisper.cpp binary or model: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		onProgress?.('Fetching real piper TTS binary & voice model...', 85);
		const piperBin = join(binDir, 'piper');
		const piperModel = join(binDir, 'en_US-lessac-medium.onnx');
		const piperConfig = join(binDir, 'en_US-lessac-medium.onnx.json');

		if (installRunner) {
			await run('download-piper', ['linux']);
		} else {
			try {
				const piperUrl = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz';
				const modelUrl = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx';
				const configUrl = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json';

				if (!existsSync(piperBin)) {
					const tarPath = join(binDir, 'piper.tar.gz');
					await downloadFile(piperUrl, tarPath);
					await run('tar', ['-xzf', tarPath, '-C', binDir, '--strip-components=1']);
					try { unlinkSync(tarPath); } catch {}
					if (existsSync(piperBin)) {
						chmodSync(piperBin, 0o755);
					}
				}

				if (!existsSync(piperModel)) {
					await downloadFile(modelUrl, piperModel);
				}
				if (!existsSync(piperConfig)) {
					await downloadFile(configUrl, piperConfig);
				}
			} catch (err) {
				throw new Error(`Failed to download piper binary or model: ${err instanceof Error ? err.message : String(err)}`);
			}
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
			if (installRunner) {
				await run('download-sox', ['windows']);
			} else {
				throw new Error('sox installation required on Windows. Please install sox via winget or add to PATH.');
			}
		}

		onProgress?.('Fetching real whisper.cpp & piper Windows binaries...', 70);
		const whisperBin = join(binDir, 'whisper-cli.exe');
		const whisperModel = join(binDir, 'ggml-base.en.bin');
		const piperBin = join(binDir, 'piper.exe');
		const piperModel = join(binDir, 'en_US-lessac-medium.onnx');
		const piperConfig = join(binDir, 'en_US-lessac-medium.onnx.json');

		if (installRunner) {
			await run('download-whisper', ['windows']);
			await run('download-piper', ['windows']);
		} else {
			try {
				const modelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';
				const piperModelUrl = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx';
				const piperConfigUrl = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json';

				if (!existsSync(whisperModel)) {
					await downloadFile(modelUrl, whisperModel);
				}
				if (!existsSync(piperModel)) {
					await downloadFile(piperModelUrl, piperModel);
				}
				if (!existsSync(piperConfig)) {
					await downloadFile(piperConfigUrl, piperConfig);
				}

				const whisperZipUrl = 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.4/whisper-cli-win-x64.zip';
				const piperZipUrl = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';

				if (!existsSync(whisperBin)) {
					const zipPath = join(binDir, 'whisper.zip');
					await downloadFile(whisperZipUrl, zipPath);
					await run('powershell', ['-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${binDir}" -Force`]);
					try { unlinkSync(zipPath); } catch {}
				}

				if (!existsSync(piperBin)) {
					const zipPath = join(binDir, 'piper.zip');
					await downloadFile(piperZipUrl, zipPath);
					await run('powershell', ['-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${binDir}" -Force`]);
					try { unlinkSync(zipPath); } catch {}
				}
			} catch (err) {
				throw new Error(`Windows binary/model download failed: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		onProgress?.('Windows voice setup complete.', 95);
	} else {
		throw new Error('Unsupported platform for automatic voice dependency installation: ' + platform);
	}

	onProgress?.('Installation completed successfully.', 100);
}
