import {randomUUID} from 'node:crypto';
import {
	closeSync,
	fsyncSync,
	linkSync,
	mkdirSync,
	openSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import {rename, unlink, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

/**
 * Write data to disk via a temp file + atomic rename, so a crash mid-write can
 * never leave a truncated file at the target path. Callers are responsible for
 * ensuring the parent directory exists.
 */
export function atomicWriteFileSync(filePath: string, data: string): void {
	const tmpPath = `${filePath}.${randomUUID()}.tmp`;
	try {
		writeFileSync(tmpPath, data, 'utf-8');
		renameSync(tmpPath, filePath);
	} catch (error) {
		try {
			unlinkSync(tmpPath);
		} catch {}
		throw error;
	}
}

/**
 * Async variant of {@link atomicWriteFileSync}. The optional mode covers call
 * sites that create permission-restricted files (for example session files).
 */
export async function atomicWriteFile(
	filePath: string,
	data: string,
	options?: {mode?: number},
): Promise<void> {
	const tmpPath = `${filePath}.${randomUUID()}.tmp`;
	try {
		if (options?.mode === undefined) {
			await writeFile(tmpPath, data, 'utf-8');
		} else {
			await writeFile(tmpPath, data, {encoding: 'utf-8', mode: options.mode});
		}
		await rename(tmpPath, filePath);
	} catch (error) {
		try {
			await unlink(tmpPath);
		} catch {}
		throw error;
	}
}

/**
 * Ensure a file's parent directory exists, then atomically write pretty-printed
 * JSON. Convenience wrapper for config files that may not exist yet.
 */
export function atomicWriteJson(filePath: string, data: unknown): void {
	const dir = dirname(filePath);
	mkdirSync(dir, {recursive: true});
	atomicWriteFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Best-effort durability sync. Failures must never fail the surrounding
 * operation (e.g. directory fsync on Windows), so all errors are swallowed
 * — the data itself is already fully written either way.
 */
function fsyncBestEffort(targetPath: string): void {
	try {
		const fd = openSync(targetPath, 'r');
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
	} catch {
		// ignore — durability hint only
	}
}

/**
 * Publish file content at `newPath` without ever overwriting an existing
 * destination. Returns true when this call published the file, false when a
 * destination was already present — i.e. a concurrent process won the race
 * and its (fresher) file is adopted untouched.
 *
 * The payload goes to a unique temp file in the destination directory
 * first and is published with a hard link, which is atomic and raises
 * EEXIST when the destination appeared concurrently. Because temp and
 * destination share a directory, a cross-device move can never occur, so —
 * unlike a `renameSync` + copy fallback — there is no path that overwrites
 * the winner's file with this stale copy.
 */
export function publishFileNoClobber(
	newPath: string,
	data: string | Buffer,
): boolean {
	// No existsSync fast path here on purpose: the link below is the atomic
	// arbiter, and attempting it unconditionally keeps the EEXIST branch
	// genuinely reachable (and covered by tests) instead of dead code
	// hiding behind a racy pre-check.
	const tmpPath = `${newPath}.${process.pid}.${randomUUID()}.tmp`;
	writeFileSync(tmpPath, data, 'utf-8');
	try {
		fsyncBestEffort(tmpPath);
		try {
			linkSync(tmpPath, newPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
				// A concurrent process published first: adopt its file.
				return false;
			}
			throw error;
		}
		// Sync the directory so the new link entry itself is durable.
		fsyncBestEffort(dirname(newPath));
		return true;
	} finally {
		try {
			unlinkSync(tmpPath);
		} catch {
			// Already consumed by a successful link, or never created.
		}
	}
}
