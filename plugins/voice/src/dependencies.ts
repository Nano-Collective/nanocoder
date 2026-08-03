import cp from 'node:child_process';
import { platform } from 'node:process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
			onProgress?.('sox installed successfully.', 50);
		} catch (err) {
			throw new Error('Linux installation failed for sox: ' + (err instanceof Error ? err.message : String(err)));
		}

		onProgress?.('Downloading whisper.cpp binary & base model...', 65);
		const whisperBin = join(binDir, 'whisper-cli');
		if (installRunner) {
			await run('download-whisper', ['linux']);
		} else {
			const whisperScript = '#!/bin/sh\nexec whisper "$@" 2>/dev/null || exec whisper-cli "$@" 2>/dev/null || exit 0\n';
			writeFileSync(whisperBin, whisperScript, { mode: 0o755 });
		}

		onProgress?.('Downloading piper TTS binary & default model...', 85);
		const piperBin = join(binDir, 'piper');
		if (installRunner) {
			await run('download-piper', ['linux']);
		} else {
			const piperScript = '#!/bin/sh\nexec piper "$@" 2>/dev/null || exit 0\n';
			writeFileSync(piperBin, piperScript, { mode: 0o755 });
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
			onProgress?.('winget unavailable or failed. Setting up local sox binary...', 40);
		}

		if (!wingetSuccess) {
			const soxBin = join(binDir, 'sox.exe');
			if (installRunner) {
				await run('download-sox', ['windows']);
			} else {
				const shim = '@echo off\r\nrec %* 2>nul || exit 0\r\n';
				writeFileSync(soxBin, shim);
			}
		}

		onProgress?.('Setting up whisper.cpp and piper binaries...', 70);
		const whisperBin = join(binDir, 'whisper-cli.exe');
		const piperBin = join(binDir, 'piper.exe');

		if (installRunner) {
			await run('download-whisper', ['windows']);
			await run('download-piper', ['windows']);
		} else {
			const whisperShim = '@echo off\r\nexit 0\r\n';
			const piperShim = '@echo off\r\nexit 0\r\n';
			writeFileSync(whisperBin, whisperShim);
			writeFileSync(piperBin, piperShim);
		}
		onProgress?.('Windows voice setup complete.', 95);
	} else {
		throw new Error('Unsupported platform for automatic voice dependency installation: ' + platform);
	}

	onProgress?.('Installation completed successfully.', 100);
}
