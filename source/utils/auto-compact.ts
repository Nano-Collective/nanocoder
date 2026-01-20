import {getModelContextLimit} from '@/models/index';
import {createTokenizer} from '@/tokenization/index';
import type {CompressionMode} from '@/types/config';
import type {Message} from '@/types/core';
import type {Tokenizer} from '@/types/tokenization';
import {compressionBackup} from './compression-backup';
import {compressMessages} from './message-compression';

export interface AutoCompactSessionOverrides {
	enabled: boolean | null;
	threshold: number | null;
	mode: CompressionMode | null;
}

/**
 * Singleton class for managing auto-compact session overrides.
 * Provides encapsulated state management instead of global mutable object.
 */
class AutoCompactSessionManager {
	private _enabled: boolean | null = null;
	private _threshold: number | null = null;
	private _mode: CompressionMode | null = null;

	get enabled(): boolean | null {
		return this._enabled;
	}

	get threshold(): number | null {
		return this._threshold;
	}

	get mode(): CompressionMode | null {
		return this._mode;
	}

	setEnabled(enabled: boolean | null): void {
		this._enabled = enabled;
	}

	setThreshold(threshold: number | null): void {
		if (threshold !== null) {
			this._threshold = Math.max(50, Math.min(95, threshold));
		} else {
			this._threshold = null;
		}
	}

	setMode(mode: CompressionMode | null): void {
		this._mode = mode;
	}

	reset(): void {
		this._enabled = null;
		this._threshold = null;
		this._mode = null;
	}
}

// Singleton instance
const autoCompactSession = new AutoCompactSessionManager();

// Legacy export for backward compatibility
export const autoCompactSessionOverrides: AutoCompactSessionOverrides =
	new Proxy({} as AutoCompactSessionOverrides, {
		get(_target, prop) {
			if (prop === 'enabled') return autoCompactSession.enabled;
			if (prop === 'threshold') return autoCompactSession.threshold;
			if (prop === 'mode') return autoCompactSession.mode;
			return undefined;
		},
		set(_target, prop, value) {
			if (prop === 'enabled') autoCompactSession.setEnabled(value);
			else if (prop === 'threshold') autoCompactSession.setThreshold(value);
			else if (prop === 'mode') autoCompactSession.setMode(value);
			return true;
		},
	});

/**
 * Perform auto-compact on messages (async)
 * Returns compressed messages if compression was performed, null otherwise
 */
export async function performAutoCompact(
	messages: Message[],
	systemMessage: Message,
	provider: string,
	model: string,
	config: {
		enabled: boolean;
		threshold: number;
		mode: CompressionMode;
		notifyUser: boolean;
	},
	onNotify?: (message: string) => void,
): Promise<Message[] | null> {
	// Check if auto compact is enabled
	const enabled =
		autoCompactSessionOverrides.enabled !== null
			? autoCompactSessionOverrides.enabled
			: config.enabled;

	if (!enabled) {
		return null;
	}

	// Get threshold
	const threshold =
		autoCompactSessionOverrides.threshold !== null
			? autoCompactSessionOverrides.threshold
			: config.threshold;

	// Get mode
	const mode =
		autoCompactSessionOverrides.mode !== null
			? autoCompactSessionOverrides.mode
			: config.mode;

	// Get context limit
	let contextLimit: number | null;
	try {
		contextLimit = await getModelContextLimit(model);
	} catch {
		return null;
	}

	if (!contextLimit) {
		return null;
	}

	// Create tokenizer
	let tokenizer: Tokenizer | undefined;
	try {
		tokenizer = createTokenizer(provider, model);
	} catch {
		return null;
	}

	try {
		// Calculate current token count
		const allMessages = [systemMessage, ...messages];
		let totalTokens = 0;
		for (const msg of allMessages) {
			totalTokens += tokenizer.countTokens(msg);
		}

		// Check if threshold is reached
		const usagePercentage = (totalTokens / contextLimit) * 100;
		if (usagePercentage < threshold) {
			return null;
		}

		compressionBackup.storeBackup(messages);

		const result = compressMessages(messages, tokenizer, {mode});

		// Show notification if enabled
		if (config.notifyUser && onNotify) {
			const reduction = Math.round(result.reductionPercentage);
			onNotify(
				`Context at ${Math.round(usagePercentage)}% capacity - auto-compacting...\nContext Compacted: ${result.originalTokenCount.toLocaleString()} tokens → ${result.compressedTokenCount.toLocaleString()} tokens (${reduction}% reduction)`,
			);
		}

		// Return compressed messages
		return result.compressedMessages;
	} finally {
		// Clean up tokenizer
		if (tokenizer?.free) {
			tokenizer.free();
		}
	}
}

// Set session override for auto-compact enabled state
export function setAutoCompactEnabled(enabled: boolean | null): void {
	autoCompactSession.setEnabled(enabled);
}

// Set session override for auto-compact threshold
export function setAutoCompactThreshold(threshold: number | null): void {
	autoCompactSession.setThreshold(threshold);
}

// Set session override for auto-compact mode
export function setAutoCompactMode(mode: CompressionMode | null): void {
	autoCompactSession.setMode(mode);
}

// Reset all session overrides
export function resetAutoCompactSession(): void {
	autoCompactSession.reset();
}
