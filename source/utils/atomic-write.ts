import {randomUUID} from 'node:crypto';
import {mkdirSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
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
 * Ensure a file's parent directory exists, then atomically write pretty-printed
 * JSON. Convenience wrapper for config files that may not exist yet.
 */
export function atomicWriteJson(filePath: string, data: unknown): void {
	const dir = dirname(filePath);
	mkdirSync(dir, {recursive: true});
	atomicWriteFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}
