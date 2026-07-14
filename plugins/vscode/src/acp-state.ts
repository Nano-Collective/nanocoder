import * as vscode from 'vscode';

export enum ACPStatus {
	Disconnected = 'Disconnected',
	Connecting = 'Connecting',
	Connected = 'Connected',
	Restarting = 'Restarting',
	VersionMismatch = 'VersionMismatch',
	CliMissing = 'CliMissing',
}

export class AcpStateManager {
	private _status: ACPStatus = ACPStatus.Disconnected;
	private _onDidChangeStatus = new vscode.EventEmitter<ACPStatus>();
	public readonly onDidChangeStatus = this._onDidChangeStatus.event;

	get status(): ACPStatus {
		return this._status;
	}

	setStatus(newStatus: ACPStatus) {
		if (this._status !== newStatus) {
			this._status = newStatus;
			this._onDidChangeStatus.fire(newStatus);
		}
	}

	dispose() {
		this._onDidChangeStatus.dispose();
	}
}
