/**
 * Parses a context limit value string, supporting k/K suffix.
 * e.g. "8192" -> 8192, "128k" -> 128000, "128K" -> 128000
 *
 * Framework-free so the CLI can apply `--context-max` without loading
 * React/Ink (needed for the ACP / plain / auth fast paths).
 */
export function parseContextLimit(value: string): number | null {
	const trimmed = value.trim().toLowerCase();
	const match = /^(\d+(?:\.\d+)?)(k)?$/.exec(trimmed);

	if (!match) {
		return null;
	}

	const [, numStr, suffix] = match;
	const parsed = Number.parseFloat(numStr);
	if (parsed <= 0) {
		return null;
	}

	const multiplier = suffix === 'k' ? 1000 : 1;
	return Math.round(parsed * multiplier);
}
