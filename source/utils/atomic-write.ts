import {randomUUID} from 'node:crypto';
import {
	linkSync,
	mkdirSync,
	readlinkSync,
	realpathSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import {rename, unlink, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, resolve} from 'node:path';

/** Owner-only permissions for files that may hold credentials. */
const PRIVATE_FILE_MODE = 0o600;

interface WriteTarget {
	/** Real file to write to, with symlinks resolved when possible. */
	path: string;
	/** Mode of the existing file, if it already exists. */
	mode?: number;
}

/**
 * Resolve where an atomic write should land: the real file behind a symlink (a
 * renamed-over link would be replaced by a plain file and leave its target
 * stale), and the mode of the existing file. A dangling symlink is followed to
 * the path it points at so the write can create that target.
 */
function resolveWriteTarget(filePath: string): WriteTarget {
	let targetPath = filePath;
	try {
		targetPath = realpathSync(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
			try {
				const link = readlinkSync(filePath);
				targetPath = isAbsolute(link) ? link : resolve(dirname(filePath), link);
			} catch {
				// Not a symlink (or not there yet): write the path as given.
			}
		}
	}
	try {
		return {path: targetPath, mode: statSync(targetPath).mode & 0o777};
	} catch {
		return {path: targetPath};
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
 * JSON. Follows symlinks so a dotfiles-managed config keeps its link, and
 * keeps an existing file's mode unless `options.mode` overrides it.
 */
export function atomicWriteJson(
	filePath: string,
	data: unknown,
	options?: {mode?: number},
): void {
	const target = resolveWriteTarget(filePath);
	mkdirSync(dirname(target.path), {recursive: true});
	atomicWriteFileSync(target.path, `${JSON.stringify(data, null, 2)}\n`, {
		mode: options?.mode ?? target.mode,
	});
}

/**
 * Atomically write a config file that may contain credentials. New files are
 * created owner-only (0600); an existing file keeps its current mode. Symlinks
 * are followed like {@link atomicWriteJson}, so the real file is updated.
 */
export function atomicWritePrivateJson(filePath: string, data: unknown): void {
	const target = resolveWriteTarget(filePath);
	atomicWriteJson(target.path, data, {
		mode: target.mode ?? PRIVATE_FILE_MODE,
	});
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
