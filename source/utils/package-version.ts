import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Placeholder shown when the version cannot be determined. Deliberately not a
 * semver string: `0.0.0` reads like a real release in the banner, `/help` and
 * `/doctor`, which hides the fact that something is wrong with the install.
 */
export const UNKNOWN_VERSION = 'unknown';

/**
 * Given the directory of the compiled module, return the path to the nearest
 * `package.json` by trying two candidate locations:
 *
 * - `../package.json`  — rolldown layout: everything compiles into a flat `dist/`
 * - `../../package.json` — tsc layout: module lands in `dist/utils/`
 *
 * The first candidate that exists on disk wins; if neither exists the first
 * candidate is returned as-is (so the error surfaces at read time, not here).
 *
 * Exported so that tests can drive the resolution logic directly with a
 * temporary directory, without relying on the module-load-time `__dirname`.
 */
export function resolvePackageJsonPath(moduleDir: string): string {
	const candidates = [
		path.join(moduleDir, '../package.json'),
		path.join(moduleDir, '../../package.json'),
	];
	return candidates.find(p => fs.existsSync(p)) ?? candidates[0];
}

const DEFAULT_PACKAGE_JSON_PATH = resolvePackageJsonPath(__dirname);

/**
 * Read this package's version off disk, never throwing.
 *
 * A missing, unreadable, or malformed `package.json` (a misbuilt or partially
 * copied install) must not take the CLI down, so every failure collapses to
 * {@link UNKNOWN_VERSION}. Callers that read the version at module load depend
 * on this: an exception there is unrecoverable and kills the process before
 * anything is rendered.
 */
export function getPackageVersion(
	packageJsonPath: string = DEFAULT_PACKAGE_JSON_PATH,
): string {
	try {
		const packageJson = JSON.parse(
			fs.readFileSync(packageJsonPath, 'utf8'),
		) as {version?: unknown};

		return typeof packageJson.version === 'string' && packageJson.version
			? packageJson.version
			: UNKNOWN_VERSION;
	} catch {
		return UNKNOWN_VERSION;
	}
}
