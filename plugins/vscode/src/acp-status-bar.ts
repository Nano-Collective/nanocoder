import * as vscode from 'vscode';
import {AcpStateManager, ACPStatus, AcpStatusDetail} from './acp-state';

/**
 * Everything the status bar needs to render one ACP state.
 * Pure data: unit-testable without a real status bar item.
 */
export interface AcpStatusBarView {
	text: string;
	tooltip: string;
	/** Command id fired when the item is clicked; undefined for the spin state. */
	command: 'nanocoder.restartAcp' | 'nanocoder.showOutput' | undefined;
}

/**
 * Map an ACP connection state to status bar presentation.
 * Pure function so the transitions are testable without VS Code.
 */
export function describeAcpStatus(
	status: ACPStatus,
	detail: AcpStatusDetail | undefined,
	model: string | undefined,
): AcpStatusBarView {
	switch (status) {
		case ACPStatus.Connected:
			return {
				text: '$(check) Nanocoder',
				tooltip: model
					? `Nanocoder agent connected (${model}). Click to restart the CLI process.`
					: 'Nanocoder agent connected. Click to restart the CLI process.',
				command: 'nanocoder.restartAcp',
			};
		case ACPStatus.Starting:
			return {
				text: '$(sync~spin) Nanocoder: Starting',
				tooltip: 'Starting the Nanocoder CLI (--acp)...',
				command: undefined,
			};
		case ACPStatus.Restarting: {
			const attempt =
				detail?.attempt !== undefined && detail?.totalAttempts !== undefined
					? ` (${detail.attempt}/${detail.totalAttempts})`
					: '';
			return {
				text: `$(sync~spin) Nanocoder: Reconnecting${attempt}`,
				tooltip: 'The Nanocoder CLI crashed and is being restarted automatically.',
				command: undefined,
			};
		}
		case ACPStatus.Failed:
			return {
				text: '$(error) Nanocoder: Failed',
				tooltip: `The Nanocoder CLI could not be started.${detail?.reason ? ` Last error: ${detail.reason}` : ''} Click for recovery options.`,
				command: 'nanocoder.showOutput',
			};
		case ACPStatus.VersionMismatch:
			return {
				text: '$(warning) Nanocoder: Update CLI',
				tooltip: `The installed Nanocoder CLI is too old for this extension.${detail?.reason ? ` ${detail.reason}` : ''} Update it, then click to restart.`,
				command: 'nanocoder.restartAcp',
			};
		case ACPStatus.CliMissing:
			return {
				text: '$(plug) Nanocoder: Not installed',
				tooltip: 'The Nanocoder CLI was not found. Install it (npm i -g @nanocollective/nanocoder), then click to retry.',
				command: 'nanocoder.restartAcp',
			};
		case ACPStatus.Disconnected:
		default:
			return {
				text: '$(circle-slash) Nanocoder: Disconnected',
				tooltip: 'The Nanocoder agent process is stopped. Click to restart it.',
				command: 'nanocoder.restartAcp',
			};
	}
}

/**
 * Owns the ACP status bar item: renders every AcpStateManager transition and
 * handles the Failed-state recovery dialog. The legacy WebSocket companion
 * keeps its own text on the same item; this controller only asserts itself
 * while the ACP process is alive (Starting/Restarting), so the two don't fight.
 */
export class AcpStatusBarController {
	private readonly item: vscode.StatusBarItem;
	private readonly stateManager: AcpStateManager;
	private readonly outputChannel: vscode.OutputChannel;
	private readonly disposables: vscode.Disposable[] = [];
	/** Belongs to the legacy companion's status message; surfaced when connected. */
	private model: string | undefined;
	/** While true, a Failed recovery dialog is already open — don't stack dialogs. */
	private dialogOpen = false;

	constructor(
		item: vscode.StatusBarItem,
		stateManager: AcpStateManager,
		outputChannel: vscode.OutputChannel,
	) {
		this.item = item;
		this.stateManager = stateManager;
		this.outputChannel = outputChannel;

		this.disposables.push(
			stateManager.onDidChangeStatus(({status, detail}) => {
				this.render(status, detail);
				if (status === ACPStatus.Failed) {
					this.showRecoveryDialog(detail);
				}
			}),
		);

		// Render the current state immediately — activate() starts the ACP
		// process before this controller exists, so the initial status would
		// otherwise stay invisible until the next transition.
		this.render(stateManager.status, stateManager.detail);
	}

	/** Update the model shown next to the check mark (from ACP state sync). */
	setModel(model: string | undefined): void {
		this.model = model;
		if (this.stateManager.status === ACPStatus.Connected) {
			this.render(ACPStatus.Connected, this.stateManager.detail);
		}
	}

	private render(status: ACPStatus, detail: AcpStatusDetail | undefined): void {
		const view = describeAcpStatus(status, detail, this.model);
		this.item.text = view.text;
		this.item.tooltip = view.tooltip;
		this.item.command = view.command;
	}

	/**
	 * Offer Show Logs / Restart when the retry loop is exhausted. The status
	 * item click already opens this dialog, so the user is never more than
	 * one click away from recovery.
	 */
	private async showRecoveryDialog(
		detail: AcpStatusDetail | undefined,
	): Promise<void> {
		if (this.dialogOpen) {
			return;
		}
		this.dialogOpen = true;
		try {
			const reason = detail?.reason ? ` Last error: ${detail.reason}.` : '';
			const action = await vscode.window.showErrorMessage(
				`Nanocoder CLI failed to start.${reason}`,
				'Show Logs',
				'Restart',
			);
			if (action === 'Show Logs') {
				this.outputChannel.show(true);
			} else if (action === 'Restart') {
				await vscode.commands.executeCommand('nanocoder.restartAcp');
			}
		} finally {
			this.dialogOpen = false;
		}
	}

	dispose(): void {
		for (const d of this.disposables.splice(0)) {
			d.dispose();
		}
	}
}
