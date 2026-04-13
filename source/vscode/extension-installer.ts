/**
 * VS Code extension installation utilities
 */

import {execFile as execFileAsync, spawn} from 'child_process';
import {existsSync} from 'fs';
import {dirname, join} from 'path';
import {platform} from 'process';
import {fileURLToPath} from 'url';
import {promisify} from 'util';

const execFile = promisify(execFileAsync);
const __dirname = dirname(fileURLToPath(import.meta.url));
const isWindows = platform === 'win32';

/**
 * List of supported VS Code CLI executables (including forks).
 * These are known to support the --install-extension and --list-extensions CLI flags.
 */
export const SUPPORTED_CLIS = [
	'code',
	'code-insiders',
	'cursor',
	'codium',
	'vscodium',
	'windsurf',
	'trae',
	'positron',
];

/**
 * Interface for VS Code flavor status
 */
export interface VSCodeStatus {
	cli: string;
	available: boolean;
	extensionInstalled: boolean;
}

// Cache for available CLIs to avoid repeated slow PATH lookups
let cachedAvailableClis: string[] | null = null;

/**
 * Get the path to the bundled VSIX file
 */
export function getVsixPath(): string {
	// In development: assets folder is at project root
	// In production (npm install): assets folder is in package root
	const possiblePaths = [
		join(__dirname, '../../assets/nanocoder-vscode.vsix'), // development
		join(__dirname, '../../../assets/nanocoder-vscode.vsix'), // npm installed
	];

	for (const path of possiblePaths) {
		if (existsSync(path)) {
			return path;
		}
	}

	throw new Error('VS Code extension VSIX not found in package');
}

/**
 * Get all available VS Code (or fork) CLIs in the PATH.
 * Uses parallel async checks with timeouts for better performance.
 */
export async function getAvailableClis(
	forceRefresh = false,
): Promise<string[]> {
	if (cachedAvailableClis && !forceRefresh) {
		return cachedAvailableClis;
	}

	const results = await Promise.all(
		SUPPORTED_CLIS.map(async cli => {
			try {
				// Use a short timeout (2s) to avoid hanging on unresponsive executables
				// execFile without shell avoids shell interpretation on all platforms,
				// preventing command injection. cli is always from SUPPORTED_CLIS allowlist.
				await execFile(cli, ['--version'], {
					timeout: 2000,
				});
				return cli;
			} catch {
				return null;
			}
		}),
	);

	cachedAvailableClis = results.filter((cli): cli is string => cli !== null);
	return cachedAvailableClis;
}

/**
 * Check if any VS Code CLI is available
 */
export async function isVSCodeCliAvailable(): Promise<boolean> {
	const available = await getAvailableClis();
	return available.length > 0;
}

/**
 * Get detailed status for all supported VS Code flavors
 */
export async function getExtensionStatus(): Promise<VSCodeStatus[]> {
	const availableClis = await getAvailableClis();

	return Promise.all(
		availableClis.map(async cli => {
			try {
				// execFile without shell avoids shell interpretation on all platforms,
				// preventing command injection. cli is always from SUPPORTED_CLIS allowlist.
				const {stdout} = await execFile(cli, ['--list-extensions'], {
					timeout: 5000,
					encoding: 'utf-8',
				});

				const extensionInstalled = stdout
					.toLowerCase()
					.includes('nanocollective.nanocoder-vscode');

				return {
					cli,
					available: true,
					extensionInstalled,
				};
			} catch {
				return {
					cli,
					available: true,
					extensionInstalled: false,
				};
			}
		}),
	);
}

/**
 * Check if the nanocoder VS Code extension is installed in any available VS Code flavor
 * @deprecated Use getExtensionStatus() for richer information
 */
export async function isExtensionInstalled(): Promise<boolean> {
	const status = await getExtensionStatus();
	return status.some(s => s.extensionInstalled);
}

/**
 * Install the VS Code extension to a specific CLI
 */
async function installToCli(cli: string, vsixPath: string): Promise<boolean> {
	// Validate CLI is in the allowed list to prevent command injection
	// This check satisfies semgrep's detect-child-process rule
	if (!SUPPORTED_CLIS.includes(cli)) {
		return false;
	}

	return new Promise(resolve => {
		// nosemgrep
		const child = spawn(cli, ['--install-extension', vsixPath], {
			stdio: ['ignore', 'pipe', 'pipe'],
			...(isWindows && {shell: 'cmd.exe'}),
		});

		// Add a timeout for installation (30s)
		const timeout = setTimeout(() => {
			child.kill();
			resolve(false);
		}, 30000);

		child.on('close', code => {
			clearTimeout(timeout);
			resolve(code === 0);
		});

		child.on('error', () => {
			clearTimeout(timeout);
			resolve(false);
		});
	});
}

/**
 * Install the VS Code extension from the bundled VSIX to all or specific available VS Code flavors.
 * Returns a promise that resolves when installation is complete.
 */
export async function installExtension(targetClis?: string[]): Promise<{
	success: boolean;
	message: string;
	results: {cli: string; success: boolean}[];
}> {
	const availableClis = await getAvailableClis();
	const clisToInstall = targetClis
		? targetClis.filter(cli => availableClis.includes(cli))
		: availableClis;

	if (clisToInstall.length === 0) {
		const checkedList = SUPPORTED_CLIS.join(', ');
		return {
			success: false,
			message:
				`No supported VS Code flavor found. Checked: ${checkedList}\n\n` +
				"Please ensure your editor's CLI is in your PATH. To enable it:\n" +
				'  1. Open VS Code or your preferred editor\n' +
				'  2. Press Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux)\n' +
				'  3. Search for "Shell Command: Install \'code\' command in PATH"',
			results: [],
		};
	}

	try {
		const vsixPath = getVsixPath();
		const results = await Promise.all(
			clisToInstall.map(async cli => ({
				cli,
				success: await installToCli(cli, vsixPath),
			})),
		);

		const successful = results.filter(r => r.success);

		if (successful.length === 0) {
			return {
				success: false,
				message: `Failed to install extension to: ${clisToInstall.join(', ')}.`,
				results,
			};
		}

		const successMessage =
			successful.length === clisToInstall.length
				? `VS Code extension installed successfully for: ${successful
						.map(r => r.cli)
						.join(', ')}!`
				: `VS Code extension installed for: ${successful
						.map(r => r.cli)
						.join(', ')}. (Failed for: ${results
						.filter(r => !r.success)
						.map(r => r.cli)
						.join(', ')})`;

		return {
			success: true,
			message: `${successMessage} Please reload your editor to activate it.`,
			results,
		};
	} catch (error) {
		return {
			success: false,
			message: `Failed to install extension: ${
				error instanceof Error ? error.message : String(error)
			}`,
			results: [],
		};
	}
}
