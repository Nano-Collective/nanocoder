import {randomUUID} from 'node:crypto';
import type {Stats} from 'node:fs';
import {
	constants,
	linkSync,
	mkdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import {
	access,
	lstat,
	open,
	realpath,
	rename,
	stat,
	unlink,
	writeFile,
} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';

/**
 * Retry budget for renaming a temp file over its target. Windows refuses a
 * rename onto a file that another rename or an open handle is using (EPERM,
 * EBUSY, sometimes EACCES); these sharing violations clear within
 * milliseconds. POSIX never blocks a rename this way, so on Linux and macOS
 * the retry only runs for a genuine permission error, which costs one bounded
 * backoff (~800 ms) before the original error is rethrown unchanged. Platform
 * is deliberately not checked so the retry path stays testable on Linux CI.
 */
const RENAME_MAX_RETRIES = 8;
const RENAME_BASE_DELAY_MS = 10;
const RENAME_MAX_DELAY_MS = 160;
const RENAME_JITTER_MS = 10;
const RETRYABLE_RENAME_CODES: ReadonlySet<string> = new Set([
	'EPERM',
	'EBUSY',
	'EACCES',
]);

function isRetryableRenameError(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
	return typeof code === 'string' && RETRYABLE_RENAME_CODES.has(code);
}

/** Exponential backoff with jitter, so concurrent writers don't retry in step. */
function renameBackoffMs(attempt: number): number {
	const base = Math.min(
		RENAME_BASE_DELAY_MS * 2 ** attempt,
		RENAME_MAX_DELAY_MS,
	);
	return base + Math.floor(Math.random() * RENAME_JITTER_MS);
}

/**
 * Rename primitives used by {@link atomicWriteFile}, {@link atomicWriteFileSync}
 * and {@link atomicWriteUserFile}, replaceable for tests (e.g. to simulate a
 * sharing violation, a bind-mounted file or a cross-device move).
 * Production code never touches these.
 * @internal
 */
type RenameFn = (oldPath: string, newPath: string) => Promise<void>;
type RenameSyncFn = (oldPath: string, newPath: string) => void;

const defaultRename: RenameFn = (oldPath, newPath) => rename(oldPath, newPath);
const defaultRenameSync: RenameSyncFn = (oldPath, newPath) =>
	renameSync(oldPath, newPath);

let renameImpl: RenameFn = defaultRename;
let renameSyncImpl: RenameSyncFn = defaultRenameSync;

/**
 * Test seam: replace the async rename primitive. Call with no arguments to
 * restore the default.
 * @internal
 */
export function setRenameForTests(impl?: RenameFn): void {
	renameImpl = impl ?? defaultRename;
}

/**
 * Test seam: replace the sync rename primitive. Call with no arguments to
 * restore the default.
 * @internal
 */
export function setRenameSyncForTests(impl?: RenameSyncFn): void {
	renameSyncImpl = impl ?? defaultRenameSync;
}

/**
 * Rename `from` onto `to`, retrying a bounded number of times when the
 * filesystem reports a transient sharing violation.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await renameImpl(from, to);
			return;
		} catch (error) {
			if (attempt >= RENAME_MAX_RETRIES || !isRetryableRenameError(error)) {
				throw error;
			}
			await new Promise<void>(resolve => {
				setTimeout(resolve, renameBackoffMs(attempt));
			});
		}
	}
}

/** Blocks the thread for `ms` without spinning. */
function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Sync variant of {@link renameWithRetry}. */
function renameSyncWithRetry(from: string, to: string): void {
	for (let attempt = 0; ; attempt++) {
		try {
			renameSyncImpl(from, to);
			return;
		} catch (error) {
			if (attempt >= RENAME_MAX_RETRIES || !isRetryableRenameError(error)) {
				throw error;
			}
			sleepSync(renameBackoffMs(attempt));
		}
	}
}

/**
 * Write data to disk via a temp file + atomic rename, so a crash mid-write can
 * never leave a truncated file at the target path. Callers are responsible for
 * ensuring the parent directory exists.
 */
export function atomicWriteFileSync(
	filePath: string,
	data: string,
	options?: {mode?: number},
): void {
	const tmpPath = `${filePath}.${randomUUID()}.tmp`;
	try {
		if (options?.mode === undefined) {
			writeFileSync(tmpPath, data, 'utf-8');
		} else {
			writeFileSync(tmpPath, data, {
				encoding: 'utf-8',
				mode: options.mode,
			});
		}
		renameSyncWithRetry(tmpPath, filePath);
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
		await renameWithRetry(tmpPath, filePath);
	} catch (error) {
		try {
			await unlink(tmpPath);
		} catch {}
		throw error;
	}
}

/**
 * Errors that mean a sibling temp file cannot be created or renamed over the
 * target (read-only directory with a writable file, bind-mounted file, file
 * owned by someone else, filesystem without rename support), while an
 * in-place write may still work. Errors such as ENOSPC are deliberately not
 * here: falling back would truncate the file the temp file was protecting.
 */
const IN_PLACE_FALLBACK_CODES = new Set([
	'EACCES',
	'EPERM',
	'EXDEV',
	'EBUSY',
	'ENOTSUP',
	'EOPNOTSUPP',
	'ENOSYS',
]);

function errorCode(error: unknown): string | undefined {
	return (error as NodeJS.ErrnoException)?.code;
}

/**
 * Work out which path to replace. Symlinks are resolved so the link's target
 * is updated, as `writeFile` would, rather than the link being replaced by a
 * regular file. Returns undefined when only an in-place write keeps the old
 * behaviour (a dangling symlink, which `writeFile` follows to create the
 * target).
 */
async function resolveUserFileTarget(
	filePath: string,
): Promise<string | undefined> {
	try {
		return await realpath(filePath);
	} catch (error) {
		if (errorCode(error) !== 'ENOENT') return undefined;
	}
	try {
		await lstat(filePath);
		// The path exists but cannot be resolved: a dangling symlink.
		return undefined;
	} catch {
		return filePath;
	}
}

/** Most bytes of the original name kept in a temp file name. */
const TEMP_NAME_PREFIX_BYTES = 64;

/**
 * Temp file name for {@link atomicWriteUserFile}: hidden, recognisable, and
 * well under the usual 255-byte name limit however long (or multibyte) the
 * original name is.
 */
function userFileTempName(name: string): string {
	let prefix = '';
	let bytes = 0;
	for (const char of name) {
		bytes += Buffer.byteLength(char, 'utf-8');
		if (bytes > TEMP_NAME_PREFIX_BYTES) break;
		prefix += char;
	}
	return `.${prefix}.${randomUUID()}.tmp`;
}

/**
 * Overwrite (or create) a file in the user's project so that a failure part
 * way through (disk full, process killed, power loss) leaves either the old
 * content or the new content, never a truncated file.
 *
 * The content goes to a temp file next to the target, is flushed to disk and
 * then renamed over it. Unlike {@link atomicWriteFile}, this keeps what an
 * in-place `writeFile` would have kept:
 * - symlinks are followed, so the link's target is updated;
 * - a file without write permission is refused with EACCES;
 * - the file's permission bits and, where allowed, its owner are copied;
 * - hard-linked files and non-regular files (FIFOs, devices) are written in
 *   place, since a rename would split or replace them;
 * - when the temp file cannot be created or renamed for permission or
 *   filesystem reasons, it falls back to an in-place write.
 *
 * Because the target is replaced by a new file, metadata other than the mode
 * and owner is not carried over: extended attributes, POSIX ACLs and SELinux
 * labels on the original are lost (the new file gets the directory defaults),
 * and file watchers see a rename rather than a modify.
 */
export async function atomicWriteUserFile(
	filePath: string,
	data: string,
): Promise<void> {
	const target = await resolveUserFileTarget(filePath);
	if (target === undefined) {
		await writeFile(filePath, data, 'utf-8');
		return;
	}

	let existing: Stats | undefined;
	try {
		existing = await stat(target);
	} catch (error) {
		if (errorCode(error) !== 'ENOENT') {
			await writeFile(target, data, 'utf-8');
			return;
		}
	}
	if (existing && (!existing.isFile() || existing.nlink > 1)) {
		await writeFile(target, data, 'utf-8');
		return;
	}

	if (existing) {
		// A rename never needs write access to the file itself, so check it
		// here: a read-only file is refused with EACCES, as writeFile would.
		await access(target, constants.W_OK);
	}

	const tmpPath = join(dirname(target), userFileTempName(basename(target)));
	try {
		const handle = await open(tmpPath, 'wx', 0o666);
		try {
			await handle.writeFile(data, 'utf-8');
			if (existing) {
				await handle.chmod(existing.mode & 0o7777);
				const created = await handle.stat();
				if (created.uid !== existing.uid || created.gid !== existing.gid) {
					await handle.chown(existing.uid, existing.gid);
				}
			}
			await handle.sync();
		} finally {
			await handle.close();
		}
		await renameImpl(tmpPath, target);
	} catch (error) {
		try {
			await unlink(tmpPath);
		} catch {}
		const code = errorCode(error);
		if (code !== undefined && IN_PLACE_FALLBACK_CODES.has(code)) {
			await writeFile(target, data, 'utf-8');
			return;
		}
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
 * Link primitive used by {@link publishFileNoClobber}, replaceable for
 * tests (e.g. to simulate filesystems without hard-link support).
 * Production code never touches this.
 * @internal
 */
type LinkSyncFn = (existingPath: string, newPath: string) => void;

let linkSyncImpl: LinkSyncFn = (existingPath, targetPath) =>
	linkSync(existingPath, targetPath);

/**
 * Test seam: replace the link primitive (e.g. with one that throws `EPERM`
 * to simulate FAT/exFAT or SMB/FUSE mounts). Call with no arguments to
 * restore the default.
 * @internal
 */
export function setLinkSyncForTests(impl?: LinkSyncFn): void {
	linkSyncImpl =
		impl ?? ((existingPath, targetPath) => linkSync(existingPath, targetPath));
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
	const tmpPath = `${newPath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(tmpPath, data, 'utf-8');
		try {
			linkSyncImpl(tmpPath, newPath);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException)?.code;
			if (code === 'EEXIST') {
				// A concurrent process published first: adopt its file.
				return false;
			}
			if (
				code === 'EPERM' ||
				code === 'ENOTSUP' ||
				code === 'EOPNOTSUPP' ||
				code === 'ENOSYS'
			) {
				// Filesystem without hard-link support (FAT/exFAT, some
				// SMB/FUSE mounts): fall back to an exclusive create, which
				// still never overwrites — EEXIST from it likewise means a
				// peer won.
				try {
					writeFileSync(newPath, data, {flag: 'wx'});
				} catch (writeError) {
					if ((writeError as NodeJS.ErrnoException)?.code === 'EEXIST') {
						return false;
					}
					throw writeError;
				}
				return true;
			}
			throw error;
		}
		return true;
	} finally {
		try {
			unlinkSync(tmpPath);
		} catch {
			// Already consumed by a successful link, or never created.
		}
	}
}
