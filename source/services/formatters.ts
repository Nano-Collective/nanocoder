import {readFile} from 'node:fs/promises';
import {relative, resolve} from 'node:path';

import {getAppConfig} from '@/config/index';
import {matchGlob} from '@/events/event-router';
import {runHookCommand} from '@/services/lifecycle-hooks';
import {getProjectRoot, getSafeSessionCwd} from '@/services/session-cwd';
import type {FormatterDefinition} from '@/types/config';
import {invalidateCache} from '@/utils/file-cache';
import {logError} from '@/utils/message-queue';

/** Ceiling on a single formatter's runtime. Overridable via `timeout`. */
const DEFAULT_FORMATTER_TIMEOUT_MS = 30_000;

/** The tools that write a file's contents, and so leave it to be formatted. */
const FILE_WRITING_TOOLS: ReadonlySet<string> = new Set([
	'write_file',
	'string_replace',
	'diff_edit',
]);

export function getConfiguredFormatters(): FormatterDefinition[] {
	return getAppConfig().formatters ?? [];
}

async function readOrNull(absPath: string): Promise<string | null> {
	try {
		return await readFile(absPath, 'utf8');
	} catch {
		return null;
	}
}

/**
 * Run the configured formatters on the file a successful write touched, and
 * tell the model when that changed the file.
 *
 * The note matters: `string_replace` matches exact content, so a model that
 * keeps editing from its own memory of the file would miss on the next call
 * once a formatter has re-indented it. A file the formatters left alone adds
 * nothing to the result.
 *
 * Called before `appendPostToolUseOutput`, so a `post-tool-use` hook (an
 * auto-commit, say) sees the formatted file. Never rejects: a formatter that
 * fails or times out is logged and the edit stands as written.
 */
export async function formatWrittenFile(
	toolName: string,
	toolArgs: Record<string, unknown>,
	content: string,
): Promise<string> {
	if (!FILE_WRITING_TOOLS.has(toolName)) return content;
	const formatters = getConfiguredFormatters();
	if (formatters.length === 0) return content;

	const rawPath = toolArgs.path ?? toolArgs.file_path ?? toolArgs.filePath;
	if (typeof rawPath !== 'string' || rawPath === '') return content;

	// Resolved the same way the file tools resolve it, then matched relative to
	// the project root — globs are written against the project, and a file
	// outside it is not the project's to format.
	const cwd = getProjectRoot();
	const absPath = resolve(getSafeSessionCwd(), rawPath);
	const relativePath = relative(cwd, absPath);
	if (!relativePath || relativePath.startsWith('..')) return content;

	const matching = formatters.filter(formatter =>
		formatter.match.some(pattern => matchGlob(pattern, relativePath)),
	);
	if (matching.length === 0) return content;

	// Only the path reaches the formatter, and only through the environment:
	// `formatter.command` is the sole value the shell parses, so a
	// model-chosen path like `a.ts; rm -rf /` stays inert.
	const env: NodeJS.ProcessEnv = {
		...process.env,
		FILE: absPath,
		NANOCODER_FILE: absPath,
		NANOCODER_CWD: cwd,
	};

	const before = await readOrNull(absPath);
	const applied: string[] = [];
	for (const formatter of matching) {
		const label = formatter.name ?? formatter.command;
		const run = await runHookCommand(
			formatter,
			env,
			cwd,
			DEFAULT_FORMATTER_TIMEOUT_MS,
		);
		if (run.failure || run.exitCode !== 0) {
			const detail =
				run.failure ?? (run.stderr.trim() || run.stdout.trim() || '');
			logError(
				`Formatter "${label}" failed on ${relativePath}${
					detail ? `: ${detail}` : ` (exit ${run.exitCode})`
				}`,
			);
			continue;
		}
		applied.push(label);
	}

	const after = await readOrNull(absPath);
	if (applied.length === 0 || after === before) return content;

	// The tools read through a content cache; drop the pre-format entry so the
	// next read_file or edit sees what is actually on disk.
	invalidateCache(absPath);
	return `${content}\n\nNote: ${relativePath} was reformatted by ${applied.join(', ')}. Re-read it before editing it again.`;
}
