import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import {existsSync} from 'node:fs';
import {ClientSideConnection, ndJsonStream} from '@agentclientprotocol/sdk';
import {AcpStateManager, ACPStatus} from './acp-state';
import {NanocoderAcpClient} from './acp-client';
import {findCliPath, nodeExistsAlongside, promptInstallCli, resolveSpawnEnv} from './cli-discovery';
import {planCliSpawn} from './cli-path-discovery';

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

	constructor(outputChannel: vscode.OutputChannel, stateManager: AcpStateManager, acpClient: NanocoderAcpClient) {
		this.outputChannel = outputChannel;
		this.stateManager = stateManager;
		this.acpClient = acpClient;
	}

	async start(): Promise<void> {
		// Refuse to start a disposed manager: a retry timer scheduled before
		// dispose() can still fire here and would overwrite the new manager's
		// acpClient.connection.
		if (this.isDisposed) {
			return;
		}
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

		this.outputChannel.appendLine(`Starting ACP process: ${cliPath} --acp`);
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
		const cwdSetting = config.get<string>('cwd') || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir() || process.cwd();
		// On Windows the discovered path is usually an npm/pnpm shim, which
		// cannot be spawned directly - see planCliSpawn.
		const plan = planCliSpawn(cliPath, ['--acp']);
		if (plan.command !== cliPath) {
			this.outputChannel.appendLine(
				`Resolved launch command: ${plan.command} ${plan.args.join(' ')}${plan.shell ? ' (via shell)' : ''}`
			);
		}
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
		const reportCrash = () => {
			if (crashReported || this.isDisposed) return;
			crashReported = true;
			this.handleCrash();
		};

		child.on('error', (err) => {
			this.outputChannel.appendLine(`ACP process error: ${err.message}`);
			reportCrash();
		});

		child.on('exit', (code, signal) => {
			this.outputChannel.appendLine(`ACP process exited with code ${code} signal ${signal}`);
			reportCrash();
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
		reportCrash: () => void,
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
			// Failed handshake: kill the child (it may still be alive) and
			// count one crash - the exit event is absorbed by reportCrash's guard.
			child.kill();
			reportCrash();
		}
	}

	private handleCrash() {
		if (this.isDisposed || this.stateManager.status === ACPStatus.VersionMismatch) return;

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
