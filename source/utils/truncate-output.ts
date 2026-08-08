/**
 * Truncate text for LLM consumption, keeping both the head and the tail
 * instead of just the head. Compiler and test-runner output puts the
 * actionable part (error list, failure summary, exit status) at the end,
 * so a head-only cut throws away exactly what the model needs most and
 * forces an extra round-trip with a narrower command to recover it.
 *
 * The tail gets the larger share of the budget, since that is where the
 * actionable content usually is.
 */
export function truncateHeadAndTail(text: string, limit: number): string {
	if (text.length <= limit) {
		return text;
	}

	const headLength = Math.floor(limit * 0.4);
	const tailLength = limit - headLength;
	const elidedCount = text.length - headLength - tailLength;

	const head = text.slice(0, headLength);
	const tail = text.slice(text.length - tailLength);

	return `${head}\n... [Output truncated: ${elidedCount} characters elided] ...\n${tail}`;
}
