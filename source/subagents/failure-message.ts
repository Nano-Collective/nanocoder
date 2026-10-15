/**
 * Shared rendering for a failed subagent run.
 *
 * A failed run can still carry work — a subagent stopped by the repeated-call
 * cap returns everything it produced before it got stuck. Hand that to the
 * caller alongside the reason rather than throwing it away.
 *
 * Both execution paths (the native agent tool and the conversation loop's agent
 * batch) render this text, so it lives here to keep them from drifting.
 *
 * @param error - Reason the run failed, if the executor reported one
 * @param output - Whatever the subagent produced before stopping
 */
export function buildSubagentFailureMessage(
	error: string | undefined,
	output: string,
): string {
	const reason = error || 'Subagent execution failed';
	return output.trim()
		? `${reason}\n\nPartial output produced before stopping:\n${output}`
		: reason;
}
