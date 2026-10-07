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

const DEFAULT_PACKAGE_JSON_PATH = path.join(__dirname, '../../package.json');

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
