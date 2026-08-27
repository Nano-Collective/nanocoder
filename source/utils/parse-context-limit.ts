/**
 * Parses a context limit value string, supporting k/K suffix.
 * e.g. "8192" -> 8192, "128k" -> 128000, "128K" -> 128000
 *
 * Framework-free so the CLI can apply `--context-max` without loading
 * React/Ink (needed for the ACP / plain / auth fast paths).
 */
export function parseContextLimit(value: string): number | null {
	const trimmed = value.trim().toLowerCase();
	let multiplier = 1;
	let numStr = trimmed;

	if (trimmed.endsWith('k')) {
		multiplier = 1000;
		numStr = trimmed.slice(0, -1);
	}

	const parsed = Number.parseFloat(numStr);
	if (Number.isNaN(parsed) || parsed <= 0) {
		return null;
	}

	return Math.round(parsed * multiplier);
}
