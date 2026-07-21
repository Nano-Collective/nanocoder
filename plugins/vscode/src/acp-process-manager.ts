import * as vscode from 'vscode';
import * as cp from 'child_process';
import {ClientSideConnection, ndJsonStream} from '@agentclientprotocol/sdk';
import {AcpStateManager, ACPStatus} from './acp-state';
import {NanocoderAcpClient} from './acp-client';
import {findCliPath, promptInstallCli} from './cli-discovery';

export class AcpProcessManager {
	private childProcess: cp.ChildProcess | null = null;
	private outputChannel: vscode.OutputChannel;
	private stateManager: AcpStateManager;
	private acpClient: NanocoderAcpClient;
	
	private retryCount = 0;
	private maxRetries = 5;
	private isDisposed = false;

	constructor(outputChannel: vscode.OutputChannel, stateManager: AcpStateManager, acpClient: NanocoderAcpClient) {
		this.outputChannel = outputChannel;
		this.stateManager = stateManager;
		this.acpClient = acpClient;
	}

	async start(): Promise<void> {
		this.stateManager.setStatus(ACPStatus.Connecting);

		const cliPath = await findCliPath();
		if (!cliPath) {
			this.stateManager.setStatus(ACPStatus.CliMissing);
			this.outputChannel.appendLine('Nanocoder CLI not found in PATH.');
			await promptInstallCli();
			return;
		}

		this.outputChannel.appendLine(`Starting ACP process: ${cliPath} --acp`);
		
		if (cliPath.startsWith('node ')) {
			const scriptPath = cliPath.substring(5);
			this.childProcess = cp.spawn('node', [scriptPath, '--acp'], { shell: false });
		} else {
			this.childProcess = cp.spawn(cliPath, ['--acp'], { shell: false });
		}

		if (!this.childProcess.stdout || !this.childProcess.stdin) {
			this.outputChannel.appendLine('Failed to attach to child process stdio.');
			this.stateManager.setStatus(ACPStatus.Disconnected);
			return;
		}

		// Log stderr from the CLI for debugging
		this.childProcess.stderr?.on('data', (data) => {
			this.outputChannel.append(`[CLI stderr] ${data.toString()}`);
		});

		this.childProcess.on('error', (err) => {
			this.outputChannel.appendLine(`ACP process error: ${err.message}`);
			this.handleCrash();
		});

		this.childProcess.on('exit', (code, signal) => {
			this.outputChannel.appendLine(`ACP process exited with code ${code} signal ${signal}`);
			if (!this.isDisposed) {
				this.handleCrash();
			}
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
			// If it failed to initialize but not due to a version mismatch, treat as crash
			this.handleCrash();
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
			vscode.window.showErrorMessage('Nanocoder CLI crashed repeatedly and could not be restarted. Please check the output logs.');
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
