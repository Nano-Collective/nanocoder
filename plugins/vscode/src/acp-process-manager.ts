import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import {existsSync} from 'node:fs';
import {ClientSideConnection, ndJsonStream} from '@agentclientprotocol/sdk';
import {AcpStateManager, ACPStatus} from './acp-state';
import {NanocoderAcpClient} from './acp-client';
import {findCliPath, nodeExistsAlongside, promptInstallCli, resolveSpawnEnv} from './cli-discovery';
import {planCliSpawn} from './cli-path-discovery';
import {acpCliArgs, resolveExtensionCwd} from './workspace-utils';

/**
 * `nanocoder --acp` exits with this code when it refuses an untrusted folder
 * (see source/acp/acp-server.ts). Retrying cannot fix that, so it is handled
 * as a trust prompt instead of a crash.
 */
export const ACP_TRUST_REFUSED_EXIT_CODE = 3;

/** What `nanocoder trust --status --json` prints. */
interface TrustStatusReport {
	path: string;
	status: 'trusted' | 'not-trusted' | 'changed' | 'needs-re-approval';
	summary: string | null;
	fingerprint: string;
}

/** Where and how the last launch spawned the CLI, reused for `nanocoder trust`. */
interface CliLaunchContext {
	cliPath: string;
	env: NodeJS.ProcessEnv;
	cwd: string | undefined;
}

interface CliRunResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

function parseTrustStatus(stdout: string): TrustStatusReport | null {
	try {
		const parsed = JSON.parse(stdout) as Partial<TrustStatusReport>;
		if (typeof parsed.fingerprint !== 'string' || typeof parsed.status !== 'string') {
			return null;
		}
		return {
			path: typeof parsed.path === 'string' ? parsed.path : '',
			status: parsed.status,
			summary: typeof parsed.summary === 'string' ? parsed.summary : null,
			fingerprint: parsed.fingerprint,
		};
	} catch {
		return null;
	}
}

export class AcpProcessManager {
	private childProcess: cp.ChildProcess | null = null;
	private outputChannel: vscode.OutputChannel;
	private stateManager: AcpStateManager;
	private acpClient: NanocoderAcpClient;

	private retryCount = 0;
	private maxRetries = 5;
	private isDisposed = false;
	private lastStderr = '';
	private retryTimer: NodeJS.Timeout | null = null;
	private currentLaunch: Promise<void> | null = null;
	private hasStarted = false;
	private launchContext: CliLaunchContext | null = null;

	constructor(outputChannel: vscode.OutputChannel, stateManager: AcpStateManager, acpClient: NanocoderAcpClient) {
		this.outputChannel = outputChannel;
		this.stateManager = stateManager;
		this.acpClient = acpClient;
	}

	/**
	 * Start the agent process unless this manager already has. The extension
	 * spawns `nanocoder --acp` lazily, the first time something needs it (the
	 * chat view opening), so this is safe to call from every such path; crash
	 * retries and a manual restart go through {@link start} instead.
	 *
	 * Resolves when the launch this call started (or joined) finishes, or at
	 * once when the process was started earlier.
	 */
	ensureStarted(): Promise<void> {
		if (!this.hasStarted) {
			return this.start();
		}
		return this.currentLaunch ?? Promise.resolve();
	}

	async start(): Promise<void> {
		// Refuse to start a disposed manager: a retry timer scheduled before
		// dispose() can still fire here and would overwrite the new manager's
		// acpClient.connection.
		if (this.isDisposed) {
			return;
		}
		this.hasStarted = true;
		if (this.currentLaunch) {
			return this.currentLaunch;
		}
		this.currentLaunch = this._runLaunch();
		return this.currentLaunch;
	}

	private async _runLaunch(): Promise<void> {
		try {
			await this.launch();
		} catch (error) {
			if (this.isDisposed) {
				this.outputChannel.appendLine(`ACP launch aborted after dispose: ${error}`);
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			this.outputChannel.appendLine(`Failed to start ACP process: ${message}`);
			this.stateManager.setStatus(ACPStatus.Failed, {reason: message});
			vscode.window.showErrorMessage(
				`Could not start the Nanocoder CLI: ${message}. See the Nanocoder output channel for details.`
			);
		} finally {
			this.currentLaunch = null;
		}
	}

	private async launch(): Promise<void> {
		if (this.isDisposed) {
			return;
		}
		this.stateManager.setStatus(ACPStatus.Starting);

		const config = vscode.workspace.getConfiguration('nanocoder');
		const configuredCliPath = config.get<string>('cliPath');
		let cliPath: string | undefined;
		if (configuredCliPath) {
			if (existsSync(configuredCliPath)) {
				cliPath = configuredCliPath;
			} else {
				this.outputChannel.appendLine(
					`WARNING: nanocoder.cliPath "${configuredCliPath}" does not exist. Falling back to PATH discovery.`
				);
				cliPath = (await findCliPath()) ?? undefined;
			}
		} else {
			cliPath = (await findCliPath()) ?? undefined;
		}

		if (!cliPath) {
			this.stateManager.setStatus(ACPStatus.CliMissing, {
				reason: 'nanocoder CLI was not found on PATH',
			});
			this.outputChannel.appendLine('Nanocoder CLI not found in PATH.');
			await promptInstallCli();
			return;
		}

		const acpArgs = acpCliArgs();
		this.outputChannel.appendLine(`Starting ACP process: ${cliPath} ${acpArgs.join(' ')}`);
		// Spawn with the login shell's PATH so the CLI's `#!/usr/bin/env node`
		// shebang (and the dev-fallback `node`) resolve the same node the user
		// gets in a terminal, not launchd's - which may be an older install.
		// Run in the workspace folder: the extension host's own cwd is `/`,
		// which is unwritable and crashes the CLI's startup (.nanocoder dir).
		const env = await resolveSpawnEnv();
		// When the CLI was found via the filesystem fallback (not the login-shell
		// PATH and not the `node <script>` dev form), prepend its directory to PATH
		// only if `node` actually lives there. This lets the shebang find the right
		// Node binary without shadowing a user's nvm/volta node when the CLI is in
		// a plain system prefix like /usr/local/bin that has no co-located node.
		if (!cliPath.startsWith('node ') && nodeExistsAlongside(cliPath)) {
			const cliDir = path.dirname(cliPath);
			env.PATH = env.PATH ? `${cliDir}${path.delimiter}${env.PATH}` : cliDir;
		}
		
		// Fallbacks: configured cwd -> workspace folder -> user homedir -> process cwd
		const cwdSetting = resolveExtensionCwd();
		// On Windows the discovered path is usually an npm/pnpm shim, which
		// cannot be spawned directly - see planCliSpawn.
		const plan = planCliSpawn(cliPath, acpArgs);
		if (plan.command !== cliPath) {
			this.outputChannel.appendLine(
				`Resolved launch command: ${plan.command} ${plan.args.join(' ')}${plan.shell ? ' (via shell)' : ''}`
			);
		}
		this.launchContext = {cliPath, env, cwd: cwdSetting};
		const spawnOptions: cp.SpawnOptions = { shell: plan.shell, env, cwd: cwdSetting };
		this.childProcess = cp.spawn(plan.command, plan.args, spawnOptions);

		if (!this.childProcess.stdout || !this.childProcess.stdin) {
			this.outputChannel.appendLine('Failed to attach to child process stdio.');
			this.stateManager.setStatus(ACPStatus.Failed, {
				reason: 'could not attach to the CLI process stdio',
			});
			return;
		}

		// Log stderr from the CLI for debugging; keep a tail for error dialogs
		this.childProcess.stderr?.on('data', (data) => {
			const text = data.toString();
			this.outputChannel.append(`[CLI stderr] ${text}`);
			this.lastStderr = (this.lastStderr + text).slice(-500);
		});

		// A single child can fail in several ways (spawn error, exit, failed
		// handshake) - count it as one crash so retries aren't double-burned.
		const child = this.childProcess;
		let crashReported = false;
		const reportCrash = (exitCode?: number | null) => {
			if (crashReported || this.isDisposed) return;
			crashReported = true;
			this.handleCrash(exitCode);
		};

		child.on('error', (err) => {
			this.outputChannel.appendLine(`ACP process error: ${err.message}`);
			reportCrash();
		});

		child.on('exit', (code, signal) => {
			this.outputChannel.appendLine(`ACP process exited with code ${code} signal ${signal}`);
			reportCrash(code);
		});

		// Closures capture the local `child`, not `this.childProcess`, so a
		// late `data` event after dispose() cannot NPE on the nulled field.
		const input = new ReadableStream<Uint8Array>({
			start: (controller) => {
				child.stdout!.on('data', (chunk: Buffer) => {
					controller.enqueue(new Uint8Array(chunk));
				});
				child.stdout!.on('end', () => controller.close());
				child.stdout!.on('error', (err) => controller.error(err));
			}
		});

		const output = new WritableStream<Uint8Array>({
			write: (chunk) => {
				child.stdin!.write(chunk);
			},
			abort: (reason) => {
				this.outputChannel.appendLine(`Stream output aborted: ${reason}`);
			}
		});

		const stream = ndJsonStream(output, input);
		const connection = new ClientSideConnection((conn) => ({
			sessionUpdate: async (params: any) => {
				if (this.acpClient?.onSessionUpdate) {
					this.acpClient.onSessionUpdate(params);
				}
			},
			requestPermission: async (params: any) => {
				return this.acpClient.handlePermissionRequest(params);
			},
			extNotification: async (method: string, params: any) => {
				return this.acpClient.handleExtNotification(method, params);
			}
		} as any), stream);

		await this._installConnection(child, connection, reportCrash);
	}

	/**
	 * Install a fresh connection on the shared acpClient and await the
	 * handshake, checking `isDisposed` before each shared-state write so a
	 * Restart that lands during spawn or during the handshake round-trip
	 * cannot overwrite the new manager's connection or reset its retry counter.
	 */
	private async _installConnection(
		child: cp.ChildProcess,
		connection: ClientSideConnection,
		reportCrash: (exitCode?: number | null) => void,
	): Promise<void> {
		if (this.isDisposed) {
			child.kill();
			return;
		}
		this.acpClient.setConnection(connection);
		const initialized = await this.acpClient.initializeHandshake();

		if (this.isDisposed) {
			child.kill();
			return;
		}

		if (initialized) {
			this.retryCount = 0; // Reset retries on successful connection
		} else if (this.stateManager.status !== ACPStatus.VersionMismatch) {
			// Failed handshake: count one crash, and kill the child if it is
			// still alive. A CLI that is exiting on its own (a trust refusal
			// closes stdout, failing the handshake, just before it exits 3) gets
			// a moment to do so, because the exit code decides whether this is a
			// crash to retry or a trust prompt. The exit event reports it; the
			// fallback covers an exit that never arrives, and if the exit already
			// fired, reportCrash's guard absorbs both timers.
			const killTimer = setTimeout(() => child.kill(), 500);
			const fallback = setTimeout(() => reportCrash(child.exitCode), 3000);
			killTimer.unref?.();
			fallback.unref?.();
			child.once('exit', () => {
				clearTimeout(killTimer);
				clearTimeout(fallback);
			});
		}
	}

	private handleCrash(exitCode?: number | null) {
		if (this.isDisposed || this.stateManager.status === ACPStatus.VersionMismatch) return;

		if (exitCode === ACP_TRUST_REFUSED_EXIT_CODE) {
			this.handleTrustRefusal();
			return;
		}

		if (this.retryCount < this.maxRetries) {
			const delay = this.retryCount === 0 ? 0 : Math.min(1000 * Math.pow(2, this.retryCount - 1), 10000); // Immediate first retry, then backoff
			this.retryCount++;
			this.stateManager.setStatus(ACPStatus.Restarting, {
				attempt: this.retryCount,
				totalAttempts: this.maxRetries,
			});
			this.outputChannel.appendLine(`ACP process crashed. Restarting in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`);

			this.retryTimer = setTimeout(() => {
				this.retryTimer = null;
				if (this.isDisposed) return;
				void this.start();
			}, delay);
		} else {
			const lastError = this.lastStderr.trim().split('\n').pop();
			this.stateManager.setStatus(ACPStatus.Failed, {
				reason: lastError || 'repeated crashes',
			});
			this.outputChannel.appendLine('Max retries reached. ACP process will not restart automatically.');
			vscode.window.showErrorMessage(
				`Nanocoder CLI crashed repeatedly and could not be restarted.${lastError ? ` Last error: ${lastError}` : ''} See the Nanocoder output channel for details.`
			);
		}
	}

	/**
	 * The CLI refused the folder because it is not trusted. Every retry would be
	 * refused the same way, so stop and ask the user instead.
	 */
	private handleTrustRefusal(): void {
		const reason = this.lastStderr.trim().split('\n').pop() || 'folder is not trusted';
		this.retryCount = 0;
		this.stateManager.setStatus(ACPStatus.Untrusted, {reason});
		this.outputChannel.appendLine('ACP process refused to start: the folder is not trusted. Not restarting.');
		void this.promptForTrust();
	}

	/**
	 * Show what the folder will run (`nanocoder trust --status --json`, which
	 * loads nothing from it) and, if the user agrees, save trust for exactly the
	 * fingerprint shown (`nanocoder trust --grant`), then start again.
	 */
	private async promptForTrust(): Promise<void> {
		const report = await this.readTrustStatus();
		if (this.isDisposed) return;

		if (!report) {
			const action = await vscode.window.showWarningMessage(
				'Nanocoder did not start because this folder is not trusted. Run `nanocoder` in the folder once to review and trust it, or trust the workspace in VS Code.',
				'Manage Workspace Trust',
				'Show Logs',
			);
			if (action === 'Manage Workspace Trust') {
				await vscode.commands.executeCommand('workbench.trust.manage');
			} else if (action === 'Show Logs') {
				this.outputChannel.show(true);
			}
			return;
		}

		if (report.status === 'trusted') {
			// Trusted in the meantime (e.g. from a terminal), or the two checks
			// disagree. Leave the restart to the user so a disagreement cannot
			// turn into a restart loop.
			const action = await vscode.window.showWarningMessage(
				'Nanocoder refused to start because the folder was not trusted, but it is trusted now.',
				'Restart',
				'Show Logs',
			);
			if (action === 'Restart' && !this.isDisposed) {
				void this.start();
			} else if (action === 'Show Logs') {
				this.outputChannel.show(true);
			}
			return;
		}

		const folder = report.path || 'this folder';
		const why =
			report.status === 'changed'
				? `${folder} changed since you trusted it.`
				: report.status === 'needs-re-approval'
					? `${folder} needs to be trusted again after a Nanocoder upgrade.`
					: `${folder} is not a trusted folder.`;
		const contents = report.summary ?? 'It contains nothing that Nanocoder runs.';
		const action = await vscode.window.showWarningMessage(
			`Nanocoder did not start: ${why} Trusting it lets Nanocoder load its project config, hooks and MCP servers.`,
			{modal: true, detail: contents},
			'Trust Folder',
			'Show Logs',
		);
		if (this.isDisposed) return;

		if (action === 'Show Logs') {
			this.outputChannel.show(true);
			return;
		}
		if (action !== 'Trust Folder') return;

		const granted = await this.runTrustCli(['trust', '--grant', report.fingerprint]);
		if (this.isDisposed) return;
		if (granted?.code === 0) {
			this.outputChannel.appendLine(`Trusted ${folder}. Starting ACP process.`);
			void this.start();
			return;
		}
		const detail = (granted?.stdout || granted?.stderr || '').trim();
		vscode.window.showErrorMessage(
			`Could not trust ${folder}.${detail ? ` ${detail}` : ''}`,
		);
	}

	private async readTrustStatus(): Promise<TrustStatusReport | null> {
		const result = await this.runTrustCli(['trust', '--status', '--json']);
		if (!result || result.code !== 0) return null;
		return parseTrustStatus(result.stdout);
	}

	/**
	 * Run a `nanocoder trust` subcommand with the same binary, env and cwd as
	 * the refused launch, so it inspects the same folder and trust list.
	 * Resolves null when there was no launch or the CLI could not be spawned.
	 */
	private runTrustCli(args: string[]): Promise<CliRunResult | null> {
		const context = this.launchContext;
		if (!context) return Promise.resolve(null);
		return new Promise(resolve => {
			let plan;
			try {
				plan = planCliSpawn(context.cliPath, args);
			} catch (error) {
				this.outputChannel.appendLine(`Could not run nanocoder ${args.join(' ')}: ${error}`);
				resolve(null);
				return;
			}
			const child = cp.spawn(plan.command, plan.args, {shell: plan.shell, env: context.env, cwd: context.cwd});
			let stdout = '';
			let stderr = '';
			child.stdout?.on('data', data => {
				stdout += data.toString();
			});
			child.stderr?.on('data', data => {
				stderr += data.toString();
			});
			child.on('error', error => {
				this.outputChannel.appendLine(`Could not run nanocoder ${args.join(' ')}: ${error.message}`);
				resolve(null);
			});
			child.on('close', code => resolve({code, stdout, stderr}));
		});
	}

	dispose() {
		this.isDisposed = true;
		// Clear the retry timer: an orphaned one would call start() on the
		// disposed manager and overwrite the new manager's acpClient.connection.
		if (this.retryTimer) {
			clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}
		if (this.childProcess) {
			this.childProcess.kill();
			this.childProcess = null;
		}
		// Deliberately does NOT dispose this.stateManager: it is shared with
		// NanocoderAcpClient and survives `nanocoder.restartAcp`, which rebuilds
		// this manager. Disposing it here would kill the status-bar subscription
		// and every other listener after a manual restart.
	}
}
