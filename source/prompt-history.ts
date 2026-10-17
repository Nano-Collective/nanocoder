import crypto from 'crypto';
import fs from 'fs/promises';
import {getClosestConfigFile} from '@/config/index';
import {MAX_PROMPT_HISTORY_SIZE} from '@/constants';
import {formatError} from '@/utils/error-formatter';
import {logError} from '@/utils/message-queue';
import type {InputState} from './types/hooks';

const ENTRY_SEPARATOR = '\n---ENTRY_SEPARATOR---\n';
const JSON_FORMAT_MARKER = '---JSON_FORMAT---';

function isEnoent(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

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

			if (content.trim() === '{}') {
				// getClosestConfigFile seeds a missing file with an empty JSON
				// object. It is not history; reading it through the legacy
				// line-per-entry path below made "{}" every new user's oldest
				// Up-arrow entry.
				this.history = [];
			} else if (content.startsWith(JSON_FORMAT_MARKER)) {
				// New JSON format with InputState objects
				const jsonContent = content.slice(JSON_FORMAT_MARKER.length);
				const parsed: unknown = JSON.parse(jsonContent);
				if (!Array.isArray(parsed)) {
					throw new Error('Prompt history file does not contain an array');
				}
				this.history = parsed as InputState[];
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
		} catch (error) {
			this.history = [];
			this.currentIndex = -1;

			if (isEnoent(error)) {
				// File doesn't exist yet, start with empty history
				return;
			}

			// The file exists but could not be read or parsed - a truncated
			// JSON payload left behind by a crash mid-save is the common case.
			// Moving it aside preserves the old entries for recovery and stops
			// the next save from overwriting them with the empty history.
			await this.quarantineCorruptFile(error);
		}
	}

	/**
	 * Move an unreadable history file out of the way so the next save starts
	 * fresh instead of destroying it. Best effort: if the rename fails the
	 * file is left untouched, and the atomic write in saveHistory means a
	 * later save renames a complete temp file into place rather than
	 * truncating the existing one.
	 */
	private async quarantineCorruptFile(error: unknown): Promise<void> {
		const backupPath = await this.nextAvailableBackupPath();
		logError(
			`Prompt history file is unreadable, backing it up to ${backupPath}: ${formatError(error)}`,
		);
		try {
			await fs.rename(this.historyFile, backupPath);
		} catch (renameError) {
			logError(
				`Failed to back up corrupt prompt history: ${formatError(renameError)}`,
			);
		}
	}

	/**
	 * A plain `.corrupt` name as long as it is free, otherwise a timestamped
	 * one. A second corruption must not overwrite the first backup, or the
	 * entries it held would be lost after all.
	 */
	private async nextAvailableBackupPath(): Promise<string> {
		const base = `${this.historyFile}.corrupt`;
		if (!(await pathExists(base))) return base;

		const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
		let candidate = `${base}-${stamp}`;
		let counter = 1;
		while (await pathExists(candidate)) {
			candidate = `${base}-${stamp}-${counter}`;
			counter++;
		}
		return candidate;
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
				// Write to a temp file and rename into place. writeFile alone
				// truncates in place, so a crash mid-save used to leave a file
				// starting with the marker followed by broken JSON, which the
				// next load discarded.
				const temporaryPath = `${this.historyFile}.${crypto.randomUUID()}.tmp`;
				try {
					await fs.writeFile(
						temporaryPath,
						JSON_FORMAT_MARKER + jsonContent,
						'utf8',
					);
					await fs.rename(temporaryPath, this.historyFile);
				} catch (writeError) {
					await fs.unlink(temporaryPath).catch(() => {});
					throw writeError;
				}
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
		return result?.displayValue ?? null;
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
