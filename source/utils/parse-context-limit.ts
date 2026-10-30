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
	// Validate the final value rather than the parsed one: a long digit string
	// can overflow to Infinity, either on its own or once the `k` multiplier is
	// applied, and a small fraction can round down to 0. Callers store whatever
	// we hand back without further validation.
	const parsed = Number.parseFloat(match[1]);
	const multiplier = match[2] === 'k' ? 1000 : 1;
	const limit = Math.round(parsed * multiplier);
	if (!Number.isFinite(limit) || limit <= 0) {
		return null;
	}

	return limit;
}
