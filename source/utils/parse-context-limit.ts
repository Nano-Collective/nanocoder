/**
 * Parses a context limit value string, supporting k/K and m/M suffixes.
 * e.g. "8192" -> 8192, "128k" -> 128000, "1.5m" -> 1500000
 *
 * Framework-free so the CLI can apply `--context-max` without loading
 * React/Ink (needed for the ACP / plain / auth fast paths).
 */
export function parseContextLimit(value: string): number | null {
	const trimmed = value.trim().toLowerCase();
	const match = /^(\d+)(?:\.(\d+))?([km])?$/.exec(trimmed);

	if (!match) {
		return null;
	}

	const [, integerPart, fractionalPart, suffix] = match;
	if (fractionalPart !== undefined && suffix === undefined) {
		return null;
	}

	const parsed = Number(
		`${integerPart}${fractionalPart ? `.${fractionalPart}` : ''}`,
	);
	if (!Number.isFinite(parsed)) {
		return null;
	}

	if (suffix === undefined && !Number.isSafeInteger(parsed)) {
		return null;
	}

	const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : 1;
	const limit = Math.round(parsed * multiplier);
	// Context limits are stored and propagated as JavaScript numbers. Reject
	// values outside the safe integer range rather than silently losing tokens.
	if (!Number.isSafeInteger(limit) || limit <= 0) {
		return null;
	}

	return limit;
}
