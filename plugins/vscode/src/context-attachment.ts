/**
 * Reading logic for `@[file]` / `@[folder]` attachments before they are
 * inlined into a prompt.
 *
 * Split out of `chat-webview-provider.ts` — which imports `vscode` and so
 * cannot be unit tested — because these caps are the guard rail that keeps a
 * mis-picked lockfile or minified bundle from silently consuming the whole
 * context window. See `context-attachment.spec.ts`.
 */

import * as fs from 'fs';

/** Largest slice of a single attached file that gets inlined. */
export const MAX_CONTEXT_FILE_BYTES = 100 * 1024;

/** Largest number of entries listed for an attached folder. */
export const MAX_CONTEXT_DIR_ENTRIES = 200;

/**
 * Bytes inspected for the binary sniff. A NUL in the first block is the
 * conventional heuristic; inlining a binary wastes context and some providers
 * reject the resulting payload outright.
 */
const BINARY_SNIFF_BYTES = 8000;

export function isBinary(buffer: Buffer): boolean {
	return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/**
 * Read up to `maxBytes` of a file as UTF-8.
 *
 * Returns null when the file is unreadable or looks binary, so the caller can
 * emit a placeholder instead of poisoning the prompt. Truncated reads carry an
 * explicit marker — silent truncation would leave the model reasoning about a
 * file it only partly received, with no way to know.
 */
export function readCappedFile(
	filePath: string,
	maxBytes: number = MAX_CONTEXT_FILE_BYTES,
): string | null {
	let fd: number | undefined;
	try {
		const stat = fs.statSync(filePath);
		// Windows happily opens a directory handle and a zero-length read off it
		// succeeds, which would otherwise yield an empty `<context>` block
		// instead of an honest "could not read" placeholder.
		if (!stat.isFile()) {
			return null;
		}

		const size = stat.size;
		const readLength = Math.min(size, maxBytes);
		const buffer = Buffer.alloc(readLength);

		fd = fs.openSync(filePath, 'r');
		const bytesRead = fs.readSync(fd, buffer, 0, readLength, 0);
		const slice = buffer.subarray(0, bytesRead);

		if (isBinary(slice)) {
			return null;
		}

		const content = slice.toString('utf8');
		if (size > readLength) {
			const omitted = size - readLength;
			return `${content}\n... [truncated: ${omitted} of ${size} bytes omitted]`;
		}
		return content;
	} catch {
		return null;
	} finally {
		if (fd !== undefined) {
			try {
				fs.closeSync(fd);
			} catch {}
		}
	}
}

/**
 * Compact one-per-line listing of a directory, directories suffixed with `/`.
 * Throws if the directory cannot be read, so the caller can report the reason.
 */
export function readCappedDirectory(
	dirPath: string,
	maxEntries: number = MAX_CONTEXT_DIR_ENTRIES,
): string {
	const entries = fs.readdirSync(dirPath, { withFileTypes: true });
	const shown = entries.slice(0, maxEntries);
	const lines = shown.map(entry =>
		entry.isDirectory() ? `${entry.name}/` : entry.name,
	);

	if (entries.length > shown.length) {
		lines.push(`... [truncated: ${entries.length - shown.length} more entries]`);
	}
	return lines.join('\n');
}
