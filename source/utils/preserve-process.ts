/**
 * Runs an async conversion while keeping `globalThis.process` intact.
 *
 * `@nanocollective/get-md` conversions can occasionally corrupt the global
 * `process` object. This wrapper saves the reference before the conversion
 * and restores it afterward.
 */

export async function withPreservedProcess<T>(
	fn: () => Promise<T>,
): Promise<T> {
	const savedProcess = globalThis.process;
	try {
		return await fn();
	} finally {
		globalThis.process = savedProcess;
	}
}
