/**
 * Runs an async conversion while keeping `globalThis.process` intact.
 *
 * `@nanocollective/get-md` converts HTML through happy-dom, and on pages with
 * an `<iframe>` some of the extra happy-dom windows are created after get-md
 * has restored the global, each running a script that sets
 * `this.process = null` against the real global (see #1553). The reference is
 * saved before the conversion and re-installed after it settles, so whatever
 * the conversion chain did to the global, the rest of the process keeps a
 * working `process`.
 */

export async function withPreservedProcess<T>(
	fn: () => Promise<T>,
): Promise<T> {
	const savedProcess = globalThis.process;
	try {
		return await fn();
	} finally {
		if (globalThis.process !== savedProcess) {
			globalThis.process = savedProcess;
		}
	}
}
