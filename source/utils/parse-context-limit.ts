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

	// The regex only matches digits, so `parseFloat` can never return NaN here.
	// It can still overflow to Infinity on a very long digit string, and callers
	// store whatever we hand back without further validation.
	const parsed = Number.parseFloat(match[1]);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return null;
	}

	const multiplier = match[2] === 'k' ? 1000 : 1;
	return Math.round(parsed * multiplier);
}
