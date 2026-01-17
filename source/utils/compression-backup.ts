import type {Message} from '@/types/core';

class CompressionBackup {
	private backup: Message[] | null = null;
	private timestamp: number | null = null;

	// Store a backup of messages before compression
	storeBackup(messages: Message[]): void {
		this.backup = messages.map(msg => ({...msg}));
		this.timestamp = Date.now();
	}

	getBackup(): Message[] | null {
		return this.backup ? this.backup.map(msg => ({...msg})) : null;
	}

	hasBackup(): boolean {
		return this.backup !== null;
	}

	getTimestamp(): number | null {
		return this.timestamp;
	}

	clearBackup(): void {
		this.backup = null;
		this.timestamp = null;
	}

	restore(): Message[] | null {
		if (!this.backup) {
			return null;
		}

		const restored = this.backup.map(msg => ({...msg}));
		return restored;
	}
}

export const compressionBackup = new CompressionBackup();
