import {defineSessionValue} from '@/services/session-context';
import type {Message} from '@/types/core';

interface StoredBackup {
	messages: Message[];
	timestamp: number;
}

// The messages from before the last compaction, kept per session so one ACP
// session restoring cannot bring back another's history.
const stored = defineSessionValue<StoredBackup>();

class CompressionBackup {
	// Store a backup of messages before compression
	storeBackup(messages: Message[]): void {
		stored.set({
			messages: messages.map(msg => ({...msg})),
			timestamp: Date.now(),
		});
	}

	getBackup(): Message[] | null {
		return this.restore();
	}

	hasBackup(): boolean {
		return stored.get() !== null;
	}

	getTimestamp(): number | null {
		return stored.get()?.timestamp ?? null;
	}

	clearBackup(): void {
		stored.reset();
	}

	restore(): Message[] | null {
		const backup = stored.get();
		return backup ? backup.messages.map(msg => ({...msg})) : null;
	}
}

export const compressionBackup = new CompressionBackup();
