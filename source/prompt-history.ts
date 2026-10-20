import fs from 'fs/promises';
import {getClosestConfigFile} from '@/config/index';
import {MAX_PROMPT_HISTORY_SIZE} from '@/constants';
import {atomicWriteFile} from '@/utils/atomic-write';
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
	// Set when the file exists but could not be read (permissions, I/O). The
	// content is unknown, so saving would replace history we never saw.
	private persistenceBlocked = false;

	constructor(historyFile?: string) {
		this.historyFile =
			historyFile ?? getClosestConfigFile('.nano-coder-history');
	}

	async loadHistory(): Promise<void> {
		this.persistenceBlocked = false;
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
					throw new SyntaxError(
						'Prompt history file does not contain an array',
					);
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

			if (error instanceof SyntaxError) {
				// The file was read but its content is not valid history - a
				// truncated JSON payload left behind by a crash mid-save is the
				// common case. Moving it aside preserves the old entries for
				// recovery and stops the next save from replacing them with the
				// empty history.
				await this.quarantineCorruptFile(error);
				return;
			}

			// The file could not be read at all (permissions, I/O error, ...).
			// That says nothing about its content, so leave it where it is, and
			// do not save: that would replace entries we never saw. Fixing the
			// cause brings the history back on the next load.
			this.persistenceBlocked = true;
			logError(
				`Prompt history could not be read, leaving it untouched and not saving it this session: ${formatError(error)}`,
			);
		}
	}

	/**
	 * Move a history file with invalid content out of the way so the next save
	 * starts fresh instead of destroying it. Best effort: if the rename fails
	 * the file is left untouched, and the atomic write in saveHistory means a
	 * later save renames a complete temp file into place rather than
	 * truncating the existing one.
	 */
	private async quarantineCorruptFile(error: unknown): Promise<void> {
		const backupPath = await this.nextAvailableBackupPath();
		logError(
			`Prompt history file is corrupt, backing it up to ${backupPath}: ${formatError(error)}`,
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

	/**
	 * Where to write: the real file behind a symlink (a renamed-over link would
	 * be replaced by a plain file and leave its target stale), and the mode the
	 * existing file has, if any.
	 */
	private async resolveWriteTarget(): Promise<{path: string; mode?: number}> {
		let path = this.historyFile;
		try {
			path = await fs.realpath(this.historyFile);
		} catch {
			// Not there yet: write the path as given.
		}
		try {
			return {path, mode: (await fs.stat(path)).mode & 0o777};
		} catch {
			return {path};
		}
	}

	async saveHistory(): Promise<void> {
		// Chain this save onto the previous save to prevent concurrent writes
		this.savePromise = this.savePromise.then(async () => {
			if (this.persistenceBlocked) return;
			try {
				const jsonContent = JSON.stringify(this.history, null, 2);
				// Write to a temp file and rename into place. writeFile alone
				// truncates in place, so a crash mid-save used to leave a file
				// starting with the marker followed by broken JSON, which the
				// next load discarded. Rename replaces whatever is at the path,
				// so write to the real file behind a symlink and give the new
				// file the old one's permissions, as an in-place write would.
				const target = await this.resolveWriteTarget();
				await atomicWriteFile(
					target.path,
					JSON_FORMAT_MARKER + jsonContent,
					target.mode === undefined ? undefined : {mode: target.mode},
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
