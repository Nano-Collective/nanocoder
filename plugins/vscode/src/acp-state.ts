import * as vscode from 'vscode';

export enum ACPStatus {
	Disconnected = 'Disconnected',
	/** Launching the CLI child process (spawn + CLI discovery). */
	Starting = 'Starting',
	/** Handshake complete; the agent is ready for prompts. */
	Connected = 'Connected',
	/** Process crashed; a scheduled restart is pending. */
	Restarting = 'Restarting',
	/** Restart attempts exhausted (or spawn failed outright) — needs a manual restart. */
	Failed = 'Failed',
	VersionMismatch = 'VersionMismatch',
	CliMissing = 'CliMissing',
}

/** Optional extra context for a status, rendered where it matters (tooltip, dialogs). */
export interface AcpStatusDetail {
	/** Restarting: which retry is pending, e.g. `2` of `5` in `Reconnecting (2/5)`. */
	attempt?: number;
	totalAttempts?: number;
	/** Failed / VersionMismatch / CliMissing: human-readable cause for tooltips and dialogs. */
	reason?: string;
}

export class AcpStateManager {
	private _status: ACPStatus = ACPStatus.Disconnected;
	private _detail: AcpStatusDetail | undefined;
	private _onDidChangeStatus = new vscode.EventEmitter<{
		status: ACPStatus;
		detail?: AcpStatusDetail;
	}>();
	public readonly onDidChangeStatus = this._onDidChangeStatus.event;

	get status(): ACPStatus {
		return this._status;
	}

	get detail(): AcpStatusDetail | undefined {
		return this._detail;
	}

	setStatus(newStatus: ACPStatus, detail?: AcpStatusDetail) {
		if (this._status !== newStatus || detail !== undefined) {
			this._status = newStatus;
			this._detail = detail;
			this._onDidChangeStatus.fire({status: newStatus, detail});
		}
	}

	dispose() {
		this._onDidChangeStatus.dispose();
	}
}
