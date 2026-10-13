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
import * as path from 'path';

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

		return withTruncationMarker(slice.toString('utf8'), size, readLength);
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

function withTruncationMarker(
	content: string,
	totalBytes: number,
	keptBytes: number,
): string {
	if (totalBytes <= keptBytes) return content;
	const omitted = totalBytes - keptBytes;
	return `${content}\n... [truncated: ${omitted} of ${totalBytes} bytes omitted]`;
}

/**
 * Cap in-memory text exactly as {@link readCappedFile} caps a file on disk:
 * same byte limit, same binary check, same truncation marker.
 */
export function capText(
	text: string,
	maxBytes: number = MAX_CONTEXT_FILE_BYTES,
): string | null {
	const buffer = Buffer.from(text, 'utf8');
	const slice = buffer.subarray(0, maxBytes);
	if (isBinary(slice)) {
		return null;
	}
	return withTruncationMarker(slice.toString('utf8'), buffer.length, slice.length);
}

/** The parts of a `vscode.TextDocument` needed to match it to a path. */
export interface OpenDocument {
	uri: { scheme: string; fsPath: string };
	getText(): string;
}

function samePath(a: string, b: string): boolean {
	const normalize = (p: string) => {
		const resolved = path.resolve(p);
		return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
	};
	return normalize(a) === normalize(b);
}

/**
 * Text of the editor that has `filePath` open, or undefined when no editor
 * does. Only `file:` documents count; an untitled buffer or a git diff view
 * is not the file the user attached.
 */
export function findOpenDocumentText(
	filePath: string,
	documents: readonly OpenDocument[],
): string | undefined {
	return documents
		.find(doc => doc.uri.scheme === 'file' && samePath(doc.uri.fsPath, filePath))
		?.getText();
}

/**
 * Content for an `@[file]` attachment. An open editor's buffer wins over the
 * disk, so unsaved edits are what the model sees; otherwise the file is read
 * from disk. Both are capped the same way.
 */
export function readAttachedFile(
	filePath: string,
	openDocumentText: (filePath: string) => string | undefined,
	maxBytes: number = MAX_CONTEXT_FILE_BYTES,
): string | null {
	const buffer = openDocumentText(filePath);
	return buffer === undefined
		? readCappedFile(filePath, maxBytes)
		: capText(buffer, maxBytes);
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
