/**
 * Project instruction file resolution.
 *
 * AGENTS.md always wins, but repositories that standardised on another tool
 * often keep their guidance in a different file. When AGENTS.md is missing we
 * fall back to a configurable ordered list of well-known filenames, so the
 * prompt builder, /status and /doctor all agree on what was loaded.
 *
 * Whether any of this is sent to the model stays controlled by
 * `tune.includeAgentsMd` (and the nano profile), as before.
 */
import {existsSync, readFileSync, statSync} from 'fs';
import {join} from 'path';
import {getAppConfig} from '@/config/index';
import {getProjectRoot} from '@/services/session-cwd';

/** Fallback filenames tried in order after AGENTS.md. */
export const DEFAULT_INSTRUCTION_FILES: readonly string[] = [
	'CLAUDE.md',
	'GEMINI.md',
	'.github/copilot-instructions.md',
	'.cursorrules',
];

export interface ProjectInstructionFile {
	/** Filename from the configured list, e.g. `CLAUDE.md`. */
	name: string;
	/** Absolute path to the file. */
	path: string;
}

export interface ProjectInstructionFileContent extends ProjectInstructionFile {
	content: string;
}

/**
 * Candidate filenames in precedence order. AGENTS.md is always first; an
 * explicit empty `instructionFiles` config disables the fallbacks entirely.
 */
export function getInstructionFileNames(): string[] {
	const configured = getAppConfig().instructionFiles;
	const fallbacks = configured ?? DEFAULT_INSTRUCTION_FILES;

	const names = ['AGENTS.md'];
	const seen = new Set(['agents.md']);
	for (const name of fallbacks) {
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		names.push(name);
	}
	return names;
}

function isFile(filePath: string): boolean {
	try {
		return statSync(filePath).isFile();
	} catch {
		return false;
	}
}

/**
 * Resolve the project instruction file without reading its contents. Used by
 * the status panel and /doctor, which only need to name the file.
 */
export function findProjectInstructionFile(): ProjectInstructionFile | null {
	const root = getProjectRoot();
	for (const name of getInstructionFileNames()) {
		const path = join(root, name);
		if (isFile(path)) return {name, path};
	}
	return null;
}

/**
 * Resolve and read the first available project instruction file. Missing or
 * unreadable candidates are skipped so later fallbacks still get a chance.
 */
export function loadProjectInstructionFile(): ProjectInstructionFileContent | null {
	const root = getProjectRoot();
	for (const name of getInstructionFileNames()) {
		const path = join(root, name);
		if (!existsSync(path)) continue;
		try {
			return {name, path, content: readFileSync(path, 'utf-8')};
		} catch {
			// Try the next fallback instead of failing the whole system prompt.
		}
	}
	return null;
}
