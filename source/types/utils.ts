export type MessageType = 'info' | 'error' | 'success';

export interface NpmRegistryResponse {
	version: string;
	name: string;
	[key: string]: unknown;
}

export interface UpdateInfo {
	hasUpdate: boolean;
	currentVersion: string;
	latestVersion?: string;
	updateCommand?: string;
}
