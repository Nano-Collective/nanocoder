import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import {ClientSideConnection, ndJsonStream} from '@agentclientprotocol/sdk';
import {AcpStateManager, ACPStatus} from './acp-state';
import {NanocoderAcpClient} from './acp-client';
import {findCliPath, promptInstallCli, resolveSpawnEnv} from './cli-discovery';

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
		this.stateManager.setStatus(ACPStatus.Connecting);

		const config = vscode.workspace.getConfiguration('nanocoder');
		const configuredCliPath = config.get<string>('cliPath');
		const cliPath = configuredCliPath || await findCliPath();

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
		
		// Fallbacks: configured cwd -> workspace folder -> user homedir -> process cwd
		const cwdSetting = config.get<string>('cwd') || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir() || process.cwd();
		const spawnOptions: cp.SpawnOptions = { shell: false, env, cwd: cwdSetting };

		if (cliPath.startsWith('node ')) {
			const scriptPath = cliPath.substring(5);
			this.childProcess = cp.spawn('node', [scriptPath, '--acp'], spawnOptions);
		} else {
			this.childProcess = cp.spawn(cliPath, ['--acp'], spawnOptions);
		}

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
