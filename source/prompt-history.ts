import fs from 'fs/promises';
import {getClosestConfigFile} from '@/config/index';
import {MAX_PROMPT_HISTORY_SIZE} from '@/constants';
import {formatError} from '@/utils/error-formatter';
import {logError} from '@/utils/message-queue';
import type {InputState} from './types/hooks';

const ENTRY_SEPARATOR = '\n---ENTRY_SEPARATOR---\n';
const JSON_FORMAT_MARKER = '---JSON_FORMAT---';

export class PromptHistory {
	private history: InputState[] = [];
	private currentIndex: number = -1;
	private readonly historyFile: string;
	private savePromise: Promise<void> = Promise.resolve();

	constructor(historyFile?: string) {
		this.historyFile =
			historyFile ?? getClosestConfigFile('.nano-coder-history');
	}

	async loadHistory(): Promise<void> {
		try {
			const content = await fs.readFile(this.historyFile, 'utf8');

			if (content.startsWith(JSON_FORMAT_MARKER)) {
				// New JSON format with InputState objects
				const jsonContent = content.slice(JSON_FORMAT_MARKER.length);
				this.history = JSON.parse(jsonContent) as InputState[];
			} else if (content.includes(ENTRY_SEPARATOR)) {
				// LEGACY_MIGRATION_REMOVE_AFTER: 1.27.0
				// Old format using ENTRY_SEPARATOR. Migrate to InputState on read.
				const stringEntries = content
					.split(ENTRY_SEPARATOR)
					.filter(entry => entry.trim() !== '');
				this.history = this.migrateStringArrayToInputState(stringEntries);
			} else {
				// LEGACY_MIGRATION_REMOVE_AFTER: 1.27.0
				// Very old format using bare newlines. Migrate to InputState on read.
				// Drop this branch and the ENTRY_SEPARATOR branch above once 1.27.0 ships.
				const stringEntries = content
					.split('\n')
					.filter(line => line.trim() !== '');
				this.history = this.migrateStringArrayToInputState(stringEntries);
			}
			this.currentIndex = -1;
		} catch {
			// File doesn't exist yet, start with empty history
			this.history = [];
			this.currentIndex = -1;
		}
	}

	private migrateStringArrayToInputState(
		stringEntries: string[],
	): InputState[] {
		return stringEntries.map(entry => ({
			displayValue: entry,
			placeholderContent: {},
		}));
	}

	async saveHistory(): Promise<void> {
		// Chain this save onto the previous save to prevent concurrent writes
		this.savePromise = this.savePromise.then(async () => {
			try {
				const jsonContent = JSON.stringify(this.history, null, 2);
				await fs.writeFile(
					this.historyFile,
					JSON_FORMAT_MARKER + jsonContent,
					'utf8',
				);
			} catch (error) {
				// Silently fail to avoid disrupting the user experience
				const errorMessage = formatError(error);
				logError(`Failed to save prompt history: ${errorMessage}`);
			}
		});
		return this.savePromise;
	}

	addPrompt(inputState: InputState): void;
	addPrompt(prompt: string): void;
	addPrompt(input: InputState | string): void {
		let inputState: InputState;

		if (typeof input === 'string') {
			const trimmed = input.trim();
			if (!trimmed) return;
			inputState = {
				displayValue: trimmed,
				placeholderContent: {},
			};
		} else {
			if (!input.displayValue.trim()) return;
			inputState = input;
		}

		// Remove duplicate if it exists (compare by displayValue)
		const existingIndex = this.history.findIndex(
			entry => entry.displayValue === inputState.displayValue,
		);
		if (existingIndex !== -1) {
			this.history.splice(existingIndex, 1);
		}

		// Add to the end
		this.history.push(inputState);

		// Keep only the last MAX_PROMPT_HISTORY_SIZE entries
		if (this.history.length > MAX_PROMPT_HISTORY_SIZE) {
			this.history = this.history.slice(-MAX_PROMPT_HISTORY_SIZE);
		}

		this.currentIndex = -1;
		void this.saveHistory(); // Fire and forget
	}

	getPrevious(): InputState | null {
		if (this.history.length === 0) return null;

		if (this.currentIndex === -1) {
			this.currentIndex = this.history.length - 1;
		} else if (this.currentIndex > 0) {
			this.currentIndex--;
		}

		return this.history[this.currentIndex] ?? null;
	}

	getNext(): InputState | null {
		if (this.history.length === 0 || this.currentIndex === -1) return null;

		if (this.currentIndex < this.history.length - 1) {
			this.currentIndex++;
			return this.history[this.currentIndex] ?? null;
		} else {
			this.currentIndex = -1;
			return null; // Changed from empty string to null for consistency
		}
	}

	// LEGACY_MIGRATION_REMOVE_AFTER: 1.27.0
	// String-returning variants kept for backward compatibility with older callers.
	// No production code uses them; they are only exercised by tests. Delete the
	// three legacy methods below (and their specs) once 1.27.0 ships.
	getPreviousString(): string | null {
		const result = this.getPrevious();
		return result?.displayValue ?? null;
	}

	getNextString(): string | null {
		const result = this.getNext();
		return result?.displayValue ?? '';
	}

	resetIndex(): void {
		this.currentIndex = -1;
	}

	getHistory(): InputState[] {
		return [...this.history];
	}

	getHistoryStrings(): string[] {
		return this.history.map(entry => entry.displayValue);
	}
}

export const promptHistory = new PromptHistory();
