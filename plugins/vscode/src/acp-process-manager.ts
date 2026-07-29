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

	constructor(outputChannel: vscode.OutputChannel, stateManager: AcpStateManager, acpClient: NanocoderAcpClient) {
		this.outputChannel = outputChannel;
		this.stateManager = stateManager;
		this.acpClient = acpClient;
	}

	async start(): Promise<void> {
		// Nothing awaits start(), so an exception here would surface as an
		// unhandled rejection: no log line, no status change, and a UI stuck on
		// "Connecting". cp.spawn throws synchronously for an unspawnable path
		// (a .cmd without a shell on Windows), which is exactly that case.
		try {
			await this.launch();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.outputChannel.appendLine(`Failed to start ACP process: ${message}`);
			this.stateManager.setStatus(ACPStatus.Disconnected);
			vscode.window.showErrorMessage(
				`Could not start the Nanocoder CLI: ${message}. See the Nanocoder output channel for details.`
			);
		}
	}

	private async launch(): Promise<void> {
		this.stateManager.setStatus(ACPStatus.Connecting);

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
			this.stateManager.setStatus(ACPStatus.CliMissing);
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
			this.stateManager.setStatus(ACPStatus.Disconnected);
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

		// Create Web Streams from Node.js streams
		const input = new ReadableStream<Uint8Array>({
			start: (controller) => {
				this.childProcess!.stdout!.on('data', (chunk: Buffer) => {
					controller.enqueue(new Uint8Array(chunk));
				});
				this.childProcess!.stdout!.on('end', () => controller.close());
				this.childProcess!.stdout!.on('error', (err) => controller.error(err));
			}
		});

		const output = new WritableStream<Uint8Array>({
			write: (chunk) => {
				this.childProcess!.stdin!.write(chunk);
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
			}
		} as any), stream);
		this.acpClient.setConnection(connection);
		const initialized = await this.acpClient.initializeHandshake();
		
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
			this.stateManager.setStatus(ACPStatus.Restarting);
			this.outputChannel.appendLine(`ACP process crashed. Restarting in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`);
			
			setTimeout(() => {
				this.start();
			}, delay);
		} else {
			this.stateManager.setStatus(ACPStatus.Disconnected);
			this.outputChannel.appendLine('Max retries reached. ACP process will not restart automatically.');
			const lastError = this.lastStderr.trim().split('\n').pop();
			vscode.window.showErrorMessage(
				`Nanocoder CLI crashed repeatedly and could not be restarted.${lastError ? ` Last error: ${lastError}` : ''} See the Nanocoder output channel for details.`
			);
		}
	}

	dispose() {
		this.isDisposed = true;
		if (this.childProcess) {
			this.childProcess.kill();
			this.childProcess = null;
		}
		this.stateManager.dispose();
	}
}
