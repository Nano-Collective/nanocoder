/**
 * ESM loader hook that counts how many unique module URLs Node resolves
 * during boot.
 *
 * Used by `benchmarks/measure.ts` as a deterministic proxy for startup
 * cost: the count is stable across runs, machines, and OSes, so it works
 * reliably in CI unlike wall-clock timing.
 *
 * **Why unique URLs rather than raw resolve calls?** Node calls the resolve
 * hook for every `import` statement in the source. A hot file like
 * `useTheme.js` that's imported from 53 places would count 53 times, but
 * Node only loads and executes it once — those extra 52 calls are just
 * cache hits. Counting unique URLs cleanly reflects "how many files did
 * Node actually have to load".
 *
 * Two env vars control output:
 *   MODULE_COUNT_FILE — the current unique count is written here on every
 *     new resolution (cheap, used by the default benchmark path)
 *   MODULE_URL_FILE — every resolved URL (not deduplicated) is appended
 *     here (used by the `--explain` diagnostic mode to group by package)
 *
 * The loader thread does not share memory with the main thread, so writing
 * on every unique resolve is the simplest way to survive process exit.
 */
import fs from 'node:fs';

const seen = new Set();
const countFile = process.env.MODULE_COUNT_FILE;
const urlFile = process.env.MODULE_URL_FILE;

export async function resolve(specifier, context, nextResolve) {
	const result = await nextResolve(specifier, context);
	if (result?.url && !seen.has(result.url)) {
		seen.add(result.url);
		if (countFile) {
			fs.writeFileSync(countFile, String(seen.size));
		}
	}
	if (urlFile && result?.url) {
		fs.appendFileSync(urlFile, `${result.url}\n`);
	}
	return result;
}
