import {randomUUID} from 'node:crypto';
import {mkdirSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
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
