import fs from 'fs/promises';
import path from 'path';

const MAX_COLLISION_ATTEMPTS = 5;

/**
 * Finds a free filename next to `filepath` and writes `content` to it
 * atomically, returning the path actually written.
 *
 * The write uses the exclusive flag 'wx' so the free-check and the create are
 * a single atomic step: two concurrent writers for the same target can never
 * both succeed on the same path (no TOCTOU race, no clobbering). On EEXIST we
 * try the next collision suffix (`-2`, `-3`, ...); once the bounded attempts
 * are exhausted we fall back to a timestamp suffix, which is cheaper than
 * walking a long sequential run. This function never falls through to
 * overwriting an existing file — if it cannot find a free name it throws.
 *
 * Callers must pass an already-validated, containment-checked absolute path
 * (see `resolveFilePath`). The suffixes are appended to the basename only, so
 * every candidate stays in the same directory as `filepath`.
 */
export async function writeUniqueFile(
	filepath: string,
	content: string,
): Promise<string> {
	const dir = path.dirname(filepath);
	const ext = path.extname(filepath);
	const base = path.basename(filepath, ext);

	const tryWrite = async (candidate: string): Promise<string | null> => {
		try {
			await fs.writeFile(candidate, content, {flag: 'wx'});
			return candidate;
		} catch (error) {
			if (error && typeof error === 'object' && 'code' in error) {
				// Collision: try the next candidate.
				if (error.code === 'EEXIST') return null;
				// Missing parent directory: report it plainly so the caller knows
				// the write failed because a directory doesn't exist.
				if (error.code === 'ENOENT') {
					throw new Error(`Parent directory does not exist: ${dir}`);
				}
			}
			throw error;
		}
	};

	for (let i = 1; i < MAX_COLLISION_ATTEMPTS + 1; i++) {
		const suffix = i === 1 ? '' : `-${i}`;
		// `filepath` was already validated and containment-checked by the caller,
		// so `dir`/`base`/`ext` cannot contain a separator or `..` and this join
		// can never leave `dir`.
		// nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
		const candidate = path.join(dir, `${base}${suffix}${ext}`);
		const written = await tryWrite(candidate);
		if (written) return written;
	}

	// Bounded attempts all collided, drop a timestamp and try once more. If the
	// astronomically-unlikely timestamp collision happens, surface the error
	// rather than clobber anything.
	// nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
	const timestamped = path.join(dir, `${base}-new-${Date.now()}${ext}`);
	const written = await tryWrite(timestamped);
	if (!written) {
		throw new Error(`Unable to allocate a unique filename for: ${filepath}`);
	}
	return written;
}
